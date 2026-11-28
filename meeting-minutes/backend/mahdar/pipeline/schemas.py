"""Contracts between the agents. Every artifact an agent writes is validated against one of these
models before it is saved, and every later agent reads only these models (never another agent's
free text). docs/ARCHITECTURE.md §4 shows them as JSON."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


# --- Agent 1: audio intake and quality ----------------------------------------------------------
Severity = Literal["critical", "major", "minor", "info"]


class Issue(Strict):
    code: str
    severity: Severity
    message_ar: str
    start: float | None = None
    end: float | None = None
    item_id: str | None = None
    segment_ids: list[str] = Field(default_factory=list)


class Interval(Strict):
    start: float
    end: float


class Chunk(Strict):
    index: int
    start: float
    end: float


class AudioQualityReport(Strict):
    recording_sha256: str
    original_format: str
    original_codec: str | None
    original_sample_rate: int | None
    original_channels: int | None
    duration_seconds: float
    size_bytes: int
    normalized_sample_rate: int = 16000
    loudness_lufs: float | None = None
    peak_dbfs: float | None = None
    clipping_ratio: float = 0.0
    speech_ratio: float
    estimated_snr_db: float | None = None
    silences: list[Interval]
    long_silences: list[Interval]
    chunks: list[Chunk]
    overlap_regions: list[Interval] = Field(default_factory=list)
    issues: list[Issue]
    overall: Literal["good", "fair", "poor"]


# --- Agents 2 and 3: transcript with speakers -----------------------------------------------------
class Word(Strict):
    w: str
    start: float
    end: float
    p: float = Field(description="Recognition probability of the word (0-1)")
    speaker_id: str | None = None


SegmentFlag = Literal[
    "low_confidence",
    "possible_hallucination",
    "repetition",
    "overlap",
    "uncertain_speaker",
    "uncertain_term",
    "inaudible",
    "edited",
    "short_turn",
    "no_speech",
]


class Segment(Strict):
    id: str
    start: float
    end: float
    speaker_id: str | None
    speaker_confidence: Literal["high", "medium", "low", "unknown"] = "unknown"
    text_verbatim: str
    text_readable: str
    words: list[Word] = Field(default_factory=list)
    avg_logprob: float | None = None
    no_speech_prob: float | None = None
    flags: list[SegmentFlag] = Field(default_factory=list)
    uncertain_terms: list[str] = Field(default_factory=list)
    # Excluded from analysis (e.g. a hallucination over silence); kept for the record.
    excluded: bool = False
    readable_source: Literal["llm", "rules", "verbatim", "human"] = "verbatim"


class Speaker(Strict):
    id: str
    label: str
    display_name: str | None = None
    title: str | None = None
    confirmed: bool = False
    speaking_seconds: float = 0.0


class Transcript(Strict):
    recording_sha256: str
    language: str = "ar"
    asr_provider: str
    asr_model: str
    diarization_provider: str
    segments: list[Segment]
    speakers: list[Speaker]
    issues: list[Issue] = Field(default_factory=list)


# --- Agent 4: semantic analysis --------------------------------------------------------------------
ItemType = Literal[
    "discussion",
    "question",
    "answer",
    "proposal",
    "recommendation",
    "objection",
    "concern",
    "agreement_tentative",
    "decision_approved",
    "decision_rejected",
    "action_assigned",
    "action_suggested",
    "risk",
    "blocker",
    "dependency",
    "open_question",
    "deferred",
    "contradiction",
]

ITEM_TYPE_AR: dict[str, str] = {
    "discussion": "نقطة نقاش",
    "question": "سؤال",
    "answer": "إجابة",
    "proposal": "مقترح",
    "recommendation": "توصية",
    "objection": "اعتراض",
    "concern": "تحفظ/مخاوف",
    "agreement_tentative": "توافق مبدئي",
    "decision_approved": "قرار معتمد",
    "decision_rejected": "مقترح مرفوض",
    "action_assigned": "تكليف",
    "action_suggested": "إجراء مقترح",
    "risk": "خطر",
    "blocker": "عائق",
    "dependency": "اعتمادية",
    "open_question": "مسألة معلقة",
    "deferred": "مؤجل لاجتماع لاحق",
    "contradiction": "تعارض",
}


class Evidence(Strict):
    segment_id: str
    quote: str = Field(description="Exact words copied from that segment's verbatim text")


class Owner(Strict):
    name_as_spoken: str | None = None
    speaker_id: str | None = None
    status: Literal["explicit", "implied", "unspecified"] = "unspecified"


class Due(Strict):
    text_as_spoken: str | None = None
    date_iso: str | None = None
    status: Literal["explicit", "relative", "unspecified"] = "unspecified"


class Item(Strict):
    id: str
    type: ItemType
    topic_id: str | None = None
    statement: str = Field(description="Faithful Modern Standard Arabic statement of what was said")
    speaker_ids: list[str] = Field(default_factory=list)
    owner: Owner = Field(default_factory=Owner)
    due: Due = Field(default_factory=Due)
    qualifications: list[str] = Field(default_factory=list)
    evidence: list[Evidence]
    approval_evidence: list[Evidence] = Field(default_factory=list)
    requires_confirmation: bool = False
    confidence: Literal["high", "medium", "low"] = "medium"
    notes: str | None = None


class Topic(Strict):
    id: str
    title: str
    summary: str
    segment_ids: list[str]


class SpeakerNameHint(Strict):
    speaker_id: str
    name: str
    evidence: list[Evidence]


class Analysis(Strict):
    purpose: str | None
    purpose_evidence: list[Evidence] = Field(default_factory=list)
    topics: list[Topic]
    items: list[Item]
    # Suggestions for a person to confirm (speaker editing); never applied automatically.
    speaker_name_hints: list[SpeakerNameHint] = Field(default_factory=list)
    provider: str
    model: str
    windows: int = 1
    usage: dict = Field(default_factory=dict)


# --- Agent 5: verification ----------------------------------------------------------------------
VerificationStatus = Literal[
    "verified", "verified_rules_only", "partially_supported", "needs_review", "unsupported", "contradicted"
]


class Check(Strict):
    name: str
    passed: bool
    severity: Severity
    detail_ar: str


class ResolvedEvidence(Strict):
    recording_sha256: str
    segment_id: str
    speaker_id: str | None
    speaker_confidence: str
    start: float
    end: float
    original_text: str
    quote: str
    quote_found: bool
    match_score: float


class LlmJudgment(Strict):
    verdict: Literal["supported", "partial", "unsupported", "contradicted"]
    classification_correct: bool
    suggested_type: str | None = None
    speaker_correct: bool | None = None
    missing_qualifications: list[str] = Field(default_factory=list)
    rationale_ar: str
    model: str


class ItemVerification(Strict):
    item_id: str
    status: VerificationStatus
    original_type: str
    final_type: str
    checks: list[Check]
    evidence: list[ResolvedEvidence]
    llm: LlmJudgment | None = None
    issues: list[Issue]


class VerificationReport(Strict):
    items: list[ItemVerification]
    document_issues: list[Issue]
    coverage: dict[str, float]
    llm_used: bool
    llm_model: str | None = None


# --- Agents 6 and 7: minutes --------------------------------------------------------------------
class Block(Strict):
    id: str
    kind: Literal["paragraph", "bullet"]
    text: str
    item_ids: list[str] = Field(default_factory=list)
    segment_ids: list[str] = Field(default_factory=list)


class TableRow(Strict):
    id: str
    cells: dict[str, str]
    item_ids: list[str]


class Section(Strict):
    key: str
    title: str
    blocks: list[Block] = Field(default_factory=list)
    table_columns: list[str] = Field(default_factory=list)
    rows: list[TableRow] = Field(default_factory=list)


class MinutesDocument(Strict):
    title: str
    status_label: str
    classification_label: str
    meeting_info: dict[str, str]
    sections: list[Section]
    issues: list[Issue] = Field(default_factory=list)
    language_review: dict = Field(default_factory=dict)
    generated_by: dict = Field(default_factory=dict)
