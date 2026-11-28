# Mahdar (محضر) — architecture

Evidence-grounded Arabic meeting minutes. A recording goes in; formal Modern Standard Arabic
minutes (DOCX, PDF), an executive summary, an action-item table, a timestamped transcript, an
evidence and uncertainty report and structured JSON come out — with every material statement
traceable to the words and the second of the recording it rests on, and nothing marked approved
until a person approves it.

> The first priority is factual accuracy and traceability, the second Arabic writing quality.
> The design follows from one rule: **a model may propose; only evidence, and then a person,
> decide.**

Contents: [1 Architecture](#1-recommended-architecture) · [2 Speech technology](#2-speech-recognition-and-diarization-for-arabic) ·
[3 Agents](#3-the-agents-and-how-they-exchange-data) · [4 Schemas](#4-json-schemas) ·
[5 Verification](#5-verification-and-anti-hallucination-methodology) · [6 Interface](#6-user-interface-workflow) ·
[7 Costs](#7-operational-costs-and-cost-drivers) · [8 Plan](#8-implementation-plan-and-status) · [9 Risks](#9-technical-risks) ·
[10 Evaluation](#10-accuracy-evaluation) · [11 Security](#11-privacy-and-security) · [12 What is verified](#12-what-has-and-has-not-been-verified)

---

## 1. Recommended architecture

```
 Browser (React, Arabic RTL)                       one origin, HTTPS (Caddy, --profile tls)
   │  upload · review · correct · approve · export
   ▼
 API (FastAPI) ──────────────┬──────────────────────────────────────────────┐
   sessions (HttpOnly cookie, CSRF header), roles, upload limits,         │
   audio excerpts, downloads, audit                                        │
   │ enqueue                                                               │
   ▼                                                                       ▼
 PostgreSQL ── jobs (queue, SKIP LOCKED) · meetings · artifacts (versioned, encrypted JSON)
   │           · blobs (pointers) · audit_log · processing_records · glossary — row-level security per organization
   ▲
   │ claim, heartbeat, save each stage
 Worker ── Agent 1 intake ─ 2 transcription ─ 3 diarization ─ align ─ 2b readable copy
            ─ 4 analysis ─ 5 verification ─ 6 writer ─ 7 language review ─ 8 documents
   │                │                    │
   │      ASR provider (local or cloud)  LLM provider (Claude, or a local OpenAI-compatible server)
   ▼
 Encrypted storage (local volume or S3-compatible): original and normalised audio, DOCX/PDF/CSV/JSON
```

| Layer | Choice | Why |
| --- | --- | --- |
| Interface | React 19 + TypeScript + Vite, served by the API | One origin (no CORS), strict CSP, bundled Arabic fonts (no CDN) |
| API | Python 3.12, FastAPI | The speech and document stack is Python; OpenAPI at `/docs` |
| Jobs | PostgreSQL queue (`FOR UPDATE SKIP LOCKED`), heartbeats, retries with backoff | No extra broker to secure; resumable per stage and per audio chunk |
| Database | PostgreSQL 16, row-level security on every content table | Cross-organization isolation enforced by the database, not only by code |
| Storage | Local volume or S3-compatible; files AES-256-GCM-encrypted before writing | The store never holds a readable recording |
| Speech | Provider interface: faster-whisper (default, local), OpenAI, Deepgram, Azure | Replaceable without touching the pipeline (§2) |
| Speakers | sherpa-onnx (default, local, no account), pyannote (optional), or the ASR provider's labels | §2 |
| Reasoning/writing | Claude (`claude-opus-5-5`) through the official SDK; or an OpenAI-compatible local server | Claude does not transcribe audio: a separate speech layer is required |
| Documents | python-docx (RTL at the OOXML level) and WeasyPrint (Pango/HarfBuzz shaping) | Both checked after rendering (§3, Agent 8) |
| Deployment | One image (API, worker, migrations), Docker Compose, optional Caddy TLS | `meeting-minutes/docker-compose.yml` |

Claude's API does not accept arbitrary audio, so the system has its own speech recognition and
diarization layer; Claude is used for reasoning and writing only, on the transcript.

## 2. Speech recognition and diarization for Arabic

Researched 2026-11-28. Labels: **[official]** read on the provider's page; **[snippet]** taken
from a search extract of an official page that could not be opened from the build environment;
**[3rd]** third-party; **unverified** where no source confirmed it. Prices change: check before
budgeting.

### 2.1 Speech-to-text

| Option | Arabic and dialects | Timestamps / speakers | Price | Deployment | Notes |
| --- | --- | --- | --- | --- | --- |
| **Whisper large-v3 via faster-whisper** (default) | Multilingual; Egyptian and code-switching weak (below) | Segment + word times; no speakers | Compute only | Local CPU/GPU, nothing leaves the server | v1.2.1 (2025-10-31), MIT [official, PyPI]. int8 on CPU; CUDA 12 on GPU |
| OpenAI `gpt-transcribe` | Arabic support **unverified**; takes `languages`, `keywords` [official SDK] | Timestamps/speakers **unverified** | $0.0045/min [snippet] | Cloud; ZDR needs approval [snippet] | All other OpenAI transcription models (`gpt-4o-transcribe`, `-mini`, `-diarize`, `whisper-1`) show a shutdown date of **2027-02-26** [official SDK] |
| Deepgram Nova-3 Arabic | `ar` + 17 regional codes incl. `ar-EG`, `ar-SA`, `ar-AE` [snippet, changelog 2026-01-27] | Words, utterances; diarization listed, Arabic diarization **unverified** | $0.0043/min [snippet] (+ diarization ≈ $0.002/min [3rd]) | Cloud or self-hosted on NVIDIA GPUs [snippet] | Keyterm prompting |
| Azure AI Speech (fast transcription) | `ar-EG` and other Arabic locales [snippet]; container 5.5.0 has 18 Arabic locales [official, MCR] | Words, phrases, diarization (`maxSpeakers`) [snippet] | ≈ $0.36/h fast, $0.18/h batch [3rd, unverified] | Cloud or containers (disconnected needs approval) | Batch: ≤ 240 min with diarization |
| ElevenLabs Scribe v2 | 90+ languages; Arabic WER **unverified** | Words; diarization up to 32 speakers | ≈ $0.20–0.22/h [snippet / 3rd] | Cloud | Not implemented here |
| AssemblyAI Universal-3.5 Pro | One price for all Arabic dialects [snippet] | Diarization add-on | ≈ $0.21/h [snippet] | Cloud | Not implemented here |
| Arabic-specialised (Jais-ASR, Cohere Arabic, AURA, Munsit, Speechmatics bilingual) | Best published Egyptian/code-switch scores (below) | Varies | Varies | Some on-prem | Licences, self-hosting **unverified**; candidates for an adapter |

Published Arabic error rates (lower is better):

| Benchmark | Whisper large-v3 | large-v3-turbo | Best listed |
| --- | --- | --- | --- |
| Open Universal Arabic ASR leaderboard (Elm, updated 2026-11-25), average of six sets | 36.86 | 40.05 | Jais-ASR 22.82, Audar-ASR-V1-Turbo 23.17, cohere-transcribe-arabic 24.19 |
| QCRI AURA bilingual board (2026-10-22): MGB-3 (Egyptian) | 34.46 | — | aura_stt_offline_xl 21.66 |
| QCRI: ArzEn (Egyptian–English code-switching) | 58.07 | — | cohere-transcribe-arabic 19.21 |
| QCRI: FLEURS-ar (read MSA) | 9.33 | — | — |

The QCRI board is run by the makers of AURA. Sources: huggingface.co/spaces/elmresearchcenter/open_universal_arabic_asr_leaderboard,
huggingface.co/spaces/QCRI/AURA-Arabic-English-ASR-leaderboard.

**Decision.** Default to **faster-whisper large-v3, locally**: it keeps confidential recordings on
the organization's servers, gives word timestamps (needed for speaker alignment and evidence
playback), and runs on CPU or GPU. Its known weakness — Egyptian dialect and Arabic–English
code-switching — is exactly where meeting recordings live, so the architecture treats speech
recognition as replaceable (`pipeline/asr`, one interface, four implementations) and the
evaluation harness (§10) exists to compare engines **on the organization's own recordings**
before choosing. Where policy allows the cloud, Deepgram Nova-3 `ar-EG` and Azure `ar-EG` are the
first candidates (diarization included, self-hosting available). OpenAI is implemented but not
recommended as the primary engine while its timestamp support is undocumented and its older
models are scheduled for shutdown.

Mitigations independent of the engine: the glossary (terms passed as hotwords/prompt and used
to normalise known variants), word-confidence flags, hallucination screening, audio playback of
every piece of evidence, and human correction with re-verification.

### 2.2 Speaker diarization

| Option | Accuracy (DER, lower is better) | Access | Deployment |
| --- | --- | --- | --- |
| **sherpa-onnx** (default): pyannote segmentation-3.0 ONNX + WeSpeaker ResNet34 embeddings + clustering | No Arabic DER published; segmentation is the same model as pyannote 3.x | Models on GitHub, **no account, no token** | Local CPU (ONNX Runtime), small |
| pyannote.audio 4.1.1 `speaker-diarization-community-1` (optional) | AMI-IHM 17.0, DIHARD3 20.2, VoxConverse 11.2 (3.1: 18.8 / 21.4 / 11.2) [official README] | Gated on Hugging Face: accept terms + `HF_TOKEN`; CC-BY-4.0 | Local, PyTorch (≈ 1 GB, `WITH_PYANNOTE=true`) |
| pyannoteAI precision-2 | AMI-IHM 12.9, DIHARD3 14.7 | API key; ≈ €0.10/h [snippet] | Cloud (enterprise self-hosting) |
| ASR provider's labels (Deepgram, Azure) | Provider-specific | With the ASR call | Cloud |

On this project's synthetic three-voice test (§10) the default clustering threshold merged two
voices at 0.5 and separated all three at 0.3–0.4, or when the number of speakers was given. The
default is 0.4, deliberately biased towards splitting: a wrong split is fixed by merging two
speakers in the interface; a wrong merge silently gives one person's words to another. Giving the
expected number of speakers at upload is better still.

Names are never inferred from voices. The analysis may suggest a name when the transcript itself
shows it ("أنا أحمد…", or someone addressed by name who answers) — shown as a hint, applied only
when a person confirms it.

## 3. The agents and how they exchange data

Each agent reads typed artifacts and writes one typed artifact (Pydantic models in
`backend/mahdar/pipeline/schemas.py`), validated before it is saved, versioned in `artifacts`
(encrypted). No agent reads another agent's free text; human corrections create new versions.

| # | Agent (module) | Reads | Writes | Model? |
| --- | --- | --- | --- | --- |
| 1 | Audio intake and quality (`pipeline/audio.py`) | original recording | `audio_quality`, blob `audio_normalized` | No (FFmpeg, Silero VAD) |
| 2 | Transcription (`pipeline/asr/`) | normalised audio, chunk plan, glossary | `asr_chunks` (resumable) | Speech model |
| 3 | Diarization (`pipeline/diarization/`) + alignment (`align.py`) | normalised audio, ASR words | `diarization`, then `transcript` (speaker-attributed) | Speaker models |
| 2b | Readable transcript (`readable.py`) | transcript, glossary | `transcript` (new version; verbatim kept) | Optional LLM, guarded |
| 4 | Semantic analysis (`analysis.py`) | transcript (verbatim, non-excluded segments), metadata, glossary | `analysis` (topics, items, name hints) | LLM |
| 5 | Evidence verification (`verification.py`) | transcript, analysis | `verification` (per-item checks, statuses, final types; document issues; coverage) | Rules + independent LLM audit |
| 6 | Minutes writer (`minutes.py: build_minutes`) | analysis, verification, reviewers' decisions | `minutes` (sections, blocks tied to item ids, tables) | LLM for wording only, guarded |
| 7 | Language reviewer (`minutes.py: review_language`) | minutes | `minutes` (revised wording, accepted/refused changes) | LLM, guarded + mechanical fixes |
| 8 | Documents (`documents/`) | minutes, transcript, verification | DOCX, PDF, evidence PDF, transcript PDF/TXT, summary PDF, CSV, JSON; `documents` (checks) | No |

**Agent 1.** ffprobe validation (extension, codec, duration, size limits), the original kept
untouched, a 16 kHz mono working copy (resampling, high-pass, dynamic normalisation — no change
in timing), EBU R128 loudness, peak, clipping ratio, Silero VAD speech ratio, an SNR estimate,
silences and long silences, and a chunk plan: cuts every ~10 minutes at the middle of the nearest
silence, each chunk extended by 2 s on both sides. Output: an Arabic quality report with issues.

**Agent 2.** Chunk by chunk (resumable): faster-whisper with VAD, word timestamps,
`condition_on_previous_text=False`, temperature fallback with compression-ratio and log-prob
thresholds, `hallucination_silence_threshold`, and a short Arabic prompt with the glossary terms.
Chunks are merged by splitting each overlap at its middle (every word kept from exactly one
side). Screening flags stock hallucinations ("اشتركوا في القناة", "ترجمة نانسي قنقر"…), repetition
loops, prompt echoes and text where the VAD heard no speech: flagged segments stay in the
verbatim transcript but are excluded from analysis. Words with probability < 0.4 and near-misses
of glossary terms become "uncertain terms". The **verbatim** text is never edited by a model;
the **readable** copy (2b) removes hesitations and repetitions, applies glossary spellings
(`إي بي آي` → `API`) and, with a model, punctuation — and a segment's model edit is refused if it
changes any number, explicit date, negation or term, or its length by more than about a third.

**Agent 3.** Turns from the diarizer; each word goes to the turn it overlaps most; segments split
where the speaker changes; one-word islands smoothed; overlap with another speaker flagged;
attribution confidence `high` only when ≥ 90 % of the words sit in one turn, the segment lasts
≥ 1.5 s and nobody else speaks at the same time.

**Agent 4.** Claude reads the whole speaker-attributed transcript (one call for most meetings;
windows of 220 segments over the same cached context for very long ones; a small local model gets
window-sized context). The prompt (`llm/prompts.py`) defines the item types strictly —
discussion, proposal, recommendation, objection, concern, tentative agreement, **approved
decision only with explicit approving words**, rejected decision, **assigned action only with an
explicit, accepted owner**, suggested action, risk, blocker, dependency, open question, deferred,
contradiction — and requires every item to quote the exact words of the segments it rests on.
"When in doubt choose the weaker type and require confirmation."

**Agent 5** — §5. **Agents 6–7** — see the rules in `minutes.py`: section placement and the
decisions/actions tables are decided by code from verified items; the model words blocks, and
each block is re-checked. **Agent 8** — DOCX: section, paragraph and run direction, complex-script
fonts, English terms in separate LTR runs, tables `bidiVisual` with fixed grid widths, repeated
header rows, page *x* of *y*, classification header; reopened and checked (`check_docx`). PDF:
WeasyPrint with Noto Naskh/Kufi Arabic; checked that every font is embedded, no fallback font was
used, ≥ 90 % of the source words are found in the PDF text, and pages are not blank; pages are
rendered to images for inspection and offered as previews in the interface.

## 4. JSON schemas

The authoritative definitions are the Pydantic models in `backend/mahdar/pipeline/schemas.py`
(and, for the model-facing contracts, the JSON Schemas in `llm/prompts.py`, enforced with
structured outputs). Abridged examples:

**Transcript segment** (`Transcript.segments[]`)
```json
{"id": "S0007", "start": 67.6, "end": 84.1, "speaker_id": "SPK_1", "speaker_confidence": "high",
 "text_verbatim": "إذن تقرر اعتماد ميزانية المرحلة الأولى بمبلغ مليونين وأربعمائة ألف جنيه…",
 "text_readable": "إذن، تقرر اعتماد ميزانية المرحلة الأولى بمبلغ مليونين وأربعمائة ألف جنيه…",
 "words": [{"w": "إذن", "start": 67.6, "end": 67.9, "p": 0.98, "speaker_id": "SPK_1"}],
 "avg_logprob": -0.12, "no_speech_prob": 0.01, "flags": [], "uncertain_terms": [], "excluded": false,
 "readable_source": "llm"}
```

**Item** (`Analysis.items[]`, produced by Agent 4)
```json
{"id": "I004", "type": "action_assigned", "topic_id": "T2",
 "statement": "يتولى الأستاذ خالد إرسال تقرير التدفق النقدي الشهري إلى أعضاء اللجنة.",
 "speaker_ids": ["SPK_1"],
 "owner": {"name_as_spoken": "الأستاذ خالد", "speaker_id": null, "status": "explicit"},
 "due": {"text_as_spoken": "قبل العشرين من ديسمبر", "date_iso": "2026-12-20", "status": "explicit"},
 "qualifications": [], "evidence": [{"segment_id": "S0009", "quote": "وأطلب من الأستاذ خالد إرسال تقرير التدفق النقدي الشهري"}],
 "approval_evidence": [], "requires_confirmation": false, "confidence": "high", "notes": null}
```

**Item verification** (`VerificationReport.items[]`, Agent 5)
```json
{"item_id": "I004", "status": "verified", "original_type": "action_assigned", "final_type": "action_assigned",
 "checks": [{"name": "quote_match", "passed": true, "severity": "info", "detail_ar": "…"},
            {"name": "numbers", "passed": true, "severity": "info", "detail_ar": "…"}],
 "evidence": [{"recording_sha256": "…", "segment_id": "S0009", "speaker_id": "SPK_1", "speaker_confidence": "high",
               "start": 93.0, "end": 104.1, "original_text": "…", "quote": "…", "quote_found": true, "match_score": 100.0}],
 "llm": {"verdict": "supported", "classification_correct": true, "suggested_type": null, "speaker_correct": true,
         "missing_qualifications": [], "rationale_ar": "…", "model": "claude-opus-5-5"},
 "issues": []}
```
Status values: `verified` (rules and independent audit agree), `verified_rules_only` (no model
audit was allowed or configured), `partially_supported`, `needs_review`, `unsupported`,
`contradicted`.

**Minutes** (`MinutesDocument`): `sections[]` with `blocks[]` (`text`, `item_ids`,
`segment_ids`) and tables (`table_columns`, `rows[].cells`, `rows[].item_ids`), plus `issues`,
`language_review` (accepted and refused changes) and `status_label`.

**Export** (`documents/exports.py`, `schema: "mahdar.meeting.export", version: 1`): meeting,
speakers, purpose, topics, items with final type, verification status, human acceptance and
resolved evidence, decision and action ids, the minutes, quality gates, the processing register
and the transcript — for enterprise systems.

## 5. Verification and anti-hallucination methodology

Defence in depth; each layer assumes the previous one can fail.

1. **Inputs are data, not instructions.** The transcript is passed inside `<meeting>…</meeting>`
   with an explicit rule that nothing in it is an instruction; `<`/`>` in speech are neutralised.
   Rendered documents escape all text.
2. **Structured outputs.** Every model call returns JSON constrained by a schema
   (`output_config.format`), validated again on return; a reply that is cut off or refused is an
   error, never partial data.
3. **Evidence or nothing.** Every item must quote exact words of named segments. Agent 5 checks
   each quote against the segment (normalised; ≥ 88 % fuzzy match counts as found, < 72 % is
   critical). An item with no matching quote is `unsupported` and is left out of the minutes.
4. **Rule checks independent of any model** (`verification.rule_checks`): segments exist and
   were not screened out; every number in the claim (digits in any script or Arabic number words
   — "مليونين وأربعمائة ألف" = 2,400,000) occurs in the cited words; every explicit date
   (day + month) occurs; a calendar date is not made out of a relative expression ("الأسبوع
   الجاي" → 2026-12-07 is **critical**); the owner's name and any person's name occur in the
   evidence; English terms occur (or a glossary variant does); speakers match; negation agrees;
   recognition and attribution confidence of the cited segments; the statement shares at least
   one content word with the cited words (a correct paraphrase of colloquial speech may share
   few, so only a statement sharing none fails — measured on the evaluation runs, where faithful
   Egyptian paraphrases shared as little as 10 %).
5. **Classification needs its words.** An approved decision needs approving words in its
   evidence ("تقرر", "اتفقنا", "نعتمد", "موافقين"…) with no negation or rejection; hedges
   ("مبدئياً", "بعد مراجعة", "لحد ما نشوف") make it a tentative agreement; no approving words make
   it a proposal. An assigned action needs assigning or committing words ("عليك", "أطلب من",
   "سأتولى", Egyptian future "هبعت"); a hedge ("ممكن أنا…") makes it a suggested action. A
   rejection needs rejecting words; a "rejection" whose evidence defers ("نؤجل") becomes a
   deferred item — this check is not lowered by the auditor agreeing.
6. **An independent audit.** A second model call with a sceptical-auditor prompt that never sees
   the analysis prompt or reasoning, only the transcript and the claims, judges support,
   classification, speaker, owner, deadline, missing conditions, and lists omissions. It can only
   weaken: a weaker suggested type is applied; a stronger one becomes an issue for a person; an
   item it finds unsupported or contradicted is kept out of the minutes (still shown for review,
   with the auditor's reason, and in the evidence report) until a person accepts it.
   (A second model pass alone is not treated as verification: the rule checks run regardless and
   both must pass for `verified`.)
7. **Omissions.** Uncited segments containing approving, rejecting, assigning or committing
   words are listed as potential omissions; uncited numbers and dates as minor issues; the
   auditor's omissions as critical for decisions and assignments.
8. **Contradictions.** Items typed `contradiction` and actions with the same owner or wording but
   different deadlines are listed for a person.
9. **Writing cannot add facts.** Placement and tables are code; each written block is checked for
   numbers, dates, terms, names, speaker labels (digits or ordinal words: "المتحدث الثاني"),
   leftover JSON or markup, decision wording on non-decisions and new negation, and replaced by a
   rule-written sentence if it fails. The language reviewer's revisions are refused when the fact
   signature (numbers, dates, terms, negation, decision and tentative wording, names, labels,
   markup) changes. A speaker label written as an owner's name is kept as that speaker, whose name
   comes only from the reviewer's confirmation.
   Prompts contain no sentence from the evaluation recordings (a test enforces it): a small model
   was observed copying a prompt example into another meeting's minutes.
10. **Status and gates.** Critical issues stay open until a person accepts, corrects or rejects
    the item; any open critical issue or failed gate labels the document **"مسودة تتطلب
    المراجعة"**. Nothing is ever marked approved automatically: "reviewed" needs a person to
    complete the review, "approved" needs a user with the approver role, and is refused while a
    critical issue is open.
11. **Replay.** Every piece of evidence, flagged segment and omission has a play button
    (server-side decrypted excerpt).

## 6. User interface workflow

1. **Upload** (title, date, place, times, preparer, classification, expected number of speakers,
   attendees). The file is validated before it is accepted.
2. **Processing** tab: stage list with progress, audio quality report, quality gates, and the
   processing register (which provider processed which data, local or external).
3. **Transcript**: readable/verbatim toggle, filter to flagged segments, search, per-segment
   playback, correction with a mandatory reason (audited).
4. **Speakers**: anonymous speakers with sample excerpts; enter names and titles, confirm, merge
   two speakers; name hints from the transcript shown as suggestions only.
5. **Items and decisions**: items grouped (decisions, actions, proposals, risks, pending,
   discussion) with verification status, reclassification, failed checks, the auditor's
   rationale, every evidence quote with playback and a jump to the transcript; accept, correct
   (statement, type, owner, deadline) or reject; document-level issues resolved one by one.
6. **Minutes and export**: an on-screen preview; edit a paragraph's wording (kept across
   regenerations, still checked); regenerate, re-verify after transcript corrections, or
   re-analyse; complete the review; approve (approver role); download each output; preview PDF
   pages as images. Any later change — to the transcript, speakers, items, issues, wording or
   meeting data, or a regeneration — withdraws the review and the approval (audited), so an
   approved document can never carry content its approver did not see; approval recomputes the
   quality gates from the current data rather than trusting stored flags.
7. **Audit log** per meeting; **settings**: glossary, privacy policy, retention, quality gates,
   document branding, users and roles.

## 7. Operational costs and cost drivers

Estimates per **hour of meeting**; assumptions stated so they can be replaced with measured
values (`usage` in the `documents` artifact records the real tokens of every run).

*Transcript size*: ~8,000 spoken words/hour ≈ 20–25K tokens of Arabic, ≈ 30–35K tokens with
segment ids, times and speaker labels. *Claude Opus 5.5*: $4 / M input, $20 / M output, cache
reads $0.20 / M (pricing page, read 2026-11-28).

| Stage | Input | Output (incl. thinking, rough) | Cost |
| --- | --- | --- | --- |
| Readable copy (optional) | ~35K | ~30–45K | $0.75–1.05 |
| Analysis | ~38K (cache write) | ~15–30K | $0.50–0.80 |
| Independent audit | ~40K (≈ 35K from cache) | ~10–20K | $0.25–0.45 |
| Writing + language review | ~20K | ~12–20K | $0.30–0.50 |
| **Total, Claude** | | | **≈ $1.8–2.8 per meeting hour** (≈ $1.0–1.8 without the model-written readable copy) |

Speech: local faster-whisper costs compute only — on 4 CPU cores large-v3 ran at ≈ 1.4× real
time in this project's tests (an hour of audio ≈ 85 min); a single modern GPU is typically one to
two orders of magnitude faster. Cloud alternatives: ≈ $0.26–0.36 per audio hour (Deepgram, Azure,
OpenAI; §2.1). Storage and database are negligible next to these.

**Drivers**: meeting length (linear); output tokens (the readable copy is the largest — use the
rule-based copy, or a cheaper model for that stage); effort level (`MAHDAR_LLM_EFFORT`); re-runs
after review (writing-only regeneration is cheap; re-analysis is not); GPU vs CPU for speech;
and the largest real cost — **reviewer time**, which the evidence links, playback and
issue-focused review are designed to reduce.

## 8. Implementation plan and status

| Phase | Content | Status |
| --- | --- | --- |
| 0 | Docker image, Compose stack, CI workflow, Dependabot (done first, at the user's request) | Done |
| 1 | Research, architecture, schemas, methodology (this document) | Done |
| 2 | MVP: upload, intake, transcription, diarization, analysis, verification, writing, review, DOCX/PDF | Done; Claude path not exercised live (§12) |
| 3 | Review experience: transcript and speaker correction, item review, minutes editing, playback, previews | Done |
| 4 | Production readiness: RLS, encryption, retention, audit, roles, rate-limited login, logging without content, health checks, resumable jobs, tests, evaluation harness, operations guide | Done in code; see §12 for what still needs real infrastructure |
| Next | Arabic-specialised ASR adapters (Jais-ASR / AURA / Cohere Arabic) evaluated on the organization's own recordings; a human-reviewed evaluation set of real meetings; DOCX font embedding; SSO (OIDC); per-stage model choice | Proposed |

## 9. Technical risks

| Risk | Effect | Mitigation |
| --- | --- | --- |
| Whisper's Egyptian / code-switching error rate (§2.1) | Wrong words → wrong facts | Replaceable ASR, glossary, uncertain-term flags, evidence playback, transcript correction + re-verification, evaluation on own data |
| A dropped negation or hedge in recognition ("مدئيا" for "مبدئياً" was observed) | A tentative statement read as final | Approval rules on evidence, independent audit, critical issues, playback |
| Diarization merges or splits voices | Wrong attribution or owner | Expected speaker count, splitting bias, attribution confidence, merge in the interface, owner names only from words |
| Model invents or overstates | Fabricated decisions | §5 (evidence, rules, audit, guards, gates, human approval) |
| Very long meetings | Context and output limits | Windowed analysis over cached context; chunked transcription |
| Fonts missing on the reader's machine (DOCX) | Substituted fonts in Word | PDF is the print-ready reference; DOCX uses Noto Naskh/Kufi Arabic (installable); font embedding is on the roadmap |
| External processing of confidential audio | Data leaves the organization | Off by default; installation allow-list + organization policy per data kind + classification ceiling; processing register |
| CPU-only deployments | Slow processing | GPU for speech; queue with progress and resumable stages |

## 10. Accuracy evaluation

`python -m mahdar.cli evaluate` scores processed runs against `evaluation/` and reports each
dimension separately (`mahdar/evaluation/metrics.py`):

| Dimension | Metric |
| --- | --- |
| Transcription completeness | WER and CER on normalised Arabic (verbatim and readable), segments excluded |
| Speaker attribution | time-weighted accuracy under the best speaker mapping; speakers found vs expected |
| Decisions | precision/recall of approved decisions; **invented decisions**; "not a decision" violations |
| Action items | precision/recall of assigned actions; suggested actions; owner accuracy |
| Hallucination rate | (unsupported or contradicted items + invented decisions) / items |
| Evidence coverage | items whose quote matches the transcript |
| Dates and numbers | expected numbers matched; numbers in the minutes never spoken |
| Arabic language quality | colloquial words left in the minutes; blocks replaced; language edits refused |
| Rendering | DOCX and PDF checks |

The dataset's references are written by people, never generated by the system: hand-written
scenarios (formal MSA with decisions; Egyptian discussion with proposals and no decision;
technical code-switching with a contradiction, a tentative date and an overlap; financial with
amounts, a rejection and a counter-proposal) and a noise-degraded copy, spoken by a TTS voice
turned into distinct voices; plus real human Egyptian read speech (FLEURS ar_eg, CC BY 4.0) for
recognition. **Synthetic speech is not natural conversation**: an organization must add its own
recorded meetings, transcribed and annotated by people, before trusting the numbers —
`evaluation/README.md` explains the format. Results: `docs/EVALUATION.md`.

## 11. Privacy and security

| Data | Where it is processed | Leaves the server? |
| --- | --- | --- |
| Audio | FFmpeg, faster-whisper, sherpa-onnx (local) | Only if the ASR provider is a cloud one **and** the installation and the organization allow it for audio, within the classification ceiling |
| Transcript | Rules (local); LLM (Claude or a local server) | Only to an allowed LLM provider for "transcript" data, within the ceiling |
| Minutes, reports | Local | No |

* Encryption in transit: HTTPS through Caddy (`--profile tls`), HSTS, Secure cookies; the API
  binds to localhost by default.
* Encryption at rest: AES-256-GCM with key ids; the associated data binds each value to its
  organization, meeting, kind and version, so a ciphertext copied to another row does not decrypt.
  There is no silent fallback to a previous key. Key rotation (`rotate-data-key`). Database volume
  encryption is recommended in addition.
* Isolation: PostgreSQL row-level security (FORCE) on every content table; the API and worker
  connect as `mahdar_app` (no BYPASSRLS); tested.
* Access: roles (viewer, editor, approver, admin); Argon2id passwords; lockout after 5 failures
  (counted atomically); a password reset revokes the user's sessions; uniform login errors; CSRF
  header; strict CSP; no CORS; the API reference is off in production unless `MAHDAR_API_DOCS=true`.
* Authorization of external processing is re-read from the database before every external call
  and every audio chunk, so a withdrawn permission or a raised classification stops a running job;
  lowering a classification requires an approver.
* Untrusted input: uploads need a session, the CSRF header and a declared length before the body
  is read; FFprobe must report an allowed container, and FFmpeg/FFprobe may read local files only
  (`-protocol_whitelist`), so playlists or concat files cannot reach other files or the network;
  the PDF renderer fetches `data:` URLs only.
* Retention per organization and kind of data, over every meeting; deletion of a meeting removes
  its files and content (refused while it is being processed); the audit trail stays, and its
  encrypted before/after details are removed together with the content they quote.
* Logs: JSON, identifiers and counts only; a redaction filter masks e-mail addresses, keys and
  Arabic text.
* Audit trail of every human action with before/after values (encrypted), and of every agent run.
* Local-only deployments: faster-whisper + sherpa-onnx + `MAHDAR_LLM_PROVIDER=openai_compatible`
  on the organization's network (vLLM, llama.cpp, Ollama).

## 12. What has and has not been verified

Verified in this repository's environment (details in `docs/EVALUATION.md`):
* faster-whisper large-v3 and small, sherpa-onnx diarization, the alignment and the whole pipeline
  on the evaluation recordings; 97 backend tests (anti-fabrication rules, documents, API with
  row-level security on a real PostgreSQL, isolation with RLS bypassed, no evaluation sentence in
  any prompt) + 4 model tests on real recordings + 5 interface tests; ruff, ESLint, TypeScript,
  pip-audit and npm audit clean.
* The OpenAI-compatible local path end to end with a small local model (Qwen3-4B on CPU).
* The Docker image (build, self-check of fonts and rendering, production configuration guard,
  unprivileged user) and the Compose stack: migrations create `mahdar_app`, the API and worker run
  under it (checked: the role cannot bypass RLS), an upload through the API was transcribed and
  diarized by the containerised worker and stopped, as designed, at "awaiting authorization" with
  no language model configured.
* DOCX and PDF rendering, inspected visually (pages rendered to images, the DOCX through
  LibreOffice) and by the automatic checks; the interface, inspected in a browser.

Not verified here, and why:
* **Claude** (`anthropic` provider): implemented with the official SDK and structured outputs, but
  no API key was available to this build, so no live call was made. Run the `pipeline` CI job
  with an `ANTHROPIC_API_KEY` secret, or `process-file` locally, before relying on it.
* **OpenAI, Deepgram, Azure** speech providers: implemented against their REST APIs; no keys.
* **pyannote**: needs a Hugging Face token and accepting the model's terms.
* **Real recorded meetings**: the dataset is synthetic speech plus read speech; real meetings
  annotated by people are required for meaningful accuracy figures.
