"""The background score, played on recorded instruments: composed here (chords, voicing, a pattern per scene cue),
written as MIDI, and rendered with FluidSynth and the FluidR3 General MIDI soundfont (MIT licence, Frank Wen;
Ubuntu/Debian package fluid-soundfont-gm). Each instrument is rendered on its own so the cue of every scene can
bring instruments in and out over a few seconds; mix.py ducks the result under the narration.

    render(cues, duration) -> stereo float32 at 48 kHz, or None when FluidSynth or the soundfont is missing

D major, 84 BPM, one chord every two bars. Four progressions (main, bright, steady, air) share the grid, so a
change of cue never breaks the phrase; the last two chords resolve to D.
"""
import os
import re
import shutil
import struct
import subprocess
import tempfile
import warnings

import numpy as np
from scipy.io import wavfile

SR = 48000
BPM = 84
BEAT = 60 / BPM
SLOT = 8 * BEAT
TPB = 480
TARGET_LUFS = -13.7
SOUNDFONT = os.environ.get('SOUNDFONT', '/usr/share/sounds/sf2/FluidR3_GM.sf2')

# (bass pitch class, chord pitch classes)
CHORDS = {
    'Bm9': (11, [11, 2, 6, 9, 1]), 'Gmaj7': (7, [7, 11, 2, 6]), 'D/F#': (6, [2, 6, 9, 4]),
    'Asus4': (9, [9, 2, 4]), 'A': (9, [9, 1, 4]), 'G': (7, [7, 11, 2, 9]), 'Em7': (4, [4, 7, 11, 2]),
    'D': (2, [2, 6, 9, 4]), 'A/C#': (1, [9, 1, 4, 11]), 'Bm7': (11, [11, 2, 6, 9]), 'Em9': (4, [4, 7, 11, 2, 6]),
    'Asus2': (9, [9, 11, 4]),
}
PROGRESSIONS = {
    'main': ['Bm9', 'Gmaj7', 'D/F#', 'Asus4'],
    'bright': ['G', 'D/F#', 'Em7', 'Asus4'],
    'steady': ['D', 'A/C#', 'Bm7', 'G'],
    'air': ['Gmaj7', 'Em9', 'Bm7', 'Asus2'],
}

# Per cue: progression, piano pattern, and each instrument's level (0–1).
STYLE = {
    'open':      ('main',   'sparse',  dict(piano=0.9,  strings=0.55, cello=0.5,  pad=0.45, harp=0.0,  celesta=0.25, bass=0.0,  drums=0.0)),
    'reveal':    ('bright', 'chords',  dict(piano=1.0,  strings=1.0,  cello=0.8,  pad=0.5,  harp=0.6,  celesta=0.6,  bass=0.0,  drums=0.0)),
    'vision':    ('air',    'broken',  dict(piano=0.75, strings=0.75, cello=0.6,  pad=0.55, harp=0.8,  celesta=0.3,  bass=0.0,  drums=0.0)),
    'segments':  ('main',   'broken',  dict(piano=0.8,  strings=0.6,  cello=0.55, pad=0.45, harp=0.3,  celesta=0.15, bass=0.35, drums=0.25)),
    'demo':      ('steady', 'eighths', dict(piano=0.75, strings=0.5,  cello=0.45, pad=0.45, harp=0.0,  celesta=0.1,  bass=0.5,  drums=0.35)),
    'features':  ('steady', 'eighths', dict(piano=0.75, strings=0.55, cello=0.45, pad=0.45, harp=0.15, celesta=0.1,  bass=0.5,  drums=0.35)),
    'classroom': ('main',   'eighths', dict(piano=0.75, strings=0.55, cello=0.5,  pad=0.45, harp=0.25, celesta=0.15, bass=0.5,  drums=0.3)),
    'student':   ('bright', 'broken',  dict(piano=0.8,  strings=0.55, cello=0.45, pad=0.45, harp=0.6,  celesta=0.3,  bass=0.35, drums=0.25)),
    'ai':        ('air',    'sparse',  dict(piano=0.7,  strings=0.7,  cello=0.45, pad=0.8,  harp=0.35, celesta=0.7,  bass=0.0,  drums=0.0)),
    'saas':      ('steady', 'eighths', dict(piano=0.75, strings=0.6,  cello=0.55, pad=0.45, harp=0.0,  celesta=0.1,  bass=0.6,  drums=0.45)),
    'finale':    ('bright', 'chords',  dict(piano=0.95, strings=1.0,  cello=0.8,  pad=0.5,  harp=0.6,  celesta=0.4,  bass=0.6,  drums=0.45)),
}

