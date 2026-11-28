"""The writer and the language reviewer may only reword: these tests feed them replies that try to
add facts and check that the facts do not reach the minutes."""

from conftest import FakeLlm
from helpers import analysis, item, seg, transcript

from mahdar.pipeline import quality
from mahdar.pipeline.minutes import build_minutes, check_block, effective_items, review_language
from mahdar.pipeline.readable import apply_glossary, safe_edit
from mahdar.pipeline.verification import verify

T = transcript(
    seg("S0001", "SPK_1", "إحنا شايفين إن النظام ده ممكن يوفر وقت، بس محتاجين نراجع التكلفة الأول.", 0, 6),
    seg("S0002", "SPK_2", "إذن تقرر اعتماد ميزانية المرحلة الأولى بمبلغ مليونين وأربعمائة ألف جنيه.", 6, 12),
    seg("S0003", "SPK_1", "سأتولى إعداد خطة اختبار الأداء وتسليمها يوم الأحد القادم.", 12, 18),
)
ITEMS = [
    item(
        "I001",
        "proposal",
        "يرى المتحدث أن النظام المقترح قد يوفر الوقت، مع ضرورة مراجعة التكلفة أولاً.",
        [("S0001", "النظام ده ممكن يوفر وقت")],
        qualifications=["مراجعة التكلفة أولاً"],
    ),
    item(
        "I002",
        "decision_approved",
        "تقرر اعتماد ميزانية المرحلة الأولى بمبلغ 2,400,000 جنيه.",
        [("S0002", "تقرر اعتماد ميزانية المرحلة الأولى")],
    ),
    item(
        "I003",
        "action_assigned",
        "يتولى المتحدث إعداد خطة اختبار الأداء وتسليمها.",
        [("S0003", "سأتولى إعداد خطة اختبار الأداء")],
        due="يوم الأحد القادم",
        due_status="relative",
    ),
]


def _build(writer_reply=None, review=None):
    an = analysis(*ITEMS)
    rep, _ = verify(T, an, meta={}, glossary=[], llm=None)
    llm = FakeLlm({"writing": [writer_reply]}) if writer_reply else None
    doc, _ = build_minutes(
        transcript=T,
        analysis=an,
        verification=rep,
        review=review or {},
        meta={"title": "اختبار"},
        classification="internal",
        minutes_status="draft_requires_review",
        approval=None,
        glossary=[],
        llm=llm,
    )
    return doc, rep, an


def section(doc, key):
    return next((s for s in doc.sections if s.key == key), None)


def _reply(**over):
    base = {
        "purpose": None,
        "topics": [],
        "decision_texts": [],
        "recommendations": [],
        "action_texts": [],
        "risks": [],
        "pending": [],
        "executive_summary": [],
    }
    return {**base, **over}


def test_decision_table_comes_from_verified_items_with_unset_cells():
    doc, _, _ = _build()
    rows = section(doc, "decisions").rows
    assert len(rows) == 1 and rows[0].cells["المسؤول"] == "لم يُحدد" and rows[0].cells["تاريخ التنفيذ"] == "لم يُحدد"
    assert "S0002" in rows[0].cells["المرجع"]
    actions = section(doc, "actions").rows
    assert actions[0].cells["الموعد المحدد"] == "يوم الأحد القادم" and actions[0].cells["الحالة"].startswith("مُكلَّف")


def test_proposal_is_never_written_as_a_decision():
    reply = _reply(recommendations=[{"text": "تقرر اعتماد النظام الجديد وتنفيذه.", "item_ids": ["I001"]}])
    doc, _, _ = _build(reply)
    text = " ".join(b.text for b in section(doc, "recommendations").blocks)
    assert "تقرر" not in text and text.startswith("مقترح:")
    assert any(i.code == "writer_block_replaced" for i in doc.issues)


