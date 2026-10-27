# Production status

State on 2026-10-27. **Both cuts are finished as previews; the narration voice is the one missing piece.**
Nothing has been published.

## Deliverables

| Deliverable | Status |
| --- | --- |
| PRODUCT_AUDIT.md, TARGET_AUDIENCE.md, VIDEO_CREATIVE_BRIEF.md | Done |
| FEATURE_COVERAGE_MATRIX.md | Done (generated): 52 capabilities, 42 available now, 5 in development, 5 future roadmap |
| STORYBOARD.md, SCENE_BY_SCENE_PRODUCTION.md | Done (generated) |
| ARABIC_NARRATION_SCRIPT.md | Done: 20-minute (134 lines) and 3-minute (28 lines), fully diacritized, with directions for the narrator |
| ENGLISH_TRANSLATION.md | Done |
| arabic.srt, arabic-plain.srt, english.srt (+ the 3-minute set) | Done, timed to the estimated narration; regenerated automatically once the voice is recorded |
| Recordings of the product | Done: 54 recordings, 538 frames (kept out of git; `npm run capture` recreates them) |
| screenshots/, graphics/, Education_SaaS_Thumbnail.png | Done |
| Music | Done: original generated score (`music/`, rebuilt by `build.mjs audio`); not yet reviewed by ear |
| **Narration voice** | **Blocked** — see below |
| Education_SaaS_Product_Showcase_1080p_PREVIEW_no-narration.mp4 | Done: 19:38.6, 1920 × 1080, 173 MB |
| Education_SaaS_Product_Showcase_3min_PREVIEW_no-narration.mp4 | Done: 2:54.7, 1920 × 1080, 31 MB |
| Education_SaaS_Product_Showcase_20min_PREVIEW_no-narration.mp4 (3840 × 2160) | Rendering |
| Education_SaaS_Product_Showcase_20min.mp4, …_1080p.mp4, …_3min.mp4 (narrated) | Waiting for the narration; one command each (below) |
| VIDEO_QA_REPORT.md | Done for the preview cuts |

The preview files are the finished film with the narration shown as burned-in Arabic captions and a
"PREVIEW — NO NARRATION" tag. They are suitable for an internal review of content, pacing and visuals, not
for release.

## Blocker: the narration voice

The brief asks for Modern Standard Arabic narration. It could not be produced in this environment:

- **Open-source Arabic voices** (Piper, or other open text-to-speech models) are downloaded from
  `huggingface.co`, which the environment's network policy refuses (checked again on 2026-10-27). No Arabic
  neural voice is published on PyPI or npm.
- **Paid text-to-speech services** (Google Cloud, Azure, ElevenLabs and others) would mean creating an
  account and incurring charges, which needs your explicit authorization and credentials; none were used.

Three ways forward, in order of quality:

1. **A human narrator (recommended for a premium film).** Record ARABIC_NARRATION_SCRIPT.md one line per
   file as `audio/narration/<cut>/<sceneId>-NN.wav` (e.g. `audio/narration/showcase-20/c1-open-01.wav`).
   Then run `node build.mjs all 20 2160`, `node build.mjs all 20 1080` and `node build.mjs all 3 1080` in
   `video-project/`: the timeline, subtitles and music follow the takes automatically.
2. **An open-source voice here.** Allow `huggingface.co` in the environment's network settings; the voice is
   then generated into the same files and the same commands produce the final cuts. The voice's licence is
   checked before use.
3. **A paid service.** Authorize it and provide the API key as an environment secret (never in the
   repository); same pipeline.

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
