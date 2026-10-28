"""Audio for a cut: an original score, sound effects and the narration, mixed.

    python3 audio/mix.py <events.json> <out.wav> [--music-stem <file.wav>]

events.json comes from build.mjs: the cut's duration, its music cues (one per scene), the narration
clips with their start times (absent until narration is recorded), and the sound-effect events
(transitions, reveals, clicks in the product demonstrations).

The score is composed in audio/score.py and played on recorded instruments (FluidSynth with the MIT-licensed
FluidR3 soundfont): piano, strings, cello, harp, celesta, a warm pad, bass and soft percussion, brought in and out
by the scene's cue. Without FluidSynth or the soundfont (or with SYNTH_SCORE=1) the older synthesised score below
is used. Under narration the music is ducked.
"""
import json
import os
import sys

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, oaconvolve, sosfilt

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import score as sampled  # noqa: E402

SR = 48000
BPM = 84
BEAT = 60 / BPM
CHORD = 8 * BEAT  # two bars per chord
RNG = np.random.default_rng(7)


def hz(midi):
    return 440.0 * 2 ** ((midi - 69) / 12)


# Bm(add9) – Gmaj7 – D(add9) – A(sus2→A): vi–IV–I–V in D major.
PROGRESSION = [
    {'root': 35, 'pad': [59, 62, 66, 73], 'arp': [59, 62, 66, 71, 74, 78]},
    {'root': 31, 'pad': [55, 59, 62, 66], 'arp': [55, 59, 62, 67, 71, 74]},
    {'root': 38, 'pad': [62, 66, 69, 76], 'arp': [62, 66, 69, 74, 78, 81]},
    {'root': 33, 'pad': [57, 61, 64, 71], 'arp': [57, 61, 64, 69, 73, 76]},
]

# Instrument levels per cue: pad, bass, arpeggio, bells, pulse; and the pad's brightness (Hz).
CUES = {
    'open':      dict(pad=0.75, bass=0.55, arp=0.0,  bell=0.18, pulse=0.0,  cutoff=1100,  arp_rate=2),
    'reveal':    dict(pad=1.0,  bass=0.8,  arp=0.35, bell=0.45, pulse=0.0,  cutoff=3200, arp_rate=2),
    'vision':    dict(pad=0.8,  bass=0.6,  arp=0.5,  bell=0.22, pulse=0.0,  cutoff=2200, arp_rate=2),
    'segments':  dict(pad=0.75, bass=0.6,  arp=0.55, bell=0.15, pulse=0.15, cutoff=2200, arp_rate=2),
    'demo':      dict(pad=0.6,  bass=0.5,  arp=0.6,  bell=0.08, pulse=0.22, cutoff=2500, arp_rate=4),
    'features':  dict(pad=0.6,  bass=0.5,  arp=0.65, bell=0.1,  pulse=0.25, cutoff=2100, arp_rate=4),
    'classroom': dict(pad=0.62, bass=0.5,  arp=0.6,  bell=0.12, pulse=0.25, cutoff=2200, arp_rate=4),
    'student':   dict(pad=0.6,  bass=0.42, arp=0.7,  bell=0.25, pulse=0.18, cutoff=2500, arp_rate=4),
    'ai':        dict(pad=0.7,  bass=0.4,  arp=0.3,  bell=0.6,  pulse=0.0,  cutoff=3000, arp_rate=2),
    'saas':      dict(pad=0.62, bass=0.62, arp=0.6,  bell=0.1,  pulse=0.4,  cutoff=2200, arp_rate=4),
    'finale':    dict(pad=0.9,  bass=0.7,  arp=0.75, bell=0.4,  pulse=0.5,  cutoff=3200, arp_rate=4),
}
LAYERS = ['pad', 'bass', 'arp', 'bell', 'pulse']


def env(n, attack, release, total=None):
    """Linear attack, sustain, cosine release over n samples."""
    e = np.ones(n, dtype=np.float32)
    a = min(n, int(attack * SR))
    if a:
        e[:a] = np.linspace(0, 1, a, dtype=np.float32)
    r = min(n, int(release * SR))
    if r:
        e[-r:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, r))).astype(np.float32)
    return e


def lowpass(x, cutoff, order=2):
    sos = butter(order, cutoff / (SR / 2), btype='low', output='sos')
    return sosfilt(sos, x, axis=0).astype(np.float32)


_cache = {}


