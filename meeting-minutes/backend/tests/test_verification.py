"""The anti-fabrication rules: each test is one way minutes can go wrong."""

from conftest import FakeLlm
from helpers import analysis, item, seg, transcript

from mahdar.pipeline.verification import verify

T = transcript(
    seg("S0001", "SPK_1", "إحنا شايفين إن النظام ده ممكن يوفر وقت، بس محتاجين نراجع التكلفة الأول.", 0, 6),
    seg("S0002", "SPK_2", "إذن تقرر اعتماد ميزانية المرحلة الأولى بمبلغ مليونين وأربعمائة ألف جنيه.", 6, 12),
    seg("S0003", "SPK_1", "سأتولى إعداد خطة اختبار الأداء وتسليمها يوم الأحد القادم.", 12, 18),
    seg("S0004", "SPK_3", "ممكن أنا أكلمهم، بس مش هقدر قبل الأسبوع الجاي.", 18, 22),
    seg("S0005", "SPK_2", "وأطلب من الأستاذ خالد إرسال التقرير قبل العشرين من ديسمبر.", 22, 28),
    seg("S0006", "SPK_1", "مبدئياً خلينا نقول آخر الشهر، ونأكد بعدين.", 28, 32),
    seg("S0007", "SPK_2", "اشتركوا في القناة", 32, 34, flags=["possible_hallucination"], excluded=True),
    seg("S0008", "SPK_3", "تمام يبقى اتفقنا نعتمد العرض التاني.", 34, 38),
)
META = {"date": "2026-12-01"}


def run(*items, llm=None):
    rep, _ = verify(T, analysis(*items), meta=META, glossary=[{"term": "خالد", "category": "person"}], llm=llm)
    return {v.item_id: v for v in rep.items}, rep


def failed(v):
    return {c.name for c in v.checks if not c.passed}


def test_genuine_decision_is_verified_by_rules():
    res, _ = run(
        item(
            "I1",
            "decision_approved",
            "تقرر اعتماد ميزانية المرحلة الأولى بمبلغ 2,400,000 جنيه.",
            [("S0002", "تقرر اعتماد ميزانية المرحلة الأولى")],
            speakers=["SPK_2"],
        )
    )
    assert res["I1"].status == "verified_rules_only"
    assert res["I1"].final_type == "decision_approved"


def test_opinion_presented_as_decision_is_downgraded():
    # The example from the brief: an opinion with a condition is not an approval.
    res, _ = run(
        item(
            "I1",
            "decision_approved",
            "تقرر اعتماد النظام الجديد وتنفيذه.",
            [("S0001", "النظام ده ممكن يوفر وقت")],
            speakers=["SPK_1"],
        )
    )
    v = res["I1"]
    assert v.final_type in ("proposal", "agreement_tentative")
    assert "approval_words" in failed(v)
    assert v.status != "verified" and any(i.severity == "critical" for i in v.issues)


def test_tentative_approval_is_not_a_final_decision():
    res, _ = run(
        item(
            "I1", "decision_approved", "اتُّفق على أن يكون الموعد آخر الشهر.", [("S0006", "مبدئياً خلينا نقول آخر الشهر")]
        )
    )
    assert res["I1"].final_type in ("agreement_tentative", "proposal")


def test_invented_number_is_critical():
    res, _ = run(
        item(
            "I1",
            "decision_approved",
            "تقرر اعتماد ميزانية بمبلغ 3,000,000 جنيه.",
            [("S0002", "تقرر اعتماد ميزانية المرحلة الأولى")],
        )
    )
    v = res["I1"]
    assert "numbers" in failed(v) and v.status == "needs_review"


def test_relative_deadline_turned_into_a_date_is_critical():
    res, _ = run(
        item(
            "I1",
            "action_assigned",
            "يتولى المتحدث إعداد خطة اختبار الأداء.",
            [("S0003", "سأتولى إعداد خطة اختبار الأداء")],
            due="يوم الأحد القادم",
            due_iso="2026-12-06",
            due_status="relative",
        )
    )
    assert "due_date" in failed(res["I1"])
    assert res["I1"].status == "needs_review"