def test_writer_cannot_add_a_number_or_a_name():
    reply = _reply(
        decision_texts=[
            {"text": "اعتماد ميزانية المرحلة الأولى بمبلغ 3,000,000 جنيه بحضور الأستاذ خالد.", "item_ids": ["I002"]}
        ]
    )
    doc, _, _ = _build(reply)
    cell = section(doc, "decisions").rows[0].cells["القرار"]
    assert "3,000,000" not in cell and "2,400,000" in cell


def test_faithful_wording_is_kept():
    good = "نوقشت إمكانية استخدام النظام المقترح لتقليل الوقت المستغرق، مع التأكيد على ضرورة مراجعة التكلفة قبل اتخاذ قرار بشأن التنفيذ."
    doc, _, _ = _build(_reply(recommendations=[{"text": good, "item_ids": ["I001"]}]))
    assert section(doc, "recommendations").blocks[0].text == good


def test_unverified_decision_goes_to_pending_not_the_table():
    an = analysis(item("I001", "decision_approved", "تقرر اعتماد النظام.", [("S0001", "النظام ده ممكن يوفر وقت")]))
    rep, _ = verify(T, an, meta={}, glossary=[], llm=None)
    doc, _ = build_minutes(
        transcript=T,
        analysis=an,
        verification=rep,
        review={},
        meta={},
        classification="internal",
        minutes_status="draft_requires_review",
        approval=None,
        glossary=[],
        llm=None,
    )
    decisions = section(doc, "decisions")
    assert decisions.rows == []  # nothing in the decisions table
    assert "لم تُتخذ في هذا الاجتماع قرارات معتمدة" in decisions.blocks[0].text
    assert section(doc, "recommendations") is not None or section(doc, "pending") is not None


def test_speaker_labels_never_reach_the_minutes_and_sections_are_numbered_in_order():
    an = analysis(
        item("I001", "proposal", "اقترح المتحدث 2 مراجعة التكلفة.", [("S0001", "محتاجين نراجع التكلفة الأول")])
    )
    rep, _ = verify(T, an, meta={}, glossary=[], llm=None)
    doc, _ = build_minutes(
        transcript=T,
        analysis=an,
        verification=rep,
        review={},
        meta={},
        classification="internal",
        minutes_status="draft_requires_review",
        approval=None,
        glossary=[],
        llm=None,
    )
    text = " ".join(b.text for s in doc.sections for b in s.blocks)
    assert "المتحدث 2" not in text and "أحد الحاضرين" in text
    ordinals = [s.title.split(":")[0] for s in doc.sections]
    assert ordinals[:3] == ["أولاً", "ثانياً", "ثالثاً"]


def test_status_requires_review_until_people_resolve():
    _, rep, an = _build()
    q = quality.evaluate(T, an, rep, {}, {})
    assert quality.minutes_status(q, "draft_requires_review", False) == "draft_requires_review"
    review = {
        "items": {v.item_id: {"decision": "accepted"} for v in rep.items},
        "issues": {quality.issue_key(i): {"resolution": "accepted"} for i in rep.document_issues},
    }
    q2 = quality.evaluate(T, an, rep, review, {"max_potential_omissions": 99})
    # The independent-audit gate still fails without a language model: never "reviewed" by itself.
    assert q2["open_critical"] == 0
    assert quality.minutes_status(q2, "draft_requires_review", True) in ("draft_requires_review", "reviewed")


def test_rejected_item_is_left_out_and_edit_applies():
    review = {"items": {"I001": {"decision": "rejected"}, "I003": {"decision": "accepted", "edits": {"owner": "سارة"}}}}
    _, rep, an = _build()
    eff = {e.item.id: e for e in effective_items(an, rep, review)}
    assert "I001" not in eff and eff["I003"].item.owner.name_as_spoken == "سارة" and eff["I003"].human_accepted


