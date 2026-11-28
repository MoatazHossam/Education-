"""A language model on the organization's own network (vLLM, llama.cpp server, Ollama, TGI...)
through the OpenAI-compatible chat completions API, for deployments where nothing may leave the
network. JSON is requested with ``response_format: json_schema`` (honoured by vLLM and llama.cpp;
servers that ignore it are still held to the schema by the validation in llm.base).

Smaller local models write less reliable Arabic and miss more; the verification agent's rule
checks do not depend on the model, so their findings stay as strict.
"""

from __future__ import annotations

import os

import httpx

from mahdar.config import get_settings
from mahdar.pipeline.llm.base import LlmError, LlmRequest, LlmResult, parse_json, validate


class OpenAICompatibleClient:
    provider = "openai_compatible"

    def __init__(self, model: str | None = None):
        s = get_settings()
        if not s.llm_base_url:
            raise LlmError("MAHDAR_LLM_BASE_URL is required for the openai_compatible provider", retryable=False, kind="config")
        self.base = s.llm_base_url.rstrip("/")
        self.model = model or s.llm_model
        key = s.llm_api_key.get_secret_value() if s.llm_api_key else os.environ.get("MAHDAR_LLM_API_KEY", "")
        self.headers = {"Authorization": f"Bearer {key}"} if key else {}
        self.timeout = httpx.Timeout(s.llm_timeout_seconds, connect=15.0)
        # json_schema (OpenAI, vLLM, llama.cpp's own server) or json_object (llama-cpp-python).
        self.json_mode = os.environ.get("MAHDAR_LLM_JSON_MODE", "json_schema")
        self.max_tokens = int(os.environ.get("MAHDAR_LLM_MAX_OUTPUT_TOKENS", "16000"))

    @staticmethod
    def _format(req: LlmRequest, mode: str) -> dict:
        if mode == "json_object":
            return {"type": "json_object", "schema": req.schema}
        return {"type": "json_schema", "json_schema": {"name": req.stage, "schema": req.schema, "strict": True}}

    def _post(self, body: dict) -> httpx.Response:
        try:
            with httpx.Client(timeout=self.timeout) as client:
                return client.post(f"{self.base}/chat/completions", json=body, headers=self.headers)
        except httpx.TimeoutException as exc:
            raise LlmError("local model timed out", retryable=True, kind="timeout") from exc
        except httpx.HTTPError as exc:
            raise LlmError(f"could not reach the local model server: {type(exc).__name__}", retryable=True, kind="unavailable") from exc

    def generate_json(self, req: LlmRequest) -> LlmResult:
        system = (req.shared_context + "\n\n" if req.shared_context else "") + req.system
        body = {
            "model": req.model or self.model,
            "messages": [{"role": "system", "content": system}, {"role": "user", "content": req.user}],
            "max_tokens": min(req.max_tokens, self.max_tokens),
            "temperature": 0,
            "response_format": self._format(req, self.json_mode),
        }
        resp = self._post(body)
        if resp.status_code in (400, 422, 500) and "response_format" in resp.text and self.json_mode == "json_schema":
            # Servers differ: llama-cpp-python takes {"type": "json_object", "schema": ...}.
            self.json_mode = "json_object"
            body["response_format"] = self._format(req, "json_object")
            resp = self._post(body)
        if resp.status_code >= 400:
            raise LlmError(f"local model server returned HTTP {resp.status_code}", retryable=resp.status_code >= 500 or resp.status_code == 429)
        payload = resp.json()
        choice = (payload.get("choices") or [{}])[0]
        if choice.get("finish_reason") == "length":
            raise LlmError("the reply was cut off at max_tokens", retryable=False, kind="truncated")
        content = (choice.get("message") or {}).get("content") or ""
        data = parse_json(content)
        validate(data, req.schema)
        usage = payload.get("usage") or {}
        return LlmResult(data=data, model=payload.get("model", body["model"]), input_tokens=usage.get("prompt_tokens", 0),
                         output_tokens=usage.get("completion_tokens", 0), stop_reason=choice.get("finish_reason"))
