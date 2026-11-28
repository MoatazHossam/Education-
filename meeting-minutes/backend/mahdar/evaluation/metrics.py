"""Evaluation metrics, each measured on its own against a human-written reference.

* Transcription: word and character error rates on normalised Arabic (diacritics, letter variants and
  punctuation removed, digits unified), so a spelling variant ("أربعمائة"/"أربعمئة") is not an error
  but a wrong word is.
* Speakers: the share of reference speech time attributed to the right speaker after the best
  one-to-one mapping between reference and detected speakers, and the number of speakers found.
* Items: precision and recall per category (approved decisions, assigned actions, ...), where an
  extracted item matches a reference item when every reference keyword, number and date occurs in
  its statement or evidence; plus counts that matter most: invented decisions (an approved decision
  with no reference decision) and "not a decision" violations.
"""

from __future__ import annotations

from itertools import permutations

from rapidfuzz import fuzz

from mahdar.pipeline import arabic


def _edits(ref: list, hyp: list) -> int:
    prev = list(range(len(hyp) + 1))
    for i, r in enumerate(ref, 1):
        cur = [i] + [0] * len(hyp)
        for j, h in enumerate(hyp, 1):
            cur[j] = min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (r != h))
        prev = cur
    return prev[-1]


def wer(reference: str, hypothesis: str) -> float:
    ref, hyp = arabic.normalize(reference).split(), arabic.normalize(hypothesis).split()
    return round(_edits(ref, hyp) / max(1, len(ref)), 4)


def cer(reference: str, hypothesis: str) -> float:
    ref = arabic.normalize(reference).replace(" ", "")
    hyp = arabic.normalize(hypothesis).replace(" ", "")
    return round(_edits(list(ref), list(hyp)) / max(1, len(ref)), 4)


def speaker_accuracy(ref_segments: list[dict], hyp_segments: list[dict]) -> dict:
    """Time-weighted attribution accuracy under the best mapping (reference speakers with no
    ground truth, e.g. FLEURS, are skipped)."""
    refs = [r for r in ref_segments if r.get("speaker")]
    if not refs:
        return {"applicable": False}
    co: dict[tuple[str, str], float] = {}
    total = 0.0
    for r in refs:
        dur = r["end"] - r["start"]
        total += dur
        for h in hyp_segments:
            ov = max(0.0, min(r["end"], h["end"]) - max(r["start"], h["start"]))
            if ov > 0 and h.get("speaker_id"):
                co[(r["speaker"], h["speaker_id"])] = co.get((r["speaker"], h["speaker_id"]), 0.0) + ov
    ref_spk = sorted({r["speaker"] for r in refs})
    hyp_spk = sorted({h["speaker_id"] for h in hyp_segments if h.get("speaker_id")})
    best = 0.0
    best_map: dict[str, str] = {}
    pool = hyp_spk + [None] * max(0, len(ref_spk) - len(hyp_spk))
    for perm in permutations(pool, len(ref_spk)):
        score = sum(co.get((r, h), 0.0) for r, h in zip(ref_spk, perm, strict=True) if h)
        if score > best:
            best, best_map = score, {r: h for r, h in zip(ref_spk, perm, strict=True) if h}
    return {
        "applicable": True,
        "accuracy": round(best / max(total, 1e-9), 4),
        "reference_speakers": len(ref_spk),
        "detected_speakers": len(hyp_spk),
        "mapping": best_map,
    }


def _item_text(item: dict, segments: dict[str, dict]) -> str:
    ev = " ".join(segments.get(e["segment_id"], {}).get("text_verbatim", "") for e in item.get("evidence", []))
    return " ".join(
        [
            item.get("statement", ""),
            item.get("owner", {}).get("name_as_spoken") or "",
            item.get("due", {}).get("text_as_spoken") or "",
            " ".join(item.get("qualifications", [])),
            ev,
        ]
    )


