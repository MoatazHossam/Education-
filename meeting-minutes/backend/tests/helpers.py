"""Builders for small transcripts and items used across tests."""

from __future__ import annotations

from mahdar.pipeline.schemas import Analysis, Due, Evidence, Item, Owner, Segment, Speaker, Transcript


def seg(sid: str, spk: str, text: str, start: float, end: float, conf: str = "high", flags=None, excluded=False) -> Segment:
    return Segment(id=sid, start=start, end=end, speaker_id=spk, speaker_confidence=conf, text_verbatim=text, text_readable=text,
                   flags=flags or [], excluded=excluded)


def transcript(*segments: Segment) -> Transcript:
    spk_ids = sorted({s.speaker_id for s in segments if s.speaker_id})
    return Transcript(recording_sha256="0" * 64, asr_provider="test", asr_model="test", diarization_provider="test",
                      segments=list(segments), speakers=[Speaker(id=s, label=f"المتحدث {s[-1]}") for s in spk_ids])


def item(iid: str, typ: str, statement: str, evidence: list[tuple[str, str]], *, speakers=None, owner=None, due=None, due_iso=None,
         due_status="unspecified", approval=None, qualifications=None) -> Item:
    return Item(
        id=iid, type=typ, statement=statement, speaker_ids=speakers or [],
        owner=Owner(name_as_spoken=owner, status="explicit" if owner else "unspecified"),
        due=Due(text_as_spoken=due, date_iso=due_iso, status=due_status if due else "unspecified"),
        evidence=[Evidence(segment_id=s, quote=q) for s, q in evidence],
        approval_evidence=[Evidence(segment_id=s, quote=q) for s, q in (approval or [])],
        qualifications=qualifications or [],
    )


def analysis(*items: Item) -> Analysis:
    return Analysis(purpose=None, topics=[], items=list(items), provider="test", model="test")
