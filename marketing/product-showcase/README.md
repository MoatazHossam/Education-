# Curriculum Scope — product showcase video

A 20-minute product showcase and a 3-minute version, in Arabic (Modern Standard Arabic, fully diacritized)
with English subtitles, built from recordings of the running application. **Not for public release without
the owner's explicit authorization.**

Start with [PRODUCTION_STATUS.md](PRODUCTION_STATUS.md): what is finished, what is a preview, and what is
blocked (the narration voice).

## Documents

| Document | What it holds |
| --- | --- |
| [PRODUCTION_STATUS.md](PRODUCTION_STATUS.md) | State of every deliverable, blockers, next steps |
| [PRODUCT_AUDIT.md](PRODUCT_AUDIT.md) | How the product was inspected; what the video may claim and why; Wise EduAgent; demo data |
| [FEATURE_COVERAGE_MATRIX.md](FEATURE_COVERAGE_MATRIX.md) | Every capability: status (available now / in development / future roadmap), users, value, evidence, and where it appears in each cut (generated) |
| [TARGET_AUDIENCE.md](TARGET_AUDIENCE.md) | Who the video is for and what each audience needs to see |
| [VIDEO_CREATIVE_BRIEF.md](VIDEO_CREATIVE_BRIEF.md) | Objective, message, structure, tone, visual language, music, specifications |
| [STORYBOARD.md](STORYBOARD.md) | One row per scene, both cuts (generated) |
| [ARABIC_NARRATION_SCRIPT.md](ARABIC_NARRATION_SCRIPT.md) | The narration, fully diacritized, with timings and directions for the narrator (generated) |
| [ENGLISH_TRANSLATION.md](ENGLISH_TRANSLATION.md) | The English translation used for the subtitles (generated) |
| [SCENE_BY_SCENE_PRODUCTION.md](SCENE_BY_SCENE_PRODUCTION.md) | Per scene: narration, visual, recording, camera, overlays, transition, music (generated) |
| [VIDEO_QA_REPORT.md](VIDEO_QA_REPORT.md) | Content, visual, audio and technical checks of the rendered files |

"Generated" documents are written by `video-project/docs.mjs` from the same script data the video is
rendered from, so they cannot drift from the film.

## Files

| Path | Contents | In git |
| --- | --- | --- |
| `arabic.srt`, `arabic-plain.srt`, `english.srt` | Subtitles of the 20-minute cut (diacritized Arabic, plain Arabic, English) | yes |
| `arabic-3min.srt`, `arabic-3min-plain.srt`, `english-3min.srt` | Subtitles of the 3-minute cut | yes |
| `Education_SaaS_Thumbnail.png` | Thumbnail, 1920 × 1080 | yes |
| `screenshots/` | 14 recorded product screens (1920 px; phones 780 px) | yes |
| `graphics/` | 18 stills of the motion-graphic scenes | yes |
| `assets/` | The product's logo mark (from `public/favicon.svg`) | yes |
| `recordings/shots.json` | Index of the 54 recordings (steps, labels, frames) | yes |
| `recordings/<shot>/NNN.jpg` | 538 frames of the running application (188 MB) | no — rebuilt by the capture |
| `music/<cut>-score.wav` | The generated score | no — rebuilt by `build.mjs audio` |
| `audio/` | The final mix (`showcase-20-mix.wav`); recorded narration goes in `audio/narration/<cut>/` | no |
| `*.mp4` | The rendered videos | no — delivered separately |
| `video-project/` | Everything that builds the above: capture, script, renderer, audio, subtitles, documents | yes |

Large media stays out of the repository (`.gitignore`): GitHub refuses files over 100 MB, and a video
committed here would be published wherever the repository is.

## Rebuilding

See [video-project/README.md](video-project/README.md). In short, from this folder:

```sh
cd video-project && npm install
# 1. Recordings (needs the repository's E2E database; ~10 minutes)
#    see video-project/README.md for the environment variables
# 2. Documents and subtitles
node docs.mjs
# 3. A cut: timeline + subtitles, audio, picture, then the final file
node build.mjs all 20 2160      # main 4K file
node build.mjs all 20 1080      # 1080p file
node build.mjs all 3 1080       # 3-minute version
# Without recorded narration, add --captions for a preview with the narration burned in.
```
