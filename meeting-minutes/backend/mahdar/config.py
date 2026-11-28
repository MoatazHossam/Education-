"""Settings, read from the environment (MAHDAR_* and the providers' own variables).

Production refuses to start with missing or weak secrets (``check_production``); the CLI's
``check-config`` and the API's startup both call it.
"""

from __future__ import annotations

import base64
import binascii
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import Field, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AsrProvider = Literal["faster_whisper", "openai", "deepgram", "azure"]
DiarizationProvider = Literal["sherpa_onnx", "pyannote", "asr", "none"]
LlmProvider = Literal["anthropic", "openai_compatible", "none"]

# Providers that send data outside the installation. Local engines (faster_whisper, sherpa_onnx,
# pyannote) and openai_compatible on a private network are not listed: they never leave it unless
# the operator points MAHDAR_LLM_BASE_URL at an external service, which they then must list here too.
EXTERNAL_PROVIDERS = {"anthropic", "openai", "deepgram", "azure", "openai_compatible"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="MAHDAR_", extra="ignore", case_sensitive=False)

    env: Literal["development", "production", "test"] = "development"
    log_level: str = "info"
    database_url: str = "postgresql+psycopg://mahdar:mahdar@localhost:5432/mahdar"
    # A role without BYPASSRLS for the API and the worker (row-level security per organization);
    # migrations run as the owner in database_url.
    app_database_url: str | None = None
    secret_key: SecretStr | None = None
    data_key: SecretStr | None = None
    data_keys_previous: str = ""
    public_url: str = "http://localhost:8080"
    data_dir: Path = Path("./data")
    web_dir: Path | None = None
    models_dir: Path | None = None

    storage_backend: Literal["local", "s3"] = "local"
    s3_bucket: str | None = None
    s3_endpoint: str | None = None
    s3_region: str | None = None

    max_upload_mb: int = Field(default=500, ge=1)
    max_duration_minutes: int = Field(default=240, ge=1)
    session_hours: int = Field(default=12, ge=1, le=24 * 14)

    worker_concurrency: int = Field(default=1, ge=1, le=16)
    job_max_attempts: int = Field(default=3, ge=1, le=10)

    asr_provider: AsrProvider = "faster_whisper"
    whisper_model: str = "large-v3"
    whisper_device: str = "cpu"
    whisper_compute_type: str = "int8"
    whisper_beam_size: int = 5
    # Long recordings are transcribed in chunks cut at silences, overlapping so no word is lost.
    chunk_minutes: float = 10.0
    chunk_overlap_seconds: float = 2.0

    diarization_provider: DiarizationProvider = "sherpa_onnx"
    diarization_threshold: float = 0.6

    llm_provider: LlmProvider = "anthropic"
    llm_model: str = "claude-opus-5-5"
    # The independent verification pass may use another model (defaults to llm_model).
    llm_verification_model: str | None = None
    llm_effort: Literal["low", "medium", "high", "xhigh", "max"] = "high"
    llm_base_url: str | None = None
    llm_api_key: SecretStr | None = None
    llm_timeout_seconds: float = 600.0
    # Context budget used to decide whether a transcript is analysed in one pass or in windows.
    llm_context_tokens: int = 400_000

    allowed_external_providers: str = ""
    retention_sweep_hours: int = 6

    @field_validator("allowed_external_providers")
    @classmethod
    def _lower(cls, v: str) -> str:
        return ",".join(p.strip().lower() for p in v.split(",") if p.strip())

    @property
    def allowed_external(self) -> set[str]:
        return {p for p in self.allowed_external_providers.split(",") if p}

    @property
    def storage_dir(self) -> Path:
        return self.data_dir / "storage"

    @property
    def resolved_models_dir(self) -> Path:
        return self.models_dir or (self.data_dir / "models")

    def data_keys(self) -> list[bytes]:
        """The current data key first, then previous ones (for decryption only)."""
        keys: list[bytes] = []
        raw = [self.data_key.get_secret_value() if self.data_key else ""]
        raw += [k.strip() for k in self.data_keys_previous.split(",") if k.strip()]
        for i, value in enumerate(raw):
            if not value:
                continue
            try:
                key = base64.b64decode(value, validate=True)
            except (binascii.Error, ValueError) as exc:
                raise ConfigError(f"{'MAHDAR_DATA_KEY' if i == 0 else 'MAHDAR_DATA_KEYS_PREVIOUS'} is not base64") from exc
            if len(key) != 32:
                raise ConfigError("MAHDAR_DATA_KEY must decode to 32 bytes (openssl rand -base64 32)")
            keys.append(key)
        return keys


class ConfigError(RuntimeError):
    pass


def check_production(s: Settings) -> list[str]:
    """Problems that must stop a production start. Empty when the configuration is acceptable."""
    problems: list[str] = []
    if s.env != "production":
        return problems
    secret = s.secret_key.get_secret_value() if s.secret_key else ""
    if len(secret) < 32:
        problems.append("MAHDAR_SECRET_KEY is missing or shorter than 32 characters (openssl rand -base64 48)")
    try:
        if not s.data_keys():
            problems.append("MAHDAR_DATA_KEY is missing (openssl rand -base64 32)")
    except ConfigError as exc:
        problems.append(str(exc))
    if not s.public_url.startswith("https://"):
        problems.append("MAHDAR_PUBLIC_URL must be https:// in production (encryption in transit)")
    unknown = s.allowed_external - EXTERNAL_PROVIDERS
    if unknown:
        problems.append(f"MAHDAR_ALLOWED_EXTERNAL_PROVIDERS has unknown providers: {', '.join(sorted(unknown))}")
    if s.storage_backend == "s3" and not s.s3_bucket:
        problems.append("MAHDAR_S3_BUCKET is required with MAHDAR_STORAGE_BACKEND=s3")
    return problems


@lru_cache
def get_settings() -> Settings:
    return Settings()
