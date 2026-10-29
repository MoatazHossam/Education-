# Production status

State on 2026-10-29. **The three films are finished under the platform's name, Midad (مِداد): 20-minute 4K and
1080p (21:09), 3-minute 1080p (3:06).** At the owner's instruction («قم أنت باصدار الفيديو و أتم العمل بشكل كامل»)
they carry the synthetic narration voice, with the recorded-instrument score and full pauses at the end of every
sentence. The Egyptian narrator's recordings could not be reached from the production environment (below); the
recording pack and the ingest stay ready, so the films can be rebuilt with a human voice at any time. Nothing has
been published.

**The rename (2026-10-29).** The owner chose the name Midad (مِداد). The films were rebuilt with it:
- **Narration:** new takes for the four lines that say the name.
  - 20-minute cut: the reveal «نُقَدِّمُ لَكُمْ مِنَصَّةَ مِدَادٍ» and the closing line.
  - 3-minute cut: its reveal and closing lines.
  - The reveal was generated six times and the take that speech recognition heard exactly was kept.
- **On screen:** the logo scene, the diagram, the titles, the subtitles and the narrator pack.
- **Product recordings:** recorded again from the renamed application.
- **Lengths:** the new reveal line is shorter, so the 20-minute cut lost 2.3 s and the 3-minute cut 1.4 s.

**Before sending the films to official bodies, read "Open points": the voice's licence is not confirmed, and
neither the voice nor the music has been listened to by a person.**

## Deliverables

| Deliverable | Status |
| --- | --- |
| PRODUCT_AUDIT.md, TARGET_AUDIENCE.md, VIDEO_CREATIVE_BRIEF.md | Done |
| FEATURE_COVERAGE_MATRIX.md | Done (generated): 52 capabilities, 42 available now, 5 in development, 5 future roadmap |
| STORYBOARD.md, SCENE_BY_SCENE_PRODUCTION.md | Done (generated) |
| ARABIC_NARRATION_SCRIPT.md | Done: 20-minute (134 lines) and 3-minute (28 lines), fully diacritized. Third review on 2026-10-28 by four independent reviewers, every ending checked against its i'rab: no error in the diacritics; ten wording changes for strict readers applied (e.g. «فَرُبَّمَا لَا» for «فَقَدْ لَا», «تُفْتَحُ بَوَّابَةُ», «فِي أَثْنَاءِ», «دَفْعَةً وَاحِدَةً», the main clause before «حَتَّى لَوْ») |
| ENGLISH_TRANSLATION.md | Done |
| arabic.srt, arabic-plain.srt, english.srt (+ the 3-minute set) | Done, timed to the narration of the final films |
| Recordings of the product | Done: 54 recordings, 542 frames, recorded again from the renamed application on 2026-10-29 (kept out of git; `npm run capture` recreates them) |
| screenshots/, graphics/, Education_SaaS_Thumbnail.png | Done |
| Music | Done: recorded instruments (piano, strings, cello, harp, celesta, pad, bass, soft percussion; FluidR3 soundfont, MIT), arranged per chapter, ducked under the voice |
| Narration | Done with the synthetic voice (next section); every take matches the reviewed script |
| **Education_SaaS_Product_Showcase_20min.mp4** (4K) | **Final** |
| **Education_SaaS_Product_Showcase_1080p.mp4** (20-minute, 1080p) | **Final** |
| **Education_SaaS_Product_Showcase_3min.mp4** (1080p) | **Final** |
| VIDEO_QA_REPORT.md | Done on the renamed final files (2026-10-29): no technical fault found; −16 LUFS; full decode clean; the name heard correctly by speech recognition wherever it is spoken |
| Narrator_Recording_Pack.pdf, NARRATOR_RECORDING_PACK.md | Ready for a human narrator (formal Egyptian MSA, full tashkeel, notes per line) |

## The narration voice

- **Voice:** `ar_JO-kareem-medium` (Piper), given phonemes from our own reading rules (`audio/arabic_g2p.py`)
  instead of text, because espeak-ng, the usual front end of open voices, mispronounces diacritized Arabic
  (vowels lost after shadda, hamzat al-wasl ignored, waw and ya misread, no pausal forms). The rules follow the
  tashkeel of the reviewed script: shadda, tanween, sukun, long vowels, hidden alif, hamzat al-wasl, sun letters,
  iqlab, ta marbuta and pausal forms at every stop.
- **Pauses:** 0.8 s of silence after every sentence, 0.45 s after a comma or colon, at least 0.6 s at the end
  of a scene.
- **Egyptian accent: not achievable with this voice.** The clearest mark of an Egyptian reading of MSA is ج read
  as a hard g. It was tried on 18 lines (26 ج): speech recognition heard ك (k), giving «الكامعات» for
  «الجامعات» and «ومركع» for «ومرجع» (character error rate 5.8 % against 3.7 % with the standard ج), so the
  standard ج is kept. The voice reads MSA in a neutral accent. Azure, which has Egyptian voices, is blocked in this
  environment and has no key; the other open Arabic voices are non-commercial or far less intelligible.
- **The Egyptian narrator's recordings:** the owner reported uploading them to Google Drive. The Drive account
  connected to this environment shows no audio and no file created since 2026-10-27, and drive.google.com itself
  is blocked by the environment's network policy. If the recordings are placed in the repository
  (`marketing/product-showcase/audio/recorded/<cut>/`, file names as in the pack), `node ingest.mjs all` brings
  them in (splitting, cleaning, natural breaths and decays, a report on clipping, noise and pace, and a
  speech-recognition check), and the three films are rebuilt from them with the same commands.

## Open points

| Point | Needed from |
| --- | --- |
| **The voice's licence.** Its model card gives the dataset as github.com/AliMokhammad/arabicttstrain with "License: See URL"; that repository holds no licence or statement about the speaker. Until its terms are confirmed in writing, sending the films to official bodies carries that risk; the narrator's recording removes it | Owner |
| **A listening pass by a person** on headphones and laptop speakers: the voice (natural enough for the audience?) and the music. All checks so far are measurements and speech recognition | Owner |
| Real contact details or a link for the end card ("Contact us…") | Owner |
| Wise EduAgent could not be inspected (network policy); the video shows the AI only as labelled future vision | Owner: allow the host and provide a test account, or the source export, if Wise features should appear |
| Authorization to publish, and where | Owner — the files are private until then |

## Rebuilding

See video-project/README.md. The renderer resumes an interrupted render: re-running the same command
reuses the finished parts.
