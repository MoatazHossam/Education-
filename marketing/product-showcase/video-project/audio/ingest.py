"""Prepares the narrator's recordings for the films: python3 ingest.py <manifest.json> <report.json>

The manifest (written by ../ingest.mjs) lists, per scene, the narration lines with the recorded files found for
them: one file per line, or one file for the whole scene, which is split at the pauses between its lines.
Every take is cleaned the way a broadcast editor would: rumble filter, noise reduction only when the room is
noisy, de-essing, gentle compression, and a natural head and tail (the breath before, the decay after, with short
fades), then written as 48 kHz mono to audio/narration/<cut>/<sceneId>-NN.wav where the timeline reads it.
The report lists per line: length, peak, noise floor, clipping, pace, and anything worth listening to again.
"""
import json
import os
import subprocess
import sys

import numpy as np

SR = 48000
FRAME = 0.02
HEAD, TAIL = 0.12, 0.35  # kept before the first and after the last speech
FADE_IN, FADE_OUT = 0.015, 0.12


def decode(path):
    """Any audio file to mono float32 at 48 kHz."""
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()


def envelope(x):
    n = int(FRAME * SR)
    frames = max(1, len(x) // n)
    rms = np.sqrt(np.mean(x[: frames * n].reshape(frames, n) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms)


def speech_frames(env):
    """Frames above a threshold set between the room's noise floor and the speech level."""
    floor = np.percentile(env, 10)
    loud = np.percentile(env, 95)
    threshold = max(floor + 10, loud - 40)
    return env > threshold, floor


def split(x, n):
    """Splits a scene recording into n takes at its n-1 longest pauses."""
    env = envelope(x)
    speech, _ = speech_frames(env)
    gaps = []
    k = 0
    while k < len(speech):
        if speech[k]:
            k += 1
            continue
        j = k
        while j < len(speech) and not speech[j]:
            j += 1
        if k > 0 and j < len(speech) and (j - k) * FRAME >= 0.35:
            gaps.append((j - k, k, j))
        k = j
    if len(gaps) < n - 1:
        raise ValueError(f'found {len(gaps) + 1} spoken parts, expected {n}: leave about two seconds between lines')
    cuts = sorted(gaps, reverse=True)[: n - 1]
    bounds = sorted(((a + b) // 2) for _, a, b in cuts)
    edges = [0] + [b * int(FRAME * SR) for b in bounds] + [len(x)]
    return [x[edges[i]:edges[i + 1]] for i in range(n)]


def clean(x, floor_db):
    """Broadcast clean-up with FFmpeg; noise reduction only above a -60 dBFS floor."""
    chain = ['highpass=f=70:poles=2']
    if floor_db > -60:
        chain.append(f'afftdn=nr=10:nf={max(-80, min(-20, floor_db)):.0f}')
    chain += ['deesser=i=0.35:m=0.5:f=0.5', 'acompressor=threshold=0.1:ratio=2:attack=8:release=160:knee=3:makeup=1.5']
    p = subprocess.run(['ffmpeg', '-v', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-af', ','.join(chain),
                        '-f', 'f32le', '-'], input=x.astype(np.float32).tobytes(), capture_output=True, check=True)
    return np.frombuffer(p.stdout, np.float32).copy()


def trim(x):
    """From just before the first speech to the natural decay after the last, with short fades."""
    env = envelope(x)
    speech, _ = speech_frames(env)
    idx = np.flatnonzero(speech)
    if not len(idx):
        return x
    n = int(FRAME * SR)
    a = max(0, idx[0] * n - int(HEAD * SR))
    b = min(len(x), (idx[-1] + 1) * n + int(TAIL * SR))
    y = x[a:b].copy()
    fi, fo = int(FADE_IN * SR), int(FADE_OUT * SR)
    y[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
    y[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32) ** 1.5
    return y


def write(path, x):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', '-c:a', 'pcm_s24le', path],
                   input=np.clip(x, -1, 1).astype(np.float32).tobytes(), check=True)


def main():
    manifest = json.load(open(sys.argv[1], encoding='utf-8'))
    report = []
    for scene in manifest['scenes']:
        lines = scene['lines']
        try:
            if all(l.get('source') for l in lines):
                takes = [decode(l['source']) for l in lines]
            elif scene.get('source'):
                takes = split(decode(scene['source']), len(lines))
            else:
                missing = [l['id'] for l in lines if not l.get('source')]
                report.append({'scene': scene['id'], 'error': 'not recorded', 'lines': missing})
                continue
        except (ValueError, subprocess.CalledProcessError) as e:
            report.append({'scene': scene['id'], 'error': str(e)})
            continue
        for l, raw in zip(lines, takes):
            env = envelope(raw)
            _, floor = speech_frames(env)
            peak = 20 * np.log10(np.abs(raw).max() + 1e-12)
            clipped = int(np.sum(np.abs(raw) >= 0.999))
            out = trim(clean(raw, floor))
            write(l['out'], out)
            dur = len(out) / SR
            r = {'id': l['id'], 'out': os.path.relpath(l['out']), 'seconds': round(dur, 2), 'peak_dbfs': round(float(peak), 1),
                 'noise_floor_dbfs': round(float(floor), 1), 'clipped_samples': clipped,
                 'letters_per_second': round(l['letters'] / max(dur, 0.1), 1)}
            flags = []
            if clipped:
                flags.append('clipping in the recording')
            if floor > -55:
                flags.append('noisy room (noise reduction applied)')
            if peak < -24:
                flags.append('recorded very quietly')
            r['flags'] = flags
            report.append(r)
    rates = [r['letters_per_second'] for r in report if 'letters_per_second' in r]
    if rates:
        med = float(np.median(rates))
        for r in report:
            if 'letters_per_second' in r and not (0.75 * med <= r['letters_per_second'] <= 1.3 * med):
                r['flags'].append('pace far from the others: check the line was read whole')
    json.dump(report, open(sys.argv[2], 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    done = sum(1 for r in report if 'out' in r)
    flagged = sum(1 for r in report if r.get('flags') or r.get('error'))
    print(f'{done} takes prepared, {flagged} to look at → {sys.argv[2]}')


if __name__ == '__main__':
    main()
