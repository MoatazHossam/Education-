"""The minutes as a right-to-left Word document (python-docx plus the OOXML it does not expose).

Right-to-left in Word is several separate settings, all applied here:
* section ``w:bidi`` (page direction), paragraph ``w:bidi`` (direction and alignment start),
* run ``w:rtl`` with a complex-script font (``w:cs``) and size (``w:szCs``) for Arabic text, and
  separate left-to-right runs for English terms, so "ERP" and "Dynamics 365" are not reordered,
* table ``w:bidiVisual`` so the first column is on the right, header rows repeated on each page,
* ``w:lang w:bidi="ar-EG"`` for Arabic spelling and hyphenation.
Alignment is left at the paragraph start (right) or ``both`` (justified): in bidirectional
paragraphs Word reads "left"/"right" as start/end, so they are never set explicitly.
``check_docx`` reopens the file and verifies every one of these.
"""

from __future__ import annotations

import io
import re

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt, RGBColor

from mahdar.pipeline.schemas import MinutesDocument

FONT = "Noto Naskh Arabic"
FONT_HEAD = "Noto Kufi Arabic"
LATIN = re.compile(r"[A-Za-z][A-Za-z0-9+#&./\-]*(?:\s+[A-Za-z0-9][A-Za-z0-9+#&./\-]*)*")
NAVY = RGBColor(0x0F, 0x2A, 0x4A)
RED = RGBColor(0x8A, 0x1C, 0x1C)


def _el(tag: str, **attrs: str) -> OxmlElement:
    e = OxmlElement(tag)
    for k, v in attrs.items():
        e.set(qn(k), v)
    return e


def _set_bidi_paragraph(p) -> None:
    ppr = p._p.get_or_add_pPr()
    if ppr.find(qn("w:bidi")) is None:
        ppr.insert(0, _el("w:bidi"))


def _style_run(
    run, *, rtl: bool, size: float, bold: bool = False, font: str = FONT, color: RGBColor | None = None
) -> None:
    rpr = run._r.get_or_add_rPr()
    fonts = rpr.find(qn("w:rFonts"))
    if fonts is None:
        fonts = _el("w:rFonts")
        rpr.insert(0, fonts)
    latin_font = font if rtl else "Noto Sans"
    for attr, value in (("w:ascii", latin_font), ("w:hAnsi", latin_font), ("w:eastAsia", latin_font), ("w:cs", font)):
        fonts.set(qn(attr), value)
    if bold:
        rpr.append(_el("w:b"))
        rpr.append(_el("w:bCs"))
    if color is not None:
        run.font.color.rgb = color
    run.font.size = Pt(size)
    rpr.append(_el("w:szCs", **{"w:val": str(int(size * 2))}))
    if rtl:
        rpr.append(_el("w:rtl"))
    rpr.append(_el("w:lang", **{"w:val": "en-US", "w:bidi": "ar-EG"}))


def add_text(
    p, text: str, *, size: float = 11.5, bold: bool = False, font: str = FONT, color: RGBColor | None = None
) -> None:
    """Arabic in right-to-left runs, English terms in left-to-right runs."""
    pos = 0
    for m in LATIN.finditer(text):
        if m.start() > pos:
            _style_run(p.add_run(text[pos : m.start()]), rtl=True, size=size, bold=bold, font=font, color=color)
        _style_run(p.add_run(m.group(0)), rtl=False, size=size, bold=bold, font=font, color=color)
        pos = m.end()
    if pos < len(text):
        _style_run(p.add_run(text[pos:]), rtl=True, size=size, bold=bold, font=font, color=color)


def para(
    container,
    text: str = "",
    *,
    size: float = 11.5,
    bold: bool = False,
    justify: bool = False,
    center: bool = False,
    font: str = FONT,
    color: RGBColor | None = None,
    style: str | None = None,
    space_after: float = 4,
):
    p = container.add_paragraph(style=style) if style else container.add_paragraph()
    _set_bidi_paragraph(p)
    if center:
        p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    elif justify:
        p.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.25
    if text:
        add_text(p, text, size=size, bold=bold, font=font, color=color)
    return p


def _field(p, code: str, size: float) -> None:
    run = p.add_run()
    _style_run(run, rtl=True, size=size)
    begin = _el("w:fldChar", **{"w:fldCharType": "begin"})
    instr = OxmlElement("w:instrText")
    instr.set(qn("xml:space"), "preserve")
    instr.text = f" {code} "
    sep = _el("w:fldChar", **{"w:fldCharType": "separate"})
    txt = OxmlElement("w:t")
    txt.text = "1"
    end = _el("w:fldChar", **{"w:fldCharType": "end"})
    for e in (begin, instr, sep, txt, end):
        run._r.append(e)


