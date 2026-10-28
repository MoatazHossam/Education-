"""Speaks narration lines with a Piper voice: python3 narrate.py <lines.json> --voice <model.onnx>
[--length-scale 1.0] [--noise-scale 0.5] [--noise-w 0.6] [--sentence-silence 0.35] [--max-pause 0.28]
[--tempo 1.0]

lines.json is a list of {"text", "out"} (written by ../narrate.mjs), the text fully diacritized. The voice is
not given the text: arabic_g2p.py turns it into phonemes by the reading rules (tashkeel, hamzat al-wasl, sun
letters, pausal forms, hidden alif...) and the phoneme ids go straight to the model, so nothing re-reads or
guesses the vowels. Each sentence is spoken on its own and joined with a short pause; pauses the voice makes
inside a sentence (at commas) are shortened to --max-pause; the take is trimmed of leading and trailing silence and written as a 16-bit mono WAV. --tempo changes the speed without changing the
pitch (FFmpeg atempo). The phonemes of every line are written next to lines.json (…-phonemes.json) for review."""
import json
import os
import subprocess
import sys
import wave

import numpy as np
from piper import PiperVoice, SynthesisConfig

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import arabic_g2p  # noqa: E402


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def trim(x, sr, threshold=10 ** (-50 / 20), head=0.05, tail=0.12):
    loud = np.flatnonzero(np.abs(x) > threshold)
    if not len(loud):
        return x
    return x[max(0, loud[0] - int(head * sr)): min(len(x), loud[-1] + int(tail * sr))]


def cap_pauses(x, sr, cap, threshold=10 ** (-40 / 20), frame=0.01):
    """Shortens every silent stretch longer than cap seconds to cap (keeping its middle cut out)."""
    n = int(frame * sr)
    frames = len(x) // n
    if frames < 3:
        return x
    rms = np.sqrt(np.mean(x[:frames * n].reshape(frames, n) ** 2, axis=1))
    quiet = rms < threshold
    keep = np.ones(len(x), dtype=bool)
    limit = int(cap / frame)
    k = 0
    while k < frames:
        if not quiet[k]:
            k += 1
            continue
        j = k
        while j < frames and quiet[j]:
            j += 1
        if j - k > limit and k > 0 and j < frames:
            half = limit // 2
            keep[(k + half) * n:(j - (limit - half)) * n] = False
        k = j
    return x[keep]


def sentences(text):
    """The phonemes of each sentence of a line: split at the full stops, question and exclamation marks of the
    text (not at the '.' espeak writes after an emphatic vowel)."""
    out, cur = [], ''
    for word, ph in arabic_g2p.phonemize(text):
        if word is None:
            cur = cur.rstrip() + ph + ' '
            if ph in '.?!':
                out.append(cur.strip())
                cur = ''
        else:
            cur += ph + ' '
    if cur.strip():
        out.append(cur.strip())
    return out


def main():
    lines = json.load(open(sys.argv[1], encoding='utf-8'))
    voice = PiperVoice.load(arg('--voice'))
    config = SynthesisConfig(length_scale=float(arg('--length-scale', '1.0')), noise_scale=float(arg('--noise-scale', '0.5')),
                             noise_w_scale=float(arg('--noise-w', '0.6')), normalize_audio=False)
    pause = float(arg('--sentence-silence', '0.35'))
    max_pause = float(arg('--max-pause', '0.28'))
    tempo = float(arg('--tempo', '1.0'))
    sr = voice.config.sample_rate
    record = []
    for n, line in enumerate(lines, 1):
        parts = []
        phonemes = sentences(line['text'])
        for ph in phonemes:
            audio = np.asarray(voice.phoneme_ids_to_audio(voice.phonemes_to_ids(list(ph)), config), dtype=np.float32).reshape(-1)
            parts += [cap_pauses(trim(audio, sr, head=0.02, tail=0.06), sr, max_pause), np.zeros(int(pause * sr), dtype=np.float32)]
        audio = trim(np.concatenate(parts[:-1]) if parts else np.zeros(1, np.float32), sr)
        with wave.open(line['out'], 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
        if abs(tempo - 1) > 1e-3:
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', line['out'], '-af', f'atempo={tempo:.4f}', '-c:a', 'pcm_s16le', line['out'] + '.tmp.wav'], check=True)
            os.replace(line['out'] + '.tmp.wav', line['out'])
        record.append({'out': os.path.basename(line['out']), 'text': line['text'], 'phonemes': phonemes})
        print(f'{n}/{len(lines)} {line["out"]}', flush=True)
    json.dump(record, open(sys.argv[1].replace('.json', '-phonemes.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