def test_explicit_date_matches():
    res, _ = run(
        item(
            "I1",
            "action_assigned",
            "يُرسل الأستاذ خالد التقرير قبل 20 ديسمبر.",
            [("S0005", "وأطلب من الأستاذ خالد إرسال التقرير")],
            owner="الأستاذ خالد",
            due="قبل العشرين من ديسمبر",
            due_iso="2026-12-20",
            due_status="explicit",
        )
    )
    assert res["I1"].status == "verified_rules_only", failed(res["I1"])


def test_owner_not_in_evidence_is_critical():
    res, _ = run(
        item(
            "I1",
            "action_assigned",
            "تتولى سارة إعداد خطة اختبار الأداء.",
            [("S0003", "سأتولى إعداد خطة اختبار الأداء")],
            owner="سارة",
        )
    )
    assert "owner" in failed(res["I1"])


def test_name_not_spoken_is_critical():
    res, _ = run(item("I1", "proposal", "اقترح خالد مراجعة التكلفة.", [("S0001", "محتاجين نراجع التكلفة الأول")]))
    assert "names" in failed(res["I1"])


def test_hedged_volunteer_is_a_suggested_action():
    res, _ = run(
        item(
            "I1",
            "action_assigned",
            "يتولى المتحدث التواصل مع الشركة.",
            [("S0004", "ممكن أنا أكلمهم")],
            due="الأسبوع الجاي",
            due_status="relative",
        )
    )
    assert res["I1"].final_type == "action_suggested"


def test_quote_that_does_not_exist_makes_the_item_unsupported():
    res, _ = run(
        item("I1", "decision_approved", "تقرر تأجيل المشروع.", [("S0002", "تقرر تأجيل المشروع إلى العام القادم")])
    )
    assert res["I1"].status == "unsupported"


def test_evidence_from_a_screened_out_segment_fails():
    res, _ = run(item("I1", "discussion", "طُلب الاشتراك في القناة.", [("S0007", "اشتركوا في القناة")]))
    assert "segment_usable" in failed(res["I1"])


def test_missing_segment_and_no_evidence():
    res, _ = run(
        item("I1", "decision_approved", "تقرر شيء.", [("S9999", "تقرر شيء")]), item("I2", "proposal", "اقتراح.", [])
    )
    assert res["I1"].status == "unsupported" and res["I2"].status == "unsupported"


def test_negation_mismatch_is_flagged():
    res, _ = run(item("I1", "proposal", "لم يُقترح مراجعة التكلفة.", [("S0001", "محتاجين نراجع التكلفة الأول")]))
    assert "negation" in failed(res["I1"])


def test_uncited_approval_is_reported_as_possible_omission():
    _, rep = run(item("I1", "proposal", "يرى المتحدث أن النظام قد يوفر الوقت.", [("S0001", "النظام ده ممكن يوفر وقت")]))
    assert any(i.code == "potential_omission" and "S0008" in i.segment_ids for i in rep.document_issues)


def _judgment(cid, verdict="supported", ok=True, suggested=None):
    return {
        "claim_id": cid,
        "verdict": verdict,
        "classification_correct": ok,
        "suggested_type": suggested,
        "speaker_correct": True,
        "owner_supported": None,
        "due_supported": None,
        "missing_qualifications": [],
        "rationale_ar": "سبب",
    }


def test_independent_audit_can_only_weaken():
    llm = FakeLlm(
        {
            "verification": [
                {
                    "judgments": [
                        _judgment("I1", ok=False, suggested="proposal"),
                        _judgment("I2", ok=False, suggested="decision_approved"),
                    ],
                    "omissions": [],
                }
            ]
        }
    )
    res, rep = run(
        item(
            "I1",
            "decision_approved",
            "تقرر اعتماد ميزانية المرحلة الأولى بمبلغ 2,400,000 جنيه.",
            [("S0002", "تقرر اعتماد ميزانية المرحلة الأولى")],
        ),
        item("I2", "proposal", "يرى المتحدث أن النظام قد يوفر الوقت.", [("S0001", "النظام ده ممكن يوفر وقت")]),
        llm=llm,
    )
    assert res["I1"].final_type == "proposal"  # weaker: applied
    assert res["I2"].final_type == "proposal"  # stronger: never applied automatically
    assert "classification_other" in failed(res["I2"])
    assert rep.llm_used