# General MIDI program, channel, reverb send, and the stem's level in the mix (dB, after normalising each stem).
INSTRUMENTS = {
    'piano':   (0, 0, 55, -19),
    'strings': (49, 1, 75, -19),
    'cello':   (42, 2, 60, -22),
    'pad':     (89, 3, 65, -29),
    'harp':    (46, 4, 70, -23),
    'celesta': (8, 5, 85, -28),
    'bass':    (32, 6, 30, -24),
    'drums':   (0, 9, 35, -27),
}


class Part:
    def __init__(self, seed):
        self.notes = []
        self.ccs = []
        self.rng = np.random.default_rng(seed)

    def note(self, t, dur, pitch, vel, jitter=0.008):
        t = max(0.0, t + float(self.rng.uniform(-jitter, jitter)))
        vel = int(np.clip(vel + self.rng.integers(-5, 6), 1, 127))
        self.notes.append((t, dur, int(pitch), vel))

    def cc(self, t, num, val):
        self.ccs.append((max(0.0, t), num, val))


def near(pcs, lo, hi, target):
    """The pitch of one of the pitch classes in [lo, hi] closest to target."""
    cands = [p for p in range(lo, hi + 1) if p % 12 in pcs]
    return min(cands, key=lambda p: (abs(p - target), p))


def voice(pcs, lo, hi, prev, n):
    """n chord tones in [lo, hi], each voice moving to the nearest tone (smooth voice leading)."""
    if prev is None:
        prev = list(np.linspace(lo + 4, hi - 4, n).round().astype(int))
    out = []
    for target in sorted(prev):
        cands = [p for p in range(lo, hi + 1) if p % 12 in pcs and p not in out]
        out.append(min(cands, key=lambda p: (abs(p - target), p)))
    # Make sure the voicing holds the chord's colour: the third or the added tone, not only roots.
    if len({p % 12 for p in out}) < min(3, len(set(pcs))):
        missing = [pc for pc in pcs if pc not in {p % 12 for p in out}]
        out[-1] = near([missing[0]], lo, hi, out[-1])
    return sorted(out)


def compose(cues, duration):
    """MIDI notes for every instrument over the cut."""
    parts = {k: Part(i + 3) for i, k in enumerate(INSTRUMENTS)}
    n_slots = int(np.ceil((duration + 1) / SLOT))
    prev = {'strings': None, 'pad': None, 'cello': 50, 'piano_rh': None}
    for k in range(n_slots):
        t0 = k * SLOT
        cue = cue_at(cues, t0 + 0.5)
        prog, pattern, _ = STYLE.get(cue, STYLE['demo'])
        name = PROGRESSIONS[prog][k % 4]
        if t0 >= duration - 2 * SLOT:
            name = 'D'  # the last chords resolve home
        halves = [('Asus4', 'A')] if name == 'Asus4' else [(name, name)]
        first, second = halves[0]
        for half, cname in enumerate((first, second)):
            bass_pc, pcs = CHORDS[cname]
            th = t0 + half * 4 * BEAT
            # Strings and pad: sustained, smoothly voiced.
            v = voice(pcs, 55, 79, prev['strings'], 4)
            prev['strings'] = v
            for p in v:
                parts['strings'].note(th, 4 * BEAT + 0.12, p, 62)
            pv = voice(pcs, 48, 67, prev['pad'], 3)
            prev['pad'] = pv
            for p in pv:
                parts['pad'].note(th, 4 * BEAT + 0.2, p, 55)
            # Cello: the bass note, held through the bar.
            c = near([bass_pc], 38, 52, prev['cello'])
            prev['cello'] = c
            parts['cello'].note(th, 4 * BEAT + 0.1, c, 64)
            # Bass guitar: a soft pulse on beats 1 and 3, a pickup into the next bar.
            b = near([bass_pc], 31, 43, c - 12)
            for beat, vel in ((0, 62), (2, 52), (3.5, 40)):
                parts['bass'].note(th + beat * BEAT, 0.9 * BEAT, b if beat < 3 else near(pcs, 31, 45, b + 2), vel, 0.005)
            # Piano: left hand on the bar, right hand in the cue's pattern; pedal per bar.
            parts['piano'].cc(th - 0.02, 64, 0)
            parts['piano'].cc(th + 0.03, 64, 100)
            lh = near([bass_pc], 38, 50, c)
            parts['piano'].note(th, 3.8 * BEAT, lh, 50)
            parts['piano'].note(th + 2 * BEAT, 1.8 * BEAT, near(pcs, lh + 5, lh + 16, lh + 7), 40)
            tones = sorted(p for p in range(60, 87) if p % 12 in pcs)
            piano_rh(parts['piano'], pattern, th, tones, k, half)
            # Harp: an ascending arpeggio opening the bar, a few notes falling back.
            if half == 0:
                arp = [p for p in range(50, 92) if p % 12 in pcs][:9]
                for i, p in enumerate(arp):
                    parts['harp'].note(th + i * BEAT / 4, 2.5 * BEAT, p, 48 + 2 * i)
            else:
                arp = sorted((p for p in range(62, 86) if p % 12 in pcs), reverse=True)[:4]
                for i, p in enumerate(arp):
                    parts['harp'].note(th + (1 + i) * BEAT / 2, 2 * BEAT, p, 46)
            # Celesta: a high chord tone at the bar, a second one later (more often in the airy cues).
            top = near(pcs, 79, 93, 86)
            parts['celesta'].note(th + 0.02, 2 * BEAT, top, 46)
            parts['celesta'].note(th + 2.5 * BEAT, 1.5 * BEAT, near(pcs, 74, 91, top - 5), 38)
            # Drums: kick on 1 and 3, shaker in eighths, a closed hat on the off-beats.
            for beat in range(4):
                parts['drums'].note(th + beat * BEAT, 0.2, 36, 50 if beat % 2 == 0 else 34, 0.004)
                for e in (0, 0.5):
                    parts['drums'].note(th + (beat + e) * BEAT, 0.1, 70, 30 if e else 22, 0.004)
                parts['drums'].note(th + (beat + 0.5) * BEAT, 0.1, 42, 26, 0.004)
    return parts


