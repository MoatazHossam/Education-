"""Meetings: upload, processing status, transcript and speaker corrections, item review, minutes
editing, regeneration, approval, audio excerpts and downloads.

Every factual change made by a person creates a new artifact version (nothing is overwritten) and an
audit entry with the values before and after. Automatic extraction never counts as human approval:
items are "accepted" only by a reviewer, and minutes are "approved" only by an approver, and only
when no critical issue is open.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from datetime import UTC, date, datetime
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import Connection
from starlette.background import BackgroundTask

from mahdar import storage
from mahdar.api.deps import Principal, current_user, meeting_or_404, org_conn, require
from mahdar.config import get_settings
from mahdar.db import repo
from mahdar.jobs import queue
from mahdar.pipeline import audio
from mahdar.pipeline.quality import issue_key
from mahdar.pipeline.schemas import ITEM_TYPE_AR, Analysis, Transcript, VerificationReport
from mahdar.retention import delete_meeting

router = APIRouter(prefix="/api/meetings", tags=["meetings"])
CLASSIFICATIONS = ("public", "internal", "confidential", "secret")


def _summary(m: dict, job: dict | None = None) -> dict:
    meta = m["meta"]
    return {
        "id": str(m["id"]), "title": meta.get("title"), "date": meta.get("date"), "location": meta.get("location"),
        "classification": m["classification"], "status": m["status"], "stage": m["stage"], "progress": m["progress"],
        "minutes_status": m["minutes_status"], "critical_open": m["critical_open"], "duration_seconds": m["duration_seconds"],
        "error_code": m["error_code"], "created_at": m["created_at"], "approved_at": m["approved_at"],
        "job": {"status": job["status"], "stage": job["stage"], "progress": job["progress"], "stages": job["stages"],
                "attempts": job["attempts"], "error": (job["error"] or "")[:300] if job["status"] == "failed" else None} if job else None,
    }


@router.get("")
def list_meetings(c: Connection = Depends(org_conn)) -> list[dict]:
    return [_summary(m) for m in repo.list_meetings(c)]


@router.post("", status_code=201)
def upload(
    file: UploadFile = File(...),
    title: str = Form(..., max_length=300),
    meeting_date: str | None = Form(None),
    location: str | None = Form(None, max_length=300),
    start_time: str | None = Form(None, max_length=20),
    end_time: str | None = Form(None, max_length=20),
    prepared_by: str | None = Form(None, max_length=200),
    classification: str = Form("internal"),
    expected_speakers: int | None = Form(None, ge=1, le=30),
    attendees: str | None = Form(None, description="JSON list of names (with titles)"),
    p: Principal = Depends(require("editor")),
) -> dict:
    s = get_settings()
    if classification not in CLASSIFICATIONS:
        raise HTTPException(422, "تصنيف غير صالح")
    if meeting_date:
        try:
            date.fromisoformat(meeting_date)
        except ValueError as exc:
            raise HTTPException(422, "صيغة التاريخ غير صالحة (YYYY-MM-DD)") from exc
    names = []
    if attendees:
        try:
            names = [str(x)[:200] for x in json.loads(attendees)][:100]
        except (ValueError, TypeError) as exc:
            raise HTTPException(422, "قائمة الحاضرين غير صالحة") from exc
    tmpdir = Path(tempfile.mkdtemp(prefix="mahdar-up-"))
    try:
        suffix = Path(file.filename or "").suffix.lower()[:10]
        dst = tmpdir / f"upload{suffix}"
        limit = s.max_upload_mb * 1_000_000
        size = 0
        with open(dst, "wb") as f:
            while chunk := file.file.read(1 << 20):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"حجم الملف يتجاوز الحد المسموح ({s.max_upload_mb} ميجابايت)")
                f.write(chunk)
        try:
            audio.validate(dst, filename=file.filename or dst.name, max_bytes=limit, max_seconds=s.max_duration_minutes * 60)
        except audio.AudioError as exc:
            raise HTTPException(422, exc.message_ar) from exc
        meta = {"title": title.strip(), "date": meeting_date, "location": location, "start_time": start_time, "end_time": end_time,
                "prepared_by": prepared_by, "expected_speakers": expected_speakers, "attendees": names}
        from mahdar.db.core import org_tx

        with org_tx(p.org_id) as c:
            mid = repo.create_meeting(c, p.org_id, p.user_id, {k: v for k, v in meta.items() if v not in (None, "", [])}, classification)
        bid = storage.new_id()
        key, stored, sha = storage.put_file(p.org_id, bid, dst)
        with org_tx(p.org_id) as c:
            repo.add_blob(c, blob_id=bid, org_id=p.org_id, meeting_id=mid, kind="audio_original", storage_key=key, size=stored, sha256=sha,
                          content_type=file.content_type or "application/octet-stream", filename=file.filename or dst.name)
            queue.enqueue(c, p.org_id, mid, "process", max_attempts=s.job_max_attempts)
            repo.audit(c, p.org_id, "meeting.uploaded", actor_user=p.user_id, target_type="meeting", target_id=mid, meeting_id=mid,
                       details={"size": stored, "sha256": sha, "classification": classification})
            m = repo.get_meeting(c, mid)
        return _summary(m)
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)


@router.get("/{meeting_id}")
def detail(meeting_id: str, c: Connection = Depends(org_conn)) -> dict:
    m = meeting_or_404(c, meeting_id)
    job = queue.latest_job(c, meeting_id)
    docs = repo.latest_artifact(c, meeting_id, "documents")
    quality = repo.latest_artifact(c, meeting_id, "audio_quality")
    out = _summary(m, job)
    out["meta"] = m["meta"]
    out["audio_quality"] = quality[1] if quality else None
    out["documents"] = {"available": sorted(docs[1]["blobs"]), "checks": docs[1]["checks"], "quality": docs[1]["quality"],
                        "generated_at": docs[1]["generated_at"], "minutes_version": docs[1]["minutes_version"]} if docs else None
    out["versions"] = repo.list_artifact_versions(c, meeting_id)
    return out


class MetaIn(BaseModel):
    title: str | None = Field(None, max_length=300)
    date: str | None = None
    location: str | None = Field(None, max_length=300)
    start_time: str | None = Field(None, max_length=20)
    end_time: str | None = Field(None, max_length=20)
    prepared_by: str | None = Field(None, max_length=200)
    attendees: list[str] | None = None
    classification: Literal["public", "internal", "confidential", "secret"] | None = None


@router.patch("/{meeting_id}")
def update_meta(meeting_id: str, body: MetaIn, p: Principal = Depends(require("editor")), c: Connection = Depends(org_conn)) -> dict:
    m = meeting_or_404(c, meeting_id)
    changes = body.model_dump(exclude_unset=True)
    before = {k: m["meta"].get(k) for k in changes if k != "classification"}
    if "classification" in changes:
        before["classification"] = m["classification"]
        repo.update_meeting(c, meeting_id, classification=changes.pop("classification"))
    meta = {**m["meta"], **changes}
    repo.update_meeting_meta(c, meeting_id, meta)
    repo.audit(c, p.org_id, "meeting.updated", actor_user=p.user_id, target_type="meeting", target_id=meeting_id, meeting_id=meeting_id,
               details={"before": before, "after": body.model_dump(exclude_unset=True)})
    return _summary(repo.get_meeting(c, meeting_id))


@router.delete("/{meeting_id}")
def remove(meeting_id: str, p: Principal = Depends(require("editor"))) -> dict:
    from mahdar.db.core import org_tx

    with org_tx(p.org_id) as c:
        m = meeting_or_404(c, meeting_id)
        if m["created_by"] and str(m["created_by"]) != p.user_id and not p.at_least("admin"):
            raise HTTPException(403, "يحذف الاجتماع من رفعه أو مدير النظام")
        queue.cancel_meeting_jobs(c, meeting_id)
    delete_meeting(p.org_id, meeting_id, p.user_id)
    return {"deleted": meeting_id}


# --- audio ---------------------------------------------------------------------------------------
@router.get("/{meeting_id}/audio")
def audio_excerpt(meeting_id: str, start: float = Query(0, ge=0), end: float = Query(..., gt=0),
                  p: Principal = Depends(current_user), c: Connection = Depends(org_conn)) -> FileResponse:
    if end - start > 600:
        raise HTTPException(422, "المقطع المطلوب أطول من 10 دقائق")
    meeting_or_404(c, meeting_id)
    b = repo.latest_blob(c, meeting_id, "audio_normalized") or repo.latest_blob(c, meeting_id, "audio_original")
    if not b:
        raise HTTPException(404, "لم يعد التسجيل محفوظاً (انتهت مدة الاحتفاظ أو حُذف)")
    tmpdir = Path(tempfile.mkdtemp(prefix="mahdar-clip-"))
    src = storage.read_to_file(b["storage_key"], str(b["id"]), tmpdir / "src")
    clip = audio.extract_clip(src, start, end, tmpdir / "clip.mp3")
    src.unlink(missing_ok=True)
    return FileResponse(clip, media_type="audio/mpeg", headers={"Cache-Control": "private, no-store"},
                        background=BackgroundTask(shutil.rmtree, tmpdir, True))


# --- transcript and speakers -----------------------------------------------------------------------
def _transcript(c: Connection, meeting_id: str) -> tuple[int, Transcript]:
    t = repo.latest_artifact(c, meeting_id, "transcript")
    if not t:
        raise HTTPException(409, "لم يكتمل التفريغ بعد")
    return t[0], Transcript(**t[1])


@router.get("/{meeting_id}/transcript")
def get_transcript(meeting_id: str, c: Connection = Depends(org_conn)) -> dict:
    meeting_or_404(c, meeting_id)
    version, tr = _transcript(c, meeting_id)
    data = tr.model_dump()
    for s in data["segments"]:
        s.pop("words", None)
    a = repo.latest_artifact(c, meeting_id, "analysis")
    hints = a[1].get("speaker_name_hints", []) if a else []
    return {"version": version, **data, "speaker_name_hints": hints}


class SegmentEdit(BaseModel):
    text_verbatim: str | None = Field(None, max_length=10000)
    text_readable: str | None = Field(None, max_length=10000)
    speaker_id: str | None = None
    reason: str = Field(..., min_length=2, max_length=500)


@router.patch("/{meeting_id}/transcript/segments/{segment_id}")
def edit_segment(meeting_id: str, segment_id: str, body: SegmentEdit, p: Principal = Depends(require("editor")),
                 c: Connection = Depends(org_conn)) -> dict:
    meeting_or_404(c, meeting_id)
    _, tr = _transcript(c, meeting_id)
    seg = next((s for s in tr.segments if s.id == segment_id), None)
    if seg is None:
        raise HTTPException(404, "المقطع غير موجود")
    if body.speaker_id and body.speaker_id not in {s.id for s in tr.speakers}:
        raise HTTPException(422, "متحدث غير معروف")
    before = {"text_verbatim": seg.text_verbatim, "text_readable": seg.text_readable, "speaker_id": seg.speaker_id}
    if body.text_verbatim is not None:
        seg.text_verbatim = body.text_verbatim.strip()
    if body.text_readable is not None:
        seg.text_readable = body.text_readable.strip()
        seg.readable_source = "human"
    if body.speaker_id:
        seg.speaker_id = body.speaker_id
        seg.speaker_confidence = "high"
        seg.flags = [f for f in seg.flags if f != "uncertain_speaker"]  # type: ignore[assignment]
    seg.flags = sorted({*seg.flags, "edited"})  # type: ignore[assignment]
    version = repo.save_artifact(c, p.org_id, meeting_id, "transcript", tr.model_dump(), user_id=p.user_id, note=f"segment {segment_id}: {body.reason}")
    repo.audit(c, p.org_id, "transcript.segment_edited", actor_user=p.user_id, target_type="segment", target_id=segment_id, meeting_id=meeting_id,
               details={"before": before, "after": body.model_dump(exclude={"reason"}, exclude_none=True), "reason": body.reason, "version": version})
    return {"version": version, "segment": seg.model_dump(exclude={"words"})}


class SpeakerEdit(BaseModel):
    display_name: str | None = Field(None, max_length=200)
    title: str | None = Field(None, max_length=200)
    confirmed: bool = True


@router.patch("/{meeting_id}/speakers/{speaker_id}")
def edit_speaker(meeting_id: str, speaker_id: str, body: SpeakerEdit, p: Principal = Depends(require("editor")),
                 c: Connection = Depends(org_conn)) -> dict:
    meeting_or_404(c, meeting_id)
    _, tr = _transcript(c, meeting_id)
    spk = next((s for s in tr.speakers if s.id == speaker_id), None)
    if spk is None:
        raise HTTPException(404, "المتحدث غير موجود")
    before = spk.model_dump()
    if body.display_name is not None:
        spk.display_name = body.display_name.strip() or None
    if body.title is not None:
        spk.title = body.title.strip() or None
    spk.confirmed = body.confirmed and bool(spk.display_name)
    version = repo.save_artifact(c, p.org_id, meeting_id, "transcript", tr.model_dump(), user_id=p.user_id, note=f"speaker {speaker_id}")
    repo.audit(c, p.org_id, "speaker.named", actor_user=p.user_id, target_type="speaker", target_id=speaker_id, meeting_id=meeting_id,
               details={"before": before, "after": spk.model_dump(), "version": version})
    return {"version": version, "speaker": spk.model_dump()}


class MergeIn(BaseModel):
    source: str
    target: str


@router.post("/{meeting_id}/speakers/merge")
def merge_speakers(meeting_id: str, body: MergeIn, p: Principal = Depends(require("editor")), c: Connection = Depends(org_conn)) -> dict:
    meeting_or_404(c, meeting_id)
    _, tr = _transcript(c, meeting_id)
    ids = {s.id for s in tr.speakers}
    if body.source not in ids or body.target not in ids or body.source == body.target:
        raise HTTPException(422, "اختيار المتحدثين غير صالح")
    moved = []
    for s in tr.segments:
        if s.speaker_id == body.source:
            s.speaker_id = body.target
            s.flags = sorted({*s.flags, "edited"})  # type: ignore[assignment]
            moved.append(s.id)
    target = next(s for s in tr.speakers if s.id == body.target)
    source = next(s for s in tr.speakers if s.id == body.source)
    target.speaking_seconds = round(target.speaking_seconds + source.speaking_seconds, 1)
    tr.speakers = [s for s in tr.speakers if s.id != body.source]
    version = repo.save_artifact(c, p.org_id, meeting_id, "transcript", tr.model_dump(), user_id=p.user_id, note=f"merge {body.source} into {body.target}")
    repo.audit(c, p.org_id, "speaker.merged", actor_user=p.user_id, target_type="speaker", target_id=body.target, meeting_id=meeting_id,
               details={"source": body.source, "target": body.target, "segments": moved, "version": version})
    return {"version": version, "segments_moved": len(moved)}


# --- items: analysis + verification + reviewers' decisions ----------------------------------------
def _review(c: Connection, meeting_id: str) -> dict:
    r = repo.latest_artifact(c, meeting_id, "review")
    return r[1] if r else {"items": {}, "issues": {}, "block_overrides": []}


@router.get("/{meeting_id}/items")
def items(meeting_id: str, c: Connection = Depends(org_conn)) -> dict:
    meeting_or_404(c, meeting_id)
    a = repo.latest_artifact(c, meeting_id, "analysis")
    v = repo.latest_artifact(c, meeting_id, "verification")
    if not a or not v:
        raise HTTPException(409, "لم يكتمل التحليل والتحقق بعد")
    an, rep = Analysis(**a[1]), VerificationReport(**v[1])
    review = _review(c, meeting_id)
    vby = {x.item_id: x for x in rep.items}
    out = []
    for it in an.items:
        ver = vby.get(it.id)
        out.append({**it.model_dump(), "type_ar": ITEM_TYPE_AR.get(it.type), "verification": ver.model_dump() if ver else None,
                    "final_type_ar": ITEM_TYPE_AR.get(ver.final_type) if ver else None, "review": review.get("items", {}).get(it.id)})
    issues = [{**i.model_dump(), "key": issue_key(i), "resolution": review.get("issues", {}).get(issue_key(i))} for i in rep.document_issues]
    return {"purpose": an.purpose, "topics": [t.model_dump() for t in an.topics], "items": out, "document_issues": issues,
            "coverage": rep.coverage, "llm_used": rep.llm_used, "llm_model": rep.llm_model, "analysis_model": an.model,
            "types_ar": ITEM_TYPE_AR, "reviewed_by": review.get("reviewed_by_name"), "reviewed_at": review.get("reviewed_at")}


class ItemReview(BaseModel):
    decision: Literal["accepted", "rejected", "reset"]
    type: str | None = None
    statement: str | None = Field(None, max_length=4000)
    owner: str | None = Field(None, max_length=200)
    due: str | None = Field(None, max_length=200)
    note: str | None = Field(None, max_length=1000)


@router.post("/{meeting_id}/items/{item_id}/review")
def review_item(meeting_id: str, item_id: str, body: ItemReview, p: Principal = Depends(require("editor")),
                c: Connection = Depends(org_conn)) -> dict:
    meeting_or_404(c, meeting_id)
    a = repo.latest_artifact(c, meeting_id, "analysis")
    if not a or item_id not in {i["id"] for i in a[1]["items"]}:
        raise HTTPException(404, "البند غير موجود")
    if body.type and body.type not in ITEM_TYPE_AR:
        raise HTTPException(422, "نوع غير صالح")
    review = _review(c, meeting_id)
    before = review.get("items", {}).get(item_id)
    entries = dict(review.get("items", {}))
    if body.decision == "reset":
        entries.pop(item_id, None)
    else:
        edits = {k: v for k, v in {"statement": body.statement, "owner": body.owner, "due": body.due}.items() if v is not None}
        entries[item_id] = {"decision": body.decision, "type": body.type, "edits": edits, "note": body.note, "by": p.user_id,
                            "by_name": p.name, "at": datetime.now(UTC).isoformat()}
    review = {**review, "items": entries}
    version = repo.save_artifact(c, p.org_id, meeting_id, "review", review, user_id=p.user_id, note=f"item {item_id}: {body.decision}")
    repo.audit(c, p.org_id, f"item.{body.decision}", actor_user=p.user_id, target_type="item", target_id=item_id, meeting_id=meeting_id,
               details={"before": before, "after": entries.get(item_id), "version": version})
    return {"version": version, "review": entries.get(item_id)}


class IssueResolve(BaseModel):
    key: str = Field(max_length=500)
    resolution: Literal["accepted", "dismissed", "reset"]
    note: str = Field(..., min_length=2, max_length=1000)


@router.post("/{meeting_id}/issues/resolve")
def resolve_issue(meeting_id: str, body: IssueResolve, p: Principal = Depends(require("editor")), c: Connection = Depends(org_conn)) -> dict:
    meeting_or_404(c, meeting_id)
    review = _review(c, meeting_id)
    issues = dict(review.get("issues", {}))
    if body.resolution == "reset":
        issues.pop(body.key, None)
    else:
        issues[body.key] = {"resolution": body.resolution, "note": body.note, "by": p.user_id, "by_name": p.name, "at": datetime.now(UTC).isoformat()}
    version = repo.save_artifact(c, p.org_id, meeting_id, "review", {**review, "issues": issues}, user_id=p.user_id, note=f"issue {body.resolution}")
    repo.audit(c, p.org_id, "issue.resolved", actor_user=p.user_id, target_type="issue", target_id=body.key, meeting_id=meeting_id,
               details={"resolution": body.resolution, "note": body.note})
    return {"version": version}


# --- minutes ---------------------------------------------------------------------------------------
@router.get("/{meeting_id}/minutes")
def minutes(meeting_id: str, c: Connection = Depends(org_conn)) -> dict:
    meeting_or_404(c, meeting_id)
    mm = repo.latest_artifact(c, meeting_id, "minutes")
    if not mm:
        raise HTTPException(409, "لم يُنشأ المحضر بعد")
    return {"version": mm[0], **mm[1], "overrides": _review(c, meeting_id).get("block_overrides", [])}


class BlockEdit(BaseModel):
    section: str = Field(max_length=40)
    item_ids: list[str]
    text: str = Field(..., min_length=1, max_length=8000)
    reason: str = Field(..., min_length=2, max_length=500)


@router.post("/{meeting_id}/minutes/edits")
def edit_minutes(meeting_id: str, body: BlockEdit, p: Principal = Depends(require("editor")), c: Connection = Depends(org_conn)) -> dict:
    """A reviewer's wording for the block built from these items in this section; it is kept across
    regenerations, and still checked (a fact not in the items is listed as an issue)."""
    meeting_or_404(c, meeting_id)
    review = _review(c, meeting_id)
    key = (body.section, tuple(sorted(body.item_ids)))
    overrides = [o for o in review.get("block_overrides", []) if (o["section"], tuple(sorted(o["item_ids"]))) != key]
    overrides.append({"section": body.section, "item_ids": sorted(body.item_ids), "text": body.text.strip(), "by": p.user_id, "by_name": p.name,
                      "at": datetime.now(UTC).isoformat(), "reason": body.reason})
    version = repo.save_artifact(c, p.org_id, meeting_id, "review", {**review, "block_overrides": overrides}, user_id=p.user_id, note="minutes edit")
    repo.audit(c, p.org_id, "minutes.edited", actor_user=p.user_id, target_type="minutes", target_id=body.section, meeting_id=meeting_id,
               details={"item_ids": body.item_ids, "text": body.text, "reason": body.reason})
    return {"version": version}


class RegenerateIn(BaseModel):
    scope: Literal["regenerate", "reverify", "reanalyse"] = "regenerate"


def _enqueue(c: Connection, p: Principal, meeting_id: str, kind: str) -> dict:
    if queue.active_job(c, meeting_id):
        raise HTTPException(409, "توجد معالجة جارية لهذا الاجتماع")
    jid = queue.enqueue(c, p.org_id, meeting_id, kind, max_attempts=get_settings().job_max_attempts)
    repo.update_meeting(c, meeting_id, status="processing", progress=0)
    repo.audit(c, p.org_id, f"pipeline.{kind}", actor_user=p.user_id, target_type="meeting", target_id=meeting_id, meeting_id=meeting_id)
    return {"job_id": jid, "kind": kind}


@router.post("/{meeting_id}/regenerate")
def regenerate(meeting_id: str, body: RegenerateIn, p: Principal = Depends(require("editor")), c: Connection = Depends(org_conn)) -> dict:
    m = meeting_or_404(c, meeting_id)
    if body.scope != "reanalyse" and not repo.latest_artifact(c, meeting_id, "analysis"):
        raise HTTPException(409, "لم يكتمل التحليل بعد")
    if m["minutes_status"] == "approved":
        repo.update_meeting(c, meeting_id, minutes_status="reviewed", approved_by=None, approved_at=None)
        repo.audit(c, p.org_id, "minutes.approval_withdrawn", actor_user=p.user_id, target_type="meeting", target_id=meeting_id,
                   meeting_id=meeting_id, details={"reason": "regenerated after approval"})
    return _enqueue(c, p, meeting_id, body.scope)


@router.post("/{meeting_id}/resume")
def resume(meeting_id: str, p: Principal = Depends(require("editor")), c: Connection = Depends(org_conn)) -> dict:
    m = meeting_or_404(c, meeting_id)
    kind = "reanalyse" if repo.latest_artifact(c, meeting_id, "transcript") else "process"
    if m["status"] not in ("awaiting_authorization", "failed"):
        raise HTTPException(409, "لا حاجة لاستئناف المعالجة")
    return _enqueue(c, p, meeting_id, kind)


@router.post("/{meeting_id}/review/complete")
def complete_review(meeting_id: str, p: Principal = Depends(require("editor")), c: Connection = Depends(org_conn)) -> dict:
    meeting_or_404(c, meeting_id)
    review = _review(c, meeting_id)
    review = {**review, "reviewed_by": p.user_id, "reviewed_by_name": p.name, "reviewed_at": datetime.now(UTC).isoformat()}
    repo.save_artifact(c, p.org_id, meeting_id, "review", review, user_id=p.user_id, note="review completed")
    repo.audit(c, p.org_id, "minutes.review_completed", actor_user=p.user_id, target_type="meeting", target_id=meeting_id, meeting_id=meeting_id)
    return _enqueue(c, p, meeting_id, "regenerate")


@router.post("/{meeting_id}/approve")
def approve(meeting_id: str, p: Principal = Depends(require("approver")), c: Connection = Depends(org_conn)) -> dict:
    m = meeting_or_404(c, meeting_id)
    if m["minutes_status"] != "reviewed":
        raise HTTPException(409, "لا يُعتمد المحضر إلا بعد اكتمال مراجعته وعدم وجود ملاحظات حرجة مفتوحة")
    if m["critical_open"]:
        raise HTTPException(409, "توجد ملاحظات حرجة لم تُحسم")
    now = datetime.now(UTC)
    repo.update_meeting(c, meeting_id, minutes_status="approved", approved_by=p.user_id, approved_at=now)
    review = _review(c, meeting_id)
    repo.save_artifact(c, p.org_id, meeting_id, "review", {**review, "approved_by": p.user_id, "approved_by_name": p.name,
                                                           "approved_at": now.isoformat()}, user_id=p.user_id, note="approved")
    repo.audit(c, p.org_id, "minutes.approved", actor_user=p.user_id, target_type="meeting", target_id=meeting_id, meeting_id=meeting_id)
    return _enqueue(c, p, meeting_id, "regenerate")


# --- evidence, audit, processing register, documents ----------------------------------------------
@router.get("/{meeting_id}/audit")
def meeting_audit(meeting_id: str, p: Principal = Depends(current_user), c: Connection = Depends(org_conn)) -> list[dict]:
    meeting_or_404(c, meeting_id)
    return repo.audit_entries(c, p.org_id, meeting_id)


@router.get("/{meeting_id}/processing")
def processing(meeting_id: str, c: Connection = Depends(org_conn)) -> list[dict]:
    meeting_or_404(c, meeting_id)
    return repo.processing_records(c, meeting_id)


DOC_NAMES = {
    "minutes_docx": "محضر-الاجتماع.docx", "minutes_pdf": "محضر-الاجتماع.pdf", "evidence_pdf": "تقرير-الأدلة.pdf",
    "transcript_pdf": "النص-الكامل.pdf", "summary_pdf": "الملخص-التنفيذي.pdf", "actions_csv": "التكليفات.csv",
    "export_json": "بيانات-الاجتماع.json", "transcript_txt": "النص-الحرفي.txt",
}


@router.get("/{meeting_id}/documents/{kind}")
def download(meeting_id: str, kind: str, p: Principal = Depends(current_user), c: Connection = Depends(org_conn)) -> StreamingResponse:
    meeting_or_404(c, meeting_id)
    docs = repo.latest_artifact(c, meeting_id, "documents")
    if not docs or kind not in docs[1]["blobs"]:
        raise HTTPException(404, "المستند غير متاح")
    b = repo.get_blob(c, docs[1]["blobs"][kind])
    if not b:
        raise HTTPException(404, "لم يعد المستند محفوظاً (انتهت مدة الاحتفاظ)")
    repo.audit(c, p.org_id, "document.downloaded", actor_user=p.user_id, target_type="document", target_id=kind, meeting_id=meeting_id)
    from urllib.parse import quote

    name = DOC_NAMES.get(kind, b["filename"])
    return StreamingResponse(storage.read_stream(b["storage_key"], str(b["id"])), media_type=b["content_type"], headers={
        "Content-Disposition": f"attachment; filename=\"{b['filename']}\"; filename*=UTF-8''{quote(name)}",
        "Cache-Control": "private, no-store"})


@router.get("/{meeting_id}/documents/{kind}/preview")
def preview_page(meeting_id: str, kind: str, page: int = Query(1, ge=1, le=200), c: Connection = Depends(org_conn)) -> FileResponse:
    """A page of a PDF as an image, for checking the layout in the browser."""
    meeting_or_404(c, meeting_id)
    docs = repo.latest_artifact(c, meeting_id, "documents")
    if not docs or kind not in docs[1]["blobs"] or not kind.endswith("_pdf"):
        raise HTTPException(404, "المستند غير متاح")
    b = repo.get_blob(c, docs[1]["blobs"][kind])
    if not b:
        raise HTTPException(404, "المستند غير متاح")
    import pypdfium2 as pdfium

    data = storage.read_bytes(b["storage_key"], str(b["id"]))
    pdf = pdfium.PdfDocument(data)
    try:
        if page > len(pdf):
            raise HTTPException(404, "الصفحة غير موجودة")
        tmp = Path(tempfile.mkdtemp(prefix="mahdar-prev-"))
        img = tmp / "page.png"
        pdf[page - 1].render(scale=1.5).to_pil().save(img)
        pages = len(pdf)
    finally:
        pdf.close()
    return FileResponse(img, media_type="image/png", headers={"X-Page-Count": str(pages), "Cache-Control": "private, no-store"},
                        background=BackgroundTask(shutil.rmtree, tmp, True))


_ = subprocess  # (FFmpeg runs through pipeline.audio)
