"""Structured outputs for other systems: action items (CSV), the whole meeting (JSON) and the
transcript (text). The JSON follows docs/ARCHITECTURE.md §4 ("export" schema, version 1)."""

from __future__ import annotations

import csv
import io

from mahdar.pipeline.llm.prompts import fmt_time
from mahdar.pipeline.minutes import EffectiveItem, _due, _owner
from mahdar.pipeline.schemas import ITEM_TYPE_AR, Analysis, MinutesDocument, Transcript, VerificationReport


def actions_csv(eff: list[EffectiveItem], transcript: Transcript) -> bytes:
    names = {s.id: s.display_name for s in transcript.speakers if s.display_name and s.confirmed}
    segs = {s.id: s for s in transcript.segments}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(
        [
            "رقم البند",
            "النوع",
            "الإجراء",
            "المسؤول",
            "الموعد",
            "تاريخ الاستحقاق",
            "حالة التحقق",
            "مراجعة بشرية",
            "المرجع",
        ]
    )
    for e in eff:
        if e.type not in ("action_assigned", "action_suggested"):
            continue
        refs = "; ".join(
            f"{x.segment_id}@{fmt_time(segs[x.segment_id].start)}" for x in e.item.evidence if x.segment_id in segs
        )
        w.writerow(
            [
                e.item.id,
                ITEM_TYPE_AR[e.type],
                e.item.statement,
                _owner(e.item, names),
                _due(e.item),
                e.item.due.date_iso or "",
                e.status,
                "نعم" if e.human_accepted else "لا",
                refs,
            ]
        )
    # UTF-8 with BOM so Excel opens Arabic correctly.
    return ("\ufeff" + buf.getvalue()).encode("utf-8")


def transcript_text(transcript: Transcript, readable: bool) -> bytes:
    names = {s.id: s.display_name or s.label for s in transcript.speakers}
    lines = []
    for s in transcript.segments:
        flags = f" [{', '.join(s.flags)}]" if s.flags else ""
        lines.append(
            f"[{fmt_time(s.start)} - {fmt_time(s.end)}] {names.get(s.speaker_id or '', 'متحدث غير محدد')}{flags}: "
            f"{s.text_readable if readable else s.text_verbatim}"
        )
    return ("\n".join(lines) + "\n").encode("utf-8")


def export_json(
    *,
    meeting: dict,
    transcript: Transcript,
    analysis: Analysis,
    verification: VerificationReport,
    minutes: MinutesDocument,
    eff: list[EffectiveItem],
    quality: dict,
    processing: list[dict],
) -> dict:
    vby = {v.item_id: v for v in verification.items}
    return {
        "schema": "mahdar.meeting.export",
        "version": 1,
        "meeting": {
            "id": str(meeting["id"]),
            "title": meeting["meta"].get("title"),
            "date": meeting["meta"].get("date"),
            "location": meeting["meta"].get("location"),
            "classification": meeting["classification"],
            "minutes_status": meeting["minutes_status"],
            "duration_seconds": meeting.get("duration_seconds"),
            "recording_sha256": transcript.recording_sha256,
        },
        "speakers": [s.model_dump() for s in transcript.speakers],
        "purpose": analysis.purpose,
        "topics": [t.model_dump() for t in analysis.topics],
        "items": [
            {
                **e.item.model_dump(),
                "final_type": e.type,
                "verification_status": e.status,
                "human_accepted": e.human_accepted,
                "evidence_resolved": [r.model_dump() for r in (vby[e.item.id].evidence if e.item.id in vby else [])],
            }
            for e in eff
        ],
        "decisions": [e.item.id for e in eff if e.type == "decision_approved" and e.ok],
        "action_items": [e.item.id for e in eff if e.type in ("action_assigned", "action_suggested")],
        "minutes": minutes.model_dump(),
        "quality": quality,
        "processing_register": processing,
        "transcript": [s.model_dump(exclude={"words"}) for s in transcript.segments],
    }
