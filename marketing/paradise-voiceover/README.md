# Paradise Innovations — Arabic voiceover

Reads `script.txt` (114 fully diacritized sections) aloud with the free Microsoft Egyptian female voice
**ar-EG-SalmaNeural** (the `edge-tts` package: no key, no account, no cost).

| File | What it is |
| --- | --- |
| `script.txt` | The voiceover script, as supplied |
| `tts.py` | The generator: one MP3 per section, then the full voiceover, timings and subtitles |
| `voiceover_colab.ipynb` | The same generator with the script inside, for Google Colab (free, runs in the browser) |

The generator writes the audio to `output/` (working files go to `build/`, which is ignored). On the
`claude/exciting-knuth-niuk0b` branch, `.github/workflows/voiceover-tts.yml` runs it on GitHub Actions
whenever `script.txt` or `tts.py` changes, and commits `output/` back to the branch.

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

The spoken text runs about 15–17 minutes. The 40-minute video gets its length from the time on screen
between sections.
