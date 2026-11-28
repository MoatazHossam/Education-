"""Cloud recognition providers (REST, through httpx). Each is used only when the privacy policy
allows sending audio to it (privacy.authorize), and every call is recorded in the processing
register by the orchestrator.

Status: implemented against each provider's published REST API; not exercised in this
repository's tests, which have no keys for them (docs/ARCHITECTURE.md §2, "What is verified").

* OpenAI: ``whisper-1`` returns segment and word times (verbose_json). Newer models
  (``gpt-transcribe``) are sent one voice-detected utterance (≤ 28 s) at a time, and the utterance
  bounds become the segment times, because their timestamp support is not documented.
* Deepgram Nova-3 Arabic (``ar-EG`` and other regional codes), with its own diarization.
* Azure AI Speech fast transcription (``ar-EG``...), with its own diarization.
"""

from __future__ import annotations

import json
import os
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

import httpx

from mahdar.pipeline.asr.base import AsrError, AsrOptions, RawSegment, RawWord

TIMEOUT = httpx.Timeout(600.0, connect=20.0)


def _excerpt(audio_path: Path, start: float, end: float, fmt: str = "mp3") -> Path:
    tmp = Path(tempfile.mkstemp(suffix=f".{fmt}")[1])
    codec = ["-c:a", "libmp3lame", "-b:a", "64k"] if fmt == "mp3" else ["-c:a", "pcm_s16le"]
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{start:.3f}", "-t", f"{end - start:.3f}", "-i", str(audio_path),
         "-ac", "1", "-ar", "16000", *codec, str(tmp)],
        check=True, timeout=600,
    )
    return tmp


def _raise_for(resp: httpx.Response, provider: str) -> None:
    if resp.status_code < 400:
        return
    retryable = resp.status_code in (408, 409, 425, 429) or resp.status_code >= 500
    # The body may echo request details; keep only the status in the error.
    raise AsrError(f"{provider} returned HTTP {resp.status_code}", retryable=retryable)


def _key(var: str, provider: str) -> str:
    value = os.environ.get(var, "")
    if not value:
        raise AsrError(f"{var} is not set for the {provider} provider", retryable=False)
    return value


class OpenAIProvider:
    name = "openai"
    diarizes = False

    def __init__(self, model: str | None = None):
        self.model = model or os.environ.get("MAHDAR_OPENAI_ASR_MODEL", "gpt-transcribe")
        self.base = os.environ.get("MAHDAR_OPENAI_BASE_URL", "https://api.openai.com/v1")

    def transcribe(self, audio_path: Path, start: float, end: float, opts: AsrOptions,
                   progress: Callable[[float], None] | None = None) -> list[RawSegment]:
        key = _key("OPENAI_API_KEY", "openai")
        headers = {"Authorization": f"Bearer {key}"}
        if self.model == "whisper-1":
            return self._native(audio_path, start, end, opts, headers)
        from mahdar.pipeline.audio import load_samples, speech_regions

        regions = _utterances(speech_regions(load_samples(audio_path, start, end)), max_len=28.0)
        out: list[RawSegment] = []
        with httpx.Client(timeout=TIMEOUT) as client:
            for i, (a, b) in enumerate(regions):
                clip = _excerpt(audio_path, start + a, start + b)
                try:
                    with open(clip, "rb") as f:
                        data = {"model": self.model, "language": opts.language, "response_format": "json"}
                        if opts.prompt:
                            data["prompt"] = opts.prompt
                        resp = client.post(f"{self.base}/audio/transcriptions", headers=headers, data=data,
                                           files={"file": (clip.name, f, "audio/mpeg")})
                finally:
                    clip.unlink(missing_ok=True)
                _raise_for(resp, "openai")
                text = (resp.json().get("text") or "").strip()
                if text:
                    out.append(RawSegment(start=round(start + a, 3), end=round(start + b, 3), text=text))
                if progress:
                    progress((i + 1) / len(regions))
        return out

    def _native(self, audio_path: Path, start: float, end: float, opts: AsrOptions, headers: dict) -> list[RawSegment]:
        clip = _excerpt(audio_path, start, end)
        try:
            with httpx.Client(timeout=TIMEOUT) as client, open(clip, "rb") as f:
                data = [("model", "whisper-1"), ("language", opts.language), ("response_format", "verbose_json"),
                        ("timestamp_granularities[]", "segment"), ("timestamp_granularities[]", "word")]
                if opts.prompt:
                    data.append(("prompt", opts.prompt))
                resp = client.post(f"{self.base}/audio/transcriptions", headers=headers, data=data,
                                   files={"file": (clip.name, f, "audio/mpeg")})
        finally:
            clip.unlink(missing_ok=True)
        _raise_for(resp, "openai")
        body = resp.json()
        words = [RawWord(w=w["word"], start=start + w["start"], end=start + w["end"]) for w in body.get("words", [])]
        segs = []
        for s in body.get("segments", []):
            a, b = start + s["start"], start + s["end"]
            segs.append(RawSegment(
                start=round(a, 3), end=round(b, 3), text=s["text"].strip(),
                words=[w for w in words if a <= (w.start + w.end) / 2 < b],
                avg_logprob=s.get("avg_logprob"), no_speech_prob=s.get("no_speech_prob"), compression_ratio=s.get("compression_ratio"),
            ))
        return segs


