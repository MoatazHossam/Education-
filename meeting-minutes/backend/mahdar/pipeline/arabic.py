"""Arabic text handling for the deterministic checks: normalisation for comparison, numbers
(digits in every script and number words in MSA and Egyptian Arabic), dates, and lexicons for
negation, approval, tentative agreement, rejection, deferral and assignment.

These rules do not *decide* what a meeting meant; they test whether a claim's concrete facts
(numbers, dates, names, negation, approval) are present in the words it cites. A failed test flags
the claim for a person; a passed test is necessary, not sufficient, for "verified".
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import date

# --- normalisation --------------------------------------------------------------------------------
_DIACRITICS = re.compile(r"[ؐ-ًؚ-ٰٟۖ-ۭـ]")
_DIGITS = str.maketrans("٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹", "01234567890123456789")
_LETTERS = str.maketrans(
    {
        "أ": "ا",
        "إ": "ا",
        "آ": "ا",
        "ٱ": "ا",
        "ى": "ي",
        "ة": "ه",
        "ؤ": "و",
        "ئ": "ي",
        "ڤ": "ف",
        "گ": "ك",
        "پ": "ب",
        "چ": "ج",
    }
)
_PUNCT = re.compile(r"[^\w\s%\uE000\uE001]", re.UNICODE)


def to_western_digits(text: str) -> str:
    return text.translate(_DIGITS).replace("٫", ".").replace("٬", ",").replace("٪", "%")


def strip_diacritics(text: str) -> str:
    return _DIACRITICS.sub("", text)


def normalize(text: str) -> str:
    """For comparison only (never shown): no diacritics or tatweel, unified letter variants,
    Western digits, no punctuation, lower-case Latin, single spaces."""
    t = unicodedata.normalize("NFKC", text)
    t = to_western_digits(strip_diacritics(t)).translate(_LETTERS).lower()
    # Keep the separators inside numbers ("2.5", "25,000"), split "15%" into "15 %".
    t = re.sub(r"(?<=\d)([.,])(?=\d)", lambda m: "\ue000" if m.group(1) == "." else "\ue001", t)
    t = re.sub(r"(\d)%", r"\1 %", t)
    t = _PUNCT.sub(" ", t).replace("\ue000", ".").replace("\ue001", ",")
    return re.sub(r"\s+", " ", t).strip()


def tokens(text: str) -> list[str]:
    return normalize(text).split()


def strip_clitics(tok: str) -> str:
    """Drops the conjunction و/ف and the prepositions ب/ل/ك + article ال at the start of a token."""
    t = tok
    for p in ("وال", "بال", "فال", "كال", "لل", "ال", "و", "ف", "ب", "ل"):
        if t.startswith(p) and len(t) - len(p) >= 2:
            return t[len(p) :]
    return t


# --- numbers --------------------------------------------------------------------------------------
_UNITS = {
    "صفر": 0,
    "واحد": 1,
    "واحده": 1,
    "اتنين": 2,
    "اثنين": 2,
    "اثنان": 2,
    "اتنان": 2,
    "تنين": 2,
    "ثلاثه": 3,
    "تلاته": 3,
    "ثلاث": 3,
    "تلات": 3,
    "اربعه": 4,
    "اربع": 4,
    "خمسه": 5,
    "خمس": 5,
    "سته": 6,
    "ست": 6,
    "سبعه": 7,
    "سبع": 7,
    "ثمانيه": 8,
    "تمانيه": 8,
    "ثماني": 8,
    "ثمان": 8,
    "تسعه": 9,
    "تسع": 9,
    "عشره": 10,
    "عشر": 10,
    "حداشر": 11,
    "احداشر": 11,
    "اتناشر": 12,
    "اطناشر": 12,
    "تلتاشر": 13,
    "اربعتاشر": 14,
    "اربعطاشر": 14,
    "خمستاشر": 15,
    "خمسطاشر": 15,
    "ستاشر": 16,
    "سطاشر": 16,
    "سبعتاشر": 17,
    "سبعطاشر": 17,
    "تمنتاشر": 18,
    "تمنطاشر": 18,
    "تسعتاشر": 19,
    "تسعطاشر": 19,
}
_TENS = {
    "عشرين": 20,
    "عشرون": 20,
    "ثلاثين": 30,
    "تلاتين": 30,
    "ثلاثون": 30,
    "اربعين": 40,
    "اربعون": 40,
    "خمسين": 50,
    "خمسون": 50,
    "ستين": 60,
    "ستون": 60,
    "سبعين": 70,
    "سبعون": 70,
    "ثمانين": 80,
    "تمانين": 80,
    "ثمانون": 80,
    "تسعين": 90,
    "تسعون": 90,
}
_HUNDREDS = {
    "ميه": 100,
    "مئه": 100,
    "مائه": 100,
    "مية": 100,
    "ميت": 100,
    "ميتين": 200,
    "مئتين": 200,
    "مائتين": 200,
    "مئتان": 200,
    "مائتان": 200,
    "تلتميه": 300,
    "ثلاثمائه": 300,
    "ثلاثمئه": 300,
    "ربعميه": 400,
    "اربعمائه": 400,
    "اربعمئه": 400,
    "خمسميه": 500,
    "خمسمائه": 500,
    "خمسمئه": 500,
    "ستميه": 600,
    "ستمائه": 600,
    "ستمئه": 600,
    "سبعميه": 700,
    "سبعمائه": 700,
    "سبعمئه": 700,
    "تمنميه": 800,
    "ثمانمائه": 800,
    "ثمانمئه": 800,
    "تسعميه": 900,
    "تسعمائه": 900,
    "تسعمئه": 900,
}
_SCALES = {
    "الف": 1_000,
    "الاف": 1_000,
    "ألف": 1_000,
    "الفين": 2_000,
    "الفان": 2_000,
    "مليون": 1_000_000,
    "ملايين": 1_000_000,
    "مليونين": 2_000_000,
    "مليونان": 2_000_000,
    "مليار": 1_000_000_000,
    "مليارات": 1_000_000_000,
    "مليارين": 2_000_000_000,
}
_FRACTIONS = {"نص": 0.5, "نصف": 0.5, "ربع": 0.25, "تلت": 1 / 3, "ثلث": 1 / 3}
# Ordinals, as in dates ("الخامس عشر من يناير"): "عشر" after them adds ten.
_UNITS.update(
    {
        "اول": 1,
        "حادي": 1,
        "ثاني": 2,
        "ثالث": 3,
        "رابع": 4,
        "خامس": 5,
        "سادس": 6,
        "سابع": 7,
        "ثامن": 8,
        "تاسع": 9,
        "عاشر": 10,
    }
)
# The keys are compared with normalised text ("ئ" becomes "ي", "ة" becomes "ه"...): normalise them too.
_UNITS, _TENS, _HUNDREDS, _SCALES, _FRACTIONS = (
    {normalize(k): v for k, v in d.items()} for d in (_UNITS, _TENS, _HUNDREDS, _SCALES, _FRACTIONS)
)
_NUM_RE = re.compile(r"\d+(?:[.,]\d+)*")


def _word_value(tok: str) -> tuple[str, float] | None:
    known = {**_UNITS, **_TENS, **_HUNDREDS, **_SCALES}
    t = tok
    for prefix in ("وال", "ال", "و"):
        if t not in known and t.startswith(prefix) and t[len(prefix) :] in known:
            t = t[len(prefix) :]
            break
    if t in _UNITS:
        return "unit", _UNITS[t]
    if t in _TENS:
        return "ten", _TENS[t]
    if t in _HUNDREDS:
        return "hundred", _HUNDREDS[t]
    if t in _SCALES:
        return "scale", _SCALES[t]
    return None


def extract_numbers(text: str) -> set[float]:
    """Numeric values written with digits or Arabic number words. "25 ألف", "خمسة وعشرين ألف" and
    "25,000" all give 25000; percentages give their number."""
    toks = normalize(text).split()
    values: set[float] = set()
    i = 0
    while i < len(toks):
        tok = toks[i]
        m = _NUM_RE.fullmatch(tok)
        if m:
            raw = tok.replace(",", "") if re.fullmatch(r"\d{1,3}(,\d{3})+", tok) else tok.replace(",", ".")
            try:
                val = float(raw)
            except ValueError:
                i += 1
                continue
            j = i + 1
            if j < len(toks) and (sc := _word_value(toks[j])) and sc[0] == "scale":
                val *= sc[1] if sc[1] in (1_000, 1_000_000, 1_000_000_000) else 1
                j += 1
            values.add(val)
            i = j
            continue
        total, current, used = 0.0, 0.0, False
        j = i
        while j < len(toks):
            wv = _word_value(toks[j])
            if wv is None:
                if toks[j] == "و" and used:
                    j += 1
                    continue
                break
            kind, v = wv
            used = True
            if kind == "scale":
                current = (current or 1) * v
                total += current
                current = 0
            else:
                current += v
            j += 1
        if used:
            values.add(total + current)
            # "ونص" after a number: x.5
            if j < len(toks) and strip_clitics(toks[j]) in _FRACTIONS:
                values.add(total + current + _FRACTIONS[strip_clitics(toks[j])])
            i = j
        else:
            i += 1
    return values


# --- dates ----------------------------------------------------------------------------------------
MONTHS = {
    "يناير": 1,
    "فبراير": 2,
    "مارس": 3,
    "ابريل": 4,
    "مايو": 5,
    "يونيو": 6,
    "يونيه": 6,
    "يوليو": 7,
    "يوليه": 7,
    "اغسطس": 8,
    "سبتمبر": 9,
    "اكتوبر": 10,
    "نوفمبر": 11,
    "ديسمبر": 12,
    "كانون الثاني": 1,
    "شباط": 2,
    "اذار": 3,
    "نيسان": 4,
    "ايار": 5,
    "حزيران": 6,
    "تموز": 7,
    "ايلول": 9,
    "تشرين الاول": 10,
    "تشرين الثاني": 11,
    "كانون الاول": 12,
    "january": 1,
    "february": 2,
    "march": 3,
    "april": 4,
    "june": 6,
    "july": 7,
    "august": 8,
    "september": 9,
    "october": 10,
    "november": 11,
    "december": 12,
}
MONTHS = {normalize(k): v for k, v in MONTHS.items()}
DAYS = {
    "السبت",
    "الاحد",
    "الاتنين",
    "الاثنين",
    "التلات",
    "الثلاثاء",
    "التلاتاء",
    "الاربع",
    "الاربعاء",
    "الخميس",
    "الجمعه",
}
DAYS = {normalize(d) for d in DAYS}
RELATIVE_DATE = [
    "بكره",
    "بكرا",
    "غدا",
    "بعد بكره",
    "بعد غد",
    "النهارده",
    "اليوم",
    "الاسبوع الجاي",
    "الاسبوع القادم",
    "الاسبوع المقبل",
    "الشهر الجاي",
    "الشهر القادم",
    "الشهر المقبل",
    "اخر الشهر",
    "نهايه الشهر",
    "اخر الاسبوع",
    "نهايه الاسبوع",
    "اخر السنه",
    "نهايه السنه",
    "الربع الجاي",
    "الربع القادم",
    "خلال اسبوع",
    "خلال اسبوعين",
    "في خلال",
    "اول الشهر",
    "بدايه الشهر",
    "الاسبوعين الجايين",
    "قبل العيد",
    "بعد العيد",
]
_DATE_NUMERIC = re.compile(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b")


@dataclass
class DateMention:
    text: str
    day: int | None = None
    month: int | None = None
    year: int | None = None
    relative: bool = False


def extract_dates(text: str) -> list[DateMention]:
    n = normalize(text)
    out: list[DateMention] = []
    raw = to_western_digits(text)
    for m in _DATE_NUMERIC.finditer(raw):
        if m.group(1):
            out.append(DateMention(m.group(0), int(m.group(3)), int(m.group(2)), int(m.group(1))))
        else:
            d, mo = int(m.group(4)), int(m.group(5))
            if 1 <= d <= 31 and 1 <= mo <= 12:
                y = m.group(6)
                yv = (2000 + int(y) if y and len(y) == 2 else int(y)) if y else None
                out.append(DateMention(m.group(0), d, mo, yv))
    for name, num in MONTHS.items():
        for m in re.finditer(rf"(?:(\d{{1,2}})\s+)?(?:من\s+)?(?:شهر\s+)?{re.escape(name)}(?:\s+(\d{{4}}))?", n):
            day = int(m.group(1)) if m.group(1) else None
            if day is None:
                # A day written in words before the month ("خمسة عشر ديسمبر").
                before = [w for w in n[: m.start()].split()[-4:] if w != "من"]
                nums = extract_numbers(" ".join(before))
                day = int(max(nums)) if nums and max(nums) <= 31 else None
            out.append(DateMention(m.group(0), day, num, int(m.group(2)) if m.group(2) else None))
    for rel in RELATIVE_DATE:
        if re.search(rf"(?:^|\s){re.escape(rel)}(?:\s|$)", n):
            out.append(DateMention(rel, relative=True))
    for d in DAYS:
        if re.search(rf"(?:^|\s)(?:يوم\s+)?{d}(?:\s|$)", n):
            out.append(DateMention(d, relative=True))
    return out


def resolve_explicit_date(mention: DateMention, meeting_date: date | None) -> date | None:
    """Only explicit day + month (year from the text or the meeting's year). Relative expressions
    ("next week") are never turned into a date here: they are ambiguous."""
    if mention.relative or mention.day is None or mention.month is None:
        return None
    year = mention.year or (meeting_date.year if meeting_date else None)
    if year is None:
        return None
    try:
        d = date(year, mention.month, mention.day)
    except ValueError:
        return None
    if mention.year is None and meeting_date and d < meeting_date and (meeting_date - d).days > 60:
        d = date(year + 1, mention.month, mention.day)
    return d


# --- lexicons -------------------------------------------------------------------------------------
def _norm_list(words: list[str]) -> list[str]:
    return sorted({normalize(w) for w in words}, key=len, reverse=True)


NEGATION = _norm_list(
    [
        "لا",
        "لم",
        "لن",
        "ليس",
        "ليست",
        "لسنا",
        "لستم",
        "غير",
        "عدم",
        "دون",
        "بدون",
        "مش",
        "مو",
        "مب",
        "مفيش",
        "ما فيش",
        "مافيش",
        "مافي",
        "ولا",
        "لأ",
        "لا يوجد",
        "لا يمكن",
        "مش هنعتمد",
        "ما نقدرش",
        "منقدرش",
    ]
)
_NEG_CIRCUMFIX = re.compile(r"^م[اـ]?\w{2,}ش$")
APPROVAL = _norm_list(
    [
        "تقرر",
        "قررنا",
        "قرر",
        "قررت",
        "نقرر",
        "تم الاتفاق",
        "اتفقنا",
        "اتفقنا على",
        "متفقين",
        "متفقون",
        "تمت الموافقة",
        "وافقنا",
        "وافق",
        "وافقت",
        "الموافقه على",
        "نوافق",
        "موافقون",
        "موافقين",
        "موافق",
        "معتمد",
        "اعتماد",
        "نعتمد",
        "اعتمدنا",
        "تم اعتماد",
        "تعتمد",
        "يعتمد",
        "اقر",
        "اقرت",
        "اقررنا",
        "تم اقرار",
        "المصادقه",
        "صادقنا",
        "خلاص اتفقنا",
        "يبقى اتفقنا",
        "يبقى كده اتفقنا",
        "نمشي بيه",
        "نمشي على كده",
        "هنمشي بكده",
        "تمام كده نعتمد",
        "approved",
        "agreed",
        "decided",
        "approve",
        "sign off",
        "signed off",
        "go ahead",
        "نبدأ التنفيذ",
    ]
)
TENTATIVE = _norm_list(
    [
        "مبدئيا",
        "مبدئي",
        "مبدئيه",
        "بشكل مبدئي",
        "الموافقه المبدئيه",
        "على اساس",
        "لحد ما",
        "لحين",
        "بشرط",
        "شرط",
        "بعد ما",
        "بعد مراجعه",
        "نشوف",
        "هنشوف",
        "خلينا نشوف",
        "ممكن",
        "يمكن",
        "ربما",
        "محتاجين نراجع",
        "لازم نراجع",
        "نرجع ل",
        "لسه",
        "مش متاكد",
        "مؤقتا",
        "حتى اشعار",
        "مقترح",
        "اقتراح",
        "اقترح",
        "نقترح",
        "شايفين",
        "رايي",
        "في رايي",
        "اعتقد",
        "اظن",
        "تصوري",
        "يا ريت",
        "ياريت",
        "قبل ما",
    ]
)
REJECTION = _norm_list(
    [
        "مرفوض",
        "رفض",
        "رفضنا",
        "نرفض",
        "مش موافق",
        "مش موافقين",
        "لا نوافق",
        "غير موافق",
        "مش هنعتمد",
        "لن نعتمد",
        "نلغي",
        "الغاء",
        "الغي",
        "مش هنمشي",
        "rejected",
        "not approved",
    ]
)
DEFERRAL = _norm_list(
    [
        "نأجل",
        "نؤجل",
        "تأجيل",
        "مؤجل",
        "الاجتماع الجاي",
        "الاجتماع القادم",
        "الاجتماع المقبل",
        "نرجع له",
        "نرجعله",
        "نكمل بعدين",
        "نتكلم فيه بعدين",
        "postpone",
        "next meeting",
    ]
)
ASSIGNMENT = _norm_list(
    [
        "يتولى",
        "هيتولى",
        "تتولى",
        "هتتولى",
        "مسؤول عن",
        "مسئول عن",
        "المسؤول",
        "مسؤوليه",
        "مسئوليه",
        "يكلف",
        "تكليف",
        "كلفنا",
        "مكلف",
        "مطلوب من",
        "المطلوب",
        "اطلب من",
        "نطلب من",
        "يطلب من",
        "طلب من",
        "اكلف",
        "نكلف",
        "عليك",
        "عليه",
        "عليكم",
        "عليها",
        "ابعت",
        "ابعتلي",
        "ابعتلنا",
        "جهز",
        "تجهز",
        "يجهز",
        "هيجهز",
        "هتجهز",
        "هجهز",
        "هبعت",
        "هتبعت",
        "هيبعت",
        "سأقوم",
        "سارسل",
        "ساجهز",
        "سوف",
        "سيقوم",
        "ستقوم",
        "يقوم",
        "تقوم",
        "سيتولى",
        "ستتولى",
        "حاضر",
        "هعمل",
        "هخلص",
        "هتخلص",
        "هيخلص",
        "هراجع",
        "هتراجع",
        "هيراجع",
        "هتابع",
        "هيتابع",
        "هكلم",
        "هيكلم",
        "هتكلم",
        "action item",
        "owner",
        "assigned",
        "deadline",
        "ديدلاين",
        "تسليم",
        "يسلم",
        "هيسلم",
        "هتسلم",
        "هسلم",
        "please",
        "خليك",
        "خليها عليك",
    ]
)
FILLERS = {
    normalize(w) for w in ["ممم", "امم", "اممم", "ام", "اه", "آه", "إأ", "اااه", "ههه", "uh", "um", "umm", "hmm", "eh"]
}
HALLUCINATION_PHRASES = _norm_list(
    [
        "اشتركوا في القناة",
        "اشترك في القناة",
        "لا تنسوا الاشتراك",
        "لا تنسى الاشتراك",
        "شكرا للمشاهدة",
        "شكرا على المشاهده",
        "شكرا لكم على المشاهده",
        "ترجمة نانسي قنقر",
        "نانسي قنقر",
        "سبتايتل",
        "موسيقى",
        "الى اللقاء في الحلقه القادمه",
        "subtitles by",
        "amara org",
        "تابعونا",
        "اضغط على زر الاعجاب",
    ]
)
COLLOQUIAL = _norm_list(
    [
        "مش",
        "عايز",
        "عايزين",
        "عاوز",
        "عاوزين",
        "دلوقتي",
        "دلوقت",
        "كده",
        "كدا",
        "احنا",
        "بتاع",
        "بتاعه",
        "بتوع",
        "ازاي",
        "ليه",
        "فين",
        "امتى",
        "اللي",
        "ده",
        "دي",
        "دول",
        "كمان",
        "برضه",
        "برضو",
        "علشان",
        "عشان",
        "لسه",
        "خلاص",
        "زي",
        "اوي",
        "ماشي",
        "بكره",
        "النهارده",
        "امبارح",
        "شويه",
        "حاجه",
        "حاجات",
        "كويس",
        "مفيش",
        "ايه",
        "هنعمل",
        "هيعمل",
        "هتعمل",
        "بقى",
        "يعني",
        "طب",
        "بص",
        "اهو",
        "ياريت",
        "يا ريت",
    ]
)
MODALITY = {
    "decision": _norm_list(["قرر", "تقرر", "قررت", "اعتمد", "اعتماد", "اعتمدت", "وافق", "الموافقه", "اقر", "اقرار"]),
    "proposal": _norm_list(["اقترح", "مقترح", "اقتراح", "توصيه", "اوصى", "يوصي", "امكانيه", "دراسه", "النظر في"]),
}
_STOP_H = {
    normalize(w)
    for w in [
        "هو",
        "هي",
        "هم",
        "هما",
        "هذا",
        "هذه",
        "هنا",
        "هناك",
        "هكذا",
        "هل",
        "هيا",
        "هنالك",
        "هيئه",
        "هدف",
        "هام",
        "هامه",
        "هاتف",
    ]
}
_EGY_FUTURE = re.compile(r"^ه(?:ن|ت|ي)?[ء-ي]{3,}$")


def contains_phrase(norm_text: str, phrases: list[str]) -> list[str]:
    padded = f" {norm_text} "
    found = []
    for p in phrases:
        if f" {p} " in padded or (len(p) > 4 and p in norm_text):
            found.append(p)
    return found


def has_negation(text: str) -> bool:
    n = normalize(text)
    if contains_phrase(n, NEGATION):
        return True
    return any(_NEG_CIRCUMFIX.match(t) and t not in {"مدرش"} for t in n.split())


def future_commitment(text: str) -> bool:
    """Egyptian first-person / second-person future ("هبعت", "هتجهز", "هنراجع") or MSA "سأ"/"سوف"."""
    for t in normalize(text).split():
        if t in _STOP_H:
            continue
        if _EGY_FUTURE.match(t) or (t.startswith("سا") and len(t) > 4) or t == "سوف":
            return True
    return False


_LATIN = re.compile(r"[A-Za-z][A-Za-z0-9+#&./-]*(?:\s+\d{2,4})?")


def latin_terms(text: str) -> set[str]:
    return {m.group(0).strip(".-/").lower() for m in _LATIN.finditer(text) if len(m.group(0).strip(".-/")) >= 2}


def colloquial_words(text: str) -> list[str]:
    toks = set(normalize(text).split())
    return [w for w in COLLOQUIAL if " " not in w and w in toks]
