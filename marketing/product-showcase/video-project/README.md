# Video project

Everything that produces the showcase: the capture of the running application, the script, the renderer,
the score and mix, the subtitles and the documents. It is deterministic: the same inputs give the same frames,
and the documents are generated from the same data as the film.

```
capture/     Playwright: drives the real application on a fresh E2E database and records frames
script/      showcase-20.mjs, showcase-3.mjs (scenes, diacritized narration, English, visuals);
             features.mjs (the capability inventory behind FEATURE_COVERAGE_MATRIX.md)
lib/         timeline (narration timing, scene layout), demo planner (pointer and camera over the
             recordings), audio events, subtitles, WAV reader, static server, review helpers
render/      the player (HTML/CSS/JS in Chromium): scene templates, design system, thumbnail
audio/mix.py the generated score, sound effects and the mix
build.mjs    prepare → audio → video → mux, per cut and resolution
render.mjs   frames → H.264 in parallel 20-second chunks, joined without re-encoding
preview.mjs  single frames for review;  stills.mjs  thumbnail, graphics/ and screenshots/
docs.mjs     the generated documents (storyboard, narration, translation, scene sheet, coverage matrix)
```

## Requirements

- Node 22 and the repository's dependencies (`npm ci` at the repository root: Playwright, sharp, the app).
  Chromium for Playwright 1.56 (`/opt/pw-browsers` in the cloud environment; otherwise
  `npx playwright install chromium`).
- `npm install` here (the fonts: Readex Pro, the application's font, and IBM Plex Mono).
- ffmpeg and ffprobe; Python 3 with numpy and scipy (the score).
- For the capture only: PostgreSQL 16 reachable through `TEST_PG_ADMIN_URL`, as for the end-to-end tests.

## 1. Capture the product

```sh
TEST_PG_ADMIN_URL=postgres://… npm run capture
```

Runs `capture/showcase.spec.ts` against the end-to-end server (port 3100) with the same database setup as
`npm run test:e2e`, in Arabic, on a 1440 × 810 window at device scale 2.5 (phones 390 × 844 at 3). It walks
through the demo school's whole story (sign-up to platform console) and writes
`../recordings/<shot>/NNN.jpg` and `../recordings/shots.json` (54 recordings, 538 frames). One-time passwords,
the two-step QR code and key, and local addresses are blurred as they are captured. The background worker is
started part-way, so `ALERT_CHECK_INTERVAL_MS` is raised to keep its first health check from being reported.
The run needs `127.0.0.1 lessons.nilevalley.example` in `/etc/hosts` for the invented webhook host, and
permission to listen on port 80 there (the receiver that stands in for the school's lesson platform).

## 2. Documents and subtitles

```sh
npm run docs          # STORYBOARD, narration, translation, scene sheet, coverage matrix
node build.mjs prepare 20 && node build.mjs prepare 3     # also writes the SRT files
```

## 3. Narration

Put one WAV per narration line in `../audio/narration/<cut>/<sceneId>-NN.wav` (e.g.
`showcase-20/c1-open-01.wav`; numbering from 01 in script order; any sample rate, mono or stereo). Read the
text from ARABIC_NARRATION_SCRIPT.md (the "يُقرأ" lines where given). The timeline then uses each take's real
length instead of the estimate; scenes, pointer, camera, music cues and subtitles follow automatically. Lines
without a take keep the estimate, and `prepare` reports how many are recorded.

Or generate the takes with an open-source voice (Piper, `pip install piper-tts` in a virtual environment; the
voice model comes from Hugging Face):

```sh
PIPER_PYTHON=/path/to/venv/bin/python node narrate.mjs 20 --voice ar_JO-kareem-medium.onnx
PIPER_PYTHON=/path/to/venv/bin/python node narrate.mjs 3 --voice ar_JO-kareem-medium.onnx
```

It speaks the diacritized text as written (Piper's own diacritizer is off; `--tashkeel` turns it on), trims
each take, and skips lines that already have a file, so a human take placed first is kept. `--force`
regenerates, `--only <sceneId>` limits to one scene, `--length-scale` sets the pace (default 1.12, calm).

## 4. Build a cut

```sh
node build.mjs all 20 2160    # → Education_SaaS_Product_Showcase_20min.mp4 (3840 × 2160)
node build.mjs all 20 1080    # → Education_SaaS_Product_Showcase_1080p.mp4
node build.mjs all 3 1080     # → Education_SaaS_Product_Showcase_3min.mp4
node build.mjs all 3 2160     # → Education_SaaS_Product_Showcase_3min_4K.mp4
```

Add `--captions` while there is no narration: the narration is burned in as Arabic captions with a
"PREVIEW — NO NARRATION" tag, and the files are named `…_PREVIEW_no-narration.mp4`. `--workers n` sets the
number of parallel browsers (default 4). On 4 cores, 1080p renders at about 22 frames per second (the
20-minute cut in about 27 minutes); 2160p takes roughly three times as long.

Loudness is normalised in two passes to −16 LUFS with narration (−18 without), true peak −1.5 dBTP. To use a
licensed music track instead of the generated score, put it at `../music/<cut>-override.wav`.

## 5. Review

```sh
node preview.mjs 20 /tmp/frames c5-monitor@4 c7-plans 612.5   # scene@seconds, scene (middle) or a time
CAPTIONS=1 node preview.mjs 3 /tmp/frames m-student@9            # with the burned-in captions
python3 lib/sheet.py out.jpg /tmp/frames/*.png                   # contact sheet
npm run stills                                                   # thumbnail, graphics/, screenshots/
```
