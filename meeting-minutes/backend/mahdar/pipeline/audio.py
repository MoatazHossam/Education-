"""Agent 1 — audio intake and quality analysis.

* Validates the upload with ffprobe (format, codec, duration, channels) against the limits.
* Keeps the original untouched (stored encrypted as ``audio_original``) and produces a 16 kHz mono
  working copy (``audio_normalized``): FFmpeg resampling, DC removal and a gentle loudness
  normalisation that never changes timing, so timestamps stay valid for the original too.
* Measures loudness, peak, clipping, speech ratio (Silero VAD), an SNR estimate, silences, and
  plans overlapping chunks cut at silences for long recordings.
"""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from mahdar.pipeline.schemas import AudioQualityReport, Chunk, Interval, Issue

SAMPLE_RATE = 16000
ALLOWED_CONTAINERS = {
    "mp3",
    "wav",
    "flac",
    "ogg",
    "mov,mp4,m4a,3gp,3g2,mj2",
    "matroska,webm",
    "aac",
    "asf",
    "amr",
    "caf",
    "aiff",
}
ALLOWED_EXTENSIONS = {
    ".mp3",
    ".wav",
    ".m4a",
    ".mp4",
    ".aac",
    ".ogg",
    ".oga",
    ".opus",
    ".flac",
    ".webm",
    ".wma",
    ".amr",
    ".aiff",
    ".caf",
}


class AudioError(Exception):
    def __init__(self, code: str, message_ar: str):
        super().__init__(message_ar)
        self.code = code
        self.message_ar = message_ar


@dataclass
class ProbeResult:
    format_name: str
    codec: str | None
    sample_rate: int | None
    channels: int | None
    duration: float


def probe(path: Path) -> ProbeResult:
    try:
        out = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-protocol_whitelist",
                "file",
                "-print_format",
                "json",
                "-show_format",
                "-show_streams",
                str(path),
            ],
            capture_output=True,
            check=True,
            timeout=120,
        ).stdout
    except subprocess.CalledProcessError as exc:
        raise AudioError("unreadable", "تعذر قراءة الملف الصوتي: الصيغة غير مدعومة أو الملف تالف.") from exc
    info = json.loads(out or b"{}")
    audio = [s for s in info.get("streams", []) if s.get("codec_type") == "audio"]
    if not audio:
        raise AudioError("no_audio", "الملف لا يحتوي على مسار صوتي.")
    fmt = info.get("format", {})
    names = set((fmt.get("format_name") or "").split(","))
    allowed = {n for group in ALLOWED_CONTAINERS for n in group.split(",")}
    if not names & allowed:
        # Playlists and other indirect formats (hls, concat, ...) could make FFmpeg read other files.
        raise AudioError(
            "format", "صيغة الحاوية غير مدعومة؛ ارفع ملفاً صوتياً عادياً (MP3 أو WAV أو M4A أو OGG أو FLAC أو WEBM)."
        )
    duration = float(fmt.get("duration") or audio[0].get("duration") or 0)
    if duration <= 0:
        raise AudioError("empty", "مدة التسجيل صفر أو غير معروفة.")
    s = audio[0]
    return ProbeResult(
        format_name=fmt.get("format_name", "unknown"),
        codec=s.get("codec_name"),
        sample_rate=int(s["sample_rate"]) if s.get("sample_rate") else None,
        channels=int(s["channels"]) if s.get("channels") else None,
        duration=duration,
    )


def validate(path: Path, *, filename: str, max_bytes: int, max_seconds: float) -> ProbeResult:
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise AudioError(
            "extension",
            f"امتداد الملف «{ext or 'بدون امتداد'}» غير مدعوم. الصيغ المدعومة: MP3 وWAV وM4A وOGG وFLAC وWEBM.",
        )
    size = path.stat().st_size
    if size > max_bytes:
        raise AudioError(
            "too_large", f"حجم الملف ({size / 1e6:.0f} ميجابايت) يتجاوز الحد المسموح ({max_bytes / 1e6:.0f} ميجابايت)."
        )
    p = probe(path)
    if p.duration > max_seconds:
        raise AudioError(
            "too_long", f"مدة التسجيل ({p.duration / 60:.0f} دقيقة) تتجاوز الحد المسموح ({max_seconds / 60:.0f} دقيقة)."
        )
    return p


