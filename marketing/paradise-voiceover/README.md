# Paradise Innovations — Arabic voiceover

Reads `script.txt` (114 fully diacritized sections) aloud with the free Microsoft Egyptian female voice
**ar-EG-SalmaNeural** (the `edge-tts` package: no key, no account, no cost).

| File | What it is |
| --- | --- |
| `script.txt` | The voiceover script, as supplied |
| `tts.py` | The generator: one MP3 per section, then the full voiceover, timings and subtitles |
| `voiceover_colab.ipynb` | The same generator with the script inside, for Google Colab (free, runs in the browser) |

The generator writes the audio to `output/` beside each script (working files go to `build/`, which is
ignored). On the `claude/exciting-knuth-niuk0b` branch, `.github/workflows/voiceover-tts.yml` runs it on
GitHub Actions for each folder whose `script.txt` has no audio yet or changed after its audio, and commits
the `output/` folders back to the branch.

| Folder | Script |
| --- | --- |
| `.` | The main 112-screen voiceover (114 sections) |
| `addendum-3new/` | Three added scenes: 1 repeats section 045's text; 2 and 3 are new |

For a new batch of scenes, add a folder with its own `script.txt` (`python3 tts.py <folder>` locally).

## Easiest: Google Colab (nothing to install)

1. Open <https://colab.research.google.com>, then **File → Upload notebook** and pick `voiceover_colab.ipynb`.
2. **Runtime → Run all**, then wait 5–10 minutes.
3. The browser downloads `voiceover-full.mp3` and `voiceover-extras.zip` (one MP3 per screen, `timings.csv`, `timings.srt`).

## On your own computer

Needs Python 3.10+ and ffmpeg.

```bash
pip install edge-tts==7.3.1
```

```bash
python3 tts.py
```

Settings (environment variables): `TTS_RATE` (default `-5%`; `+0%` is the voice's normal speed) and
`TTS_VOICE` (default `ar-EG-SalmaNeural`; `ar-EG-ShakirNeural` is the Egyptian male voice).

## Output

- `output/voiceover-full.mp3`: every section in order, 1 s pause between sections, levelled to −16 LUFS
- `output/segments.zip`: `00-intro.mp3`, `001.mp3` … `113-closing.mp3`, one per screen
- `output/timings.csv`: start, end and length of each section inside the full file
- `output/timings.srt`: the same timings as subtitles, for a video editor

At the default rate the full voiceover runs 23 min 53 s (sections of 9–18 s each). The 40-minute video
gets the rest of its length from the time on screen between sections.
