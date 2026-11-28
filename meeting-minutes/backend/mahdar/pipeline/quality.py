"""Quality gates and the minutes status.

No single "accuracy %" is computed: it would have no statistical meaning for one meeting. Instead
each gate is a measured quantity with a configurable threshold (organization settings,
quality_gates), and the status follows from open critical issues:

* ``draft_requires_review`` ("مسودة تتطلب المراجعة") while any critical issue is open or a gate
  fails. A critical issue closes only when a person accepts, corrects or rejects the item.
* ``draft`` when nothing critical is open but no person has reviewed it.
* ``reviewed`` / ``approved`` are only ever set by people (the review and approve endpoints).
"""

from __future__ import annotations

from mahdar.pipeline.schemas import Analysis, Issue, Transcript, VerificationReport

DEFAULT_GATES = {
    "max_low_confidence_word_ratio": 0.15,
    "min_evidence_coverage": 1.0,
    "max_unverified_critical": 0,
    "max_potential_omissions": 0,
}


def issue_key(i: Issue) -> str:
    return f"{i.code}:{i.item_id or ''}:{','.join(i.segment_ids)}"


def open_issues(issues: list[Issue], review: dict, analysis: Analysis | None = None) -> list[Issue]:
    """Issues not yet resolved by a person. Deciding on an item (accept/correct/reject) resolves
    that item's issues; a document issue is resolved individually."""
    decided = {k for k, v in (review or {}).get("items", {}).items() if v.get("decision") in ("accepted", "rejected")}
    resolved = set((review or {}).get("issues", {}))
    return [i for i in issues if not (i.item_id and i.item_id in decided) and issue_key(i) not in resolved]


def evaluate(
    transcript: Transcript,
    analysis: Analysis,
    verification: VerificationReport,
    review: dict,
    gates: dict,
    document_checks: dict | None = None,
) -> dict:
    g = {**DEFAULT_GATES, **(gates or {})}
    all_issues = [i for v in verification.items for i in v.issues] + list(verification.document_issues)
    still_open = open_issues(all_issues, review, analysis)
    crit = [i for i in still_open if i.severity == "critical"]
    omissions = [i for i in still_open if i.code in ("potential_omission", "auditor_omission")]
    cov = verification.coverage
    checks = [
        {
            "gate": "low_confidence_words",
            "label_ar": "نسبة الكلمات منخفضة الثقة في التعرف على الكلام",
            "value": cov.get("low_confidence_word_ratio", 0.0),
            "threshold": g["max_low_confidence_word_ratio"],
            "passed": cov.get("low_confidence_word_ratio", 0.0) <= g["max_low_confidence_word_ratio"],
        },
        {
            "gate": "evidence_coverage",
            "label_ar": "نسبة البنود المستندة إلى اقتباس مطابق من التسجيل",
            "value": cov.get("evidence_coverage", 0.0),
            "threshold": g["min_evidence_coverage"],
            "passed": cov.get("evidence_coverage", 0.0) >= g["min_evidence_coverage"] or not analysis.items,
        },
        {
            "gate": "open_critical",
            "label_ar": "الملاحظات الحرجة غير المحسومة",
            "value": len(crit),
            "threshold": g["max_unverified_critical"],
            "passed": len(crit) <= g["max_unverified_critical"],
        },
        {
            "gate": "potential_omissions",
            "label_ar": "مواضع محتملة لقرارات أو تكليفات لم تُستخرج",
            "value": len(omissions),
            "threshold": g["max_potential_omissions"],
            "passed": len(omissions) <= g["max_potential_omissions"],
        },
        {
            "gate": "independent_audit",
            "label_ar": "مراجعة مستقلة بنموذج لغوي",
            "value": "نعم" if verification.llm_used else "لا",
            "threshold": "نعم",
            "passed": verification.llm_used,
        },
    ]
    if document_checks is not None:
        ok = all(c.get("ok") for c in document_checks.values())
        checks.append(
            {
                "gate": "document_rendering",
                "label_ar": "سلامة عرض المستندات (الخطوط، الاتجاه، النص)",
                "value": "سليم" if ok else "به مشكلات",
                "threshold": "سليم",
                "passed": ok,
            }
        )
    excluded = sum(1 for s in transcript.segments if s.excluded)
    return {
        "gates": checks,
        "all_passed": all(c["passed"] for c in checks),
        "open_critical": len(crit),
        "open_major": sum(1 for i in still_open if i.severity == "major"),
        "excluded_segments": excluded,
        "items_by_status": {
            s: sum(1 for v in verification.items if v.status == s)
            for s in (
                "verified",
                "verified_rules_only",
                "partially_supported",
                "needs_review",
                "unsupported",
                "contradicted",
            )
        },
    }


def minutes_status(quality: dict, current: str, human_reviewed: bool, human_approved: bool = False) -> str:
    """ "approved" only while an approver's approval is recorded, the review stands and every gate
    passes; any change withdraws them (api.routes_meetings._withdraw)."""
    if (
        current == "approved"
        and human_approved
        and human_reviewed
        and quality["open_critical"] == 0
        and quality["all_passed"]
    ):
        return "approved"
    if quality["open_critical"] > 0 or not quality["all_passed"]:
        return "draft_requires_review"
    if human_reviewed:
        return "reviewed"
    return "draft"