def normalize(src: Path, dst: Path) -> Path:
    """16 kHz mono 16-bit WAV. highpass removes rumble/DC; dynaudnorm evens out quiet and loud
    speakers without moving any sample in time."""
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-v",
            "error",
            "-y",
            "-i",
            str(src),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(SAMPLE_RATE),
            "-af",
            "highpass=f=60,dynaudnorm=f=250:g=15:p=0.9:m=8",
            "-c:a",
            "pcm_s16le",
            str(dst),
        ],
        check=True,
        timeout=3600,
    )
    return dst


def load_samples(path: Path, start: float | None = None, end: float | None = None) -> np.ndarray:
    cmd = ["ffmpeg", "-nostdin", "-protocol_whitelist", "file,pipe", "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    if end is not None:
        cmd += ["-to", f"{end:.3f}"] if start is None else ["-t", f"{end - start:.3f}"]
    cmd += ["-i", str(path), "-ac", "1", "-ar", str(SAMPLE_RATE), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True, timeout=3600).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def _loudness(path: Path) -> float | None:
    """Integrated loudness (EBU R128) of the original, from FFmpeg's ebur128 filter."""
    proc = subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-hide_banner",
            "-i",
            str(path),
            "-vn",
            "-af",
            "ebur128=framelog=quiet",
            "-f",
            "null",
            "-",
        ],
        capture_output=True,
        text=True,
        timeout=3600,
    )
    for line in reversed(proc.stderr.splitlines()):
        line = line.strip()
        if line.startswith("I:") and "LUFS" in line:
            try:
                return float(line.split()[1])
            except (IndexError, ValueError):
                return None
    return None


def speech_regions(samples: np.ndarray) -> list[tuple[float, float]]:
    from faster_whisper.vad import VadOptions, get_speech_timestamps

    opts = VadOptions(threshold=0.5, min_silence_duration_ms=300, speech_pad_ms=150, min_speech_duration_ms=200)
    stamps = get_speech_timestamps(samples, opts, sampling_rate=SAMPLE_RATE)
    return [(s["start"] / SAMPLE_RATE, s["end"] / SAMPLE_RATE) for s in stamps]


def plan_chunks(duration: float, silences: list[tuple[float, float]], target_s: float, overlap_s: float) -> list[Chunk]:
    """Cuts near every ``target_s`` seconds, at the middle of the nearest silence (within 60 s), and
    extends each chunk by ``overlap_s`` on both sides; words in an overlap are kept once (asr.merge)."""
    if duration <= target_s * 1.2:
        return [Chunk(index=0, start=0.0, end=round(duration, 3))]
    cuts: list[float] = []
    pos = target_s
    while pos < duration - target_s * 0.2:
        near = [((a + b) / 2, abs((a + b) / 2 - pos)) for a, b in silences if abs((a + b) / 2 - pos) <= 60]
        cut = min(near, key=lambda x: x[1])[0] if near else pos
        cuts.append(cut)
        pos = cut + target_s
    bounds = [0.0, *cuts, duration]
    return [
        Chunk(
            index=i,
            start=round(max(0.0, bounds[i] - (overlap_s if i else 0)), 3),
            end=round(min(duration, bounds[i + 1] + (overlap_s if i + 1 < len(bounds) - 1 else 0)), 3),
        )
        for i in range(len(bounds) - 1)
    ]


