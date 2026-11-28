"""External-processing authorization.

A provider may receive a kind of data (``audio`` or ``transcript``) for a meeting only when all of
these hold, and every use is written to the processing register:

1. The provider is local (faster_whisper, sherpa_onnx, pyannote, and openai_compatible when the
   operator has not listed it as external), or
2. the installation lists it in MAHDAR_ALLOWED_EXTERNAL_PROVIDERS, **and** the organization allows
   it for that kind of data, **and** the meeting's classification is not above the organization's
   ``max_classification_external``.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import Connection

from mahdar.config import get_settings
from mahdar.db import repo

LOCAL_PROVIDERS = {"faster_whisper", "sherpa_onnx", "pyannote", "local"}
CLASSIFICATION_ORDER = ["public", "internal", "confidential", "secret"]
CLASSIFICATION_AR = {"public": "عام", "internal": "داخلي", "confidential": "سري", "secret": "سري للغاية"}
DATA_KIND_AR = {"audio": "التسجيل الصوتي", "transcript": "النص المفرغ"}


class NotAuthorized(Exception):
    def __init__(self, provider: str, data_kind: str, reason_ar: str):
        super().__init__(f"{provider} may not receive {data_kind}: {reason_ar}")
        self.provider = provider
        self.data_kind = data_kind
        self.reason_ar = reason_ar


@dataclass(frozen=True)
class Decision:
    provider: str
    data_kind: str
    external: bool


def is_external(provider: str) -> bool:
    if provider in LOCAL_PROVIDERS:
        return False
    if provider == "openai_compatible":
        # A server on the organization's own network, unless the operator says otherwise.
        return "openai_compatible" in get_settings().allowed_external
    return True


def authorize(conn: Connection, org_id: str, meeting: dict, provider: str, data_kind: str) -> Decision:
    if not is_external(provider):
        return Decision(provider, data_kind, external=False)
    settings = get_settings()
    if provider not in settings.allowed_external:
        raise NotAuthorized(
            provider, data_kind,
            f"المزوّد الخارجي «{provider}» غير مسموح به في إعدادات التشغيل (MAHDAR_ALLOWED_EXTERNAL_PROVIDERS).",
        )
    org = repo.get_org(conn, org_id) or {"settings": {}}
    policy = org["settings"].get("privacy", {})
    if provider not in (policy.get(data_kind) or []):
        raise NotAuthorized(
            provider, data_kind,
            f"لم تأذن سياسة الخصوصية في المؤسسة بإرسال {DATA_KIND_AR.get(data_kind, data_kind)} إلى «{provider}».",
        )
    limit = policy.get("max_classification_external", "internal")
    level = meeting.get("classification", "internal")
    if CLASSIFICATION_ORDER.index(level) > CLASSIFICATION_ORDER.index(limit):
        raise NotAuthorized(
            provider, data_kind,
            f"تصنيف الاجتماع «{CLASSIFICATION_AR[level]}» أعلى من الحد المسموح بمعالجته خارجياً «{CLASSIFICATION_AR[limit]}».",
        )
    return Decision(provider, data_kind, external=True)
