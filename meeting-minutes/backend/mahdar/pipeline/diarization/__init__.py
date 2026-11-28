"""Agent 3 — speaker diarization: who spoke when.

Providers return speaker turns with anonymous labels; ``align`` attaches them to the recognised
words. Voices are never matched to real names: names come only from people (speaker editing).

* sherpa_onnx (default, local, no account): pyannote segmentation-3.0 (ONNX) + a speaker
  embedding model (WeSpeaker ResNet34 by default) + clustering with per-turn confidence.
* pyannote (local, ``pip install .[pyannote]`` + HF_TOKEN, gated model): pyannote.audio's
  ``speaker-diarization-community-1`` pipeline, usually more accurate.
* asr: the speech provider's own labels (Deepgram, Azure).
* none: one unknown speaker.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

from mahdar.config import get_settings


@dataclass
class Turn:
    start: float
    end: float
    speaker: str
    confidence: float | None = None


class DiarizationError(Exception):
    def __init__(self, message: str, *, retryable: bool = False):
        super().__init__(message)
        self.retryable = retryable


def _sherpa_paths() -> tuple[Path, Path]:
    base = get_settings().resolved_models_dir / "sherpa"
    seg = Path(os.environ.get("MAHDAR_SEGMENTATION_MODEL", base / "sherpa-onnx-pyannote-segmentation-3-0" / "model.onnx"))
    emb = Path(os.environ.get("MAHDAR_EMBEDDING_MODEL", base / "wespeaker_en_voxceleb_resnet34_LM.onnx"))
    return seg, emb


@lru_cache(maxsize=4)
def _sherpa(seg: str, emb: str, num_clusters: int, threshold: float):
    import sherpa_onnx

    threads = os.cpu_count() or 2
    config = sherpa_onnx.OfflineSpeakerDiarizationConfig(
        segmentation=sherpa_onnx.OfflineSpeakerSegmentationModelConfig(
            pyannote=sherpa_onnx.OfflineSpeakerSegmentationPyannoteModelConfig(model=seg), num_threads=threads,
        ),
        embedding=sherpa_onnx.SpeakerEmbeddingExtractorConfig(model=emb, num_threads=threads),
        clustering=sherpa_onnx.FastClusteringConfig(num_clusters=num_clusters, threshold=threshold, compute_confidence=True),
        min_duration_on=0.3,
        min_duration_off=0.5,
    )
    if not config.validate():
        raise DiarizationError("sherpa-onnx diarization models are missing or invalid (python -m mahdar.cli models download)")
    return sherpa_onnx.OfflineSpeakerDiarization(config)


def diarize_sherpa(audio_path: Path, expected_speakers: int | None) -> list[Turn]:
    from mahdar.pipeline.audio import load_samples

    seg, emb = _sherpa_paths()
    if not seg.exists() or not emb.exists():
        raise DiarizationError("sherpa-onnx diarization models are not downloaded (python -m mahdar.cli models download)")
    sd = _sherpa(str(seg), str(emb), expected_speakers or -1, get_settings().diarization_threshold)
    samples = load_samples(audio_path)
    result = sd.process(samples).sort_by_start_time()
    turns = []
    for r in result:
        conf = getattr(r, "confidence", None)
        turns.append(Turn(start=round(r.start, 3), end=round(r.end, 3), speaker=f"s{r.speaker}",
                          confidence=float(conf) if conf is not None and conf >= 0 else None))
    return turns


def diarize_pyannote(audio_path: Path, expected_speakers: int | None) -> list[Turn]:
    try:
        from pyannote.audio import Pipeline  # type: ignore[import-not-found]
    except ImportError as exc:
        raise DiarizationError("pyannote.audio is not installed (image built without WITH_PYANNOTE=true)") from exc
    token = os.environ.get("HF_TOKEN")
    if not token:
        raise DiarizationError("HF_TOKEN is required for pyannote's gated models")
    name = os.environ.get("MAHDAR_PYANNOTE_PIPELINE", "pyannote/speaker-diarization-community-1")
    pipeline = Pipeline.from_pretrained(name, token=token)
    kwargs = {"num_speakers": expected_speakers} if expected_speakers else {}
    output = pipeline(str(audio_path), **kwargs)
    annotation = getattr(output, "speaker_diarization", output)
    return [Turn(start=round(seg.start, 3), end=round(seg.end, 3), speaker=f"p{label}")
            for seg, _, label in annotation.itertracks(yield_label=True)]


def diarize(provider: str, audio_path: Path, expected_speakers: int | None) -> list[Turn]:
    if provider == "sherpa_onnx":
        return diarize_sherpa(audio_path, expected_speakers)
    if provider == "pyannote":
        return diarize_pyannote(audio_path, expected_speakers)
    if provider in ("asr", "none"):
        return []
    raise DiarizationError(f"unknown diarization provider: {provider}")
