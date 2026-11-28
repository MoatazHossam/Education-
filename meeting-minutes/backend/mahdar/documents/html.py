"""Right-to-left HTML for the PDF documents (WeasyPrint lays it out with Pango and HarfBuzz, which
shape Arabic and apply the Unicode bidirectional algorithm). Everything is escaped: no text from a
recording can become markup."""

from __future__ import annotations

from html import escape

from mahdar.pipeline.llm.prompts import fmt_time
from mahdar.pipeline.schemas import ITEM_TYPE_AR, Analysis, MinutesDocument, Transcript, VerificationReport

FONT_BODY = "Noto Naskh Arabic"
FONT_HEAD = "Noto Kufi Arabic"
# Arabic fonts carry few Latin glyphs: English terms and digits fall through to Noto Sans, never to
# an arbitrary system font (check_pdf rejects any other font).
BODY_STACK = "'Noto Naskh Arabic', 'Noto Sans', 'Amiri'"
HEAD_STACK = "'Noto Kufi Arabic', 'Noto Sans', 'Noto Naskh Arabic'"


def _css(header_left: str, header_right: str, footer_note: str) -> str:
    return f"""
@page {{
  size: A4; margin: 24mm 20mm 22mm 20mm;
  @top-right {{ content: "{escape(header_right)}"; font-family: {HEAD_STACK}; font-size: 8.5pt; color: #444; }}
  @top-left {{ content: "{escape(header_left)}"; font-family: {HEAD_STACK}; font-size: 8.5pt; color: #8a1c1c; font-weight: 700; }}
  @bottom-center {{ content: "صفحة " counter(page) " من " counter(pages); font-family: {BODY_STACK}; font-size: 8.5pt; color: #444; }}
  @bottom-right {{ content: "{escape(footer_note)}"; font-family: {BODY_STACK}; font-size: 7.5pt; color: #666; }}
}}
html {{ direction: rtl; }}
body {{ font-family: {BODY_STACK}, 'Amiri', 'Noto Sans', serif; font-size: 11pt; line-height: 1.75; color: #111; }}
h1 {{ font-family: {HEAD_STACK}; font-size: 19pt; text-align: center; margin: 0 0 2mm; color: #0f2a4a; }}
.org {{ text-align: center; font-family: {HEAD_STACK}; font-size: 11pt; color: #333; margin-bottom: 1mm; }}
.status {{ text-align: center; font-family: {HEAD_STACK}; font-size: 10.5pt; margin: 0 0 6mm; }}
.status span {{ border: 1px solid #8a1c1c; color: #8a1c1c; padding: 0.5mm 4mm; border-radius: 2mm; }}
.status span.ok {{ border-color: #1c5e2e; color: #1c5e2e; }}
h2 {{ font-family: {HEAD_STACK}; font-size: 13pt; color: #0f2a4a; border-bottom: 1.2px solid #0f2a4a; padding-bottom: 1mm;
      margin: 7mm 0 3mm; page-break-after: avoid; }}
h3 {{ font-family: {HEAD_STACK}; font-size: 11.5pt; color: #1d3d63; margin: 4mm 0 1.5mm; page-break-after: avoid; }}
p {{ margin: 0 0 2.2mm; text-align: justify; }}
ul {{ margin: 0 0 2mm; padding-right: 6mm; padding-left: 0; }}
li {{ margin-bottom: 1.4mm; text-align: justify; }}
table {{ width: 100%; border-collapse: collapse; margin: 1mm 0 3mm; page-break-inside: auto; direction: rtl; }}
tr {{ page-break-inside: avoid; }}
th {{ background: #e8eef6; font-family: {HEAD_STACK}; font-size: 9.5pt; font-weight: 700; text-align: right; }}
th, td {{ border: 0.8px solid #8a99ad; padding: 1.6mm 2.2mm; vertical-align: top; text-align: right; font-size: 10pt; }}
td.num {{ text-align: center; width: 8mm; }}
td.ref, td.small {{ font-size: 8.5pt; color: #333; }}
.info td:first-child {{ width: 38mm; background: #f4f6f9; font-family: {HEAD_STACK}; font-size: 9.5pt; }}
.note {{ font-size: 8.5pt; color: #555; }}
.flag {{ color: #8a1c1c; }}
.crit {{ color: #8a1c1c; font-weight: 700; }}
.major {{ color: #9a5b00; }}
.seg {{ margin-bottom: 1.8mm; page-break-inside: avoid; }}
.seg .meta {{ font-size: 8.5pt; color: #4a5a70; font-family: {HEAD_STACK}; }}
.ltr {{ direction: ltr; unicode-bidi: isolate; }}
.box {{ border: 0.8px solid #c3ccd8; background: #fafbfd; padding: 2mm 3mm; margin: 2mm 0; page-break-inside: avoid; }}
"""


def _doc(title: str, body: str, header_left: str, header_right: str, footer_note: str) -> str:
    return (
        f'<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>{escape(title)}</title>'
        f"<style>{_css(header_left, header_right, footer_note)}</style></head><body>{body}</body></html>"
    )