def pad_chord(ci, cutoff):
    key = ('pad', ci, cutoff)
    if key in _cache:
        return _cache[key]
    dur = CHORD + 2.2
    n = int(dur * SR)
    t = np.arange(n, dtype=np.float32) / SR
    out = np.zeros((n, 2), dtype=np.float32)
    for vi, note in enumerate(PROGRESSION[ci]['pad']):
        for d, pan in ((-7, 0.25), (0, 0.5), (7, 0.75)):
            f = hz(note) * 2 ** (d / 1200)
            ph = RNG.uniform(0, 2 * np.pi)
            w = np.zeros(n, dtype=np.float32)
            for k in range(1, 9):
                if f * k > 9000:
                    break
                w += (np.sin(2 * np.pi * f * k * t + ph * k) / k ** 1.5).astype(np.float32)
            # Slow movement inside the sound.
            w *= (0.85 + 0.15 * np.sin(2 * np.pi * (0.13 + 0.02 * vi) * t + ph)).astype(np.float32)
            out[:, 0] += w * (1 - pan)
            out[:, 1] += w * pan
    out *= env(n, 1.6, 2.4)[:, None]
    out = lowpass(out, cutoff)
    out /= np.max(np.abs(out)) + 1e-9
    _cache[key] = out
    return out


def bass_note(ci):
    key = ('bass', ci)
    if key in _cache:
        return _cache[key]
    n = int((CHORD + 1.2) * SR)
    t = np.arange(n, dtype=np.float32) / SR
    f = hz(PROGRESSION[ci]['root'])
    w = np.sin(2 * np.pi * f * t) + 0.25 * np.sin(2 * np.pi * 2 * f * t)
    w = (w * env(n, 0.4, 1.2)).astype(np.float32)
    out = np.stack([w, w], axis=1)
    out /= np.max(np.abs(out)) + 1e-9
    _cache[key] = out
    return out


def pluck(note, vel):
    key = ('pluck', note, round(vel, 2))
    if key in _cache:
        return _cache[key]
    n = int(1.1 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    f = hz(note)
    w = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t * 9) + 0.12 * np.sin(2 * np.pi * 3 * f * t) * np.exp(-t * 14)
    w *= np.exp(-t * 3.2) * np.minimum(1, t / 0.004)
    w = (w * vel).astype(np.float32)
    _cache[key] = w
    return w


def bell(note):
    key = ('bell', note)
    if key in _cache:
        return _cache[key]
    n = int(4.0 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    f = hz(note)
    w = np.zeros(n, dtype=np.float32)
    for ratio, amp, dec in ((1, 1, 1.2), (2.76, 0.4, 2.0), (5.4, 0.18, 3.5), (8.93, 0.08, 5)):
        w += (amp * np.sin(2 * np.pi * f * ratio * t) * np.exp(-t * dec)).astype(np.float32)
    w *= np.minimum(1, t / 0.003)
    _cache[key] = w
    return w


def kick():
    n = int(0.45 * SR)
    t = np.arange(n, dtype=np.float32) / SR
    f = 46 + 70 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) * np.exp(-t * 8)).astype(np.float32)


def hat():
    n = int(0.08 * SR)
    noise = RNG.standard_normal(n).astype(np.float32)
    sos = butter(2, 7000 / (SR / 2), btype='high', output='sos')
    return (sosfilt(sos, noise) * np.exp(-np.arange(n) / SR * 60)).astype(np.float32)


def add(buf, start, sig, gain=1.0, pan=0.5):
    i = int(start * SR)
    if i >= len(buf):
        return
    if sig.ndim == 1:
        sig = np.stack([sig * (1 - pan) * 2 ** 0.5, sig * pan * 2 ** 0.5], axis=1)
    j = min(len(buf), i + len(sig))
    if i < 0:
        sig = sig[-i:]
        i = 0
    buf[i:j] += sig[: j - i] * gain


def cue_at(cues, t):
    for c in cues:
        if c['t0'] <= t < c['t1']:
            return c['cue']
    return cues[-1]['cue']


def layer_curves(cues, n):
    """Per-layer gain over time, ramping over 3 s at cue changes."""
    t = np.arange(n, dtype=np.float32) / SR
    curves = {}
    for layer in LAYERS:
        pts_t, pts_v = [0.0], [CUES[cues[0]['cue']][layer]]
        for c in cues[1:]:
            v = CUES[c['cue']][layer]
            if v != pts_v[-1]:
                pts_t += [c['t0'] - 1.5, c['t0'] + 1.5]
                pts_v += [pts_v[-1], v]
        curves[layer] = np.interp(t, pts_t, pts_v).astype(np.float32)
    return curves


def reverb_ir(seconds=2.6):
    n = int(seconds * SR)
    t = np.arange(n, dtype=np.float32) / SR
    ir = RNG.standard_normal((n, 2)).astype(np.float32) * np.exp(-t * (6.9 / seconds))[:, None]
    ir = lowpass(ir, 5200)
    ir[: int(0.012 * SR)] = 0
    return ir / np.sqrt(np.sum(ir ** 2, axis=0, keepdims=True))


