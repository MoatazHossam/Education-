"""Speech recognition: the provider interface, chunk merging and hallucination screening.

Providers return raw segments for one chunk with times relative to the whole recording. The
pipeline merges chunks (``merge_chunks``), screens the result (``screen``) and never edits the
recognised words: corrections happen in the readable copy and by people, with an audit trail.
"""

from __future__ import annotations

import re
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol

from rapidfuzz import fuzz

from mahdar.pipeline import arabic


@dataclass
class RawWord:
    w: str
    start: float
    end: float
    p: float = 1.0
    speaker: str | None = None


@dataclass
class RawSegment:
    start: float
    end: float
    text: str
    words: list[RawWord] = field(default_factory=list)
    avg_logprob: float | None = None
    no_speech_prob: float | None = None
    compression_ratio: float | None = None
    speaker: str | None = None
    flags: set[str] = field(default_factory=set)


@dataclass
class AsrOptions:
    language: str = "ar"
    locale: str = "ar-EG"
    prompt: str | None = None
    hotwords: list[str] = field(default_factory=list)
    expected_speakers: int | None = None


class AsrProvider(Protocol):
    name: str
    model: str
    #: The provider labels speakers itself (Deepgram, Azure): diarization "asr" uses them.
    diarizes: bool

    def transcribe(
        self,
        audio_path: Path,
        start: float,
        end: float,
        opts: AsrOptions,
        progress: Callable[[float], None] | None = None,
    ) -> list[RawSegment]: ...


class AsrError(Exception):
    def __init__(self, message: str, *, retryable: bool):
        super().__init__(message)
        self.retryable = retryable


def merge_chunks(chunks: list[tuple[float, float, list[RawSegment]]]) -> list[RawSegment]:
    """Chunks overlap; each overlap is split at its middle and every word is kept from exactly
    one side, so nothing is lost or duplicated at a boundary."""
    if not chunks:
        return []
    merged: list[RawSegment] = []
    for i, (c_start, c_end, segs) in enumerate(chunks):
        lo = -1.0
        hi = float("inf")
        if i > 0:
            prev_end = chunks[i - 1][1]
            lo = (c_start + prev_end) / 2
        if i + 1 < len(chunks):
            nxt_start = chunks[i + 1][0]
            hi = (nxt_start + c_end) / 2
        for s in segs:
            if s.words:
                kept = [w for w in s.words if lo <= (w.start + w.end) / 2 < hi]
                if not kept:
                    continue
                if len(kept) != len(s.words):
                    s = RawSegment(
                        start=kept[0].start,
                        end=kept[-1].end,
                        text=" ".join(w.w for w in kept),
                        words=kept,
                        avg_logprob=s.avg_logprob,
                        no_speech_prob=s.no_speech_prob,
                        compression_ratio=s.compression_ratio,
                        speaker=s.speaker,
                        flags=set(s.flags),
                    )
                merged.append(s)
            elif lo <= (s.start + s.end) / 2 < hi:
                merged.append(s)
    merged.sort(key=lambda s: s.start)
    return merged


_REPEAT = re.compile(r"(\b\S+(?:\s+\S+){0,3}\b)(?:\s+\1){3,}")


def screen(segments: list[RawSegment], speech: list[tuple[float, float]], prompt: str | None) -> list[RawSegment]:
    """Flags what Whisper-style models are known to invent: stock phrases over silence or music,
    loops of repeated words, an echo of the prompt, and text where the voice detector heard no
    speech. Flagged segments stay in the verbatim transcript but are left out of the analysis."""
    prompt_norm = arabic.normalize(prompt) if prompt else ""
    for s in segments:
        norm = arabic.normalize(s.text)
        if not norm:
            s.flags.add("no_speech")
            continue
        if arabic.contains_phrase(norm, arabic.HALLUCINATION_PHRASES) and len(norm.split()) <= 12:
            s.flags.add("possible_hallucination")
        if _REPEAT.search(norm) or (s.compression_ratio or 0) > 2.4:
            s.flags.add("repetition")
        if prompt_norm and fuzz.partial_ratio(norm, prompt_norm) >= 90 and len(norm) > 10:
            s.flags.add("possible_hallucination")
        overlap = sum(max(0.0, min(s.end, b) - max(s.start, a)) for a, b in speech)
        if speech and overlap < 0.2 * max(0.01, s.end - s.start) and (s.no_speech_prob or 0) > 0.5:
            s.flags.add("possible_hallucination")
        if (s.avg_logprob is not None and s.avg_logprob < -1.0) or (
            s.words and sum(w.p for w in s.words) / len(s.words) < 0.5
        ):
            s.flags.add("low_confidence")
    return segments


def build_prompt(glossary_terms: list[str]) -> str:
    """A short Arabic context line plus the organization's own terms; long prompts make Whisper
    more likely to echo them, so it is capped."""
    base = "اجتماع عمل باللغة العربية، وقد ترد فيه مصطلحات إنجليزية."
    terms = [t for t in glossary_terms if t][:40]
    text = base + (" " + "، ".join(terms) + "." if terms else "")
    return text[:600]
