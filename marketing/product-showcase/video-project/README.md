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

Or generate the takes with a synthetic voice. The current takes (2026-10-28) use the open-source Piper voice
`ar_JO-kareem-medium` (sherpa-onnx GitHub release `tts-models`), **with our own pronunciation**: the voice is not
given the text. `audio/arabic_g2p.py` turns each diacritized line into phonemes by the reading rules, and the
phoneme ids go straight to the model, so nothing re-reads or guesses the vowels:

```sh
python3 -m venv /path/to/venv && /path/to/venv/bin/pip install piper-tts
S='--length-scale 0.76 --noise-scale 0.333 --noise-w 0.4 --sentence-silence 0.3'
PIPER_PYTHON=/path/to/venv/bin/python node narrate.mjs 20 --voice ar_JO-kareem-medium.onnx $S
PIPER_PYTHON=/path/to/venv/bin/python node narrate.mjs 3 --voice ar_JO-kareem-medium.onnx $S
python3 -m unittest discover -s audio -p 'test_*.py'     # the reading rules
```

Why: Piper (like most open voices) reads Arabic through espeak-ng, which mispronounces fully diacritized text.
Checked word by word over both scripts, it drops the vowel after every shadda when the marks are in Unicode's
normal order (الشَّمْسُ → ʔaʃʃmsu, سَنُدَرِّسُ → sanudarrsu), reads a waw or ya that carries a vowel as a vowel
(هِيَ → hiːa, بَيَانَات → baiaːnaːt), ignores hamzat al-wasl (بِالْمَنْهَجِ → bi aːlmanhadʒi), reads ذَلِكَ and
هَذَا with a short a, and has no pausal forms. The rules in `arabic_g2p.py`: every short vowel, tanween, sukun and
shadda as written; long vowels and diphthongs; the dagger alif also where it is not written (هٰذَا، ذٰلِكَ،
لٰكِنَّ، هٰكَذَا); hamzat al-wasl (silent in connected speech, a long vowel before it shortened, a helping vowel after
a consonant, ʔa / ʔi after a pause); the article's lam assimilated to sun letters; iqlab (n → m before b); pausal
forms before every pause; ta marbuta; stress. Phonemes are written in espeak's own notation, the one the voice
was trained on. The phonemes of every line are saved next to the line list (`build/<cut>/narration-lines-phonemes.json`).

`--length-scale` sets the pace, `--sentence-silence` the pause between sentences, `--max-pause` (0.28 s) shortens
the pauses the voice makes at commas, `--noise-scale` and `--noise-w` its variation; `--tempo` time-stretches (not
used). The settings above were chosen by the speech-recognition check on the 24 hardest lines: 0.76 with the lower
variation gave a 7.8 % character error rate, against 11.4 % at 0.72 with the voice's default variation (0.8 was
clearer still, 6.6 %, but would make the 20-minute cut almost 22 minutes). The 20-minute cut is 20.7 minutes, the
3-minute cut 3.1. Lines that
already have a file are skipped, so a human take placed first is kept; `--force` regenerates, `--only <sceneId>`
limits to one scene.

**The voice's licence could not be confirmed**: its model card refers to a training-data repository that states
no licence. Other Arabic voices were checked: the three newer Piper voices (`ar_JO-SA_dii`, `SA_miro`,
`SA_miro_V2`) are CC BY-NC-SA 4.0 (no commercial use), and Nabra-82M (Kokoro architecture, licence also not
confirmable here) was far less intelligible in the speech-recognition check (15–17 % character error rate
against 3.7 %), cut line endings and cannot tell س from ص.

`--engine azure` uses an Azure AI Speech neural voice instead (default `ar-SA-ZariyahNeural`, `--rate` for the
pace; `node narrate.mjs samples` renders two lines per voice). It needs `AZURE_SPEECH_KEY` and
`AZURE_SPEECH_REGION` as environment secrets (never in the repository or the chat) and
`*.tts.speech.microsoft.com` allowed by the network policy. The requests go through curl; the key is passed to
curl on its standard input, never on the command line or on disk.

`lib/asr_check.py` transcribes the takes with Whisper (small, sherpa-onnx `asr-models` release) and reports a
character error rate per line against the script (each take padded with half a second of silence, as in the
film; without it Whisper tends to drop the last word), to find lines worth listening to.

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