def _p(text: str) -> str:
    return f"<p>{escape(text)}</p>"


def minutes_html(doc: MinutesDocument, *, org_name: str | None, logo_data_uri: str | None) -> str:
    parts = []
    if logo_data_uri:
        parts.append(f'<div style="text-align:center"><img src="{logo_data_uri}" style="max-height:18mm"></div>')
    if org_name:
        parts.append(f'<div class="org">{escape(org_name)}</div>')
    parts.append(f"<h1>{escape(doc.title)}</h1>")
    ok = doc.status_label in ("معتمد", "تمت مراجعته")
    parts.append(
        f'<div class="status"><span class="{"ok" if ok else ""}">حالة المحضر: {escape(doc.status_label)}</span></div>'
    )
    for s in doc.sections:
        parts.append(f"<h2>{escape(s.title)}</h2>")
        if s.key == "info":
            parts.append(
                '<table class="info">'
                + "".join(
                    f"<tr><td>{escape(r.cells['البيان'])}</td><td>{escape(r.cells['القيمة'])}</td></tr>" for r in s.rows
                )
                + "</table>"
            )
            continue
        if s.rows:
            parts.append(
                "<table><thead><tr>"
                + "".join(f"<th>{escape(c)}</th>" for c in s.table_columns)
                + "</tr></thead><tbody>"
            )
            for r in s.rows:
                cells = []
                for c in s.table_columns:
                    cls = (
                        "num"
                        if c == "رقم"
                        else "ref"
                        if c in ("المرجع",)
                        else "small"
                        if c in ("الحالة", "التوقيع", "التاريخ")
                        else ""
                    )
                    cells.append(f'<td class="{cls}">{escape(r.cells.get(c, ""))}</td>')
                parts.append("<tr>" + "".join(cells) + "</tr>")
            parts.append("</tbody></table>")
        bullets: list[str] = []
        for b in s.blocks:
            if b.text.startswith("## "):
                if bullets:
                    parts.append("<ul>" + "".join(bullets) + "</ul>")
                    bullets = []
                parts.append(f"<h3>{escape(b.text[3:])}</h3>")
            elif b.kind == "bullet":
                bullets.append(f"<li>{escape(b.text)}</li>")
            else:
                if bullets:
                    parts.append("<ul>" + "".join(bullets) + "</ul>")
                    bullets = []
                parts.append(_p(b.text))
        if bullets:
            parts.append("<ul>" + "".join(bullets) + "</ul>")
    parts.append(
        '<p class="note">أُعدَّت مسودة هذا المحضر آلياً من التسجيل الصوتي، وتخضع للمراجعة البشرية قبل اعتمادها. '
        "يُرفق تقرير الأدلة وعدم اليقين بشكل منفصل.</p>"
    )
    return _doc(
        doc.title,
        "".join(parts),
        doc.classification_label,
        org_name or "محضر اجتماع",
        "مسودة تتطلب المراجعة" if not ok else doc.status_label,
    )


SEV_AR = {"critical": "حرج", "major": "مهم", "minor": "ثانوي", "info": "معلومة"}
STATUS_AR = {
    "verified": "تم التحقق",
    "verified_rules_only": "تم التحقق آلياً بالقواعد فقط",
    "partially_supported": "مدعوم جزئياً",
    "needs_review": "يتطلب المراجعة",
    "unsupported": "غير مدعوم",
    "contradicted": "متعارض مع التسجيل",
}


