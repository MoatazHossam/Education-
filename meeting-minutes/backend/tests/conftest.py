"""Test setup: a fresh PostgreSQL database per run (MAHDAR_TEST_DATABASE_URL is a superuser URL),
migrated, with the runtime role mahdar_app so row-level security is really enforced, a temporary
storage directory and a random data key."""

from __future__ import annotations

import base64
import os
import secrets
import uuid
from pathlib import Path

import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

ROOT = Path(__file__).resolve().parents[2]
RECORDINGS = ROOT / "evaluation" / "recordings"
SCENARIOS = ROOT / "evaluation" / "scenarios"


def _reset() -> None:
    from mahdar import storage
    from mahdar.config import get_settings
    from mahdar.db.core import reset_engines

    get_settings.cache_clear()
    reset_engines()
    storage.reset()


@pytest.fixture(scope="session", autouse=True)
def env(tmp_path_factory):
    os.environ["MAHDAR_ENV"] = "test"
    os.environ["MAHDAR_DATA_KEY"] = base64.b64encode(secrets.token_bytes(32)).decode()
    os.environ["MAHDAR_SECRET_KEY"] = secrets.token_urlsafe(48)
    os.environ["MAHDAR_DATA_DIR"] = str(tmp_path_factory.mktemp("data"))
    os.environ.setdefault("MAHDAR_LLM_PROVIDER", "none")
    _reset()
    yield


@pytest.fixture(scope="session")
def database(env):
    admin = os.environ.get("MAHDAR_TEST_DATABASE_URL")
    if not admin:
        pytest.skip("MAHDAR_TEST_DATABASE_URL is not set (a PostgreSQL superuser URL)")
    name = f"mahdar_test_{uuid.uuid4().hex[:8]}"
    eng = create_engine(admin, isolation_level="AUTOCOMMIT")
    with eng.connect() as c:
        c.execute(text(f"create database {name}"))
    url = make_url(admin).set(database=name)
    app_password = secrets.token_urlsafe(16)
    os.environ["MAHDAR_DATABASE_URL"] = url.render_as_string(hide_password=False)
    os.environ["MAHDAR_APP_DATABASE_URL"] = url.set(username="mahdar_app", password=app_password).render_as_string(hide_password=False)
    os.environ.pop("MAHDAR_APP_DB_PASSWORD", None)
    _reset()
    from mahdar.db.core import migrate

    migrate(app_password)
    yield name
    _reset()
    with eng.connect() as c:
        c.execute(text(f"select pg_terminate_backend(pid) from pg_stat_activity where datname = '{name}'"))
        c.execute(text(f"drop database if exists {name}"))
    eng.dispose()


class FakeLlm:
    """Test double for the language-model interface: returns the given replies in order, per stage."""

    provider = "fake"
    model = "fake-model"

    def __init__(self, replies: dict[str, list]):
        self.replies = {k: list(v) for k, v in replies.items()}
        self.requests: list = []

    def generate_json(self, req):
        from mahdar.pipeline.llm.base import LlmResult, validate

        self.requests.append(req)
        queue = self.replies.get(req.stage)
        if not queue:
            raise AssertionError(f"unexpected {req.stage} call")
        data = queue.pop(0)
        data = data(req) if callable(data) else data
        validate(data, req.schema)
        return LlmResult(data=data, model=self.model)
