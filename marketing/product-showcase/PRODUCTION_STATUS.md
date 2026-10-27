# Production status

State on 2026-10-27. **Both cuts are finished as previews. The narration will be a female Azure neural voice; the
generator is ready and waits for the Azure key and network access.** Nothing has been published.

## Deliverables

| Deliverable | Status |
| --- | --- |
| PRODUCT_AUDIT.md, TARGET_AUDIENCE.md, VIDEO_CREATIVE_BRIEF.md | Done |
| FEATURE_COVERAGE_MATRIX.md | Done (generated): 52 capabilities, 42 available now, 5 in development, 5 future roadmap |
| STORYBOARD.md, SCENE_BY_SCENE_PRODUCTION.md | Done (generated) |
| ARABIC_NARRATION_SCRIPT.md | Done: 20-minute (134 lines) and 3-minute (28 lines), fully diacritized. Second tashkeel review on 2026-10-27: «أَيَّ الْكُتُبِ» (fronted object), «إِحْدَى وَثَلَاثُونَ مَادَّةً» (the unit agrees with the feminine noun, both cuts), «صَفْحَةِ "الْيَوْم"» (a page name), «إِلِكْتْرُونِيّ» (four lines) |
| ENGLISH_TRANSLATION.md | Done |
| arabic.srt, arabic-plain.srt, english.srt (+ the 3-minute set) | Done, timed to the estimated narration; regenerated automatically from the voice takes |
| Recordings of the product | Done: 54 recordings, 538 frames (kept out of git; `npm run capture` recreates them) |
| screenshots/, graphics/, Education_SaaS_Thumbnail.png | Done |
| Music | Done: original generated score (`music/`, rebuilt by `build.mjs audio`); not yet reviewed by ear |
| **Narration voice** | **Waiting for the Azure key and network access** — see below |
| Education_SaaS_Product_Showcase_1080p_PREVIEW_no-narration.mp4 | Done: 19:38.6, 1920 × 1080, 173 MB |
| Education_SaaS_Product_Showcase_3min_PREVIEW_no-narration.mp4 | Done: 2:54.7, 1920 × 1080, 31 MB |
| Education_SaaS_Product_Showcase_20min.mp4 (3840 × 2160), …_1080p.mp4, …_3min.mp4 (narrated) | Waiting for the narration; one command each (below). A 3-minute cut with the male Piper voice was made on 2026-10-27 and withdrawn after review |
| VIDEO_QA_REPORT.md | Done for the preview cuts; repeated on the narrated cuts |

The preview files are the finished film with the narration shown as burned-in Arabic captions and a
"PREVIEW — NO NARRATION" tag. They are suitable for an internal review of content, pacing and visuals, not
for release.

## The narration voice

- **Tried and rejected:** the open-source Piper voice `ar_JO-kareem-medium` (male, the only Arabic Piper voice)
  was generated for both cuts. The owner rejected it on 2026-10-27 ("very bad"; a female voice was asked for),
  and its licence could not be confirmed. Its takes are not used.
- **Chosen:** Azure AI Speech, female neural voice. Default `ar-SA-ZariyahNeural`; `ar-EG-SalmaNeural` and
  `ar-AE-FatimaNeural` are the alternatives offered as samples. The generator (`video-project/narrate.mjs`,
  `lib/azure-tts.mjs`) speaks the diacritized script in pausal form, retries throttling, and keeps the key out
  of the command line, the disk and the logs.

Needed from the owner (none of it in the chat or the repository):

1. An Azure Speech resource (the free F0 tier is enough: both scripts are about 12,600 characters).
2. Its key and region as environment secrets `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` in the Claude Code
   environment settings.
3. `*.tts.speech.microsoft.com` added to the environment's allowed domains (today it is refused), keeping
   package managers allowed.
4. A new session, so the settings apply.

Then, in `video-project/`: `node narrate.mjs samples` (one sample per voice, for the owner to choose), then
`node narrate.mjs 20` and `node narrate.mjs 3` with the chosen voice, the Whisper check (`lib/asr_check.py`)
and a listening pass, `--rate` adjusted so each cut lands in its target length, then `node build.mjs all 20
2160`, `node build.mjs all 20 1080` and `node build.mjs all 3 1080`, and the QA report.

A human narrator stays possible at any time: record ARABIC_NARRATION_SCRIPT.md one line per file as
`audio/narration/<cut>/<sceneId>-NN.wav`; the same build commands use those takes.

## Other open points

| Point | Needed from |
| --- | --- |
| Listening review of the generated score, or a licensed track to replace it | Owner |
| Real contact details or a link for the end card ("Contact us…") | Owner |
| Wise EduAgent could not be inspected (network policy); the video shows the AI only as labelled future vision | Owner: allow the host and provide a test account, or the source export, if Wise features should appear |
| Authorization to publish, and where | Owner — the files are private until then |

## Rebuilding

See video-project/README.md. The renderer resumes an interrupted render: re-running the same command
reuses the finished parts.
