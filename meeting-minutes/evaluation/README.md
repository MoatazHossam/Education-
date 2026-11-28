# Evaluation dataset

References here are written by people. The system's own output is never used as ground truth.

| Recording | What it tests | Speech | Reference |
| --- | --- | --- | --- |
| `s1_formal_decisions.mp3` | MSA steering meeting: two explicit decisions, two assignments (one explicit date, one relative), a condition stated before a decision, a deferred proposal | Synthetic (TTS), 3 voices | `scenarios/s1_formal_decisions.json` |
| `s1_formal_decisions_degraded.mp3` | The same with café-like noise, telephone bandwidth, 24 kbit/s | Synthetic, degraded | same |
| `s2_egyptian_no_decision.ogg` | Egyptian discussion: proposals, concerns, a hedged volunteer, deferral, **no decision**, no names | Synthetic, 3 voices | `scenarios/s2_egyptian_no_decision.json` |
| `s3_technical_codeswitch.mp3` | Egyptian + English terms (ERP, API, SAP, SLA, KPI, Dynamics 365), a contradiction about a deadline, a provisional date, a target that is explicitly not a decision, an overlapping interjection | Synthetic, 3 voices | `scenarios/s3_technical_codeswitch.json` |
| `s4_financial.m4a` | Amounts and percentages, a counter-proposal approved, a rejected proposal, an explicit deadline | Synthetic, 2 voices | `scenarios/s4_financial.json` |
| `fleurs_ar_eg.mp3` | Recognition on real human Egyptian read speech (16 FLEURS dev utterances) | Real, CC BY 4.0 (Google FLEURS) | `recordings/fleurs_ar_eg.reference.json` |

Each `*.reference.json` holds the reference segments (speaker, start, end, text) with exact times.
Each scenario lists the expected items by category (`decisions_approved`, `actions_assigned`,
`actions_suggested`, `proposals`, `deferred`, `tentative`, `contradictions`, `decisions_rejected`)
and the things that must **not** become decisions (`not_decisions`). An extracted item matches an
expected one when every keyword, number and date of the expected entry occurs in the item's
statement or evidence.

## Limits of this dataset

The scenario recordings are synthetic speech from one TTS voice turned into several by pitch and
timbre shifts: they test the meeting logic with a known answer, not recognition of natural
conversation, and the shifted voices are closer to each other than real people (two of them were
confused by diarization). FLEURS is real speech but read, single-speaker and female-only for
Egyptian Arabic, so it carries no speaker ground truth.

## Adding your own meetings (needed before trusting the numbers)

1. Put the recording in `recordings/<id>.<ext>`.
2. Write `recordings/<id>.reference.json`: `{"id", "source", "segments": [{"speaker", "start", "end", "text"}]}` — transcribed by a person, verbatim.
3. Write `scenarios/<id>.json` with `meeting` (title, date, expected_speakers), `glossary`, and `expected`, annotated by a person who attended or reviewed the meeting.
4. Process and score:

```bash
python -m mahdar.cli process-file recordings/<id>.mp3 --meta meta.json --glossary glossary.json --out runs/<id>
```

```bash
python -m mahdar.cli evaluate --results runs --dataset evaluation --out report.json
```

Score each dimension separately (transcription, speakers, decisions, actions); a single number
hides the failures that matter.

`build_recordings.py` regenerates the synthetic recordings (needs `piper-tts` and the
ar_JO-kareem voice).
