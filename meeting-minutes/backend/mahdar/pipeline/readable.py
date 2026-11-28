"""Agent 2, second output — the readable transcript, kept next to the verbatim one.

First a rule pass that always runs (no model): the organization's glossary spellings for known
variants ("إي بي آي" → "API"), hesitation sounds and immediate repetitions removed, and words the
recogniser was unsure of listed as uncertain terms. Then, when a language model is allowed, a
light edit for punctuation and obvious recognition errors. The model's version of a segment is
accepted only if it keeps the same numbers, explicit dates, negation and terms as the verbatim
text and about the same length; otherwise the rule version stays and the segment is flagged.
"""

from __future__ import annotations

import json
import re
from collections.abc import Callable

from rapidfuzz import fuzz

from mahdar.pipeline import arabic
from mahdar.pipeline.llm import LlmClient, LlmRequest
from mahdar.pipeline.llm import prompts
from mahdar.pipeline.schemas import Segment, Transcript

BATCH = 40


def _variants(glossary: list[dict]) -> list[tuple[str, str]]:
    pairs = []
    for g in glossary:
        for v in g.get("variants") or []:
            if v.strip():
                pairs.append((v.strip(), g["term"]))
    return sorted(pairs, key=lambda p: len(p[0]), reverse=True)


def apply_glossary(text: str, glossary: list[dict]) -> tuple[str, list[str]]:
    """Replaces known spoken/recognised variants by the glossary term (exact match on the
    normalised text, allowing the Arabic article "ال" before the variant)."""
    out = text
    applied = []
    for variant, term in _variants(glossary):
        pattern = r"(?:(?<=\s)|^)(?:الـ\s?|ال)?" + r"\s+".join(re.escape(p) for p in variant.split()) + r"(?=[\s،.؟!,]|$)"
        new, n = re.subn(pattern, term, out)
        if n == 0:
            # Same comparison as normalize(): try without diacritics/hamza differences.
            norm_v = arabic.normalize(variant)
            toks = out.split()
            for i in range(len(toks)):
                window = " ".join(toks[i:i + len(norm_v.split())])
                if arabic.normalize(arabic.strip_clitics(window)) == norm_v or arabic.normalize(window) == norm_v:
                    toks[i:i + len(norm_v.split())] = [term]
                    new, n = " ".join(toks), 1
                    break
        if n:
            out = new
            applied.append(term)
    return out, applied


def near_misses(text: str, glossary: list[dict]) -> list[str]:
    """Words that look like a glossary term or variant but are not exactly it ("داينمت" for
    "داينامكس"): listed as uncertain, never replaced."""
    cands = [(arabic.normalize(v), g["term"]) for g in glossary for v in [g["term"], *(g.get("variants") or [])] if v]
    found = []
    for tok in text.split():
        nt = arabic.normalize(arabic.strip_clitics(tok))
        if len(nt) < 4:
            continue
        for cv, term in cands:
            if " " in cv:
                continue
            r = fuzz.ratio(nt, cv)
            if 70 <= r < 92 and nt != cv:
                found.append(f"{tok} (؟ {term})")
                break
    return found


def rules_readable(seg: Segment, glossary: list[dict]) -> tuple[str, list[str]]:
    text, _ = apply_glossary(seg.text_verbatim, glossary)
    toks = text.split()
    kept: list[str] = []
    for t in toks:
        if arabic.normalize(t) in arabic.FILLERS:
            continue
        if kept and arabic.normalize(kept[-1]) == arabic.normalize(t) and len(arabic.normalize(t)) > 1:
            continue
        kept.append(t)
    uncertain = [w.w for w in seg.words if w.p < 0.4 and len(arabic.normalize(w.w)) > 2]
    uncertain += near_misses(seg.text_verbatim, glossary)
    return " ".join(kept), sorted(set(uncertain))


def signature(text: str) -> dict:
    return {
        "numbers": sorted(arabic.extract_numbers(text)),
        "dates": sorted({(d.day, d.month) for d in arabic.extract_dates(text) if d.day and d.month}),
        "negation": arabic.has_negation(text),
        "latin": sorted(arabic.latin_terms(text)),
    }


def safe_edit(reference: str, edited: str) -> tuple[bool, str]:
    a, b = signature(reference), signature(edited)
    if a["numbers"] != b["numbers"]:
        return False, "numbers"
    if a["dates"] != b["dates"]:
        return False, "dates"
    if a["negation"] != b["negation"]:
        return False, "negation"
    if not set(b["latin"]) <= set(a["latin"]):
        return False, "terms"
    la, lb = len(arabic.normalize(reference)), len(arabic.normalize(edited))
    if la and not (0.5 <= lb / la <= 1.35):
        return False, "length"
    return True, ""


def build(transcript: Transcript, glossary: list[dict], llm: LlmClient | None,
          progress: Callable[[float], None] | None = None) -> tuple[Transcript, list[dict], dict]:
    segments = [s.model_copy(deep=True) for s in transcript.segments]
    for s in segments:
        text, uncertain = rules_readable(s, glossary)
        s.text_readable = text
        s.uncertain_terms = uncertain
        s.readable_source = "rules"
        if uncertain and "uncertain_term" not in s.flags:
            s.flags = sorted({*s.flags, "uncertain_term"})  # type: ignore[assignment]
    usage: list[dict] = []
    stats = {"llm_accepted": 0, "llm_rejected": 0, "rejections": {}}
    usable = [s for s in segments if not s.excluded and s.text_verbatim.strip()]
    if llm is not None and usable:
        context = prompts.meeting_context({}, glossary, [], transcript.speakers)
        for i in range(0, len(usable), BATCH):
            batch = usable[i:i + BATCH]
            payload = [{"id": s.id, "text": s.text_readable} for s in batch]
            res = llm.generate_json(LlmRequest(
                stage="readable", system=prompts.READABLE_SYSTEM, shared_context=context, schema=prompts.readable_schema(),
                user="Segments (JSON). The text already has the glossary spellings applied.\n<segments>\n"
                     + json.dumps(payload, ensure_ascii=False, indent=1) + "\n</segments>",
                max_tokens=24000, effort="medium",
            ))
            usage.append({"stage": "readable", "model": res.model, "input_tokens": res.input_tokens, "output_tokens": res.output_tokens,
                          "cache_read_tokens": res.cache_read_tokens, "served_by_fallback": res.served_by_fallback})
            by_id = {s.id: s for s in batch}
            for r in res.data["segments"]:
                seg = by_id.get(r["id"])
                if seg is None:
                    continue
                ok, why = safe_edit(seg.text_readable, r["text"])
                if ok:
                    seg.text_readable = r["text"].strip()
                    seg.readable_source = "llm"
                    seg.uncertain_terms = sorted(set(seg.uncertain_terms) | {t for t in r.get("uncertain_terms", []) if t.strip()})
                    stats["llm_accepted"] += 1
                else:
                    stats["llm_rejected"] += 1
                    stats["rejections"][why] = stats["rejections"].get(why, 0) + 1
            if progress:
                progress(min(1.0, (i + BATCH) / len(usable)))
    return transcript.model_copy(update={"segments": segments}), usage, stats