def matches(expected: dict, item: dict, segments: dict[str, dict], glossary: list[dict] | None = None) -> bool:
    text = _item_text(item, segments)
    norm = arabic.normalize(text)
    for kw in expected.get("keywords", []):
        k = arabic.normalize(kw)
        variants = [k] + [
            arabic.normalize(v)
            for g in (glossary or [])
            if arabic.normalize(g["term"]) == k
            for v in g.get("variants", [])
        ]
        if not any(v in norm or fuzz.partial_ratio(v, norm) >= 85 for v in variants if v):
            return False
    nums = arabic.extract_numbers(text)
    if any(not any(abs(n - m) < 1e-6 for m in nums) for n in expected.get("numbers", [])):
        return False
    dates = {(d.day, d.month) for d in arabic.extract_dates(text) if d.day and d.month}
    return all(tuple(d) in dates for d in expected.get("dates", []))


CATEGORY_TYPES = {
    "decisions_approved": {"decision_approved"},
    "decisions_rejected": {"decision_rejected"},
    "actions_assigned": {"action_assigned"},
    "actions_suggested": {"action_suggested"},
    "proposals": {"proposal", "recommendation", "agreement_tentative", "decision_rejected"},
    "deferred": {"deferred", "open_question"},
    "tentative": {"agreement_tentative"},
    "contradictions": {"contradiction"},
    "concerns": {"concern", "objection", "risk", "blocker"},
}


def item_scores(expected: dict, items: list[dict], segments: dict[str, dict], glossary: list[dict]) -> dict:
    """items: [{..., 'final_type'}]. Returns per-category precision/recall and the critical counts."""
    out: dict = {}
    for cat, types in CATEGORY_TYPES.items():
        exp = expected.get(cat)
        if exp is None:
            continue
        got = [i for i in items if i["final_type"] in types]
        found = [e for e in exp if any(matches(e, i, segments, glossary) for i in got)]
        strict = cat in ("decisions_approved", "actions_assigned", "decisions_rejected")
        extra = [i for i in got if not any(matches(e, i, segments, glossary) for e in exp)] if strict else []
        out[cat] = {
            "expected": len(exp),
            "extracted": len(got),
            "matched": len(found),
            "recall": round(len(found) / len(exp), 4) if exp else None,
            "precision": round((len(got) - len(extra)) / len(got), 4) if strict and got else None,
            "missing": [e["key"] for e in exp if e not in found],
            "unexpected": [i["id"] for i in extra],
        }
    approved = [i for i in items if i["final_type"] == "decision_approved"]
    exp_dec = expected.get("decisions_approved", [])
    invented = [i["id"] for i in approved if not any(matches(e, i, segments, glossary) for e in exp_dec)]
    violations = [
        n["key"] for n in expected.get("not_decisions", []) if any(matches(n, i, segments, glossary) for i in approved)
    ]
    out["invented_decisions"] = invented
    out["not_decision_violations"] = violations
    owners = []
    for e in expected.get("actions_assigned", []) + expected.get("actions_suggested", []):
        hit = next(
            (
                i
                for i in items
                if i["final_type"] in ("action_assigned", "action_suggested") and matches(e, i, segments, glossary)
            ),
            None,
        )
        if hit and e.get("owner"):
            owners.append(
                arabic.normalize(e["owner"]) in arabic.normalize(hit.get("owner", {}).get("name_as_spoken") or "")
            )
    out["owner_accuracy"] = round(sum(owners) / len(owners), 4) if owners else None
    return out


def invented_numbers(minutes_texts: list[str], reference_texts: list[str]) -> list[float]:
    """Numbers in the minutes that were never spoken (ignoring item numbering 1..20)."""
    ref = arabic.extract_numbers(" ".join(reference_texts))
    nums = arabic.extract_numbers(" ".join(minutes_texts))
    return sorted(n for n in nums if n > 20 and not any(abs(n - m) < 1e-6 for m in ref) and not (1900 < n < 2100))