def _utterances(regions: list[tuple[float, float]], max_len: float) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    for a, b in regions:
        while b - a > max_len:
            out.append((a, a + max_len))
            a += max_len
        if out and b - out[-1][0] <= max_len and a - out[-1][1] < 0.8:
            out[-1] = (out[-1][0], b)
        else:
            out.append((a, b))
    return out


class DeepgramProvider:
    name = "deepgram"
    diarizes = True

    def __init__(self, model: str | None = None):
        self.model = model or os.environ.get("MAHDAR_DEEPGRAM_MODEL", "nova-3")
        self.base = os.environ.get("MAHDAR_DEEPGRAM_BASE_URL", "https://api.deepgram.com/v1")

    def transcribe(self, audio_path: Path, start: float, end: float, opts: AsrOptions,
                   progress: Callable[[float], None] | None = None) -> list[RawSegment]:
        key = _key("DEEPGRAM_API_KEY", "deepgram")
        params: list[tuple[str, str]] = [
            ("model", self.model), ("language", opts.locale or opts.language), ("diarize", "true"),
            ("punctuate", "true"), ("utterances", "true"), ("smart_format", "false"),
        ]
        params += [("keyterm", t) for t in opts.hotwords[:50]]
        clip = _excerpt(audio_path, start, end, fmt="wav")
        try:
            with httpx.Client(timeout=TIMEOUT) as client, open(clip, "rb") as f:
                resp = client.post(f"{self.base}/listen", params=params, content=f.read(),
                                   headers={"Authorization": f"Token {key}", "Content-Type": "audio/wav"})
        finally:
            clip.unlink(missing_ok=True)
        _raise_for(resp, "deepgram")
        body = resp.json()
        out = []
        for u in body.get("results", {}).get("utterances", []) or []:
            words = [
                RawWord(w=w.get("punctuated_word") or w["word"], start=round(start + w["start"], 3), end=round(start + w["end"], 3),
                        p=float(w.get("confidence", 1.0)), speaker=f"dg{w.get('speaker', u.get('speaker', 0))}")
                for w in u.get("words", [])
            ]
            out.append(RawSegment(start=round(start + u["start"], 3), end=round(start + u["end"], 3), text=u["transcript"].strip(),
                                  words=words, speaker=f"dg{u.get('speaker', 0)}"))
        if progress:
            progress(1.0)
        return out


class AzureProvider:
    name = "azure"
    diarizes = True

    def __init__(self, model: str | None = None):
        self.model = model or "fast-transcription"

    def transcribe(self, audio_path: Path, start: float, end: float, opts: AsrOptions,
                   progress: Callable[[float], None] | None = None) -> list[RawSegment]:
        key = _key("AZURE_SPEECH_KEY", "azure")
        region = os.environ.get("AZURE_SPEECH_REGION", "")
        endpoint = os.environ.get("MAHDAR_AZURE_SPEECH_ENDPOINT") or (
            f"https://{region}.api.cognitive.microsoft.com" if region else "")
        if not endpoint:
            raise AsrError("AZURE_SPEECH_REGION or MAHDAR_AZURE_SPEECH_ENDPOINT is not set", retryable=False)
        definition: dict = {"locales": [opts.locale or "ar-EG"], "profanityFilterMode": "None"}
        definition["diarization"] = {"enabled": True, "maxSpeakers": max(2, min(35, opts.expected_speakers or 10))}
        if opts.hotwords:
            definition["phraseList"] = {"phrases": opts.hotwords[:200]}
        clip = _excerpt(audio_path, start, end, fmt="wav")
        try:
            with httpx.Client(timeout=TIMEOUT) as client, open(clip, "rb") as f:
                resp = client.post(
                    f"{endpoint}/speechtotext/transcriptions:transcribe", params={"api-version": "2024-11-15"},
                    headers={"Ocp-Apim-Subscription-Key": key},
                    files={"audio": (clip.name, f, "audio/wav"), "definition": (None, json.dumps(definition), "application/json")},
                )
        finally:
            clip.unlink(missing_ok=True)
        _raise_for(resp, "azure")
        out = []
        for ph in resp.json().get("phrases", []):
            a = start + ph["offsetMilliseconds"] / 1000
            b = a + ph["durationMilliseconds"] / 1000
            spk = f"az{ph['speaker']}" if "speaker" in ph else None
            words = [
                RawWord(w=w["text"], start=round(start + w["offsetMilliseconds"] / 1000, 3),
                        end=round(start + (w["offsetMilliseconds"] + w["durationMilliseconds"]) / 1000, 3), speaker=spk)
                for w in ph.get("words", [])
            ]
            out.append(RawSegment(start=round(a, 3), end=round(b, 3), text=ph["text"].strip(), words=words, speaker=spk,
                                  avg_logprob=None))
        if progress:
            progress(1.0)
        return out