def piano_rh(part, pattern, th, tones, k, half):
    """The piano's right hand over one bar (4 beats) of the chord."""
    mid = [p for p in tones if 64 <= p <= 79] or tones
    if pattern == 'sparse':
        # A slow line: one chord tone on 1, another on 3 and on the "and" of 4 in the second bar.
        a = mid[(k + half) % len(mid)]
        part.note(th, 2 * BEAT, a, 52)
        part.note(th + 2 * BEAT, 1.5 * BEAT, mid[(k + half + 2) % len(mid)], 44)
        if half:
            part.note(th + 3.5 * BEAT, BEAT, mid[(k + 3) % len(mid)], 40)
    elif pattern == 'broken':
        seq = [0, 2, 4, 5, 3, 4, 2, 1]
        up = [p for p in tones if 62 <= p <= 84][:6] or tones[:6]
        for i in range(8):
            p = up[seq[i] % len(up)]
            part.note(th + i * BEAT / 2, 0.9 * BEAT, p, 50 if i % 2 == 0 else 42)
    elif pattern == 'eighths':
        lo3 = mid[:3] if len(mid) >= 3 else (mid * 3)[:3]
        seq = [0, 1, 2, 1, 0, 1, 2, 1]
        for i in range(8):
            part.note(th + i * BEAT / 2, 0.45 * BEAT, lo3[seq[i]], 52 if i in (0, 4) else 42)
    elif pattern == 'chords':
        chord = [p for p in tones if 60 <= p <= 76][-3:]
        for p in chord:
            part.note(th, 2.8 * BEAT, p, 56)
        for p in chord:
            part.note(th + 2.5 * BEAT, 1.4 * BEAT, p, 46)
        melody = [p for p in tones if 72 <= p <= 86]
        if melody:
            part.note(th + 0.01, 1.5 * BEAT, melody[(k * 2 + half) % len(melody)], 62)
            part.note(th + 3 * BEAT, BEAT, melody[(k * 2 + half + 1) % len(melody)], 52)


def cue_at(cues, t):
    for c in cues:
        if c['t0'] <= t < c['t1']:
            return c['cue']
    return cues[-1]['cue']


# ---------------------------------------------------------------- MIDI file
def varlen(n):
    out = [n & 0x7F]
    n >>= 7
    while n:
        out.append((n & 0x7F) | 0x80)
        n >>= 7
    return bytes(reversed(out))


def write_midi(path, part, program, channel, reverb):
    tick = lambda s: int(round(s / BEAT * TPB))  # noqa: E731
    ev = [(0, bytes([0xFF, 0x51, 3]) + int(60e6 / BPM).to_bytes(3, 'big'))]
    if channel != 9:
        ev.append((0, bytes([0xC0 | channel, program])))
    ev += [(0, bytes([0xB0 | channel, 7, 100])), (0, bytes([0xB0 | channel, 91, reverb])), (0, bytes([0xB0 | channel, 93, 0]))]
    for t, num, val in part.ccs:
        ev.append((tick(t), bytes([0xB0 | channel, num, val])))
    for t, dur, pitch, vel in part.notes:
        ev.append((tick(t), bytes([0x90 | channel, pitch, vel])))
        ev.append((tick(t + dur), bytes([0x80 | channel, pitch, 0])))
    ev.sort(key=lambda e: (e[0], e[1][0] & 0xF0 == 0x90))  # note-offs before note-ons at the same tick
    data = b''
    last = 0
    for t, msg in ev:
        data += varlen(t - last) + msg
        last = t
    data += varlen(0) + bytes([0xFF, 0x2F, 0])
    with open(path, 'wb') as f:
        f.write(b'MThd' + struct.pack('>IHHH', 6, 0, 1, TPB) + b'MTrk' + struct.pack('>I', len(data)) + data)


