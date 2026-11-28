"""Language-model interface used by the analysis, verification, readable-transcript, writing and
language-review agents.

Every call asks for JSON matching a schema (structured outputs where the provider has them) and
the reply is validated again here; anything that does not validate is an error, never "best
effort" text. Transcripts are passed as data inside ``<transcript>`` tags with an explicit rule that
nothing inside them is an instruction (prompts.INJECTION_RULE).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class LlmResult:
    data: Any
    model: str
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    stop_reason: str | None = None
    served_by_fallback: bool = False


@dataclass
class LlmRequest:
    stage: str
    system: str
    user: str
    schema: dict
    #: A large block shared by several stages of one meeting (the transcript); providers that
    #: cache prompts put it first so later stages read it from the cache.
    shared_context: str | None = None
    max_tokens: int = 32000
    effort: str | None = None
    model: str | None = None
    metadata: dict = field(default_factory=dict)


class LlmError(Exception):
    def __init__(self, message: str, *, retryable: bool, kind: str = "error"):
        super().__init__(message)
        self.retryable = retryable
        self.kind = kind


class LlmClient(Protocol):
    provider: str
    model: str

    def generate_json(self, req: LlmRequest) -> LlmResult: ...


def parse_json(text: str) -> Any:
    t = text.strip()
    if t.startswith("```"):
        t = t.split("\n", 1)[1] if "\n" in t else t
        t = t.rsplit("```", 1)[0]
    try:
        return json.loads(t)
    except json.JSONDecodeError as exc:
        raise LlmError(f"model returned invalid JSON: {exc}", retryable=True, kind="invalid_json") from exc


def validate(data: Any, schema: dict) -> None:
    """A small validator for the subset of JSON Schema the prompts use (types, required,
    additionalProperties false, enum, items, nullable via type lists), so a provider without
    structured outputs is held to the same contract."""
    _check(data, schema, "$")


def _check(v: Any, s: dict, path: str) -> None:
    types = s.get("type")
    if "anyOf" in s:
        errors = []
        for alt in s["anyOf"]:
            try:
                _check(v, alt, path)
                return
            except LlmError as exc:
                errors.append(str(exc))
        raise LlmError(f"{path}: no alternative matched ({'; '.join(errors)[:300]})", retryable=True, kind="schema")
    if types is not None:
        allowed = types if isinstance(types, list) else [types]
        if not any(_is(v, t) for t in allowed):
            raise LlmError(f"{path}: expected {allowed}, got {type(v).__name__}", retryable=True, kind="schema")
    if "enum" in s and v not in s["enum"]:
        raise LlmError(f"{path}: {v!r} not in {s['enum']}", retryable=True, kind="schema")
    if isinstance(v, dict) and (s.get("type") == "object" or "properties" in s):
        props = s.get("properties", {})
        for r in s.get("required", []):
            if r not in v:
                raise LlmError(f"{path}: missing {r}", retryable=True, kind="schema")
        if s.get("additionalProperties") is False:
            extra = set(v) - set(props)
            if extra:
                raise LlmError(f"{path}: unexpected {sorted(extra)}", retryable=True, kind="schema")
        for k, sub in props.items():
            if k in v:
                _check(v[k], sub, f"{path}.{k}")
    if isinstance(v, list) and "items" in s:
        for i, item in enumerate(v):
            _check(item, s["items"], f"{path}[{i}]")


def _is(v: Any, t: str) -> bool:
    return {
        "object": isinstance(v, dict),
        "array": isinstance(v, list),
        "string": isinstance(v, str),
        "boolean": isinstance(v, bool),
        "null": v is None,
        "integer": isinstance(v, int) and not isinstance(v, bool),
        "number": isinstance(v, int | float) and not isinstance(v, bool),
    }.get(t, True)