def test_audit_contradiction_and_verified():
    llm = FakeLlm(
        {
            "verification": [
                {
                    "judgments": [_judgment("I1"), _judgment("I2", verdict="contradicted")],
                    "omissions": [
                        {
                            "segment_id": "S0008",
                            "quote": "يبقى اتفقنا نعتمد العرض التاني",
                            "suggested_type": "decision_approved",
                            "why_ar": "قرار",
                        }
                    ],
                }
            ]
        }
    )
    res, rep = run(
        item(
            "I1",
            "decision_approved",
            "تقرر اعتماد ميزانية المرحلة الأولى بمبلغ 2,400,000 جنيه.",
            [("S0002", "تقرر اعتماد ميزانية المرحلة الأولى")],
        ),
        item("I2", "agreement_tentative", "اتُّفق مبدئياً على آخر الشهر.", [("S0006", "مبدئياً خلينا نقول آخر الشهر")]),
        llm=llm,
    )
    assert res["I1"].status == "verified"
    assert res["I2"].status == "contradicted"
    assert any(i.code == "auditor_omission" and i.severity == "critical" for i in rep.document_issues)


def test_statement_sharing_no_word_with_its_evidence_fails():
    # Observed with a small model: a prompt example copied as an item, citing an unrelated quote.
    res, _ = run(
        item("I1", "action_suggested", "ممكن أنا أكلمهم عن خدمة الدفع الإلكتروني.", [("S0006", "خلينا نقول آخر الشهر")])
    )
    assert "statement_grounding" in failed(res["I1"]) and res["I1"].status != "verified_rules_only"
    # A faithful MSA paraphrase of colloquial speech shares few words, and still passes.
    res, _ = run(
        item(
            "I2",
            "action_suggested",
            "ممكن أن يتولى أحد الحاضرين الاتصال بالشركة، لكن ليس قبل الأسبوع القادم.",
            [("S0004", "ممكن أنا أكلمهم")],
        )
    )
    assert "statement_grounding" not in failed(res["I2"])


def test_deferral_recorded_as_rejection_becomes_deferred():
    t = transcript(seg("S0001", "SPK_1", "نؤجل موضوع الدفع الإلكتروني إلى الاجتماع القادم.", 0, 5))
    rep, _ = verify(
        t,
        analysis(
            item(
                "I1",
                "decision_rejected",
                "رُفض مقترح الدفع الإلكتروني.",
                [("S0001", "نؤجل موضوع الدفع الإلكتروني")],
                approval=[("S0001", "نؤجل موضوع الدفع الإلكتروني")],
            )
        ),
        meta=META,
        glossary=[],
        llm=FakeLlm({"verification": [{"judgments": [_judgment("I1")], "omissions": []}]}),
    )
    v = rep.items[0]
    # The auditor agreeing does not lower this one: a deferral is not a rejection.
    assert v.final_type == "deferred" and "rejection_is_deferral" in failed(v)
    assert v.status == "partially_supported"


def test_audit_unsupported_keeps_the_item_out_even_when_rules_pass():
    llm = FakeLlm({"verification": [{"judgments": [_judgment("I1", verdict="unsupported")], "omissions": []}]})
    res, _ = run(
        item("I1", "proposal", "يرى المتحدث أن النظام قد يوفر الوقت.", [("S0001", "النظام ده ممكن يوفر وقت")]),
        llm=llm,
    )
    assert res["I1"].status == "unsupported"


def test_speaker_label_given_as_owner_name_becomes_the_speaker():
    from mahdar.pipeline.analysis import _to_items

    raw = {
        "type": "action_assigned",
        "statement": "سأتولى إعداد الخطة.",
        "owner_status": "explicit",
        "evidence": [{"segment_id": "S0003", "quote": "سأتولى إعداد خطة"}],
    }
    for name in ("المتحدث 2", "المتحدث الثاني", "SPK_2"):
        (it,) = _to_items([{**raw, "owner_name_as_spoken": name}], {"SPK_1", "SPK_2"})
        assert it.owner.name_as_spoken is None and it.owner.speaker_id == "SPK_2"
    (it,) = _to_items([{**raw, "owner_name_as_spoken": "خالد"}], {"SPK_1", "SPK_2"})
    assert it.owner.name_as_spoken == "خالد"