def score(cues, duration):
    n = int((duration + 4) * SR)
    layers = {k: np.zeros((n, 2), dtype=np.float32) for k in LAYERS}
    k = 0
    while k * CHORD < duration + 1:
        t0 = k * CHORD
        ci = k % len(PROGRESSION)
        cue = CUES[cue_at(cues, t0 + 0.5)]
        add(layers['pad'], t0, pad_chord(ci, cue['cutoff']), 0.5)
        add(layers['bass'], t0, bass_note(ci), 0.38)
        # Arpeggio: 8ths or 16ths through the chord, gently varied.
        notes = PROGRESSION[ci]['arp']
        step = BEAT / (cue['arp_rate'] / 1.0) if cue['arp_rate'] else BEAT
        pattern = [0, 2, 4, 5, 3, 1, 2, 4]
        m = 0
        while m * step < CHORD - 1e-6:
            note = notes[pattern[m % len(pattern)]] + (12 if (m // 8) % 2 and cue['arp_rate'] == 4 else 0)
            vel = 0.55 + 0.25 * ((m % 4) == 0) + 0.1 * RNG.random()
            add(layers['arp'], t0 + m * step, pluck(note, vel), 0.16, pan=0.3 + 0.4 * ((m % 2) == 0))
            m += 1
        # Bells on the chord change, an octave and a fifth up.
        add(layers['bell'], t0 + BEAT * 0.02, bell(PROGRESSION[ci]['pad'][-1] + 12), 0.09, pan=0.65)
        add(layers['bell'], t0 + 4 * BEAT, bell(PROGRESSION[ci]['pad'][1] + 24), 0.05, pan=0.35)
        # Pulse: soft kick on 1 and 3, a hat on the off-beats.
        for b in range(8):
            if b % 2 == 0:
                add(layers['pulse'], t0 + b * BEAT, kick(), 0.32)
            add(layers['pulse'], t0 + (b + 0.5) * BEAT, hat(), 0.05, pan=0.6)
        k += 1
    curves = layer_curves(cues, n)
    dry = np.zeros((n, 2), dtype=np.float32)
    wet_send = np.zeros((n, 2), dtype=np.float32)
    for layer in LAYERS:
        sig = layers[layer] * curves[layer][:, None]
        dry += sig
        if layer != 'pulse':
            wet_send += sig * (0.55 if layer in ('pad', 'bell') else 0.35)
    wet = oaconvolve(wet_send, reverb_ir(), axes=0, mode='full')[:n].astype(np.float32)
    music = dry + 0.42 * wet
    # Fade in at the start, out at the end.
    music[: int(1.5 * SR)] *= np.linspace(0, 1, int(1.5 * SR), dtype=np.float32)[:, None]
    end = int(duration * SR)
    fade = int(5.0 * SR)
    music[end - fade:end] *= np.linspace(1, 0, fade, dtype=np.float32)[:, None] ** 1.5
    music[end:] = 0
    return music[:end]


# ---------------------------------------------------------------- sound effects
def sfx(kind):
    if kind == 'whoosh':
        n = int(1.1 * SR)
        t = np.arange(n) / SR
        noise = RNG.standard_normal(n).astype(np.float32)
        out = np.zeros(n, dtype=np.float32)
        # A band that sweeps up then settles.
        for i0 in range(0, n, 2400):
            seg = noise[i0:i0 + 2400]
            fc = 300 + 2600 * np.sin(np.pi * min(1, i0 / n)) ** 2
            sos = butter(2, [fc * 0.6 / (SR / 2), min(0.99, fc * 1.6 / (SR / 2))], btype='band', output='sos')
            out[i0:i0 + len(seg)] = sosfilt(sos, seg)
        e = np.sin(np.pi * np.clip(t / 1.1, 0, 1)) ** 2
        return (out * e).astype(np.float32)
    if kind == 'impact':
        n = int(2.4 * SR)
        t = np.arange(n) / SR
        boom = np.sin(2 * np.pi * (42 + 30 * np.exp(-t * 6)) * t) * np.exp(-t * 2.2)
        noise = lowpass(RNG.standard_normal(n).astype(np.float32), 900) * np.exp(-t * 5) * 0.6
        return (boom + noise).astype(np.float32)
    if kind == 'riser':
        n = int(2.6 * SR)
        t = np.arange(n) / SR
        noise = RNG.standard_normal(n).astype(np.float32)
        out = np.zeros(n, dtype=np.float32)
        for i0 in range(0, n, 2400):
            fc = 400 + 5000 * (i0 / n) ** 2
            sos = butter(2, [fc * 0.7 / (SR / 2), min(0.99, fc * 1.4 / (SR / 2))], btype='band', output='sos')
            out[i0:i0 + 2400] = sosfilt(sos, noise[i0:i0 + 2400])
        tone = 0.25 * np.sin(2 * np.pi * np.cumsum(220 + 440 * (t / 2.6) ** 2) / SR)
        return ((out + tone) * (t / 2.6) ** 2).astype(np.float32)
    if kind == 'click':
        n = int(0.05 * SR)
        t = np.arange(n) / SR
        c = np.sin(2 * np.pi * 2300 * t) * np.exp(-t * 180) + 0.5 * RNG.standard_normal(n) * np.exp(-t * 400)
        return lowpass(c.astype(np.float32), 6000)
    if kind == 'chime':
        return bell(86) * 0.6
    raise ValueError(kind)


SFX_GAIN = {'whoosh': 0.16, 'impact': 0.5, 'riser': 0.12, 'click': 0.05, 'chime': 0.07}


def db(x):
    return 10 ** (x / 20)


def main():
    events = json.load(open(sys.argv[1]))
    out = sys.argv[2]
    stem = sys.argv[sys.argv.index('--music-stem') + 1] if '--music-stem' in sys.argv else None
    duration = events['duration']
    n = int(duration * SR)
    override = events.get('musicOverride')
    if override:
        # A licensed or composed track supplied by the owner replaces the generated score.
        sr, raw = wavfile.read(override)
        data = raw.astype(np.float32) / (float(np.iinfo(raw.dtype).max) if raw.dtype.kind == 'i' else 1.0)
        if data.ndim == 1:
            data = np.stack([data, data], axis=1)
        if sr != SR:
            idx = np.arange(0, len(data), sr / SR)
            data = np.stack([np.interp(idx, np.arange(len(data)), data[:, c]) for c in range(2)], axis=1).astype(np.float32)
        music = np.zeros((n, 2), dtype=np.float32)
        music[: min(n, len(data))] = data[:n] / (np.max(np.abs(data)) + 1e-9)
    else:
        music = None if os.environ.get('SYNTH_SCORE') else sampled.render(events['cues'], duration)
        if music is None:
            music = score(events['cues'], duration)
    if stem:
        wavfile.write(stem, SR, (music / (np.max(np.abs(music)) + 1e-9) * 0.89).astype(np.float32))

    voice = np.zeros((n, 2), dtype=np.float32)
    for clip in events['narration']:
        sr, raw = wavfile.read(clip['file'])
        data = raw.astype(np.float32)
        if raw.dtype.kind == 'i':
            data /= float(np.iinfo(raw.dtype).max)
        if data.ndim == 2:
            data = data.mean(axis=1)
        if sr != SR:
            idx = np.arange(0, len(data), sr / SR)
            data = np.interp(idx, np.arange(len(data)), data).astype(np.float32)
        # Each clip at a common speech level (RMS -20 dBFS).
        rms = np.sqrt(np.mean(data ** 2)) + 1e-9
        data *= db(-20) / rms
        add(voice, clip['t'], data, 1.0, pan=0.5)

    # Music level: -27 dB under speech, -15 dB elsewhere (narration absent: the music carries the cut).
    has_voice = len(events['narration']) > 0
    level = np.full(n, db(-15 if not has_voice else -17), dtype=np.float32)
    if has_voice:
        speech = np.abs(voice[:, 0])
        win = int(0.05 * SR)
        env_v = np.convolve(speech, np.ones(win, dtype=np.float32) / win, mode='same')
        active = (env_v > db(-45)).astype(np.float32)
        # Attack 0.15 s, release 0.7 s on the ducking.
        duck = np.zeros(n, dtype=np.float32)
        a, r = 1 / (0.15 * SR), 1 / (0.7 * SR)
        g = 0.0
        for i in range(0, n, 480):
            target = active[i]
            g += (target - g) * (min(1, a * 480) if target > g else min(1, r * 480))
            duck[i:i + 480] = g
        level *= db(-10) ** duck
    mix = music[:n] * level[:, None] + voice

    fx = np.zeros((n, 2), dtype=np.float32)
    for e in events['sfx']:
        add(fx, e['t'], sfx(e['kind']), SFX_GAIN[e['kind']] * e.get('gain', 1.0), pan=e.get('pan', 0.5))
    mix += fx * db(-6)
    peak = np.max(np.abs(mix))
    if peak > 0.98:
        mix *= 0.98 / peak
    wavfile.write(out, SR, mix.astype(np.float32))
    print(f'mixed {duration:.1f} s, narration clips {len(events["narration"])}, sfx {len(events["sfx"])}, peak {20 * np.log10(peak + 1e-9):.1f} dBFS')


if __name__ == '__main__':
    main()
