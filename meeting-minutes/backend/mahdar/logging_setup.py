"""Structured JSON logs. Messages carry identifiers, counts and timings only: never transcript text,
names, titles, file names, e-mail addresses or keys. ``RedactingFilter`` masks anything that looks
like an e-mail address or an API key, and Arabic text, in case a library logs one."""

from __future__ import annotations

import json
import logging
import re
import sys
from datetime import UTC, datetime

from mahdar.config import get_settings

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
_KEY = re.compile(r"\b(sk-[A-Za-z0-9_-]{8,}|sk-ant-[A-Za-z0-9_-]{8,}|[A-Fa-f0-9]{32,})\b")
_ARABIC = re.compile(r"[؀-ۿ][؀-ۿ\s،؛؟.]{3,}")
_STD = set(vars(logging.LogRecord("", 0, "", 0, "", None, None)).keys()) | {"message", "asctime"}


def redact(text: str) -> str:
    text = _EMAIL.sub("[email]", text)
    text = _KEY.sub("[secret]", text)
    return _ARABIC.sub("[text]", text)


class RedactingFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = redact(str(record.msg))
        if record.args:
            # Only strings are redacted: other arguments keep their type for %d / %f formats.
            record.args = (
                tuple(redact(a) if isinstance(a, str) else a for a in record.args)
                if isinstance(record.args, tuple)
                else record.args
            )
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry = {
            "time": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname.lower(),
            "logger": record.name,
            "message": record.getMessage(),
        }
        for k, v in vars(record).items():
            if k not in _STD and not k.startswith("_"):
                entry[k] = redact(str(v)) if isinstance(v, str) else v
        if record.exc_info:
            entry["error"] = redact(self.formatException(record.exc_info))[-4000:]
        return json.dumps(entry, ensure_ascii=False, default=str)


def setup_logging() -> None:
    root = logging.getLogger()
    if any(isinstance(h.formatter, JsonFormatter) for h in root.handlers):
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter())
    handler.addFilter(RedactingFilter())
    root.handlers = [handler]
    root.setLevel(get_settings().log_level.upper())
    for noisy in ("httpx", "httpcore", "faster_whisper", "weasyprint", "fontTools", "urllib3"):
        logging.getLogger(noisy).setLevel(logging.WARNING)
