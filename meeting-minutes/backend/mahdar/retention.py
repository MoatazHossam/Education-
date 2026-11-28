"""Retention: deletes recordings, transcripts and documents once an organization's retention
period for that kind of data has passed. What goes is the content (files are deleted from storage,
artifact content is emptied); the record that something existed — hashes, dates, the audit trail —
stays. Deleting a meeting removes everything except its audit entries."""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta

from sqlalchemy import text

from mahdar import storage
from mahdar.db import repo
from mahdar.db.core import org_tx, system_tx

log = logging.getLogger("mahdar.retention")

AUDIO_BLOBS = ["audio_original", "audio_normalized"]
DOC_BLOBS = ["minutes_docx", "minutes_pdf", "evidence_pdf", "transcript_pdf", "summary_pdf", "actions_csv", "export_json", "transcript_txt"]
TRANSCRIPT_ARTIFACTS = ["asr_chunks", "diarization", "transcript", "analysis", "verification", "minutes", "review"]


def _expired(created: datetime, days: int | None) -> bool:
    return days is not None and created < datetime.now(UTC) - timedelta(days=int(days))


def sweep() -> dict:
    with system_tx() as c:
        orgs = [str(r[0]) for r in c.execute(text("select id from organizations"))]
    totals = {"blobs": 0, "artifacts": 0}
    for org_id in orgs:
        with org_tx(org_id) as c:
            org = repo.get_org(c, org_id)
            policy = org["settings"].get("retention", {}) if org else {}
            meetings = repo.list_meetings(c)
        for m in meetings:
            created = m["created_at"]
            kinds = []
            if _expired(created, policy.get("audio_days")):
                kinds += AUDIO_BLOBS
            if _expired(created, policy.get("documents_days")):
                kinds += DOC_BLOBS
            with org_tx(org_id) as c:
                for b in repo.meeting_blobs(c, str(m["id"])):
                    if b["kind"] in kinds and b["purged_at"] is None:
                        storage.delete(b["storage_key"])
                        repo.mark_blob_purged(c, str(b["id"]))
                        totals["blobs"] += 1
                if _expired(created, policy.get("transcript_days")):
                    n = repo.purge_artifacts(c, str(m["id"]), TRANSCRIPT_ARTIFACTS)
                    totals["artifacts"] += n
                    if n:
                        repo.audit(c, org_id, "retention.purged", actor_kind="system", target_type="meeting", target_id=str(m["id"]),
                                   meeting_id=str(m["id"]), details={"artifacts": n})
    if totals["blobs"] or totals["artifacts"]:
        log.info("retention sweep", extra=totals)
    return totals


def delete_meeting(org_id: str, meeting_id: str, actor: str | None) -> None:
    with org_tx(org_id) as c:
        blobs = repo.meeting_blobs(c, meeting_id)
    for b in blobs:
        try:
            storage.delete(b["storage_key"])
        except FileNotFoundError:
            pass
    with org_tx(org_id) as c:
        repo.audit(c, org_id, "meeting.deleted", actor_user=actor, target_type="meeting", target_id=meeting_id, meeting_id=meeting_id,
                   details={"blobs_deleted": len(blobs)})
        repo.delete_meeting(c, meeting_id)
