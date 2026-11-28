"""Local recognition with faster-whisper (CTranslate2): nothing leaves the server.

Settings that matter for meetings: Silero VAD so silence is not transcribed, word timestamps (for
speaker alignment and evidence playback), ``condition_on_previous_text=False`` (stops one
mistake from repeating through the rest of the chunk), the temperature fallback with
compression-ratio and log-probability thresholds, and ``hallucination_silence_threshold``.
"""

from __future__ import annotations

import os
import threading
from collections.abc import Callable
from functools import lru_cache
from pathlib import Path

from mahdar.config import get_settings
from mahdar.pipeline.asr.base import AsrError, AsrOptions, RawSegment, RawWord
from mahdar.pipeline.audio import SAMPLE_RATE, load_samples

_lock = threading.Lock()


@lru_cache(maxsize=2)
def _model(name: str, device: str, compute_type: str):
    from faster_whisper import WhisperModel

    s = get_settings()
    os.environ.setdefault("HF_HOME", str(s.resolved_models_dir / "huggingface"))
    threads = int(os.environ.get("MAHDAR_WHISPER_THREADS", "0")) or (os.cpu_count() or 4)
    return WhisperModel(name, device=device, compute_type=compute_type, cpu_threads=threads)


class FasterWhisperProvider:
    name = "faster_whisper"
    diarizes = False

    def __init__(self, model: str | None = None):
        s = get_settings()
        self.model = model or s.whisper_model
        self.device = s.whisper_device
        self.compute_type = s.whisper_compute_type
        self.beam_size = s.whisper_beam_size

    def transcribe(
        self,
        audio_path: Path,
        start: float,
        end: float,
        opts: AsrOptions,
        progress: Callable[[float], None] | None = None,
    ) -> list[RawSegment]:
        try:
            model = _model(self.model, self.device, self.compute_type)
        except Exception as exc:  # model missing or unloadable: not fixed by retrying
            raise AsrError(f"faster-whisper model {self.model} could not be loaded: {exc}", retryable=False) from exc
        samples = load_samples(audio_path, start, end)
        if samples.size < SAMPLE_RATE // 4:
            return []
        with _lock:  # one decoding at a time per process: the model uses every core
            segments, _info = model.transcribe(
                samples,
                language=opts.language,
                beam_size=self.beam_size,
                vad_filter=True,
                vad_parameters={"min_silence_duration_ms": 500, "speech_pad_ms": 200},
                word_timestamps=True,
                condition_on_previous_text=False,
                initial_prompt=opts.prompt,
                compression_ratio_threshold=2.4,
                log_prob_threshold=-1.0,
                no_speech_threshold=0.6,
                hallucination_silence_threshold=2.0,
            )
            out: list[RawSegment] = []
            total = max(0.01, end - start)
            for seg in segments:
                words = [
                    RawWord(
                        w=w.word.strip(),
                        start=round(start + w.start, 3),
                        end=round(start + w.end, 3),
                        p=round(w.probability, 4),
                    )
                    for w in (seg.words or [])
                    if w.word.strip()
                ]
                out.append(
                    RawSegment(
                        start=round(start + seg.start, 3),
                        end=round(start + seg.end, 3),
                        text=seg.text.strip(),
                        words=words,
                        avg_logprob=seg.avg_logprob,
                        no_speech_prob=seg.no_speech_prob,
                        compression_ratio=seg.compression_ratio,
                    )
                )
                if progress:
                    progress(min(1.0, seg.end / total))
        return out
