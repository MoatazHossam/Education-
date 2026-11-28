"""PostgreSQL job queue: claims with FOR UPDATE SKIP LOCKED, heartbeats, retries with backoff.

A job whose worker died (no heartbeat for ``STALE_SECONDS``) is put back in the queue. The pipeline
is resumable: each stage saves its artifact, so a retried job continues from the last saved stage.
"""

from __future__ import annotations

import json
import socket
import os
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Connection, text

from mahdar.db import repo

STALE_SECONDS = 300


def worker_id() -> str:
    return f"{socket.gethostname()}:{os.getpid()}"


def enqueue(conn: Connection, org_id: str, meeting_id: str | None, kind: str, payload: dict | None = None,
            max_attempts: int = 3) -> str:
    jid = repo.new_uuid()
    conn.execute(
        text(
            "insert into jobs (id, org_id, meeting_id, kind, payload, max_attempts) "
            "values (:id, :org, :m, :k, cast(:p as jsonb), :ma)"
        ),
        {"id": jid, "org": org_id, "m": meeting_id, "k": kind, "p": json.dumps(payload or {}), "ma": max_attempts},
    )
    return jid


def claim(conn: Connection, wid: str) -> dict | None:
    conn.execute(
        text(
            "update jobs set status = 'queued', locked_by = null, locked_at = null "
            "where status = 'running' and heartbeat_at < now() - make_interval(secs => :s)"
        ),
        {"s": STALE_SECONDS},
    )
    row = conn.execute(
        text(
            "select id from jobs where status = 'queued' and run_after <= now() "
            "order by run_after, created_at for update skip locked limit 1"
        )
    ).first()
    if not row:
        return None
    job = conn.execute(
        text(
            "update jobs set status = 'running', attempts = attempts + 1, locked_by = :w, locked_at = now(), "
            "heartbeat_at = now() where id = :id returning *"
        ),
        {"w": wid, "id": row[0]},
    ).mappings().first()
    return dict(job) if job else None


def heartbeat(conn: Connection, job_id: str, *, stage: str | None = None, progress: float | None = None) -> None:
    conn.execute(
        text(
            "update jobs set heartbeat_at = now(), stage = coalesce(:s, stage), progress = coalesce(:p, progress) "
            "where id = :id"
        ),
        {"id": job_id, "s": stage, "p": progress},
    )


def record_stage(conn: Connection, job_id: str, entry: dict[str, Any]) -> None:
    conn.execute(
        text("update jobs set stages = stages || cast(:e as jsonb) where id = :id"),
        {"id": job_id, "e": json.dumps([entry], default=str, ensure_ascii=False)},
    )


def succeed(conn: Connection, job_id: str) -> None:
    conn.execute(
        text("update jobs set status = 'succeeded', progress = 1, finished_at = now(), locked_by = null where id = :id"),
        {"id": job_id},
    )


def fail(conn: Connection, job: dict, error: str, *, retry: bool) -> bool:
    """Returns True when the job will be retried."""
    again = retry and job["attempts"] < job["max_attempts"]
    if again:
        delay = min(30 * 2 ** (job["attempts"] - 1), 900)
        conn.execute(
            text(
                "update jobs set status = 'queued', locked_by = null, error = :e, "
                "run_after = now() + make_interval(secs => :d) where id = :id"
            ),
            {"id": job["id"], "e": error[:2000], "d": delay},
        )
    else:
        conn.execute(
            text("update jobs set status = 'failed', error = :e, finished_at = now(), locked_by = null where id = :id"),
            {"id": job["id"], "e": error[:2000]},
        )
    return again


def cancel_meeting_jobs(conn: Connection, meeting_id: str) -> None:
    conn.execute(
        text("update jobs set status = 'cancelled', finished_at = now() where meeting_id = :m and status in ('queued')"),
        {"m": meeting_id},
    )


def latest_job(conn: Connection, meeting_id: str) -> dict | None:
    row = conn.execute(
        text("select * from jobs where meeting_id = :m order by created_at desc limit 1"), {"m": meeting_id}
    ).mappings().first()
    return dict(row) if row else None


def active_job(conn: Connection, meeting_id: str) -> dict | None:
    row = conn.execute(
        text("select * from jobs where meeting_id = :m and status in ('queued', 'running') order by created_at desc limit 1"),
        {"m": meeting_id},
    ).mappings().first()
    return dict(row) if row else None


def beat_worker(conn: Connection, wid: str) -> None:
    conn.execute(
        text(
            "insert into worker_heartbeats (worker_id, seen_at) values (:w, now()) "
            "on conflict (worker_id) do update set seen_at = now()"
        ),
        {"w": wid},
    )


def last_worker_beat(conn: Connection) -> datetime | None:
    v = conn.execute(text("select max(seen_at) from worker_heartbeats")).scalar()
    return v.astimezone(UTC) if v else None