def test_language_review_refuses_fact_changes():
    doc, _, _ = _build()
    target = section(doc, "decisions").rows[0]
    llm = FakeLlm(
        {
            "language_review": [
                lambda req: {
                    "blocks": [
                        {"id": f"{target.id}:القرار", "text": target.cells["القرار"].replace("2,400,000", "2,500,000")}
                    ],
                    "changes": [],
                }
            ]
        }
    )
    out, _ = review_language(doc, llm, [])
    assert "2,400,000" in section(out, "decisions").rows[0].cells["القرار"]
    assert out.language_review["refused"]


def test_check_block_flags_speaker_labels():
    _doc, rep, an = _build()
    eff = effective_items(an, rep, {})
    assert "speaker_label" in check_block("قال SPK_1 إن النظام يوفر الوقت.", [eff[0]], {}, [])


def test_glossary_variants_and_readable_guard():
    text, applied = apply_glossary("الإي بي آي جاهز تقريبا", [{"term": "API", "variants": ["إي بي آي"]}])
    assert "API" in text and applied == ["API"]
    assert safe_edit("التكلفة خمسة وعشرين ألف", "التكلفة خمسة وعشرين ألف.")[0]
    assert not safe_edit("التكلفة خمسة وعشرين ألف", "التكلفة ثلاثين ألف")[0]
    assert not safe_edit("مش هنعتمد النظام", "هنعتمد النظام")[0]


def test_check_block_flags_ordinal_labels_and_markup():
    _doc, rep, an = _build()
    eff = effective_items(an, rep, {})
    assert "speaker_label" in check_block("أُطلب من المتحدث الثاني مراجعة التكلفة.", [eff[0]], {}, [])
    # Observed: JSON punctuation left by a small model at the end of a paragraph.
    assert "markup" in check_block("يرى أحد الحاضرين أن النظام قد يوفر الوقت (يتطلب التحقق)},{", [eff[0]], {}, [])
    from mahdar.pipeline.minutes import without_labels

    assert without_labels("اقترحت المتحدثة الثالثة التأجيل", {"SPK_3": "سارة"}) == "اقترحت سارة التأجيل"


def test_writer_markup_is_replaced_by_the_rule_text():
    reply = _reply(recommendations=[{"item_ids": ["I001"], "text": 'يرى أحد الحاضرين أن النظام قد يوفر الوقت"},{"id'}])
    doc, _, _ = _build(reply)
    text = " ".join(b.text for s in doc.sections for b in s.blocks)
    assert "},{" not in text and "{" not in text
    assert any(i.code == "writer_block_replaced" for i in doc.issues)


def test_contradicted_item_stays_out_of_the_minutes():
    an = analysis(*ITEMS)
    judgments = [
        {
            "claim_id": i.id,
            "verdict": "contradicted" if i.id == "I001" else "supported",
            "classification_correct": True,
            "suggested_type": None,
            "speaker_correct": True,
            "owner_supported": None,
            "due_supported": None,
            "missing_qualifications": [],
            "rationale_ar": "سبب",
        }
        for i in ITEMS
    ]
    rep, _ = verify(
        T, an, meta={}, glossary=[], llm=FakeLlm({"verification": [{"judgments": judgments, "omissions": []}]})
    )
    doc, _ = build_minutes(
        transcript=T,
        analysis=an,
        verification=rep,
        review={},
        meta={},
        classification="internal",
        minutes_status="draft_requires_review",
        approval=None,
        glossary=[],
        llm=None,
    )
    text = " ".join(
        [b.text for s in doc.sections for b in s.blocks]
        + [c for s in doc.sections for r in s.rows for c in r.cells.values()]
    )
    assert "يوفر الوقت" not in text
    # Accepted by a person, it comes back.
    doc2, _ = build_minutes(
        transcript=T,
        analysis=an,
        verification=rep,
        review={"items": {"I001": {"decision": "accepted"}}},
        meta={},
        classification="internal",
        minutes_status="draft_requires_review",
        approval=None,
        glossary=[],
        llm=None,
    )
    assert "يوفر الوقت" in " ".join(b.text for s in doc2.sections for b in s.blocks)
