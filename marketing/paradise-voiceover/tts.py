"""Read script.txt aloud with a free Egyptian female neural voice and build the voiceover.

Voice: Microsoft ar-EG-SalmaNeural through the edge-tts package (no key, no account).
Output, in output/ next to the script:
  voiceover-full.mp3   every section in order, with a pause between sections
  segments.zip         one MP3 per section (00-intro.mp3, 001.mp3 ... 113-closing.mp3), for syncing with each screen
  timings.csv          start, end and length of each section inside voiceover-full.mp3
  timings.srt          the same timings as subtitles (the diacritized text of each section)

Run:  pip install edge-tts  (and have ffmpeg on PATH), then  python3 tts.py [folder]
The folder holds script.txt and receives output/; it defaults to this file's own folder.
"""

import asyncio
import csv
import os
import re
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

import edge_tts

BASE = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parent
SCRIPT = BASE / "script.txt"
OUT = BASE / "output"
WORK = BASE / "build"

VOICE = os.environ.get("TTS_VOICE", "ar-EG-SalmaNeural")
RATE = os.environ.get("TTS_RATE", "-5%")  # a little slower than default, for narration over screens
LEAD_IN = 0.5  # seconds of silence before the first section
GAP = 1.0  # seconds of silence between sections
TAIL = 1.5  # seconds of silence after the last section
SAMPLE_RATE = 24000  # the voice's native rate

# "NNN. [title]", optionally followed by a note for the editor (not read aloud).
HEADER = re.compile(r"^(\d+)\.\s*\[([^\]]+)\]")


def parse(path):
    """Return [(id, title, text)] from the script: a "NNN. [title]" line, then the spoken text."""
    sections, current = [], None
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        match = HEADER.match(line)
        if match:
            current = [match.group(1), match.group(2), []]
            sections.append(current)
        elif line and current is not None:
            current[2].append(line)
    result = []
    for sid, title, lines in sections:
        text = " ".join(lines)
        # A dash between clauses reads better as a comma pause than as a symbol.
        text = re.sub(r"\s*[—–]\s*", "، ", text)
        text = re.sub(r"\s+", " ", text).strip()
        if not text:
            sys.exit(f"Section {sid} [{title}] has no text")
        result.append((sid, title, text))
    if not result:
        sys.exit("No sections found in script.txt")
    return result


def slug(sid, title):
    if title == "المقدمة":
        return f"{sid}-intro"
    if title == "الخاتمة":
        return f"{sid}-closing"
    return sid


async def synth_one(sem, text, target):
    async with sem:
        for attempt in range(1, 7):
            try:
                tmp = target.with_suffix(".part.mp3")
                await edge_tts.Communicate(text, VOICE, rate=RATE).save(str(tmp))
                if tmp.stat().st_size < 1000:
                    raise RuntimeError("empty audio")
                tmp.replace(target)
                return
            except Exception as error:  # network hiccups and throttling: back off and retry
                if attempt == 6:
                    raise
                wait = 2**attempt
                print(f"  retry {attempt} for {target.name} in {wait}s: {error}", flush=True)
                await asyncio.sleep(wait)


def duration(path):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return float(out)


def ffmpeg(*args):
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args], check=True)


def srt_time(seconds):
    ms = round(seconds * 1000)
    h, ms = divmod(ms, 3_600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02}:{m:02}:{s:02},{ms:03}"


async def main():
    sections = parse(SCRIPT)
    print(f"{len(sections)} sections, {sum(len(t) for _, _, t in sections)} characters, voice {VOICE}, rate {RATE}")
    shutil.rmtree(WORK, ignore_errors=True)
    (WORK / "segments").mkdir(parents=True)
    OUT.mkdir(exist_ok=True)

    names = [slug(sid, title) for sid, title, _ in sections]
    if len(set(names)) != len(names):
        sys.exit("Two sections share a number")
    mp3s = [WORK / "segments" / f"{name}.mp3" for name in names]
    sem = asyncio.Semaphore(4)
    await asyncio.gather(*(synth_one(sem, text, mp3) for (_, _, text), mp3 in zip(sections, mp3s)))
    print("all sections synthesized")

    # Decode every section to the same PCM format and join them with silences in between.
    silence = {}
    for name, seconds in (("lead", LEAD_IN), ("gap", GAP), ("tail", TAIL)):
        silence[name] = WORK / f"silence-{name}.wav"
        ffmpeg("-f", "lavfi", "-i", f"anullsrc=r={SAMPLE_RATE}:cl=mono", "-t", str(seconds),
               "-c:a", "pcm_s16le", str(silence[name]))
    parts, rows, clock = [silence["lead"]], [], LEAD_IN
    for index, ((sid, title, text), mp3) in enumerate(zip(sections, mp3s)):
        wav = mp3.with_suffix(".wav")
        ffmpeg("-i", str(mp3), "-ar", str(SAMPLE_RATE), "-ac", "1", "-c:a", "pcm_s16le", str(wav))
        length = duration(wav)
        rows.append((sid, title, clock, clock + length, length, text))
        clock += length
        parts.append(wav)
        if index < len(sections) - 1:
            parts.append(silence["gap"])
            clock += GAP
    parts.append(silence["tail"])
    listing = WORK / "concat.txt"
    listing.write_text("".join(f"file '{p}'\n" for p in parts), encoding="utf-8")
    joined = WORK / "joined.wav"
    ffmpeg("-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(joined))

    # Even loudness for speech (-16 LUFS), then MP3.
    full = OUT / "voiceover-full.mp3"
    ffmpeg("-i", str(joined), "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", "-ar", str(SAMPLE_RATE),
           "-ac", "1", "-c:a", "libmp3lame", "-b:a", "64k",
           "-metadata", "title=Paradise Innovations - voiceover (ar-EG)", str(full))

    with zipfile.ZipFile(OUT / "segments.zip", "w", zipfile.ZIP_STORED) as archive:
        for mp3 in mp3s:
            archive.write(mp3, mp3.name)

    with open(OUT / "timings.csv", "w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["section", "title", "file", "start", "end", "seconds"])
        for (sid, title, start, end, length, _), name in zip(rows, names):
            writer.writerow([sid, title, f"{name}.mp3", srt_time(start), srt_time(end), f"{length:.2f}"])

    with open(OUT / "timings.srt", "w", encoding="utf-8") as handle:
        for number, (sid, title, start, end, _, text) in enumerate(rows, 1):
            handle.write(f"{number}\n{srt_time(start)} --> {srt_time(end)}\n{text}\n\n")

    total = duration(full)
    print(f"voiceover-full.mp3: {int(total // 60)} min {total % 60:.0f} s, {full.stat().st_size / 1e6:.1f} MB")


if __name__ == "__main__":
    asyncio.run(main())
