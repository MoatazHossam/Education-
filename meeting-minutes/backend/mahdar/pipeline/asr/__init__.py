"""Speech recognition providers, chosen by MAHDAR_ASR_PROVIDER."""

from __future__ import annotations

from mahdar.pipeline.asr.base import AsrError, AsrOptions, AsrProvider, RawSegment, RawWord, merge_chunks, screen


def get_provider(name: str, model: str | None = None) -> AsrProvider:
    if name == "faster_whisper":
        from mahdar.pipeline.asr.faster_whisper_provider import FasterWhisperProvider

        return FasterWhisperProvider(model)
    if name == "openai":
        from mahdar.pipeline.asr.cloud import OpenAIProvider

        return OpenAIProvider(model)
    if name == "deepgram":
        from mahdar.pipeline.asr.cloud import DeepgramProvider

        return DeepgramProvider(model)
    if name == "azure":
        from mahdar.pipeline.asr.cloud import AzureProvider

        return AzureProvider(model)
    raise ValueError(f"unknown speech recognition provider: {name}")


__all__ = ["AsrError", "AsrOptions", "AsrProvider", "RawSegment", "RawWord", "get_provider", "merge_chunks", "screen"]
