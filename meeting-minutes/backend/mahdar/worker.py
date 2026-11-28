"""The background worker: claims jobs from the PostgreSQL queue and runs them.

Run with ``python -m mahdar.worker``. Each worker runs MAHDAR_WORKER_CONCURRENCY jobs at a time
(default 1: transcription uses every core), beats a heartbeat for the container health check, and
sweeps expired data every MAHDAR_RETENTION_SWEEP_HOURS.
"""

from __future__ import annotations

import logging
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from mahdar.config import get_settings
from mahdar.db.core import system_tx
from mahdar.jobs import queue
from mahdar.logging_setup import setup_logging

log = logging.getLogger("mahdar.worker")
_stop = threading.Event()


def _handle(signum, _frame) -> None:
    log.info("stopping after the current job", extra={"signal": signum})
    _stop.set()


def main() -> None:
    setup_logging()
    s = get_settings()
    signal.signal(signal.SIGTERM, _handle)
    signal.signal(signal.SIGINT, _handle)
    wid = queue.worker_id()
    from mahdar.pipeline.orchestrator import run_job
    from mahdar.retention import sweep

    log.info("worker started", extra={"worker": wid, "concurrency": s.worker_concurrency})
    running: set = set()
    last_sweep = 0.0
    with ThreadPoolExecutor(max_workers=s.worker_concurrency) as pool:
        while not _stop.is_set():
            try:
                with system_tx() as c:
                    queue.beat_worker(c, wid)
                if time.monotonic() - last_sweep > s.retention_sweep_hours * 3600:
                    last_sweep = time.monotonic()
                    try:
                        sweep()
                    except Exception:
                        log.exception("retention sweep failed")
                running = {f for f in running if not f.done()}
                if len(running) < s.worker_concurrency:
                    with system_tx() as c:
                        job = queue.claim(c, wid)
                    if job:
                        log.info("job claimed", extra={"job": str(job["id"]), "kind": job["kind"], "attempt": job["attempts"]})
                        running.add(pool.submit(run_job, job))
                        continue
            except Exception:
                log.exception("worker loop error")
            _stop.wait(2.0)
    log.info("worker stopped")


if __name__ == "__main__":
    main()
