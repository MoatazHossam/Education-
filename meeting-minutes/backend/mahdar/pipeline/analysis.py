"""Agent 4 — semantic analysis: topics and classified items, each citing the transcript.

The model reads the whole speaker-attributed transcript (the shared, cached context). A long
meeting is analysed in windows of segments over the same context, and items found twice in the
overlap are merged. When the whole transcript does not fit the model's context (a small local
model), each window carries only its own segments plus a margin.
"""

from __future__ import annotations

from collections.abc import Callable

from rapidfuzz import fuzz

from mahdar.pipeline import arabic
from mahdar.pipeline.llm import LlmClient, LlmRequest, prompts
from mahdar.pipeline.schemas import Analysis, Due, Evidence, Item, Owner, SpeakerNameHint, Topic, Transcript

WINDOW_SEGMENTS = 220
WINDOW_OVERLAP = 12


def estimate_tokens(text: str) -> int:
    # Arabic runs at roughly 2.5 characters per token with current tokenizers; erring high.
    return int(len(text) / 2.2) + 1


def analyse(
    transcript: Transcript,
    meta: dict,
    glossary: list[dict],
    llm: LlmClient,
    *,
    context_budget: int,
    progress: Callable[[float], None] | None = None,
) -> tuple[Analysis, list[dict]]:
    """Returns the analysis and the usage of each model call (for the processing register)."""
    segs = [s for s in transcript.segments if not s.excluded]
    full_context = prompts.meeting_context(meta, glossary, segs, transcript.speakers)
    windows: list[tuple[int, int]]
    if len(segs) <= WINDOW_SEGMENTS:
        windows = [(0, len(segs))]
    else:
        windows = []
        i = 0
        while i < len(segs):
            windows.append((max(0, i - WINDOW_OVERLAP), min(len(segs), i + WINDOW_SEGMENTS)))
            i += WINDOW_SEGMENTS
    fits = estimate_tokens(full_context) <= context_budget
    usage: list[dict] = []
    raw_items: list[dict] = []
    topics: list[dict] = []
    hints: list[dict] = []
    purpose: str | None = None
    purpose_ev: list[dict] = []
    for n, (a, b) in enumerate(windows):
        if fits:
            context = full_context
        else:
            lo, hi = max(0, a - WINDOW_OVERLAP), min(len(segs), b + WINDOW_OVERLAP)
            context = prompts.meeting_context(meta, glossary, segs[lo:hi], transcript.speakers)
        scope = None if len(windows) == 1 else (segs[a].id, segs[b - 1].id)
        res = llm.generate_json(
            LlmRequest(
                stage="analysis",
                system=prompts.ANALYSIS_SYSTEM,
                user=prompts.analysis_user(scope),
                schema=prompts.analysis_schema(),
                shared_context=context,
                max_tokens=48000,
            )
        )
        usage.append(
            {
                "stage": "analysis",
                "window": n,
                "model": res.model,
                "input_tokens": res.input_tokens,
                "output_tokens": res.output_tokens,
                "cache_read_tokens": res.cache_read_tokens,
                "served_by_fallback": res.served_by_fallback,
            }
        )
        data = res.data
        if purpose is None and data.get("purpose"):
            purpose, purpose_ev = data["purpose"], data.get("purpose_evidence") or []
        offset = len(topics)
        remap = {}
        for t in data.get("topics", []):
            new_id = f"T{offset + len(remap) + 1}"
            remap[t["id"]] = new_id
            topics.append({**t, "id": new_id})
        for it in data.get("items", []):
            it["topic_id"] = remap.get(it.get("topic_id") or "", it.get("topic_id"))
            raw_items.append(it)
        hints.extend(data.get("speaker_name_hints", []))
        if progress:
            progress((n + 1) / len(windows))
    topics = _merge_topics(topics, raw_items)
    items = _to_items(_dedupe(raw_items), {s.id for s in transcript.speakers})
    model = usage[-1]["model"] if usage else getattr(llm, "model", "")
    analysis = Analysis(
        purpose=purpose,
        purpose_evidence=[Evidence(**e) for e in purpose_ev],
        topics=[Topic(**t) for t in topics],
        items=items,
        speaker_name_hints=[
            SpeakerNameHint(speaker_id=h["speaker_id"], name=h["name"], evidence=[Evidence(**e) for e in h["evidence"]])
            for h in hints
        ],
        provider=llm.provider,
        model=model,
        windows=len(windows),
        usage={
            "calls": usage,
            "input_tokens": sum(u["input_tokens"] for u in usage),
            "output_tokens": sum(u["output_tokens"] for u in usage),
        },
    )
    return analysis, usage


