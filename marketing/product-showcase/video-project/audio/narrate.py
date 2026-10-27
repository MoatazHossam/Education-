"""Speaks narration lines with a Piper voice: python3 narrate.py <lines.json> --voice <model.onnx> [--length-scale 1.12]
[--sentence-silence 0.3] [--tempo 1.0] [--tashkeel]

lines.json is a list of {"text", "out"} (written by ../narrate.mjs). Each line becomes a 16-bit mono WAV with
the voice's leading and trailing silence trimmed and a short pause between sentences. The text is already fully
diacritized, so Piper's own diacritizer is off unless --tashkeel is given. --tempo speeds the take up (or slows
it down) without changing the pitch (FFmpeg atempo), for fitting a cut to its target length."""
import json
import os
import subprocess
import sys
import wave

import numpy as np
from piper import PiperVoice, SynthesisConfig


def arg(name, default=None):
    return sys.argv[sys.argv.index(name) + 1] if name in sys.argv else default


def trim(x, sr, threshold=10 ** (-50 / 20), head=0.05, tail=0.12):
    loud = np.flatnonzero(np.abs(x) > threshold)
    if not len(loud):
        return x
    return x[max(0, loud[0] - int(head * sr)): min(len(x), loud[-1] + int(tail * sr))]


def main():
    lines = json.load(open(sys.argv[1], encoding='utf-8'))
    voice = PiperVoice.load(arg('--voice'))
    voice.use_tashkeel = '--tashkeel' in sys.argv
    config = SynthesisConfig(length_scale=float(arg('--length-scale', '1.12')), normalize_audio=True)
    pause = float(arg('--sentence-silence', '0.3'))
    tempo = float(arg('--tempo', '1.0'))
    for n, line in enumerate(lines, 1):
        parts, sr = [], voice.config.sample_rate
        for chunk in voice.synthesize(line['text'], syn_config=config):
            sr = chunk.sample_rate
            parts.append(np.frombuffer(chunk.audio_int16_bytes, dtype=np.int16).astype(np.float32) / 32768)
            parts.append(np.zeros(int(pause * sr), dtype=np.float32))
        audio = trim(np.concatenate(parts[:-1]) if parts else np.zeros(1, np.float32), sr)
        with wave.open(line['out'], 'wb') as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(sr)
            w.writeframes((np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes())
        if abs(tempo - 1) > 1e-3:
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', line['out'], '-af', f'atempo={tempo:.4f}', '-c:a', 'pcm_s16le', line['out'] + '.tmp.wav'], check=True)
            os.replace(line['out'] + '.tmp.wav', line['out'])
        print(f'{n}/{len(lines)} {line["out"]}', flush=True)


if __name__ == '__main__':
    main()
