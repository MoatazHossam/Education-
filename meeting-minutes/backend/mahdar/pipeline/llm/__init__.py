"""Language-model providers, chosen by MAHDAR_LLM_PROVIDER."""

from __future__ import annotations

from mahdar.pipeline.llm.base import LlmClient, LlmError, LlmRequest, LlmResult


def get_client(provider: str, model: str | None = None) -> LlmClient:
    if provider == "anthropic":
        from mahdar.pipeline.llm.anthropic_provider import AnthropicClient

        return AnthropicClient(model)
    if provider == "openai_compatible":
        from mahdar.pipeline.llm.openai_compatible import OpenAICompatibleClient

        return OpenAICompatibleClient(model)
    raise LlmError(f"no language model configured (MAHDAR_LLM_PROVIDER={provider})", retryable=False, kind="config")


__all__ = ["LlmClient", "LlmError", "LlmRequest", "LlmResult", "get_client"]