def _dedupe(items: list[dict]) -> list[dict]:
    """Items extracted twice in a window overlap: same type, overlapping evidence, similar wording."""
    kept: list[dict] = []
    for it in items:
        ev = {e["segment_id"] for e in it.get("evidence", [])}
        dup = None
        for k in kept:
            kev = {e["segment_id"] for e in k.get("evidence", [])}
            if (
                k["type"] == it["type"]
                and ev & kev
                and fuzz.token_set_ratio(arabic.normalize(k["statement"]), arabic.normalize(it["statement"])) >= 80
            ):
                dup = k
                break
        if dup is None:
            kept.append(it)
        else:
            seen = {(e["segment_id"], e["quote"]) for e in dup["evidence"]}
            dup["evidence"] += [e for e in it["evidence"] if (e["segment_id"], e["quote"]) not in seen]
    return kept


def _merge_topics(topics: list[dict], items: list[dict]) -> list[dict]:
    out: list[dict] = []
    alias: dict[str, str] = {}
    for t in topics:
        same = next(
            (o for o in out if fuzz.token_set_ratio(arabic.normalize(o["title"]), arabic.normalize(t["title"])) >= 90),
            None,
        )
        if same:
            alias[t["id"]] = same["id"]
            same["segment_ids"] = sorted(set(same["segment_ids"]) | set(t["segment_ids"]))
        else:
            out.append(dict(t))
    for it in items:
        if it.get("topic_id") in alias:
            it["topic_id"] = alias[it["topic_id"]]
    # Renumber in order.
    ren = {t["id"]: f"T{i}" for i, t in enumerate(out, start=1)}
    for t in out:
        t["id"] = ren[t["id"]]
    for it in items:
        it["topic_id"] = ren.get(it.get("topic_id") or "")
    return out


def _to_items(raw: list[dict], speaker_ids: set[str]) -> list[Item]:
    items = []
    for n, it in enumerate(raw, start=1):
        requires = bool(it.get("requires_confirmation")) or it["type"] in (
            "agreement_tentative",
            "action_suggested",
            "contradiction",
        )
        items.append(
            Item(
                id=f"I{n:03d}",
                type=it["type"],
                topic_id=it.get("topic_id"),
                statement=it["statement"].strip(),
                speaker_ids=[s for s in it.get("speaker_ids", []) if s in speaker_ids],
                owner=Owner(
                    name_as_spoken=it.get("owner_name_as_spoken"),
                    speaker_id=it.get("owner_speaker_id") if it.get("owner_speaker_id") in speaker_ids else None,
                    status=it.get("owner_status", "unspecified"),
                ),
                due=Due(
                    text_as_spoken=it.get("due_text_as_spoken"),
                    date_iso=it.get("due_date_iso"),
                    status=it.get("due_status", "unspecified"),
                ),
                qualifications=[q for q in it.get("qualifications", []) if q.strip()],
                evidence=[Evidence(**e) for e in it.get("evidence", [])],
                approval_evidence=[Evidence(**e) for e in it.get("approval_evidence", [])],
                requires_confirmation=requires,
                confidence=it.get("confidence", "medium"),
                notes=it.get("notes"),
            )
        )
    return items
