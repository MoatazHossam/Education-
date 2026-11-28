"""Agent 5 — evidence verification.

Two independent passes over every item, then a combination that can only make an item weaker:

1. Rule checks against the transcript itself (no language model): the cited segments exist and
   were not screened out; each quote really occurs in its segment; every number, explicit date,
   owner name, person name and English term in the claim occurs in the cited words; a decision
   cites approving words and no hedge or negation; an assignment cites assigning or committing
   words; a deferral is not recorded as a rejection; negation agrees; a calendar date is not made
   out of a relative expression; the statement shares at least one content word with what was said.
2. An independent model audit (when a model is configured and allowed): a sceptical auditor
   prompt that sees the transcript and the claims, never the analysis prompt or its reasoning,
   and judges support, classification, speaker, owner, date and missing conditions, and lists
   omissions.

An item is "verified" only when both pass. An item the auditor finds unsupported, or that the
recording contradicts, stays out of the minutes until a person accepts it. The type is never upgraded automatically: a decision
without approving words becomes a tentative agreement or a proposal, an assignment without an
accepted owner becomes a suggested action, and a person sees why.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from datetime import date

from rapidfuzz import fuzz

from mahdar.pipeline import arabic
from mahdar.pipeline.llm import LlmClient, LlmRequest, prompts
from mahdar.pipeline.schemas import (
    Analysis,
    Check,
    Issue,
    Item,
    ItemVerification,
    LlmJudgment,
    ResolvedEvidence,
    Segment,
    Transcript,
    VerificationReport,
)

DECISION_TYPES = {"decision_approved", "decision_rejected"}
ACTION_TYPES = {"action_assigned", "action_suggested"}
HIGH_STAKES = {"decision_approved", "decision_rejected", "action_assigned"}
# Checks whose failure is a hint, not a proof (wording varies): an independent model's "supported"
# lowers them to minor.
HEURISTIC = {"negation", "latin_terms", "qualifications", "deferral_words", "rejection_words"}
WEAKER = {
    "decision_approved": ["agreement_tentative", "proposal", "recommendation", "discussion"],
    "agreement_tentative": ["proposal", "recommendation", "discussion"],
    "action_assigned": ["action_suggested"],
    "decision_rejected": ["deferred", "proposal", "discussion"],
}
# Reporting words a minutes statement adds around what was said; they prove nothing about support.
_GENERIC = {
    arabic.normalize(w)
    for w in [
        "تم",
        "تقرر",
        "يقترح",
        "مقترح",
        "اقتراح",
        "اقترح",
        "يطلب",
        "طلب",
        "أكد",
        "أشار",
        "ذكر",
        "أوضح",
        "أفاد",
        "أبدى",
        "أعرب",
        "رأى",
        "يرى",
        "الاجتماع",
        "اللجنة",
        "الموضوع",
        "موضوع",
        "ضرورة",
        "إلى",
        "على",
        "في",
        "من",
        "عن",
        "مع",
        "أن",
        "إن",
        "هل",
        "ما",
        "هو",
        "هي",
        "هذا",
        "هذه",
        "ذلك",
        "التي",
        "الذي",
        "قبل",
        "بعد",
        "خلال",
        "حول",
        "بشأن",
        "عدم",
        "وجود",
        "كان",
        "يكون",
        "سيتم",
        "يتم",
        "لم",
        "لا",
        "قد",
        "كما",
        "أيضا",
        "حتى",
        "بين",
        "أو",
        "ثم",
        "كل",
        "بعض",
        "المتحدث",
        "الحاضرين",
        "أحد",
    ]
}


def _content_words(text: str) -> list[str]:
    out = []
    for t in arabic.normalize(text).split():
        s = arabic.strip_clitics(t)
        if len(s) >= 3 and t not in _GENERIC and s not in _GENERIC and not t.isdigit():
            out.append(s)
    return out


def grounding(statement: str, evidence_text: str) -> tuple[int, int]:
    """(content words of the statement, how many occur — loosely — in the evidence). Paraphrase from
    colloquial speech legitimately shares few words, so only a statement sharing none is suspect."""
    words = _content_words(statement)
    ev = [arabic.strip_clitics(t) for t in arabic.normalize(evidence_text).split()]
    hits = sum(
        1
        for w in words
        if any(fuzz.ratio(w, x) >= 75 or (len(w) >= 4 and len(x) >= 3 and (w in x or x in w)) for x in ev)
    )
    return len(words), hits


TITLES = {
    arabic.normalize(t)
    for t in [
        "الأستاذ",
        "أستاذ",
        "الاستاذة",
        "أستاذة",
        "المهندس",
        "مهندس",
        "المهندسة",
        "مهندسة",
        "الدكتور",
        "دكتور",
        "الدكتورة",
        "دكتورة",
        "السيد",
        "السيدة",
        "د",
        "م",
        "أ",
    ]
}

QUOTE_FOUND = 88
QUOTE_APPROX = 72


def _seg_text(seg: Segment) -> str:
    return f"{seg.text_verbatim} {seg.text_readable}"


def _quote_score(quote: str, seg: Segment) -> float:
    q = arabic.normalize(quote)
    if not q:
        return 0.0
    best = 0.0
    for txt in (seg.text_verbatim, seg.text_readable):
        t = arabic.normalize(txt)
        if q in t:
            return 100.0
        best = max(best, fuzz.partial_ratio(q, t) if len(q) <= len(t) else fuzz.ratio(q, t))
    return best


def _check(checks: list[Check], name: str, passed: bool, severity: str, detail: str) -> None:
    checks.append(Check(name=name, passed=passed, severity=severity, detail_ar=detail))  # type: ignore[arg-type]


def _name_in(name: str, text_norm: str) -> bool:
    toks = [t for t in arabic.normalize(name).split() if t not in TITLES and len(t) >= 2]
    if not toks:
        return True
    return all(any(fuzz.ratio(t, w) >= 85 or arabic.strip_clitics(w) == t for w in text_norm.split()) for t in toks)


def _term_in(term: str, text: str, glossary: list[dict]) -> bool:
    n = arabic.normalize(text)
    if arabic.normalize(term) in n:
        return True
    for g in glossary:
        if arabic.normalize(g.get("term", "")) == arabic.normalize(term):
            for v in g.get("variants") or []:
                vn = arabic.normalize(v)
                if vn and (vn in n or fuzz.partial_ratio(vn, n) >= 85):
                    return True
    return False


def rule_checks(
    item: Item,
    segs: dict[str, Segment],
    glossary: list[dict],
    meeting_date: date | None,
    speaker_names: dict[str, str],
    recording_sha: str,
) -> tuple[list[Check], list[ResolvedEvidence], str]:
    """Returns the checks, the resolved evidence and the type the rules allow."""
    checks: list[Check] = []
    resolved: list[ResolvedEvidence] = []
    hs = item.type in HIGH_STAKES
    allowed_type = item.type

    cited = [e for e in [*item.evidence, *item.approval_evidence]]
    if not item.evidence:
        _check(checks, "evidence_present", False, "critical", "لا يستند البند إلى أي مقطع من التسجيل.")
    for e in cited:
        seg = segs.get(e.segment_id)
        if seg is None:
            _check(checks, "segment_exists", False, "critical", f"المقطع {e.segment_id} المستشهد به غير موجود في النص.")
            continue
        if seg.excluded:
            _check(
                checks,
                "segment_usable",
                False,
                "critical",
                f"المقطع {seg.id} مستبعد من التحليل (يُرجَّح أنه نص مُختلَق أثناء صمت أو ضوضاء).",
            )
        score = _quote_score(e.quote, seg)
        found = score >= QUOTE_FOUND
        resolved.append(
            ResolvedEvidence(
                recording_sha256=recording_sha,
                segment_id=seg.id,
                speaker_id=seg.speaker_id,
                speaker_confidence=seg.speaker_confidence,
                start=seg.start,
                end=seg.end,
                original_text=seg.text_verbatim,
                quote=e.quote,
                quote_found=found,
                match_score=round(score, 1),
            )
        )
        if not found:
            sev = "major" if score >= QUOTE_APPROX else "critical"
            _check(
                checks,
                "quote_match",
                False,
                sev,
                f"الاقتباس «{e.quote}» لا يطابق نص المقطع {seg.id} (درجة التطابق {score:.0f}٪).",
            )
    good = [r for r in resolved if r.quote_found]
    if item.evidence and good:
        _check(checks, "quote_match", True, "info", "الاقتباسات موجودة حرفياً في المقاطع المستشهد بها.")

    ev_segs = [segs[r.segment_id] for r in resolved if r.segment_id in segs]
    ev_text = " ".join(_seg_text(s) for s in ev_segs)
    ev_norm = arabic.normalize(ev_text)
    # Speaker labels ("المتحدث 2") are references, not facts: their digits are not numbers to check.
    claim_text = arabic.SPEAKER_LABEL.sub(
        " ",
        " ".join(
            [item.statement, *item.qualifications, item.due.text_as_spoken or "", item.owner.name_as_spoken or ""]
        ),
    )

    # The statement must share at least one content word with what was said.
    if resolved and any(r.quote_found for r in resolved):
        n_words, n_hits = grounding(item.statement, ev_text)
        if n_words >= 3 and n_hits == 0:
            _check(
                checks,
                "statement_grounding",
                False,
                "critical",
                "لا ترد في المقاطع المستشهد بها أي كلمة من مضمون البند؛ الاقتباس لا يدعم ما نُسب إليه.",
            )

    # Speakers.
    cited_speakers = {s.speaker_id for s in ev_segs if s.speaker_id}
    for sid in item.speaker_ids:
        if sid not in cited_speakers:
            _check(
                checks,
                "speaker",
                False,
                "major",
                f"المتحدث {speaker_names.get(sid, sid)} لا يظهر في المقاطع المستشهد بها.",
            )
    weak = [s for s in ev_segs if s.speaker_confidence in ("low", "unknown") or "uncertain_speaker" in s.flags]
    if weak and (item.speaker_ids or item.owner.speaker_id):
        _check(
            checks,
            "speaker_confidence",
            False,
            "major" if hs else "minor",
            f"نسبة المقاطع {', '.join(s.id for s in weak)} إلى متحدثيها غير مؤكدة.",
        )
    low_asr = [s for s in ev_segs if "low_confidence" in s.flags]
    if low_asr:
        _check(
            checks,
            "recognition_confidence",
            False,
            "major" if hs else "minor",
            f"دقة التعرف على الكلام منخفضة في المقاطع {', '.join(s.id for s in low_asr)}؛ يُنصح بالاستماع إليها.",
        )

    # Numbers.
    claim_nums = arabic.extract_numbers(claim_text)
    ev_nums = arabic.extract_numbers(ev_text)
    if item.due.date_iso:
        claim_nums -= {float(p) for p in item.due.date_iso.split("-") if p.isdigit()}
    missing = sorted(n for n in claim_nums if not any(abs(n - m) < 1e-6 for m in ev_nums))
    if missing:
        shown = "، ".join(f"{m:g}" for m in missing)
        _check(
            checks,
            "numbers",
            False,
            "critical" if hs else "major",
            f"أرقام في البند لا ترد في المقاطع المستشهد بها: {shown}.",
        )
    elif claim_nums:
        _check(checks, "numbers", True, "info", "الأرقام الواردة في البند موجودة في الدليل.")

    # Dates.
    ev_dates = arabic.extract_dates(ev_text)
    ev_explicit = {(d.day, d.month) for d in ev_dates if d.day and d.month}
    for d in arabic.extract_dates(" ".join([item.statement, item.due.text_as_spoken or ""])):
        if d.day and d.month and (d.day, d.month) not in ev_explicit:
            _check(checks, "dates", False, "critical", f"التاريخ «{d.text}» لا يرد في المقاطع المستشهد بها.")
    if item.due.date_iso:
        try:
            iso = date.fromisoformat(item.due.date_iso)
        except ValueError:
            iso = None
            _check(checks, "due_date", False, "critical", f"تاريخ الاستحقاق «{item.due.date_iso}» غير صالح.")
        if iso and (iso.day, iso.month) not in ev_explicit:
            _check(
                checks,
                "due_date",
                False,
                "critical",
                "حُوِّل الموعد إلى تاريخ محدد لم يُذكر صراحة في التسجيل"
                + (f" («{item.due.text_as_spoken}»)." if item.due.text_as_spoken else "."),
            )
        elif iso and meeting_date is None and not any(d.year for d in ev_dates):
            _check(checks, "due_date_year", False, "minor", "السنة مستنتجة؛ تاريخ الاجتماع غير معروف.")
    if item.due.text_as_spoken:
        dn = arabic.normalize(item.due.text_as_spoken)
        if dn and fuzz.partial_ratio(dn, ev_norm) < 80:
            _check(
                checks,
                "due_text",
                False,
                "critical" if hs else "major",
                f"الموعد «{item.due.text_as_spoken}» لا يرد في الدليل.",
            )
        if item.due.status == "explicit" and not ev_explicit and any(d.relative for d in ev_dates):
            _check(
                checks, "due_status", False, "major", "الموعد المذكور نسبي (مثل «الأسبوع القادم») وليس تاريخاً محدداً."
            )

    # Owner and people.
    if item.owner.name_as_spoken and not _name_in(item.owner.name_as_spoken, ev_norm):
        _check(
            checks,
            "owner",
            False,
            "critical" if item.type in ACTION_TYPES else "major",
            f"اسم المسؤول «{item.owner.name_as_spoken}» لا يرد في المقاطع المستشهد بها.",
        )
    people = [g["term"] for g in glossary if g.get("category") == "person"] + [n for n in speaker_names.values() if n]
    for person in {p for p in people if p}:
        # The statement may name a speaker whose label a person confirmed; that is allowed.
        if (
            _name_in(person, arabic.normalize(item.statement))
            and not _name_in(person, ev_norm)
            and person not in speaker_names.values()
        ):
            _check(checks, "names", False, "critical", f"الاسم «{person}» يرد في البند ولا يرد في الدليل.")
    if item.type == "action_assigned" and item.owner.status == "unspecified":
        _check(checks, "owner_present", False, "major", "تكليف دون مسؤول محدد.")

    # English terms.
    for term in arabic.latin_terms(item.statement):
        if not _term_in(term, ev_text, glossary):
            _check(
                checks,
                "latin_terms",
                False,
                "major",
                f"المصطلح «{term}» لا يرد في الدليل (ولا أحد أشكاله المعروفة في المسرد).",
            )

    # Classification.
    approval_segs = [segs[e.segment_id] for e in item.approval_evidence if e.segment_id in segs] or ev_segs
    approval_text = arabic.normalize(
        " ".join([e.quote for e in item.approval_evidence]) or " ".join(_seg_text(s) for s in approval_segs)
    )
    if item.type == "decision_approved":
        appr = arabic.contains_phrase(approval_text, arabic.APPROVAL)
        tent = arabic.contains_phrase(arabic.normalize(" ".join(_seg_text(s) for s in approval_segs)), arabic.TENTATIVE)
        rej = arabic.contains_phrase(approval_text, arabic.REJECTION)
        if not appr:
            allowed_type = "agreement_tentative" if tent else "proposal"
            _check(
                checks,
                "approval_words",
                False,
                "critical",
                "لا يتضمن الدليل عبارة اعتماد أو موافقة صريحة؛ صُنِّف البند " + ("توافقاً مبدئياً." if tent else "مقترحاً."),
            )
        elif rej or (
            arabic.has_negation(approval_text)
            and not arabic.contains_phrase(approval_text, ["لا اعتراض", "مفيش اعتراض"])
        ):
            allowed_type = "proposal"
            _check(checks, "approval_negated", False, "critical", "عبارة الاعتماد في الدليل منفية أو مرفوضة.")
        elif tent:
            allowed_type = "agreement_tentative"
            _check(
                checks,
                "tentative_words",
                False,
                "major",
                f"عبارات تحفظ أو اشتراط في مقطع الاعتماد: {'، '.join(tent[:3])}.",
            )
        else:
            _check(checks, "approval_words", True, "info", f"عبارة الاعتماد: {'، '.join(appr[:3])}.")
    elif item.type == "decision_rejected":
        if not (arabic.contains_phrase(approval_text, arabic.REJECTION) or arabic.has_negation(approval_text)):
            if arabic.contains_phrase(ev_norm, arabic.DEFERRAL):
                # "نؤجل" is not "نرفض": recording a deferral as a rejection changes the decision.
                allowed_type = "deferred"
                _check(
                    checks,
                    "rejection_is_deferral",
                    False,
                    "major",
                    "الدليل يتضمن تأجيلاً لا رفضاً؛ صُنِّف البند موضوعاً مؤجلاً.",
                )
            else:
                _check(checks, "rejection_words", False, "major", "لا يتضمن الدليل عبارة رفض صريحة.")
    elif item.type == "action_assigned":
        if not (arabic.contains_phrase(ev_norm, arabic.ASSIGNMENT) or arabic.future_commitment(ev_text)):
            allowed_type = "action_suggested"
            _check(
                checks,
                "assignment_words",
                False,
                "critical",
                "لا يتضمن الدليل تكليفاً أو التزاماً صريحاً؛ صُنِّف إجراءً مقترحاً.",
            )
        elif arabic.contains_phrase(ev_norm, ["ممكن", "يمكن", "ربما"]) and not arabic.contains_phrase(
            ev_norm, ["عليك", "اطلب من", "حاضر", "يتولى", "سأتولى"]
        ):
            allowed_type = "action_suggested"
            _check(checks, "assignment_hedged", False, "major", "الالتزام بالمهمة مشروط أو غير مؤكد («ممكن»).")
    elif item.type == "deferred" and not arabic.contains_phrase(ev_norm, arabic.DEFERRAL):
        _check(checks, "deferral_words", False, "minor", "لا يتضمن الدليل عبارة تأجيل صريحة.")

    # Negation.
    claim_neg = arabic.has_negation(item.statement)
    ev_neg = arabic.has_negation(" ".join(e.quote for e in item.evidence))
    if claim_neg != ev_neg:
        _check(
            checks,
            "negation",
            False,
            "major",
            "صيغة النفي في البند لا تطابق صيغة الدليل؛ تأكد من عدم انعكاس المعنى."
            if claim_neg
            else "الدليل يتضمن نفياً لا يظهر في البند؛ تأكد من عدم انعكاس المعنى.",
        )

    # Qualifications.
    for q in item.qualifications:
        qn = arabic.normalize(q)
        content = [w for w in qn.split() if len(w) > 3]
        hits = sum(
            1
            for w in content
            if any(fuzz.ratio(arabic.strip_clitics(w), arabic.strip_clitics(x)) >= 80 for x in ev_norm.split())
        )
        if content and hits / len(content) < 0.5:
            _check(checks, "qualifications", False, "major", f"الشرط «{q}» لا يظهر بوضوح في الدليل.")

    return checks, resolved, allowed_type


def _weakest(original: str, *candidates: str | None) -> str:
    order = [original, *WEAKER.get(original, [])]
    chosen = original
    for c in candidates:
        if c and c in order and order.index(c) > order.index(chosen):
            chosen = c
    return chosen


def llm_audit(
    llm: LlmClient, context: str, items: list[Item], speaker_names: dict[str, str]
) -> tuple[dict[str, dict], list[dict], list[dict]]:
    judgments: dict[str, dict] = {}
    omissions: list[dict] = []
    usage: list[dict] = []
    for i in range(0, len(items), 40):
        batch = items[i : i + 40]
        claims = [
            {
                "claim_id": it.id,
                "type": it.type,
                "statement": it.statement,
                "speakers": [f"{s} ({speaker_names.get(s) or s})" for s in it.speaker_ids],
                "owner": it.owner.name_as_spoken,
                "due": it.due.text_as_spoken,
                "due_date_iso": it.due.date_iso,
                "qualifications": it.qualifications,
                "cited_segments": sorted({e.segment_id for e in [*it.evidence, *it.approval_evidence]}),
                "quotes": [e.quote for e in [*it.evidence, *it.approval_evidence]],
            }
            for it in batch
        ]
        user = (
            "Claims to audit (JSON). Judge every claim_id; list omissions only once, considering the whole transcript.\n"
            f"<claims>\n{json.dumps(claims, ensure_ascii=False, indent=1)}\n</claims>"
        )
        res = llm.generate_json(
            LlmRequest(
                stage="verification",
                system=prompts.VERIFY_SYSTEM,
                user=user,
                schema=prompts.verify_schema(),
                shared_context=context,
                max_tokens=32000,
            )
        )
        usage.append(
            {
                "stage": "verification",
                "model": res.model,
                "input_tokens": res.input_tokens,
                "output_tokens": res.output_tokens,
                "cache_read_tokens": res.cache_read_tokens,
                "served_by_fallback": res.served_by_fallback,
            }
        )
        for j in res.data["judgments"]:
            judgments[j["claim_id"]] = {**j, "model": res.model}
        if i == 0:
            omissions = res.data.get("omissions", [])
    return judgments, omissions, usage


def verify(
    transcript: Transcript,
    analysis: Analysis,
    *,
    meta: dict,
    glossary: list[dict],
    llm: LlmClient | None,
    progress: Callable[[float], None] | None = None,
) -> tuple[VerificationReport, list[dict]]:
    segs = {s.id: s for s in transcript.segments}
    speaker_names = {s.id: s.display_name or "" for s in transcript.speakers if s.display_name}
    try:
        meeting_date = date.fromisoformat(meta["date"]) if meta.get("date") else None
    except ValueError:
        meeting_date = None
    judgments: dict[str, dict] = {}
    llm_omissions: list[dict] = []
    usage: list[dict] = []
    if llm is not None and analysis.items:
        context = prompts.meeting_context(
            meta, glossary, [s for s in transcript.segments if not s.excluded], transcript.speakers
        )
        judgments, llm_omissions, usage = llm_audit(llm, context, analysis.items, speaker_names)
    if progress:
        progress(0.7)

    results: list[ItemVerification] = []
    doc_issues: list[Issue] = []
    for it in analysis.items:
        checks, resolved, allowed = rule_checks(
            it, segs, glossary, meeting_date, speaker_names, transcript.recording_sha256
        )
        j = judgments.get(it.id)
        judgment = None
        if j:
            judgment = LlmJudgment(
                verdict=j["verdict"],
                classification_correct=j["classification_correct"],
                suggested_type=j.get("suggested_type"),
                speaker_correct=j.get("speaker_correct"),
                missing_qualifications=j.get("missing_qualifications", []),
                rationale_ar=j.get("rationale_ar", ""),
                model=j.get("model", ""),
            )
            if j.get("owner_supported") is False:
                _check(
                    checks,
                    "owner_llm",
                    False,
                    "critical" if it.type in ACTION_TYPES else "major",
                    "المراجعة المستقلة: المسؤول غير مدعوم بالتسجيل.",
                )
            if j.get("due_supported") is False:
                _check(
                    checks,
                    "due_llm",
                    False,
                    "critical" if it.type in HIGH_STAKES else "major",
                    "المراجعة المستقلة: الموعد غير مدعوم بالتسجيل.",
                )
            if judgment.speaker_correct is False:
                _check(checks, "speaker_llm", False, "major", "المراجعة المستقلة: نسبة القول إلى المتحدث غير صحيحة.")
            for mq in judgment.missing_qualifications:
                _check(checks, "missing_qualification", False, "major", f"شرط أو تحفظ لم يُذكر في البند: {mq}")
        llm_ok = judgment is not None and judgment.verdict == "supported" and judgment.classification_correct
        # A model that read the transcript and agrees lowers heuristic findings to minor.
        if llm_ok:
            checks = [
                c.model_copy(update={"severity": "minor"})
                if (not c.passed and c.name in HEURISTIC and c.severity == "major")
                else c
                for c in checks
            ]
        failed = [c for c in checks if not c.passed]
        crit = [c for c in failed if c.severity == "critical"]
        major = [c for c in failed if c.severity == "major"]
        any_found = any(r.quote_found for r in resolved)

        suggested = judgment.suggested_type if judgment and not judgment.classification_correct else None
        final_type = _weakest(it.type, allowed, suggested)
        if judgment and suggested and suggested not in [it.type, *WEAKER.get(it.type, [])]:
            _check(
                checks,
                "classification_other",
                False,
                "major",
                f"المراجعة المستقلة ترى أن التصنيف الأنسب «{suggested}»؛ لم يُغيَّر تلقائياً.",
            )
            major.append(checks[-1])

        if not it.evidence or not any_found:
            status = "unsupported"
        elif (judgment and judgment.verdict == "contradicted") or any(c.name == "approval_negated" for c in crit):
            status = "contradicted"
        elif judgment and judgment.verdict == "unsupported":
            # An independent reading found no support: kept out of the minutes until a person accepts it.
            status = "unsupported"
        elif crit:
            status = "needs_review"
        elif major or (judgment and judgment.verdict == "partial") or final_type != it.type:
            status = "partially_supported"
        elif judgment is None:
            status = "verified_rules_only"
        else:
            status = "verified" if llm_ok else "partially_supported"
        if final_type != it.type and status in ("verified", "verified_rules_only"):
            status = "partially_supported"

        issues = [
            Issue(
                code=c.name,
                severity=c.severity,
                message_ar=c.detail_ar,
                item_id=it.id,  # type: ignore[arg-type]
                segment_ids=sorted({e.segment_id for e in it.evidence}),
            )
            for c in checks
            if not c.passed
        ]
        if final_type != it.type:
            issues.append(
                Issue(
                    code="reclassified",
                    severity="critical" if it.type in HIGH_STAKES else "major",
                    message_ar=f"أُعيد تصنيف البند من «{it.type}» إلى «{final_type}» لعدم كفاية الدليل.",
                    item_id=it.id,
                )
            )
        if status in ("unsupported", "contradicted", "needs_review") and not any(
            i.severity == "critical" for i in issues
        ):
            issues.append(
                Issue(
                    code=f"status_{status}",
                    severity="critical" if it.type in HIGH_STAKES else "major",
                    message_ar=judgment.rationale_ar if judgment else "البند غير مدعوم بما يكفي من التسجيل.",
                    item_id=it.id,
                )
            )
        results.append(
            ItemVerification(
                item_id=it.id,
                status=status,
                original_type=it.type,
                final_type=final_type,  # type: ignore[arg-type]
                checks=checks,
                evidence=resolved,
                llm=judgment,
                issues=issues,
            )
        )

    # Document level: possible omissions (rules), the auditor's omissions, contradictions, transcript.
    cited = {e.segment_id for it in analysis.items for e in [*it.evidence, *it.approval_evidence]}
    for s in transcript.segments:
        if s.excluded or s.id in cited:
            continue
        n = arabic.normalize(s.text_verbatim)
        strong = arabic.contains_phrase(n, arabic.APPROVAL) or arabic.contains_phrase(n, arabic.REJECTION)
        task = arabic.contains_phrase(n, arabic.ASSIGNMENT) or arabic.future_commitment(s.text_verbatim)
        facts = arabic.extract_numbers(s.text_verbatim) or [
            d for d in arabic.extract_dates(s.text_verbatim) if not d.relative
        ]
        if strong or task:
            doc_issues.append(
                Issue(
                    code="potential_omission",
                    severity="major",
                    segment_ids=[s.id],
                    start=s.start,
                    end=s.end,
                    message_ar=f"المقطع {s.id} يتضمن عبارة {'اعتماد أو رفض' if strong else 'تكليف أو التزام'} ولم يستند إليه أي بند.",
                )
            )
        elif facts and len(n.split()) >= 4:
            doc_issues.append(
                Issue(
                    code="uncited_fact",
                    severity="minor",
                    segment_ids=[s.id],
                    start=s.start,
                    end=s.end,
                    message_ar=f"المقطع {s.id} يتضمن أرقاماً أو تواريخ لم يستند إليها أي بند.",
                )
            )
    for o in llm_omissions:
        seg = segs.get(o["segment_id"])
        doc_issues.append(
            Issue(
                code="auditor_omission",
                severity="critical" if o["suggested_type"] in HIGH_STAKES else "major",
                segment_ids=[o["segment_id"]],
                start=seg.start if seg else None,
                end=seg.end if seg else None,
                message_ar=f"المراجعة المستقلة: «{o['quote']}» — {o['why_ar']}",
            )
        )
    for it in analysis.items:
        if it.type == "contradiction":
            doc_issues.append(
                Issue(
                    code="contradiction",
                    severity="major",
                    item_id=it.id,
                    segment_ids=sorted({e.segment_id for e in it.evidence}),
                    message_ar=f"تعارض: {it.statement}",
                )
            )
    doc_issues += _conflicting_dates(analysis.items)
    if (
        analysis.purpose
        and analysis.purpose_evidence
        and not any(
            e.segment_id in segs and _quote_score(e.quote, segs[e.segment_id]) >= QUOTE_FOUND
            for e in analysis.purpose_evidence
        )
    ):
        doc_issues.append(
            Issue(code="purpose_unsupported", severity="major", message_ar="هدف الاجتماع كما صيغ لا يطابق نص التسجيل.")
        )
    excluded = [s for s in transcript.segments if s.excluded]
    if excluded:
        doc_issues.append(
            Issue(
                code="excluded_segments",
                severity="minor",
                segment_ids=[s.id for s in excluded],
                message_ar=f"استُبعد {len(excluded)} مقطعاً يُرجَّح أنها نص مُختلَق أثناء صمت أو ضوضاء؛ يمكن الاستماع إليها.",
            )
        )

    coverage = _coverage(transcript, analysis, results)
    report = VerificationReport(
        items=results,
        document_issues=doc_issues,
        coverage=coverage,
        llm_used=bool(judgments),
        llm_model=next(iter(judgments.values()))["model"] if judgments else None,
    )
    if progress:
        progress(1.0)
    return report, usage


def _conflicting_dates(items: list[Item]) -> list[Issue]:
    out = []
    acts = [i for i in items if i.type in ACTION_TYPES and i.due.text_as_spoken]
    for i, a in enumerate(acts):
        for b in acts[i + 1 :]:
            same_owner = (
                a.owner.name_as_spoken
                and b.owner.name_as_spoken
                and _name_in(a.owner.name_as_spoken, arabic.normalize(b.owner.name_as_spoken))
            )
            similar = fuzz.token_set_ratio(arabic.normalize(a.statement), arabic.normalize(b.statement)) >= 75
            if (same_owner or similar) and arabic.normalize(a.due.text_as_spoken or "") != arabic.normalize(
                b.due.text_as_spoken or ""
            ):
                out.append(
                    Issue(
                        code="conflicting_dates",
                        severity="major",
                        item_id=a.id,
                        message_ar=f"موعدان مختلفان لمهمة متشابهة: «{a.due.text_as_spoken}» و«{b.due.text_as_spoken}» ({a.id}، {b.id}).",
                    )
                )
    return out


def _coverage(transcript: Transcript, analysis: Analysis, results: list[ItemVerification]) -> dict[str, float]:
    usable = [s for s in transcript.segments if not s.excluded]
    words = [w for s in usable for w in s.words]
    cited = {e.segment_id for it in analysis.items for e in it.evidence}
    n = len(results) or 1
    hs = [r for r in results if r.original_type in HIGH_STAKES] or []
    return {
        "items": float(len(results)),
        "evidence_coverage": round(sum(1 for r in results if any(e.quote_found for e in r.evidence)) / n, 4),
        "verified_ratio": round(sum(1 for r in results if r.status in ("verified", "verified_rules_only")) / n, 4),
        "high_stakes_items": float(len(hs)),
        "high_stakes_verified_ratio": round(
            sum(1 for r in hs if r.status in ("verified", "verified_rules_only")) / (len(hs) or 1), 4
        ),
        "unsupported_items": float(sum(1 for r in results if r.status in ("unsupported", "contradicted"))),
        "segments_cited_ratio": round(len(cited & {s.id for s in usable}) / (len(usable) or 1), 4),
        "low_confidence_word_ratio": round(sum(1 for w in words if w.p < 0.5) / (len(words) or 1), 4),
        "uncertain_speaker_segments": float(sum(1 for s in usable if "uncertain_speaker" in s.flags)),
    }