def _table(doc, columns: list[str], rows: list[list[str]], widths_cm: list[float], header: bool = True):
    t = doc.add_table(rows=1 if header else 0, cols=len(columns))
    t.alignment = WD_TABLE_ALIGNMENT.CENTER
    tblpr = t._tbl.tblPr
    tblpr.append(_el("w:bidiVisual"))
    tblpr.append(_el("w:tblW", **{"w:w": "5000", "w:type": "pct"}))
    borders = _el("w:tblBorders")
    for side in ("top", "left", "bottom", "right", "insideH", "insideV"):
        borders.append(_el(f"w:{side}", **{"w:val": "single", "w:sz": "6", "w:space": "0", "w:color": "8A99AD"}))
    tblpr.append(borders)
    margins = _el("w:tblCellMar")
    for side in ("top", "bottom"):
        margins.append(_el(f"w:{side}", **{"w:w": "60", "w:type": "dxa"}))
    for side in ("left", "right"):
        margins.append(_el(f"w:{side}", **{"w:w": "100", "w:type": "dxa"}))
    tblpr.append(margins)
    for i, c in enumerate(columns if header else []):
        hdr = t.rows[0]
        if i == 0:
            hdr._tr.get_or_add_trPr().append(_el("w:tblHeader"))
        cell = hdr.cells[i]
        cell.text = ""
        tcpr = cell._tc.get_or_add_tcPr()
        tcpr.append(_el("w:shd", **{"w:val": "clear", "w:color": "auto", "w:fill": "E8EEF6"}))
        p = cell.paragraphs[0]
        _set_bidi_paragraph(p)
        add_text(p, c, size=10, bold=True, font=FONT_HEAD)
    for r in rows:
        cells = t.add_row()
        cells._tr.get_or_add_trPr().append(_el("w:cantSplit"))
        for i, v in enumerate(r):
            cell = cells.cells[i]
            p = cell.paragraphs[0]
            _set_bidi_paragraph(p)
            if columns[i] == "رقم":
                p.alignment = WD_ALIGN_PARAGRAPH.CENTER
            if not header and i == 0:
                cell._tc.get_or_add_tcPr().append(
                    _el("w:shd", **{"w:val": "clear", "w:color": "auto", "w:fill": "F4F6F9"})
                )
            add_text(
                p,
                v,
                size=10 if columns[i] not in ("المرجع", "الحالة") else 8.5,
                bold=not header and i == 0,
                font=FONT_HEAD if not header and i == 0 else FONT,
            )
    # Fixed layout with explicit grid widths: Word and LibreOffice otherwise size columns by content.
    t.autofit = False
    tblpr.append(_el("w:tblLayout", **{"w:type": "fixed"}))
    for gc, w in zip(t._tbl.tblGrid.gridCol_lst, widths_cm, strict=False):
        gc.w = Cm(w)
    for row in t.rows:
        for i, w in enumerate(widths_cm):
            row.cells[i].width = Cm(w)
    return t


WIDTHS = {
    ("رقم", "القرار", "المسؤول", "تاريخ التنفيذ", "المرجع"): [1.0, 7.4, 3.0, 2.8, 2.8],
    ("رقم", "الإجراء المطلوب", "المسؤول", "الموعد المحدد", "الحالة"): [1.0, 7.0, 3.0, 2.8, 3.2],
    ("الصفة", "الاسم", "التوقيع", "التاريخ"): [2.6, 5.4, 5.0, 4.0],
    ("البيان", "القيمة"): [4.2, 12.8],
}