def evidence_html(
    *,
    title: str,
    transcript: Transcript,
    analysis: Analysis,
    verification: VerificationReport,
    quality: dict,
    classification_label: str,
) -> str:
    segs = {s.id: s for s in transcript.segments}
    names = {s.id: s.display_name or s.label for s in transcript.speakers}
    parts = [f"<h1>تقرير الأدلة وعدم اليقين</h1><div class='org'>{escape(title)}</div>"]
    parts.append("<h2>ملخص جودة المعالجة</h2><table><tbody>")
    for g in quality.get("gates", []):
        parts.append(
            f"<tr><td>{escape(g['label_ar'])}</td><td class='ltr'>{escape(str(g['value']))}</td>"
            f"<td>{'مستوفى' if g['passed'] else '<span class=crit>غير مستوفى</span>'}</td></tr>"
        )
    parts.append("</tbody></table>")
    parts.append(
        f"<p class='note'>المراجعة المستقلة بنموذج لغوي: {'نعم — ' + escape(verification.llm_model or '') if verification.llm_used else 'لا (فحوص القواعد فقط)'}.</p>"
    )
    by_id = {v.item_id: v for v in verification.items}
    parts.append("<h2>البنود المستخرجة والأدلة</h2>")
    for it in analysis.items:
        v = by_id.get(it.id)
        st = STATUS_AR.get(v.status, v.status) if v else "—"
        cls = (
            "crit"
            if v and v.status in ("unsupported", "contradicted", "needs_review")
            else "major"
            if v and v.status == "partially_supported"
            else ""
        )
        typ = ITEM_TYPE_AR.get(v.final_type if v else it.type, it.type)
        changed = f" (كان: {ITEM_TYPE_AR.get(it.type, it.type)})" if v and v.final_type != it.type else ""
        parts.append(
            f"<div class='box'><h3>{escape(it.id)} — {escape(typ)}{escape(changed)} — <span class='{cls}'>{escape(st)}</span></h3>"
        )
        parts.append(_p(it.statement))
        if it.owner.name_as_spoken or it.due.text_as_spoken:
            parts.append(
                f"<p class='note'>المسؤول: {escape(it.owner.name_as_spoken or 'لم يُحدد')} — الموعد: {escape(it.due.text_as_spoken or 'لم يُحدد')}</p>"
            )
        for e in v.evidence if v else []:
            mark = "✓" if e.quote_found else "✗"
            parts.append(
                f"<p class='note'>{mark} {escape(e.segment_id)} | {escape(names.get(e.speaker_id or '', 'غير محدد'))} | "
                f"{fmt_time(e.start)}–{fmt_time(e.end)}: «{escape(e.original_text)}»</p>"
            )
        for c in v.checks if v else []:
            if not c.passed:
                parts.append(
                    f"<p class='note {('crit' if c.severity == 'critical' else 'major' if c.severity == 'major' else '')}'>"
                    f"[{SEV_AR[c.severity]}] {escape(c.detail_ar)}</p>"
                )
        if v and v.llm:
            parts.append(f"<p class='note'>المراجعة المستقلة: {escape(v.llm.rationale_ar)}</p>")
        parts.append("</div>")
    if verification.document_issues:
        parts.append("<h2>ملاحظات على مستوى المحضر</h2><ul>")
        for i in verification.document_issues:
            where = f" ({fmt_time(i.start)})" if i.start is not None else ""
            parts.append(
                f"<li><span class='{('crit' if i.severity == 'critical' else 'major' if i.severity == 'major' else '')}'>[{SEV_AR[i.severity]}]</span> "
                f"{escape(i.message_ar)}{escape(where)}</li>"
            )
        parts.append("</ul>")
    flagged = [s for s in transcript.segments if s.flags]
    if flagged:
        parts.append(
            "<h2>مقاطع تتطلب الانتباه</h2><table><thead><tr><th>المقطع</th><th>الوقت</th><th>التنبيه</th><th>النص</th></tr></thead><tbody>"
        )
        for s in flagged:
            parts.append(
                f"<tr><td class='small'>{s.id}</td><td class='small'>{fmt_time(s.start)}</td><td class='small'>{escape('، '.join(s.flags))}</td>"
                f"<td>{escape(s.text_verbatim)}</td></tr>"
            )
        parts.append("</tbody></table>")
    _ = segs
    return _doc(
        "تقرير الأدلة",
        "".join(parts),
        classification_label,
        "تقرير الأدلة وعدم اليقين",
        "للاستخدام الداخلي في المراجعة",
    )


def transcript_html(*, title: str, transcript: Transcript, readable: bool, classification_label: str) -> str:
    names = {s.id: s.display_name or s.label for s in transcript.speakers}
    parts = [
        f"<h1>النص الكامل للتسجيل</h1><div class='org'>{escape(title)}</div>",
        f"<p class='note'>{'النسخة المقروءة (بدون تغيير المعنى)' if readable else 'النص الحرفي كما تعرّف عليه النظام'} — "
        f"محرك التعرف: {escape(transcript.asr_provider)} / {escape(transcript.asr_model)}؛ تمييز المتحدثين: {escape(transcript.diarization_provider)}.</p>",
    ]
    for s in transcript.segments:
        who = names.get(s.speaker_id or "", "متحدث غير محدد")
        flags = f" — <span class='flag'>{escape('، '.join(s.flags))}</span>" if s.flags else ""
        parts.append(
            f"<div class='seg'><div class='meta'>{s.id} | {escape(who)} | {fmt_time(s.start)}–{fmt_time(s.end)}{flags}</div>"
            f"<div>{escape(s.text_readable if readable else s.text_verbatim)}</div></div>"
        )
    return _doc("النص الكامل", "".join(parts), classification_label, "النص الكامل للتسجيل", "يُستخدم للمراجعة")


def summary_html(*, doc: MinutesDocument, org_name: str | None) -> str:
    sec = next((s for s in doc.sections if s.key == "summary"), None)
    decisions = next((s for s in doc.sections if s.key == "decisions"), None)
    parts = [
        f"<h1>ملخص تنفيذي</h1><div class='org'>{escape(doc.meeting_info.get('موضوع الاجتماع', ''))}</div>",
        f'<div class="status"><span>{escape(doc.status_label)}</span></div>',
    ]
    if sec:
        parts.append("<ul>" + "".join(f"<li>{escape(b.text)}</li>" for b in sec.blocks) + "</ul>")
    if decisions:
        parts.append(
            "<h2>القرارات المعتمدة</h2><ul>"
            + "".join(f"<li>{escape(r.cells['القرار'])}</li>" for r in decisions.rows)
            + "</ul>"
        )
    return _doc("ملخص تنفيذي", "".join(parts), doc.classification_label, org_name or "ملخص تنفيذي", doc.status_label)