def analyse(
    original: Path, normalized: Path, probe_result: ProbeResult, *, chunk_minutes: float, overlap_seconds: float
) -> AudioQualityReport:
    sha = hashlib.sha256()
    with open(original, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            sha.update(block)
    orig = load_samples(original)
    work = load_samples(normalized)
    duration = len(work) / SAMPLE_RATE
    peak = float(np.max(np.abs(orig))) if orig.size else 0.0
    clipping = float(np.mean(np.abs(orig) >= 0.999)) if orig.size else 0.0
    speech = speech_regions(work)
    speech_seconds = sum(b - a for a, b in speech)
    silences: list[tuple[float, float]] = []
    last = 0.0
    for a, b in speech:
        if a - last >= 1.0:
            silences.append((last, a))
        last = b
    if duration - last >= 1.0:
        silences.append((last, duration))
    snr = _snr(orig, speech, duration)
    loud = _loudness(original)
    issues: list[Issue] = []
    speech_ratio = speech_seconds / duration if duration else 0.0
    long_sil = [(a, b) for a, b in silences if b - a >= 30]
    if speech_ratio < 0.05:
        issues.append(Issue(code="no_speech", severity="critical", message_ar="لم يُرصد كلام تقريباً في التسجيل."))
    elif speech_ratio < 0.3:
        issues.append(
            Issue(
                code="low_speech",
                severity="major",
                message_ar=f"نسبة الكلام منخفضة ({speech_ratio:.0%} من مدة التسجيل).",
            )
        )
    if clipping > 0.001:
        issues.append(
            Issue(
                code="clipping",
                severity="major" if clipping > 0.01 else "minor",
                message_ar=f"تشوه بسبب ارتفاع مستوى الصوت (تشبع) في {clipping:.1%} من العينات.",
            )
        )
    if loud is not None and loud < -40:
        issues.append(Issue(code="quiet", severity="major", message_ar=f"مستوى الصوت منخفض جداً ({loud:.0f} LUFS)."))
    if snr is not None and snr < 10:
        issues.append(
            Issue(
                code="noisy",
                severity="major" if snr < 5 else "minor",
                message_ar=f"ضوضاء خلفية مرتفعة (نسبة الإشارة إلى الضوضاء نحو {snr:.0f} ديسيبل).",
            )
        )
    for a, b in long_sil:
        issues.append(
            Issue(
                code="long_silence",
                severity="info",
                message_ar=f"صمت طويل ({b - a:.0f} ثانية).",
                start=round(a, 2),
                end=round(b, 2),
            )
        )
    if probe_result.sample_rate and probe_result.sample_rate < 16000:
        issues.append(
            Issue(
                code="low_sample_rate",
                severity="minor",
                message_ar=f"معدل العينات الأصلي منخفض ({probe_result.sample_rate} هرتز)، وقد يقل وضوح الكلام.",
            )
        )
    worst = {i.severity for i in issues}
    overall = (
        "poor"
        if worst & {"critical"} or len([i for i in issues if i.severity == "major"]) >= 2
        else ("fair" if worst & {"major", "minor"} else "good")
    )
    return AudioQualityReport(
        recording_sha256=sha.hexdigest(),
        original_format=probe_result.format_name,
        original_codec=probe_result.codec,
        original_sample_rate=probe_result.sample_rate,
        original_channels=probe_result.channels,
        duration_seconds=round(duration, 3),
        size_bytes=original.stat().st_size,
        loudness_lufs=loud,
        peak_dbfs=round(20 * math.log10(peak), 2) if peak > 0 else None,
        clipping_ratio=round(clipping, 5),
        speech_ratio=round(speech_ratio, 4),
        estimated_snr_db=round(snr, 1) if snr is not None else None,
        silences=[Interval(start=round(a, 2), end=round(b, 2)) for a, b in silences],
        long_silences=[Interval(start=round(a, 2), end=round(b, 2)) for a, b in long_sil],
        chunks=plan_chunks(duration, silences, chunk_minutes * 60, overlap_seconds),
        issues=issues,
        overall=overall,
    )


def _snr(samples: np.ndarray, speech: list[tuple[float, float]], duration: float) -> float | None:
    if not speech or samples.size == 0:
        return None
    mask = np.zeros(samples.size, dtype=bool)
    for a, b in speech:
        mask[int(a * SAMPLE_RATE) : int(b * SAMPLE_RATE)] = True
    sp, noise = samples[mask], samples[~mask]
    if noise.size < SAMPLE_RATE * 0.5 or sp.size == 0:
        return None
    p_sig = float(np.mean(sp**2))
    p_noise = float(np.mean(noise**2)) or 1e-12
    return 10 * math.log10(max(p_sig - p_noise, 1e-12) / p_noise)


def extract_clip(path: Path, start: float, end: float, dst: Path) -> Path:
    """An MP3 excerpt for playback in the review interface."""
    subprocess.run(
        [
            "ffmpeg",
            "-nostdin",
            "-protocol_whitelist",
            "file,pipe",
            "-v",
            "error",
            "-y",
            "-ss",
            f"{max(0.0, start):.3f}",
            "-t",
            f"{max(0.1, end - start):.3f}",
            "-i",
            str(path),
            "-ac",
            "1",
            "-c:a",
            "libmp3lame",
            "-b:a",
            "64k",
            str(dst),
        ],
        check=True,
        timeout=300,
    )
    return dst
