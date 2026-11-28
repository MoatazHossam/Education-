"""Database access: engines, organization-scoped transactions and migrations.

Every transaction that touches content runs ``org_tx(org_id)``, which sets ``mahdar.org_id`` for
that transaction only (``set_config(..., true)``); row-level security then hides every other
organization's rows. ``system_tx()`` is for the few cross-organization reads that carry no content
(login lookup, the job queue, retention sweeps), and sets no organization.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from contextlib import contextmanager
from functools import lru_cache
from importlib import resources
from uuid import UUID

from sqlalchemy import Connection, Engine, create_engine, text
from sqlalchemy.engine import make_url

from mahdar.config import get_settings

_ADVISORY_LOCK = 724_105_331  # migrations: one runner at a time
APP_ROLE = "mahdar_app"


@lru_cache
def engine() -> Engine:
    s = get_settings()
    return create_engine(s.app_database_url or s.database_url, pool_pre_ping=True, pool_size=10, max_overflow=10)


@lru_cache
def owner_engine() -> Engine:
    return create_engine(get_settings().database_url, pool_pre_ping=True, pool_size=2)


def reset_engines() -> None:
    for fn in (engine, owner_engine):
        if fn.cache_info().currsize:
            fn().dispose()
        fn.cache_clear()


@contextmanager
def org_tx(org_id: UUID | str) -> Iterator[Connection]:
    with engine().begin() as conn:
        conn.execute(text("select set_config('mahdar.org_id', :org, true)"), {"org": str(org_id)})
        yield conn


@contextmanager
def system_tx() -> Iterator[Connection]:
    with engine().begin() as conn:
        yield conn


def _migrations() -> list[tuple[str, str]]:
    folder = resources.files("mahdar.db") / "migrations"
    files = sorted(p.name for p in folder.iterdir() if p.name.endswith(".sql"))
    return [(name, (folder / name).read_text(encoding="utf-8")) for name in files]


def migrate(app_password: str | None = None) -> list[str]:
    """Applies pending migrations (one runner at a time); returns the names applied."""
    applied: list[str] = []
    with owner_engine().begin() as conn:
        conn.execute(text("select pg_advisory_xact_lock(:k)"), {"k": _ADVISORY_LOCK})
        conn.execute(
            text("create table if not exists schema_migrations (name text primary key, applied_at timestamptz default now())")
        )
        done = {r[0] for r in conn.execute(text("select name from schema_migrations"))}
        for name, sql in _migrations():
            if name in done:
                continue
            # The raw driver cursor without parameters: migration SQL may contain "%" (format()).
            conn.connection.cursor().execute(sql)
            conn.execute(text("insert into schema_migrations (name) values (:n)"), {"n": name})
            applied.append(name)
        if app_password:
            _ensure_app_role(conn, app_password)
    return applied


def _ensure_app_role(conn: Connection, password: str) -> None:
    """The runtime role: no superuser, no BYPASSRLS, only data privileges."""
    exists = conn.execute(text("select 1 from pg_roles where rolname = :r"), {"r": APP_ROLE}).first()
    # Role names cannot be bound parameters; APP_ROLE is a constant. The password is a literal
    # quoted by PostgreSQL's own quote_literal.
    quoted = conn.execute(text("select quote_literal(:p)"), {"p": password}).scalar_one()
    verb = "alter" if exists else "create"
    conn.exec_driver_sql(f"{verb} role {APP_ROLE} login nosuperuser nobypassrls nocreatedb nocreaterole password {quoted}")
    db = make_url(get_settings().database_url).database
    if db and re.fullmatch(r"[A-Za-z0-9_]+", db):
        conn.exec_driver_sql(f"grant connect on database {db} to {APP_ROLE}")
    conn.exec_driver_sql(f"grant usage on schema public to {APP_ROLE}")
    conn.exec_driver_sql(f"grant select, insert, update, delete on all tables in schema public to {APP_ROLE}")
    conn.exec_driver_sql(f"grant usage, select on all sequences in schema public to {APP_ROLE}")
    conn.exec_driver_sql(f"revoke all on schema_migrations from {APP_ROLE}")
    conn.exec_driver_sql(f"grant select on schema_migrations to {APP_ROLE}")  # readiness check