# ---------------------------------------------------------------- rendering
def gain_curve(cues, layer, n, ramp=3.0):
    """The instrument's level over time from the scene cues, moving over `ramp` seconds at each change."""
    t = np.arange(n, dtype=np.float32) / SR
    pts_t, pts_v = [0.0], [STYLE.get(cues[0]['cue'], STYLE['demo'])[2][layer]]
    for c in cues[1:]:
        v = STYLE.get(c['cue'], STYLE['demo'])[2][layer]
        if v != pts_v[-1]:
            pts_t += [c['t0'] - ramp / 2, c['t0'] + ramp / 2]
            pts_v += [pts_v[-1], v]
    return np.interp(t, pts_t, pts_v).astype(np.float32)


def render(cues, duration):
    fs = shutil.which('fluidsynth')
    if not fs or not os.path.exists(SOUNDFONT):
        return None
    n = int(duration * SR)
    parts = compose(cues, duration)
    music = np.zeros((n, 2), dtype=np.float32)
    with tempfile.TemporaryDirectory() as tmp:
        for name, (program, channel, reverb, level) in INSTRUMENTS.items():
            mid, wav = os.path.join(tmp, f'{name}.mid'), os.path.join(tmp, f'{name}.wav')
            write_midi(mid, parts[name], program, channel, reverb)
            subprocess.run([fs, '-ni', '-q', '-R', '1', '-C', '0', '-g', '0.4', '-r', str(SR), '-O', 'float', '-T', 'wav',
                            '-o', 'synth.reverb.room-size=0.72', '-o', 'synth.reverb.damp=0.35', '-o', 'synth.reverb.width=0.9',
                            '-o', 'synth.reverb.level=0.75', '-F', wav, SOUNDFONT, mid], check=True, capture_output=True)
            with warnings.catch_warnings():
                warnings.simplefilter('ignore', wavfile.WavFileWarning)  # FluidSynth adds a LIST chunk
                sr, x = wavfile.read(wav)
            x = x.astype(np.float32)
            if x.ndim == 1:
                x = np.stack([x, x], axis=1)
            x = x[:n] if len(x) >= n else np.pad(x, ((0, n - len(x)), (0, 0)))
            # Each stem at a set level where it plays, then shaped by the cues.
            curve = gain_curve(cues, name, n)
            active = curve > 0.05
            rms = np.sqrt(np.mean(x[active] ** 2)) if active.any() else 0.0
            if rms > 0:
                music += x * (10 ** (level / 20) / rms) * curve[:, None]
        # Bus: no sub-bass rumble, a lighter low end, a small dip where speech is most intelligible (so the
        # narrator sits in front), then a gentle compressor and a limiter, as a mixing engineer would do.
        raw, done = os.path.join(tmp, 'bus.wav'), os.path.join(tmp, 'bus-out.wav')
        wavfile.write(raw, SR, music)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', raw, '-af',
                        'highpass=f=40:poles=2,lowshelf=f=120:g=-3,equalizer=f=2000:width_type=o:width=1.5:g=-2.5,'
                        'acompressor=threshold=0.063:ratio=2.5:attack=15:release=250:knee=4,alimiter=limit=0.7:attack=4:release=60:level=disabled',
                        '-c:a', 'pcm_f32le', done], check=True)
        music = wavfile.read(done)[1].astype(np.float32)[:n]
    music[: int(2.0 * SR)] *= np.linspace(0, 1, int(2.0 * SR), dtype=np.float32)[:, None] ** 2
    fade = int(5.0 * SR)
    music[n - fade:] *= np.linspace(1, 0, fade, dtype=np.float32)[:, None] ** 1.5
    # The same loudness as the synthesised score had (-13.7 LUFS), so the balance with the voice set in mix.py
    # is unchanged.
    return music * 10 ** ((TARGET_LUFS - loudness(music)) / 20)


def loudness(x):
    """Integrated loudness (LUFS, EBU R128) measured by FFmpeg."""
    with tempfile.TemporaryDirectory() as tmp:
        path = os.path.join(tmp, 'm.wav')
        wavfile.write(path, SR, x.astype(np.float32))
        r = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', path, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True)
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', r.stderr)[-1])