def build_docx(
    doc: MinutesDocument, *, org_name: str | None = None, logo: bytes | None = None, footer_note: str | None = None
) -> bytes:
    d = Document()
    sec = d.sections[0]
    sec.orientation = WD_ORIENT.PORTRAIT
    sec.page_width, sec.page_height = Cm(21.0), Cm(29.7)
    sec.top_margin, sec.bottom_margin = Cm(2.4), Cm(2.2)
    sec.left_margin = sec.right_margin = Cm(2.0)
    sec._sectPr.append(_el("w:bidi"))
    # Document defaults: Arabic font and language for every style.
    styles = d.styles.element
    rpr_default = styles.find(qn("w:docDefaults")).find(qn("w:rPrDefault")).find(qn("w:rPr"))
    fonts = rpr_default.find(qn("w:rFonts"))
    if fonts is None:
        fonts = _el("w:rFonts")
        rpr_default.insert(0, fonts)
    for a in ("w:ascii", "w:hAnsi", "w:cs", "w:eastAsia"):
        fonts.set(qn(a), FONT)
    for a in ("w:asciiTheme", "w:hAnsiTheme", "w:cstheme", "w:eastAsiaTheme"):
        if fonts.get(qn(a)) is not None:
            del fonts.attrib[qn(a)]
    lang = rpr_default.find(qn("w:lang"))
    if lang is None:
        lang = _el("w:lang")
        rpr_default.append(lang)
    lang.set(qn("w:bidi"), "ar-EG")
    settings = d.settings.element
    settings.append(_el("w:themeFontLang", **{"w:val": "en-US", "w:bidi": "ar-EG"}))

    # Header: organization (start side) and classification (end side); footer: page x of y.
    hp = sec.header.paragraphs[0]
    _set_bidi_paragraph(hp)
    add_text(hp, org_name or "محضر اجتماع", size=8.5, font=FONT_HEAD, color=RGBColor(0x44, 0x44, 0x44))
    if doc.classification_label:
        add_text(hp, "    |    التصنيف: " + doc.classification_label, size=8.5, bold=True, font=FONT_HEAD, color=RED)
    fp = sec.footer.paragraphs[0]
    _set_bidi_paragraph(fp)
    fp.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_text(fp, "صفحة ", size=8.5)
    _field(fp, "PAGE", 8.5)
    add_text(fp, " من ", size=8.5)
    _field(fp, "NUMPAGES", 8.5)
    if footer_note or doc.status_label != "معتمد":
        para(
            sec.footer,
            footer_note or "مسودة أُعدَّت آلياً وتخضع للمراجعة البشرية",
            size=7.5,
            center=True,
            color=RGBColor(0x66, 0x66, 0x66),
            space_after=0,
        )

    if logo:
        lp = para(d, center=True)
        lp.add_run().add_picture(io.BytesIO(logo), height=Cm(1.8))
    if org_name:
        para(d, org_name, size=12, center=True, font=FONT_HEAD, space_after=2)
    para(d, doc.title, size=20, bold=True, center=True, font=FONT_HEAD, color=NAVY, space_after=2)
    ok = doc.status_label in ("معتمد", "تمت مراجعته")
    para(
        d,
        f"حالة المحضر: {doc.status_label}",
        size=11,
        bold=True,
        center=True,
        font=FONT_HEAD,
        color=RGBColor(0x1C, 0x5E, 0x2E) if ok else RED,
        space_after=10,
    )

    for s in doc.sections:
        h = para(d, s.title, size=14, bold=True, font=FONT_HEAD, color=NAVY, space_after=4)
        h.paragraph_format.space_before = Pt(10)
        h.paragraph_format.keep_with_next = True
        ppr = h._p.get_or_add_pPr()
        bdr = _el("w:pBdr")
        bdr.append(_el("w:bottom", **{"w:val": "single", "w:sz": "8", "w:space": "1", "w:color": "0F2A4A"}))
        ppr.append(bdr)
        if s.rows:
            cols = s.table_columns
            widths = WIDTHS.get(tuple(cols), [17.0 / len(cols)] * len(cols))
            _table(d, cols, [[r.cells.get(c, "") for c in cols] for r in s.rows], widths, header=s.key != "info")
            para(d, "", space_after=2)
        for b in s.blocks:
            if b.text.startswith("## "):
                sub = para(
                    d, b.text[3:], size=12, bold=True, font=FONT_HEAD, color=RGBColor(0x1D, 0x3D, 0x63), space_after=2
                )
                sub.paragraph_format.keep_with_next = True
            elif b.kind == "bullet":
                para(d, b.text, justify=True, style="List Bullet")
            else:
                para(d, b.text, justify=True)
    para(
        d,
        "أُعدَّت مسودة هذا المحضر آلياً من التسجيل الصوتي، وتخضع للمراجعة البشرية قبل اعتمادها. "
        "يُرفق تقرير الأدلة وعدم اليقين بشكل منفصل.",
        size=8.5,
        color=RGBColor(0x55, 0x55, 0x55),
    )
    buf = io.BytesIO()
    d.save(buf)
    return buf.getvalue()


def check_docx(data: bytes) -> dict:
    """Reopens the document and checks the right-to-left settings on every part."""
    d = Document(io.BytesIO(data))
    problems = []
    if d.sections[0]._sectPr.find(qn("w:bidi")) is None:
        problems.append("section is not right-to-left")
    paras = list(d.paragraphs)
    for t in d.tables:
        if t._tbl.tblPr.find(qn("w:bidiVisual")) is None:
            problems.append("a table is not right-to-left (bidiVisual)")
        for row in t.rows:
            for c in row.cells:
                paras += c.paragraphs
    arabic_re = re.compile(r"[؀-ۿ]")
    for p in paras:
        if not p.text.strip():
            continue
        ppr = p._p.pPr
        if ppr is None or ppr.find(qn("w:bidi")) is None:
            problems.append(f"paragraph without bidi: {p.text[:40]}")
        for r in p.runs:
            if arabic_re.search(r.text or ""):
                rpr = r._r.rPr
                if rpr is None or rpr.find(qn("w:rtl")) is None:
                    problems.append(f"Arabic run without rtl: {r.text[:30]}")
                fonts = rpr.find(qn("w:rFonts")) if rpr is not None else None
                if fonts is None or not fonts.get(qn("w:cs")):
                    problems.append(f"Arabic run without a complex-script font: {r.text[:30]}")
    return {
        "ok": not problems,
        "problems": sorted(set(problems))[:20],
        "paragraphs": len(paras),
        "tables": len(d.tables),
    }
