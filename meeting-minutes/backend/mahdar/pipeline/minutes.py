"""Agents 6 and 7 — the formal Arabic minutes and their language review.

Where things come from:
* Which item goes in which section is decided here, from each item's verified type and status and
  from reviewers' decisions, never by the writing model.
* The decisions and actions tables are built here: owner and date cells come from the verified
  items (``لم يُحدد`` when not stated); the model only words the decision/action text.
* The model writes the prose blocks from the items it is given. Each block is checked after
  writing: a number, date, English term or person's name not in its items, a decision verb for an
  item that is not a decision, or a speaker label, rejects the block and puts a faithful
  rule-written sentence in its place (and says so in the issues).
* The language reviewer (Agent 7) may only change wording: a revision that changes numbers, dates,
  names, terms, negation or the decision/proposal wording is refused, and every change is listed.
Without a language model, every block is rule-written from the item statements.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date

from rapidfuzz import fuzz

from mahdar.pipeline import arabic
from mahdar.pipeline.llm import LlmClient, LlmRequest
from mahdar.pipeline.llm import prompts
from mahdar.pipeline.llm.prompts import fmt_time
from mahdar.pipeline.schemas import (
    ITEM_TYPE_AR,
    Analysis,
    Block,
    Issue,
    Item,
    MinutesDocument,
    Section,
    TableRow,
    Transcript,
    VerificationReport,
)

OK_STATUSES = {"verified", "verified_rules_only", "partially_supported"}
NOT_SET = "لم يُحدد"
DECISION_VERBS = arabic._norm_list(["تقرر", "قرر", "قررت", "اعتمد", "اعتمدت", "اعتماد", "وافق", "وافقت", "الموافقه", "اقر", "اقرت", "صادق"])
STATUS_LABELS = {
    "draft_requires_review": "مسودة تتطلب المراجعة",
    "draft": "مسودة",
    "reviewed": "تمت مراجعته",
    "approved": "معتمد",
}
CLASSIFICATION_LABELS = {"public": "عام", "internal": "داخلي", "confidential": "سري", "secret": "سري للغاية"}
SECTION_TITLES = {
    "info": "أولاً: بيانات الاجتماع",
    "purpose": "ثانياً: هدف الاجتماع",
    "topics": "ثالثاً: الموضوعات التي تمت مناقشتها",
    "decisions": "رابعاً: القرارات المعتمدة",
    "recommendations": "خامساً: التوصيات والمقترحات",
    "actions": "سادساً: التكليفات والإجراءات المطلوبة",
    "risks": "سابعاً: التحديات والمخاطر",
    "pending": "ثامناً: الموضوعات المعلقة",
    "summary": "تاسعاً: ملخص تنفيذي",
    "approval": "عاشراً: المراجعة والاعتماد",
}


@dataclass
class EffectiveItem:
    item: Item
    type: str
    status: str
    human_accepted: bool
    issues: list[Issue]

    @property
    def ok(self) -> bool:
        return self.human_accepted or self.status in OK_STATUSES


def effective_items(analysis: Analysis, verification: VerificationReport, review: dict) -> list[EffectiveItem]:
    """Applies reviewers' decisions: rejected items are left out, accepted ones count as checked
    by a person, edits (statement, type, owner, date) replace the extracted values."""
    by_id = {v.item_id: v for v in verification.items}
    decisions = (review or {}).get("items", {})
    out = []
    for it in analysis.items:
        v = by_id.get(it.id)
        d = decisions.get(it.id, {})
        if d.get("decision") == "rejected":
            continue
        item = it
        if d.get("edits"):
            e = d["edits"]
            item = it.model_copy(update={
                "statement": e.get("statement", it.statement),
                "owner": it.owner.model_copy(update={"name_as_spoken": e["owner"], "status": "explicit"}) if "owner" in e else it.owner,
                "due": it.due.model_copy(update={"text_as_spoken": e["due"], "status": "explicit" if e["due"] else "unspecified"}) if "due" in e else it.due,
            })
        typ = d.get("type") or (v.final_type if v else it.type)
        out.append(EffectiveItem(item=item, type=typ, status=v.status if v else "needs_review",
                                 human_accepted=d.get("decision") == "accepted", issues=v.issues if v else []))
    return out


def _ref(item: Item, segs: dict) -> str:
    ids = sorted({e.segment_id for e in [*item.evidence, *item.approval_evidence] if e.segment_id in segs})
    return "، ".join(f"{i} ({fmt_time(segs[i].start)})" for i in ids[:4]) or NOT_SET


def _owner(it: Item, names: dict[str, str]) -> str:
    if it.owner.name_as_spoken:
        return it.owner.name_as_spoken
    if it.owner.speaker_id and names.get(it.owner.speaker_id):
        return names[it.owner.speaker_id]
    return NOT_SET


def _due(it: Item) -> str:
    if it.due.date_iso and it.due.text_as_spoken:
        return f"{it.due.text_as_spoken} ({it.due.date_iso})"
    return it.due.text_as_spoken or it.due.date_iso or NOT_SET


_PREFIX = {
    "discussion": "نوقش ", "question": "طُرح تساؤل: ", "answer": "أُوضح أن ", "proposal": "اقتُرح ", "recommendation": "أُوصي بـ",
    "objection": "أُبدي اعتراض: ", "concern": "أُبديت مخاوف: ", "agreement_tentative": "جرى التوافق مبدئياً على ما يلي، على أن يُؤكَّد لاحقاً: ",
    "decision_approved": "تقرر: ", "decision_rejected": "لم يُوافق على: ", "action_assigned": "", "action_suggested": "إجراء مقترح (يتطلب التأكيد): ",
    "risk": "خطر: ", "blocker": "عائق: ", "dependency": "اعتمادية: ", "open_question": "مسألة معلقة: ", "deferred": "أُرجئ: ",
    "contradiction": "تعارض يتطلب التوضيح: ",
}


def rule_text(e: EffectiveItem) -> str:
    """A faithful sentence from the verified statement alone (no model)."""
    s = e.item.statement.strip().rstrip(".")
    prefix = _PREFIX.get(e.type, "")
    if prefix and arabic.normalize(s).startswith(arabic.normalize(prefix.split()[0])):
        prefix = ""
    text = prefix + s
    if e.item.qualifications and not all(arabic.normalize(q) in arabic.normalize(s) for q in e.item.qualifications):
        text += "، مع مراعاة ما يلي: " + "؛ ".join(q.rstrip(".") for q in e.item.qualifications)
    if not e.ok:
        text += " (يتطلب التحقق من التسجيل)"
    return text + "."


def _allowed_facts(items: list[EffectiveItem], names: dict[str, str]) -> dict:
    txt = " ".join(" ".join([e.item.statement, *e.item.qualifications, e.item.owner.name_as_spoken or "", e.item.due.text_as_spoken or "",
                             e.item.due.date_iso or ""]) for e in items)
    return {
        "numbers": arabic.extract_numbers(txt) | {float(p) for e in items if e.item.due.date_iso for p in e.item.due.date_iso.split("-") if p.isdigit()},
        "dates": {(d.day, d.month) for d in arabic.extract_dates(txt) if d.day and d.month},
        "latin": arabic.latin_terms(txt),
        "text": arabic.normalize(txt),
        "names": {n for n in names.values() if n},
    }


def check_block(text: str, items: list[EffectiveItem], names: dict[str, str], people: list[str]) -> list[str]:
    """Reasons a written block is not supported by its items (empty when it is)."""
    problems = []
    if not items:
        return ["no_items"]
    facts = _allowed_facts(items, names)
    nums = arabic.extract_numbers(text) - {1.0}
    extra = [n for n in nums if not any(abs(n - m) < 1e-6 for m in facts["numbers"])]
    if extra:
        problems.append("numbers:" + ",".join(f"{n:g}" for n in extra))
    dates = {(d.day, d.month) for d in arabic.extract_dates(text) if d.day and d.month}
    if dates - facts["dates"]:
        problems.append("dates")
    if not arabic.latin_terms(text) <= facts["latin"]:
        problems.append("terms:" + ",".join(sorted(arabic.latin_terms(text) - facts["latin"])))
    if re.search(r"SPK_\d+|المتحدث \d+", text):
        problems.append("speaker_label")
    norm = arabic.normalize(text)
    for person in people:
        pn = arabic.normalize(person)
        if pn and re.search(rf"(?:^|\s)(?:ل|و|ب)?{re.escape(pn)}(?:\s|$)", norm) and pn not in facts["text"] and person not in facts["names"]:
            problems.append(f"name:{person}")
    is_decision = any(e.type in ("decision_approved", "decision_rejected") for e in items)
    if not is_decision and arabic.contains_phrase(norm, DECISION_VERBS):
        problems.append("decision_wording")
    if not any(e.type == "decision_approved" for e in items) and "تقرر" in text:
        problems.append("decision_wording")
    if arabic.has_negation(text) and not any(arabic.has_negation(e.item.statement) for e in items) and not any(
            e.type in ("decision_rejected", "open_question", "contradiction", "agreement_tentative", "deferred", "concern",
                       "objection", "risk", "blocker", "action_suggested") for e in items):
        problems.append("negation")
    return sorted(set(problems))


def _plan(items: list[EffectiveItem]) -> dict[str, list[EffectiveItem]]:
    plan: dict[str, list[EffectiveItem]] = {k: [] for k in ["topics", "decisions", "recommendations", "actions", "risks", "pending"]}
    for e in items:
        t = e.type
        if e.status == "unsupported" and not e.human_accepted:
            continue  # not in the minutes; listed in the evidence report
        if t in ("decision_approved", "action_assigned") and not e.ok:
            plan["pending"].append(e)
        elif t == "decision_approved":
            plan["decisions"].append(e)
        elif t in ("action_assigned", "action_suggested"):
            plan["actions"].append(e)
        elif t in ("proposal", "recommendation", "decision_rejected", "agreement_tentative"):
            plan["recommendations"].append(e)
            if t == "agreement_tentative":
                plan["pending"].append(e)
        elif t in ("risk", "blocker", "dependency", "concern", "objection"):
            plan["risks"].append(e)
        elif t in ("open_question", "deferred", "contradiction"):
            plan["pending"].append(e)
        else:
            plan["topics"].append(e)
    return plan


def build_minutes(*, transcript: Transcript, analysis: Analysis, verification: VerificationReport, review: dict, meta: dict,
                  classification: str, minutes_status: str, approval: dict | None, glossary: list[dict],
                  llm: LlmClient | None) -> tuple[MinutesDocument, list[dict]]:
    segs = {s.id: s for s in transcript.segments}
    names = {s.id: s.display_name for s in transcript.speakers if s.display_name and s.confirmed}
    people = [g["term"] for g in glossary if g.get("category") == "person"]
    eff = effective_items(analysis, verification, review)
    by_id = {e.item.id: e for e in eff}
    plan = _plan(eff)
    usage: list[dict] = []
    issues: list[Issue] = []

    written: dict = {}
    if llm is not None and eff:
        payload = {
            "meeting": {k: v for k, v in meta.items() if k in ("title", "date", "location")},
            "purpose": analysis.purpose,
            "topics": [{"topic_id": t.id, "title": t.title, "summary": t.summary,
                        "items": [i.item.id for i in eff if i.item.topic_id == t.id and i in plan["topics"]]} for t in analysis.topics],
            "items": [{"id": e.item.id, "type": e.type, "type_ar": ITEM_TYPE_AR.get(e.type), "statement": e.item.statement,
                       "qualifications": e.item.qualifications, "owner": _owner(e.item, names) if e.type in ("action_assigned", "action_suggested", "decision_approved") else None,
                       "due": e.item.due.text_as_spoken, "needs_confirmation": not e.ok,
                       "section": next(k for k, v in plan.items() if e in v) if any(e in v for v in plan.values()) else None} for e in eff],
            "sections": {"decision_texts": [e.item.id for e in plan["decisions"]], "action_texts": [e.item.id for e in plan["actions"]],
                         "recommendations": [e.item.id for e in plan["recommendations"]], "risks": [e.item.id for e in plan["risks"]],
                         "pending": [e.item.id for e in plan["pending"]]},
        }
        context = prompts.meeting_context(meta, glossary, [], transcript.speakers)
        res = llm.generate_json(LlmRequest(
            stage="writing", system=prompts.WRITER_SYSTEM, shared_context=context, schema=prompts.writer_schema(), max_tokens=32000,
            user="Write the minutes from these verified items (JSON). Put each item id in the section listed under 'sections' "
                 "(topics: the items listed under each topic). decision_texts and action_texts: one block per item, wording only "
                 "the decision or the task (owners and dates go in separate table columns). executive_summary: two to five short "
                 "blocks for senior leadership, citing the items they summarise.\n<items>\n"
                 + json.dumps(payload, ensure_ascii=False, indent=1) + "\n</items>",
        ))
        usage.append({"stage": "writing", "model": res.model, "input_tokens": res.input_tokens, "output_tokens": res.output_tokens,
                      "cache_read_tokens": res.cache_read_tokens, "served_by_fallback": res.served_by_fallback})
        written = res.data

    counter = [0]
    overrides = {(o["section"], tuple(sorted(o["item_ids"]))): o for o in (review or {}).get("block_overrides", [])}

    def block(text: str | None, item_ids: list[str], section: str, kind: str = "paragraph") -> Block | None:
        its = [by_id[i] for i in item_ids if i in by_id]
        if not its:
            return None
        counter[0] += 1
        bid = f"B{counter[0]:03d}"
        final = text.strip() if text else None
        human = overrides.get((section, tuple(sorted(e.item.id for e in its))))
        if human:
            problems = check_block(human["text"], its, names, people)
            if problems:
                issues.append(Issue(code="human_edit_unverified", severity="minor", item_id=its[0].item.id,
                                    message_ar=f"صياغة المراجِع {human.get('by_name', '')} تتضمن ما لا يرد في البنود ({'، '.join(problems)})؛ أُبقيت بقرار بشري."))
            seg_ids = sorted({x.segment_id for e in its for x in e.item.evidence})
            return Block(id=bid, kind=kind, text=human["text"], item_ids=[e.item.id for e in its], segment_ids=seg_ids)  # type: ignore[arg-type]
        if final:
            problems = check_block(final, its, names, people)
            if problems:
                issues.append(Issue(code="writer_block_replaced", severity="minor", item_id=its[0].item.id,
                                    message_ar=f"استُبدلت صياغة فقرة في «{SECTION_TITLES.get(section, section)}» بصياغة حرفية من البنود "
                                               f"لأنها تضمنت ما لا يرد في البنود ({'، '.join(problems)})."))
                final = None
        if not final:
            final = " ".join(rule_text(e) for e in its)
        if not all(e.ok for e in its) and "(يتطلب" not in final:
            final = final.rstrip(".") + " (يتطلب التحقق من التسجيل)."
        seg_ids = sorted({x.segment_id for e in its for x in e.item.evidence})
        return Block(id=bid, kind=kind, text=final, item_ids=[e.item.id for e in its], segment_ids=seg_ids)  # type: ignore[arg-type]

    def blocks_for(section: str, key: str, planned: list[EffectiveItem]) -> list[Block]:
        out: list[Block] = []
        covered: set[str] = set()
        for wb in written.get(key) or []:
            ids = [i for i in wb.get("item_ids", []) if i in {e.item.id for e in planned} and i not in covered]
            b = block(wb.get("text"), ids, section, "bullet")
            if b:
                out.append(b)
                covered |= set(b.item_ids)
        for e in planned:
            if e.item.id not in covered:
                b = block(None, [e.item.id], section, "bullet")
                if b:
                    out.append(b)
        return out

    sections: list[Section] = []
    # أولاً: بيانات الاجتماع
    confirmed = [s for s in transcript.speakers if s.display_name and s.confirmed]
    attendees = meta.get("attendees") or [f"{s.display_name}{('، ' + s.title) if s.title else ''}" for s in confirmed]
    info = {
        "موضوع الاجتماع": meta.get("title") or "",
        "تاريخ الاجتماع": meta.get("date") or "",
        "وقت البداية": meta.get("start_time") or "",
        "وقت النهاية": meta.get("end_time") or "",
        "المكان أو وسيلة الانعقاد": meta.get("location") or "",
        "الحاضرون": "، ".join(attendees) if attendees else
        f"لم تُحدَّد أسماء الحاضرين بعد (عدد المتحدثين المرصودين في التسجيل: {len(transcript.speakers)})",
        "معد المحضر": meta.get("prepared_by") or "",
        "حالة المحضر": STATUS_LABELS[minutes_status],
    }
    info = {k: v for k, v in info.items() if v}
    sections.append(Section(key="info", title=SECTION_TITLES["info"], table_columns=["البيان", "القيمة"],
                            rows=[TableRow(id=f"M{i}", cells={"البيان": k, "القيمة": v}, item_ids=[]) for i, (k, v) in enumerate(info.items(), 1)]))
    # ثانياً: هدف الاجتماع
    if analysis.purpose:
        pw = written.get("purpose") or {}
        ptext = pw.get("text") if isinstance(pw, dict) else None
        ev_ok = any(e.segment_id in segs for e in analysis.purpose_evidence)
        if ptext and (arabic.extract_numbers(ptext) - arabic.extract_numbers(analysis.purpose)):
            ptext = None
        counter[0] += 1
        sections.append(Section(key="purpose", title=SECTION_TITLES["purpose"], blocks=[Block(
            id=f"B{counter[0]:03d}", kind="paragraph", text=(ptext or analysis.purpose).strip() + ("" if ev_ok else " (يتطلب التحقق)"),
            segment_ids=[e.segment_id for e in analysis.purpose_evidence])]))
    # ثالثاً: الموضوعات
    topic_blocks: list[Block] = []
    for t in analysis.topics:
        wt = next((w for w in written.get("topics") or [] if w.get("topic_id") == t.id), None)
        t_items = [e for e in plan["topics"] if e.item.topic_id == t.id]
        counter[0] += 1
        topic_blocks.append(Block(id=f"B{counter[0]:03d}", kind="paragraph", text=f"## {(wt or {}).get('title') or t.title}", segment_ids=[]))
        covered: set[str] = set()
        for wb in (wt or {}).get("blocks") or []:
            ids = [i for i in wb.get("item_ids", []) if i in {e.item.id for e in t_items} and i not in covered]
            b = block(wb.get("text"), ids, "topics")
            if b:
                topic_blocks.append(b)
                covered |= set(b.item_ids)
        for e in t_items:
            if e.item.id not in covered:
                b = block(None, [e.item.id], "topics")
                if b:
                    topic_blocks.append(b)
        if not t_items:
            counter[0] += 1
            topic_blocks.append(Block(id=f"B{counter[0]:03d}", kind="paragraph", text=t.summary.strip(), segment_ids=t.segment_ids[:6]))
    orphan = [e for e in plan["topics"] if not e.item.topic_id or e.item.topic_id not in {t.id for t in analysis.topics}]
    for e in orphan:
        b = block(None, [e.item.id], "topics")
        if b:
            topic_blocks.append(b)
    if topic_blocks:
        sections.append(Section(key="topics", title=SECTION_TITLES["topics"], blocks=topic_blocks))
    # رابعاً: القرارات المعتمدة (table)
    if plan["decisions"]:
        texts = {i: wb.get("text") for wb in written.get("decision_texts") or [] for i in wb.get("item_ids", [])[:1]}
        rows = []
        for n, e in enumerate(plan["decisions"], 1):
            b = block(texts.get(e.item.id), [e.item.id], "decisions")
            rows.append(TableRow(id=f"D{n}", item_ids=[e.item.id], cells={
                "رقم": str(n), "القرار": b.text if b else rule_text(e), "المسؤول": _owner(e.item, names),
                "تاريخ التنفيذ": _due(e.item), "المرجع": _ref(e.item, segs)}))
        sections.append(Section(key="decisions", title=SECTION_TITLES["decisions"],
                                table_columns=["رقم", "القرار", "المسؤول", "تاريخ التنفيذ", "المرجع"], rows=rows))
    # خامساً: التوصيات والمقترحات
    rec = blocks_for("recommendations", "recommendations", plan["recommendations"])
    if rec:
        sections.append(Section(key="recommendations", title=SECTION_TITLES["recommendations"], blocks=rec))
    # سادساً: التكليفات (table)
    if plan["actions"]:
        texts = {i: wb.get("text") for wb in written.get("action_texts") or [] for i in wb.get("item_ids", [])[:1]}
        rows = []
        ordered = [e for e in plan["actions"] if e.type == "action_assigned"] + [e for e in plan["actions"] if e.type != "action_assigned"]
        for n, e in enumerate(ordered, 1):
            b = block(texts.get(e.item.id), [e.item.id], "actions")
            state = ("مُكلَّف" if e.type == "action_assigned" else "مقترح — لم يُكلَّف به أحد رسمياً")
            if e.human_accepted:
                state += " (تمت مراجعته)"
            elif not e.ok:
                state += " (يتطلب التأكيد)"
            rows.append(TableRow(id=f"A{n}", item_ids=[e.item.id], cells={
                "رقم": str(n), "الإجراء المطلوب": b.text if b else rule_text(e), "المسؤول": _owner(e.item, names),
                "الموعد المحدد": _due(e.item), "الحالة": state}))
        sections.append(Section(key="actions", title=SECTION_TITLES["actions"],
                                table_columns=["رقم", "الإجراء المطلوب", "المسؤول", "الموعد المحدد", "الحالة"], rows=rows))
    # سابعاً: التحديات والمخاطر
    risks = blocks_for("risks", "risks", plan["risks"])
    if risks:
        sections.append(Section(key="risks", title=SECTION_TITLES["risks"], blocks=risks))
    # ثامناً: الموضوعات المعلقة
    pend = blocks_for("pending", "pending", plan["pending"])
    if pend:
        sections.append(Section(key="pending", title=SECTION_TITLES["pending"], blocks=pend))
    # تاسعاً: ملخص تنفيذي
    summary: list[Block] = []
    for wb in written.get("executive_summary") or []:
        ids = [i for i in wb.get("item_ids", []) if i in by_id and by_id[i].ok]
        b = block(wb.get("text"), ids, "summary", "bullet")
        if b:
            summary.append(b)
    if not summary:
        for e in [*plan["decisions"], *[a for a in plan["actions"] if a.type == "action_assigned" and a.ok]][:5]:
            b = block(None, [e.item.id], "summary", "bullet")
            if b:
                summary.append(b)
        n_pending = len(plan["pending"])
        if n_pending:
            counter[0] += 1
            summary.append(Block(id=f"B{counter[0]:03d}", kind="bullet", text=f"عدد الموضوعات المعلقة أو التي تتطلب التأكيد: {n_pending}."))
    if summary:
        sections.append(Section(key="summary", title=SECTION_TITLES["summary"], blocks=summary))
    # عاشراً: المراجعة والاعتماد — never filled in by the system except with a recorded approval.
    rows = [TableRow(id="R1", cells={"الصفة": "أعدّه", "الاسم": meta.get("prepared_by") or "", "التوقيع": "", "التاريخ": ""}, item_ids=[]),
            TableRow(id="R2", cells={"الصفة": "راجعه", "الاسم": "", "التوقيع": "", "التاريخ": ""}, item_ids=[]),
            TableRow(id="R3", cells={"الصفة": "اعتمده", "الاسم": "", "التوقيع": "", "التاريخ": ""}, item_ids=[])]
    if approval:
        rows[2] = TableRow(id="R3", item_ids=[], cells={"الصفة": "اعتمده", "الاسم": approval.get("name", ""),
                                                        "التوقيع": "اعتماد إلكتروني مسجل في النظام", "التاريخ": approval.get("date", "")})
    sections.append(Section(key="approval", title=SECTION_TITLES["approval"], table_columns=["الصفة", "الاسم", "التوقيع", "التاريخ"], rows=rows))

    for e in eff:
        if not e.human_accepted:
            issues.extend(i for i in e.issues if i.severity in ("critical", "major"))
    issues.extend(verification.document_issues)
    doc = MinutesDocument(
        title="محضر اجتماع", status_label=STATUS_LABELS[minutes_status], classification_label=CLASSIFICATION_LABELS.get(classification, ""),
        meeting_info=info, sections=sections, issues=issues,
        generated_by={"writer": f"{llm.provider}:{llm.model}" if llm else "rules", "date": date.today().isoformat()},
    )
    return doc, usage


# --- Agent 7: language review ----------------------------------------------------------------------
_FIXES = [(re.compile(r"(?<=[؀-ۿ])\s*,\s*"), "، "), (re.compile(r"(?<=[؀-ۿ])\s*;\s*"), "؛ "),
          (re.compile(r"(?<=[؀-ۿ])\s*\?"), "؟"), (re.compile(r"\s+([،؛.؟:])"), r"\1"), (re.compile(r"[ \t]{2,}"), " "),
          (re.compile(r"\.{2,}"), ".")]


def lint(text: str) -> tuple[str, list[str]]:
    """Safe mechanical fixes (Arabic punctuation, spacing) and the problems a person should see."""
    out = text
    for pat, rep in _FIXES:
        out = pat.sub(rep, out)
    notes = []
    coll = arabic.colloquial_words(out)
    if coll:
        notes.append("ألفاظ عامية: " + "، ".join(coll[:5]))
    return out.strip(), notes


def fact_signature(text: str) -> dict:
    n = arabic.normalize(text)
    return {
        "numbers": sorted(arabic.extract_numbers(text)), "dates": sorted({(d.day, d.month) for d in arabic.extract_dates(text) if d.day and d.month}),
        "latin": sorted(arabic.latin_terms(text)), "negation": arabic.has_negation(text),
        "decision": bool(arabic.contains_phrase(n, DECISION_VERBS)), "tentative": bool(arabic.contains_phrase(n, ["مبدئيا", "مبدئي"])),
    }


def review_language(doc: MinutesDocument, llm: LlmClient | None, people: list[str]) -> tuple[MinutesDocument, list[dict]]:
    usage: list[dict] = []
    targets: list[tuple[str, str]] = []  # (id, text)
    for s in doc.sections:
        for b in s.blocks:
            if not b.text.startswith("## "):
                targets.append((b.id, b.text))
        for r in s.rows:
            for col in ("القرار", "الإجراء المطلوب"):
                if col in r.cells:
                    targets.append((f"{r.id}:{col}", r.cells[col]))
    revised: dict[str, str] = {}
    reasons: dict[str, str] = {}
    if llm is not None and targets:
        res = llm.generate_json(LlmRequest(
            stage="language_review", system=prompts.REVIEW_SYSTEM, schema=prompts.review_schema(), max_tokens=32000, effort="medium",
            user="Blocks of the minutes (JSON):\n<blocks>\n" + json.dumps([{"id": i, "text": t} for i, t in targets], ensure_ascii=False, indent=1) + "\n</blocks>",
        ))
        usage.append({"stage": "language_review", "model": res.model, "input_tokens": res.input_tokens, "output_tokens": res.output_tokens,
                      "cache_read_tokens": res.cache_read_tokens, "served_by_fallback": res.served_by_fallback})
        revised = {b["id"]: b["text"] for b in res.data["blocks"]}
        reasons = {c["id"]: c["reason_ar"] for c in res.data["changes"]}
    accepted, refused, notes = [], [], []
    final: dict[str, str] = {}
    for bid, text in targets:
        new = revised.get(bid, text).strip() or text
        if new != text:
            same = fact_signature(new) == fact_signature(text)
            names_ok = all((arabic.normalize(p) in arabic.normalize(new)) == (arabic.normalize(p) in arabic.normalize(text)) for p in people if p)
            if same and names_ok and fuzz.ratio(arabic.normalize(new), arabic.normalize(text)) >= 55:
                accepted.append({"id": bid, "before": text, "after": new, "reason_ar": reasons.get(bid, "")})
            else:
                refused.append({"id": bid, "proposed": new, "reason_ar": "رُفض التعديل لأنه يغير رقماً أو تاريخاً أو اسماً أو مصطلحاً أو صيغة النفي أو قوة العبارة."})
                new = text
        fixed, lint_notes = lint(new)
        final[bid] = fixed
        notes += [{"id": bid, "note_ar": n} for n in lint_notes]
    sections = []
    for s in doc.sections:
        blocks = [b.model_copy(update={"text": final.get(b.id, b.text)}) for b in s.blocks]
        rows = [r.model_copy(update={"cells": {k: final.get(f"{r.id}:{k}", v) for k, v in r.cells.items()}}) for r in s.rows]
        sections.append(s.model_copy(update={"blocks": blocks, "rows": rows}))
    issues = list(doc.issues) + [Issue(code="language_note", severity="minor", message_ar=f"{n['note_ar']} ({n['id']})") for n in notes]
    return doc.model_copy(update={"sections": sections, "issues": issues, "language_review": {
        "reviewer": f"{llm.provider}:{llm.model}" if llm else "rules", "accepted": accepted, "refused": refused, "notes": notes}}), usage
