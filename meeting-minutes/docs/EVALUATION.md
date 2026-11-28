# Mahdar — evaluation results

Measured on 2026-11-28 in the build environment (4 CPU cores, 15 GB RAM, no GPU) with
`python -m mahdar.cli process-file` and scored by `python -m mahdar.cli evaluate` against the
human-written references in `evaluation/` (see `evaluation/README.md` for what each recording
tests and the limits of the dataset). Re-run them; do not quote these numbers for a different
deployment, and do not treat them as accuracy on real meetings.

**Engines used.** Speech: faster-whisper `large-v3` (int8, CPU). Speakers: sherpa-onnx
(pyannote segmentation-3.0 + WeSpeaker ResNet34), expected speaker count given at upload.
Language model: **not Claude** — no API key was available to this build — but a small local model
(Qwen3-4B-Instruct, Q4_K_M, through llama-cpp-python's OpenAI-compatible server), the
"nothing leaves the network" path. It is far weaker than Claude at Arabic and at following the
extraction rules, which makes these runs a test of the safeguards rather than of extraction
quality.

## 1. Transcription and speakers

| Recording | Speech | WER | CER | Speaker attribution | Speakers found / expected |
| --- | --- | --- | --- | --- | --- |
| s1 formal decisions (MSA) | synthetic, 3 voices | 4.8 % | 3.0 % | 91.8 % | 3 / 3 |
| s1, noise + 8 kHz + 24 kbit/s | synthetic, degraded | 4.8 % | 3.0 % | 76.1 % | 3 / 3 |
| s2 Egyptian, no decision | synthetic, 3 voices | 7.8 % | 1.5 % | 67.4 % | 3 / 3 |
| s3 technical, code-switching | synthetic, 3 voices | **30.1 %** (readable copy 24.8 %) | 21.7 % | 93.5 % | 3 / 3 |
| s4 financial (M4A) | synthetic, 2 voices | 5.7 % | 1.4 % | 96.9 % | 2 / 2 |
| FLEURS ar_eg (16 utterances) | **real human read speech** | 7.9 % | 2.4 % | — (no ground truth) | — |

Speed: large-v3 transcribed at roughly 1.4× the recording's duration on 4 CPU cores; diarization
took 15–35 s per recording.

Reading the numbers:

* **Code-switching is the weak point**, as the published benchmarks predicted (Whisper large-v3:
  58 % WER on ArzEn, 34 % on MGB-3; ARCHITECTURE §2.1). In s3 the English terms, pronounced the
  Egyptian way, came out as "الإسئل إياه" (SLA), "داينمت" (Dynamics), "تبديد لينو" ("طيب
  الديدلاين"). The glossary variants recover some of them in the readable copy (WER 30.1 → 24.8 %);
  the rest are flagged as uncertain terms. This is the strongest argument for evaluating an
  Arabic-specialised engine on the organization's own recordings.
* **Recognition errors that change meaning occur even at low WER.** In s2, "بس مش هقدر" (but I
  can't) was recognised as "بسمشها قدر" — the negation is gone; in s3, "مبدئياً" (provisionally)
  became "مدئيا". These are why every piece of evidence has a play button and why the approval
  rules look for hedges in the cited segments.
* **Speaker attribution** depends on how different the voices are. The synthetic voices are one
  TTS voice shifted in pitch; in s2 two of them differ by a 7 % shift and were confused (67 %).
  The noisy copy of s1 dropped from 92 % to 76 %. Real, different people are usually easier to
  separate; this must be measured on real meetings.
* **The degraded copy was milder than intended**: its measured SNR was 24 dB (the intake reported
  quality "مقبولة" and a low sample rate), not the ~8 dB aimed for; large-v3 lost only punctuation.
  A harder noisy condition should be added.

## 2. Meeting analysis and verification (local 4B model)

### s2 — Egyptian discussion, proposals, a hedged volunteer, no decision

| Measure | Result |
| --- | --- |
| Approved decisions extracted (expected 0) | **0** — no invented decision, no "not a decision" violation |
| Proposals (expected 2) | 2 / 2 |
| Suggested action — the hedged "ممكن أنا أكلمهم" (expected as suggested, not assigned) | 1 / 1, typed `action_suggested` |
| Deferral (expected 1) | found (plus two more deferral items) |
| Concerns (training, Arabic support; expected 2) | 0 / 2 as concerns — the model typed them as discussion and question |
| Items with a quote that matches the transcript | 10 / 10 (100 %) |
| Verification statuses | 6 verified, 2 partially supported, **2 contradicted** |
| Hallucination rate (unsupported or contradicted items + invented decisions, over items) | 0.20 — both items were caught and flagged, none reached the decisions or actions tables |
| Minutes status | «مسودة تتطلب المراجعة» (4 possible omissions open) |
| DOCX / PDF / evidence / transcript checks | all pass (after the fixes below) |

The two contradicted items were a "contradiction" the model invented between a volunteer's
timing and the deferral, and a deferral stated more strongly than the words; the independent audit
(the same local model under the auditor prompt) and the rules both rejected them. The rules also
flagged a number in an item that did not occur in its evidence. Three omissions reported by the
audit and one by the rules (an uncited segment with approving words) were listed for the reviewer.

### s1 — formal meeting with two decisions and two assignments

See §5 (filled in when the run completes).

## 3. What the end-to-end runs found and changed

Running the whole system on these recordings, rather than only unit tests, found problems that
were then fixed (each fix has a test):

| Found | Fix |
| --- | --- |
| The development server, connected as a database superuser, showed one organization's meeting to another's administrator: isolation relied on row-level security alone, and the Compose stack ran the API as the owner | Every repository query filters by the transaction's organization; the API and worker run as `mahdar_app`; production refuses a role that bypasses RLS; test with RLS bypassed |
| Speaker labels ("المتحدث 2") written by the model reached the minutes; unchecked topic summaries were printed | Labels replaced by confirmed names or "أحد الحاضرين"; summaries shown only if they pass the block check |
| Section numbers skipped when a section was absent; a meeting without decisions said nothing about decisions | Sequential numbering; the decisions section states that no approved decision was taken |
| ✓/✗ in the evidence report fell back to a non-Arabic font (caught by the rendering check, which kept the minutes in "requires review") | Words instead of symbols |
| Failed logins were not counted (the error rolled back the counter's transaction) | Counter committed separately; test |
| Number words with "ئ" ("أربعمائة"), duals ("مليونان"), ordinals and day words in dates ("الخامس عشر", "العشرين من ديسمبر") were not read; "أطلب من" was not an assignment | Lexicons normalised and extended; tests |
| Compose passes unset settings as empty strings; the API refused them | Empty variables count as unset |
| The worker kept Whisper (several GB) loaded after transcription; with a local LLM on the same machine the system ran out of memory | The model is released after transcription unless `MAHDAR_WHISPER_KEEP_LOADED=true` |

### Independent security review

A separate read-only review of the API, data access, privacy and encryption code found no
cross-organization access path, and these defects, all fixed with tests:

| Severity | Finding | Fix |
| --- | --- | --- |
| High | Approved minutes could be edited and re-issued as "approved" under the approver's name | Any change (transcript, speakers, items, issues, wording, meeting data, regeneration) withdraws review and approval, audited; "approved" requires the recorded approval, the review and every gate; approve recomputes the gates from current data |
| Medium | "Reviewed" survived re-analysis and later changes; approve trusted cached columns | Same withdrawal; re-analysis clears review and approval |
| Medium | Parallel wrong passwords each counted once (read-then-write) | Atomic increment |
| Medium | Audio excerpts: no cleanup of the decrypted recording on failure; `inf`/`nan` bounds | try/finally cleanup; finite, ordered, in-range bounds |
| Medium | Retention reached only the 500 newest meetings | Unlimited retention query |
| Medium | An editor could lower a classification to unlock external processing; authorization read once per job | Lowering needs approver/admin; authorization re-read before every external call and every audio chunk |
| Low–medium | Password reset kept existing sessions; deletion during a running job could orphan files | Sessions revoked; deletion refused while running; storage cleaned if the database insert fails |
| Low | Audit details kept content after retention/deletion; a user's free-text reason in a plaintext column | Details purged with the content; reasons only in encrypted audit details |
| Low | Container type not checked (playlists/concat could make FFmpeg read other files) | FFprobe container allow-list; FFmpeg/FFprobe read local files only (`-protocol_whitelist`) |
| Low | Anonymous multipart bodies reached the disk; chunked uploads skipped the size check | Uploads need a session cookie, the CSRF header and a declared length before the body is read |
| Low | Login and user-creation messages revealed which accounts exist; raw errors shown to users | Uniform messages; only the Arabic stage message is shown |
| Hardening | Ciphertext bound only to row id; silent fallback to a previous key; PDF renderer could fetch URLs; CSS strings not escaped; API docs public in production; request id echoed unvalidated; upload in two transactions | AAD binds organization, meeting, kind and version; no current key means no keyring; WeasyPrint fetches `data:` only; CSS escaping; docs only with `MAHDAR_API_DOCS=true` in production; request id validated; upload in one transaction with file cleanup |

Residual: audit details share one associated-data context per organization (a database writer
could swap two audit rows' details); one data key covers all tenants; the same approver may both
complete the review and approve (separation of duties is an organizational policy option to add).

## 4. Not measured here

* **Claude** — the default reasoning and writing engine — was not called (no key). Run the CI
  `pipeline` job with an `ANTHROPIC_API_KEY` secret, or `process-file` with
  `MAHDAR_LLM_PROVIDER=anthropic`, and score with `evaluate` before relying on it.
* Real recorded meetings (natural conversation, real overlap, real rooms): add them as described in
  `evaluation/README.md`; the synthetic set cannot stand in for them.
* Cloud speech engines and pyannote (no keys or tokens).

## 5. s1 extraction results

Pending.
