"""The DOCX and PDF are checked for right-to-left settings, embedded Arabic fonts and readable text."""

import io
import shutil

import pytest
from docx import Document
from docx.oxml.ns import qn
from helpers import analysis, item, seg, transcript

from mahdar.documents import html
from mahdar.documents.docx_builder import build_docx, check_docx
from mahdar.documents.pdf import check_pdf, render_pdf
from mahdar.pipeline.minutes import build_minutes
from mahdar.pipeline.verification import verify

pytestmark = pytest.mark.skipif(not shutil.which("fc-list"), reason="fontconfig is required")


def minutes_doc():
    t = transcript(
        seg("S0001", "SPK_1", "إذن تقرر اعتماد ربط نظام ERP مع Dynamics 365 بميزانية مليونين وأربعمائة ألف جنيه.", 0, 8)
    )
    an = analysis(
        item(
            "I001",
            "decision_approved",
            "تقرر اعتماد ربط نظام ERP مع Dynamics 365 بميزانية 2,400,000 جنيه.",
            [("S0001", "تقرر اعتماد ربط نظام ERP مع Dynamics 365")],
        )
    )
    rep, _ = verify(t, an, meta={}, glossary=[], llm=None)
    doc, _ = build_minutes(
        transcript=t,
        analysis=an,
        verification=rep,
        review={},
        meta={"title": "ربط الأنظمة"},
        classification="confidential",
        minutes_status="draft_requires_review",
        approval=None,
        glossary=[],
        llm=None,
    )
    return doc


def test_docx_is_right_to_left_everywhere():
    data = build_docx(minutes_doc(), org_name="جهة اختبار")
    assert check_docx(data)["ok"], check_docx(data)
    d = Document(io.BytesIO(data))
    runs = [r for p in d.paragraphs for r in p.runs]
    latin = [r for r in runs if "Dynamics" in r.text]
    assert latin and latin[0]._r.rPr.find(qn("w:rtl")) is None  # English term kept left-to-right
    assert any("مسودة تتطلب المراجعة" in p.text for p in d.paragraphs)


def test_docx_check_detects_missing_rtl():
    data = build_docx(minutes_doc())
    d = Document(io.BytesIO(data))
    p = d.add_paragraph("فقرة عربية بلا اتجاه")
    assert p._p.pPr is None or p._p.pPr.find(qn("w:bidi")) is None
    buf = io.BytesIO()
    d.save(buf)
    assert not check_docx(buf.getvalue())["ok"]


def test_pdf_embeds_arabic_fonts_and_keeps_the_words(tmp_path):
    doc = minutes_doc()
    pdf = render_pdf(html.minutes_html(doc, org_name="جهة اختبار", logo_data_uri=None))
    texts = [b.text for s in doc.sections for b in s.blocks] + [
        v for s in doc.sections for r in s.rows for v in r.cells.values()
    ]
    result = check_pdf(pdf, texts, render_dir=tmp_path)
    assert result["ok"], result["problems"]
    assert all(f["embedded"] for f in result["fonts"])
    assert result["pages"] >= 1 and result["page_images"]


def test_markup_in_a_transcript_is_escaped():
    doc = minutes_doc()
    doc.sections[0].rows[0].cells["القيمة"] = "<script>alert(1)</script>"
    out = html.minutes_html(doc, org_name=None, logo_data_uri=None)
    assert "<script>" not in out and "&lt;script&gt;" in out
