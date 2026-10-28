# Production status

State on 2026-10-28. **For the official release the narration will be recorded by an Egyptian narrator in formal
MSA (the owner's choice). The recording pack is ready, the recordings drop in through `ingest.mjs`, and the films
are rebuilt from them.** The current files carry a synthetic guide voice and serve for review only. Nothing has been
published.

## Deliverables

| Deliverable | Status |
| --- | --- |
| PRODUCT_AUDIT.md, TARGET_AUDIENCE.md, VIDEO_CREATIVE_BRIEF.md | Done |
| FEATURE_COVERAGE_MATRIX.md | Done (generated): 52 capabilities, 42 available now, 5 in development, 5 future roadmap |
| STORYBOARD.md, SCENE_BY_SCENE_PRODUCTION.md | Done (generated) |
| ARABIC_NARRATION_SCRIPT.md | Done: 20-minute (134 lines) and 3-minute (28 lines), fully diacritized. Third review on 2026-10-28 by four independent reviewers, every ending checked against its i'rab: no error in the diacritics; ten wording changes for strict readers applied (e.g. «فَرُبَّمَا لَا» for «فَقَدْ لَا», «تُفْتَحُ بَوَّابَةُ», «فِي أَثْنَاءِ», «دَفْعَةً وَاحِدَةً», the main clause before «حَتَّى لَوْ») |
| Narrator_Recording_Pack.pdf, NARRATOR_RECORDING_PACK.md | Done: 41 pages; reading style (formal Egyptian MSA), recording specification, file names and delivery, English terms, every line with full tashkeel, length, hamzat al-wasl joins and reading notes |
| ENGLISH_TRANSLATION.md | Done |
| arabic.srt, arabic-plain.srt, english.srt (+ the 3-minute set) | Done; re-timed automatically from the narrator's takes |
| Recordings of the product | Done: 54 recordings, 538 frames (kept out of git; `npm run capture` recreates them) |
| screenshots/, graphics/, Education_SaaS_Thumbnail.png | Done |
| Music | Rebuilt on recorded instruments (piano, strings, cello, harp, celesta, pad, bass, soft percussion; FluidR3 soundfont, MIT); awaiting the owner's listening approval |
| **Narration** | **Waiting for the Egyptian narrator's recordings** (about 19 minutes of reading, about two hours in the studio) |
| Films with the narrator's voice (20-minute 4K and 1080p, 3-minute 1080p) | Rebuilt as soon as the recordings arrive (`ingest.mjs`, then three builds and QA) |
| Films with the guide voice (…_20min.mp4, …_1080p.mp4, …_3min.mp4) | For review only: synthetic voice (Jordanian accent, licence unconfirmed) |
| VIDEO_QA_REPORT.md | Done for the guide-voice files; repeated on the final films |

## The narration voice

- **Final voice:** an Egyptian narrator, formal MSA, recorded from `Narrator_Recording_Pack.pdf`. Recordings go to
  `audio/recorded/<cut>/` (or a shared Google Drive folder): one file per line, or one per scene with pauses between
  lines. `node ingest.mjs all` splits, cleans (rumble filter, noise reduction only if needed, de-essing, gentle
  compression), keeps natural breaths and decays, and reports clipping, noise and pace; the speech-recognition
  check catches a misread or misplaced line.
- **Pauses:** 0.8 s of silence after every sentence, 0.45 s after a colon or comma, as the timeline places the lines.
- **Guide voice (until then):** `ar_JO-kareem-medium` (Piper) fed phonemes from our own reading rules
  (`audio/arabic_g2p.py`), because espeak-ng, the usual front end of open voices, mispronounces diacritized Arabic
  (vowels lost after shadda, hamzat al-wasl ignored, waw and ya misread, no pausal forms). Azure (which has Egyptian
  voices) is blocked in this environment and has no key; the other open Arabic voices are non-commercial or far less
  intelligible.

## Other open points

| Point | Needed from |
| --- | --- |
| Book the Egyptian narrator and send the recordings (pack: Narrator_Recording_Pack.pdf) | Owner |
| Listening approval of the new score (review cut sent), or a licensed track to replace it | Owner |
| Real contact details or a link for the end card ("Contact us…") | Owner |
| Wise EduAgent could not be inspected (network policy); the video shows the AI only as labelled future vision | Owner: allow the host and provide a test account, or the source export, if Wise features should appear |
| Authorization to publish, and where | Owner — the files are private until then |

## Rebuilding

See video-project/README.md. The renderer resumes an interrupted render: re-running the same command
reuses the finished parts.
