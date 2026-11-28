"""Claude through the official Anthropic SDK.

* Structured outputs (``output_config.format``) for every call, validated again on return.
* Streaming with ``get_final_message()``: analysis of a long meeting can produce long output.
* Adaptive thinking is the model's default on current models; depth is set with
  ``output_config.effort`` (MAHDAR_LLM_EFFORT, ``high`` by default: this is accuracy-sensitive work).
* Prompt caching: the transcript goes in a first system block marked for caching, so the
  verification and writing stages of the same meeting read it from the cache.
* Server-side fallback on models whose safety classifiers can decline a request: a declined call
  is re-run on the model Anthropic recommends for that case, inside the same request, and the
  processing register records that a fallback served it.
"""

from __future__ import annotations

import anthropic

from mahdar.config import get_settings
from mahdar.pipeline.llm.base import LlmError, LlmRequest, LlmResult, parse_json, validate

SERVER_FALLBACK_MODELS = {
    "claude-fable-5-2",
    "claude-fable-5-1",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-sonnet-5-5",
}
FALLBACK_BETA = "server-side-fallback-2026-07-01"


class AnthropicClient:
    provider = "anthropic"

    def __init__(self, model: str | None = None):
        s = get_settings()
        self.model = model or s.llm_model
        self.effort = s.llm_effort
        kwargs: dict = {"timeout": s.llm_timeout_seconds, "max_retries": 3}
        if s.llm_base_url and s.llm_provider == "anthropic":
            kwargs["base_url"] = s.llm_base_url
        # ANTHROPIC_API_KEY (or an `ant auth login` profile) is read by the SDK itself.
        self.client = anthropic.Anthropic(**kwargs)

    def generate_json(self, req: LlmRequest) -> LlmResult:
        model = req.model or self.model
        system: list[dict] = []
        if req.shared_context:
            system.append({"type": "text", "text": req.shared_context, "cache_control": {"type": "ephemeral"}})
        system.append({"type": "text", "text": req.system})
        params: dict = {
            "model": model,
            "max_tokens": req.max_tokens,
            "system": system,
            "messages": [{"role": "user", "content": req.user}],
            "output_config": {
                "effort": req.effort or self.effort,
                "format": {"type": "json_schema", "schema": req.schema},
            },
        }
        try:
            if model in SERVER_FALLBACK_MODELS:
                with self.client.beta.messages.stream(**params, betas=[FALLBACK_BETA], fallbacks="default") as stream:
                    msg = stream.get_final_message()
            else:
                with self.client.messages.stream(**params) as stream:
                    msg = stream.get_final_message()
        except anthropic.AuthenticationError as exc:
            raise LlmError("Anthropic API rejected the key (401)", retryable=False, kind="auth") from exc
        except anthropic.PermissionDeniedError as exc:
            raise LlmError("Anthropic API denied the request (403)", retryable=False, kind="auth") from exc
        except anthropic.BadRequestError as exc:
            raise LlmError(
                f"Anthropic API rejected the request (400): {exc.message[:300]}", retryable=False, kind="bad_request"
            ) from exc
        except anthropic.RateLimitError as exc:
            raise LlmError("Anthropic API rate limit (429)", retryable=True, kind="rate_limited") from exc
        except anthropic.InternalServerError as exc:
            raise LlmError(
                f"Anthropic API unavailable ({exc.status_code})", retryable=True, kind="unavailable"
            ) from exc
        except anthropic.APITimeoutError as exc:
            raise LlmError("Anthropic API timed out", retryable=True, kind="timeout") from exc
        except anthropic.APIConnectionError as exc:
            raise LlmError("Could not reach the Anthropic API", retryable=True, kind="unavailable") from exc
        except anthropic.APIStatusError as exc:
            raise LlmError(
                f"Anthropic API error {exc.status_code}", retryable=exc.status_code >= 500, kind="error"
            ) from exc

        usage = msg.usage
        iterations = getattr(usage, "iterations", None) or []
        result = LlmResult(
            data=None,
            model=msg.model,
            input_tokens=usage.input_tokens or 0,
            output_tokens=usage.output_tokens or 0,
            cache_read_tokens=getattr(usage, "cache_read_input_tokens", 0) or 0,
            cache_write_tokens=getattr(usage, "cache_creation_input_tokens", 0) or 0,
            stop_reason=msg.stop_reason,
            served_by_fallback=any(getattr(e, "type", "") == "fallback_message" for e in iterations),
        )
        # Check the stop reason before reading the content: a refusal or a cut-off reply may
        # carry partial JSON that must not be used.
        if msg.stop_reason == "refusal":
            raise LlmError("the model declined this request", retryable=False, kind="refusal")
        if msg.stop_reason == "max_tokens":
            raise LlmError("the reply was cut off at max_tokens", retryable=False, kind="truncated")
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        result.data = parse_json(text)
        validate(result.data, req.schema)
        return result
