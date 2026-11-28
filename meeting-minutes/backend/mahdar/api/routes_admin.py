"""Organization settings (privacy, retention, quality gates, branding), glossary, users, audit."""

from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import Connection, text

from mahdar import storage
from mahdar.api.deps import Principal, current_user, org_conn, require
from mahdar.config import EXTERNAL_PROVIDERS, get_settings
from mahdar.db import repo
from mahdar.db.core import org_tx, system_tx
from mahdar.security.passwords import MIN_PASSWORD_LENGTH, hash_password

router = APIRouter(prefix="/api", tags=["administration"])


@router.get("/system")
def system(p: Principal = Depends(current_user)) -> dict:
    s = get_settings()
    return {
        "asr_provider": s.asr_provider,
        "whisper_model": s.whisper_model if s.asr_provider == "faster_whisper" else None,
        "diarization_provider": s.diarization_provider,
        "llm_provider": s.llm_provider,
        "llm_model": s.llm_model,
        "allowed_external_providers": sorted(s.allowed_external),
        "known_external_providers": sorted(EXTERNAL_PROVIDERS),
        "max_upload_mb": s.max_upload_mb,
        "max_duration_minutes": s.max_duration_minutes,
    }


@router.get("/org")
def get_org(c: Connection = Depends(org_conn), p: Principal = Depends(current_user)) -> dict:
    org = repo.get_org(c, p.org_id)
    return {"id": str(org["id"]), "name": org["name"], "settings": org["settings"]}


class Privacy(BaseModel):
    audio: list[str] = Field(default_factory=list)
    transcript: list[str] = Field(default_factory=list)
    max_classification_external: Literal["public", "internal", "confidential", "secret"] = "internal"


class Retention(BaseModel):
    audio_days: int | None = Field(None, ge=1, le=3650)
    transcript_days: int | None = Field(None, ge=1, le=3650)
    documents_days: int | None = Field(None, ge=1, le=36500)


class Gates(BaseModel):
    max_low_confidence_word_ratio: float = Field(0.15, ge=0, le=1)
    min_evidence_coverage: float = Field(1.0, ge=0, le=1)
    max_unverified_critical: int = Field(0, ge=0, le=100)
    max_potential_omissions: int = Field(0, ge=0, le=100)


class Branding(BaseModel):
    org_name_ar: str | None = Field(None, max_length=200)
    footer_text: str | None = Field(None, max_length=300)


def _save(c: Connection, p: Principal, section: str, values: dict) -> dict:
    before = repo.get_org(c, p.org_id)["settings"].get(section)
    settings = repo.update_org_settings(c, p.org_id, section, values)
    repo.audit(
        c,
        p.org_id,
        f"settings.{section}",
        actor_user=p.user_id,
        target_type="organization",
        target_id=p.org_id,
        details={"before": before, "after": settings[section]},
    )
    return settings


@router.put("/org/privacy")
def set_privacy(body: Privacy, p: Principal = Depends(require("admin")), c: Connection = Depends(org_conn)) -> dict:
    unknown = (set(body.audio) | set(body.transcript)) - EXTERNAL_PROVIDERS
    if unknown:
        raise HTTPException(422, f"مزودون غير معروفين: {', '.join(sorted(unknown))}")
    return _save(c, p, "privacy", body.model_dump())


@router.put("/org/retention")
def set_retention(body: Retention, p: Principal = Depends(require("admin")), c: Connection = Depends(org_conn)) -> dict:
    return _save(c, p, "retention", body.model_dump())


@router.put("/org/quality-gates")
def set_gates(body: Gates, p: Principal = Depends(require("admin")), c: Connection = Depends(org_conn)) -> dict:
    return _save(c, p, "quality_gates", body.model_dump())


@router.put("/org/branding")
def set_branding(body: Branding, p: Principal = Depends(require("admin")), c: Connection = Depends(org_conn)) -> dict:
    return _save(c, p, "branding", body.model_dump(exclude_unset=True))


@router.post("/org/logo")
def upload_logo(file: UploadFile = File(...), p: Principal = Depends(require("admin"))) -> dict:
    data = file.file.read(2_000_001)
    if len(data) > 2_000_000:
        raise HTTPException(413, "حجم الشعار يتجاوز 2 ميجابايت")
    kind = "image/png" if data.startswith(b"\x89PNG") else "image/jpeg" if data[:3] == b"\xff\xd8\xff" else None
    if kind is None:
        raise HTTPException(422, "الشعار يجب أن يكون PNG أو JPEG")
    bid = storage.new_id()
    key, size, sha = storage.put_bytes(p.org_id, bid, data)
    with org_tx(p.org_id) as c:
        repo.add_blob(
            c,
            blob_id=bid,
            org_id=p.org_id,
            meeting_id=None,
            kind="logo",
            storage_key=key,
            size=size,
            sha256=sha,
            content_type=kind,
            filename=file.filename or "logo",
        )
        _save(c, p, "branding", {"logo_blob_id": bid})
    return {"logo_blob_id": bid}


# --- glossary ---------------------------------------------------------------------------------------
class Term(BaseModel):
    term: str = Field(..., min_length=1, max_length=200)
    variants: list[str] = Field(default_factory=list, max_length=50)
    category: Literal["person", "organization", "project", "product", "acronym", "term", "place", "title"] = "term"
    note: str | None = Field(None, max_length=300)


@router.get("/glossary")
def glossary(c: Connection = Depends(org_conn)) -> list[dict]:
    return repo.list_glossary(c)


@router.post("/glossary", status_code=201)
def add_term(body: Term, p: Principal = Depends(require("editor")), c: Connection = Depends(org_conn)) -> dict:
    tid = repo.upsert_glossary(c, p.org_id, body.model_dump())
    repo.audit(
        c,
        p.org_id,
        "glossary.added",
        actor_user=p.user_id,
        target_type="glossary",
        target_id=tid,
        details=body.model_dump(),
    )
    return {"id": tid, **body.model_dump()}


@router.put("/glossary/{term_id}")
def update_term(
    term_id: str, body: Term, p: Principal = Depends(require("editor")), c: Connection = Depends(org_conn)
) -> dict:
    try:
        repo.upsert_glossary(c, p.org_id, body.model_dump(), term_id)
    except KeyError as exc:
        raise HTTPException(404, "المصطلح غير موجود") from exc
    repo.audit(
        c,
        p.org_id,
        "glossary.updated",
        actor_user=p.user_id,
        target_type="glossary",
        target_id=term_id,
        details=body.model_dump(),
    )
    return {"id": term_id, **body.model_dump()}


@router.delete("/glossary/{term_id}")
def delete_term(term_id: str, p: Principal = Depends(require("editor")), c: Connection = Depends(org_conn)) -> dict:
    if not repo.delete_glossary(c, term_id):
        raise HTTPException(404, "المصطلح غير موجود")
    repo.audit(c, p.org_id, "glossary.deleted", actor_user=p.user_id, target_type="glossary", target_id=term_id)
    return {"deleted": term_id}


# --- users ------------------------------------------------------------------------------------------
class NewUser(BaseModel):
    email: str = Field(..., max_length=320, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(..., min_length=1, max_length=200)
    role: Literal["admin", "approver", "editor", "viewer"] = "editor"
    password: str = Field(..., min_length=MIN_PASSWORD_LENGTH, max_length=1024)


class UserPatch(BaseModel):
    role: Literal["admin", "approver", "editor", "viewer"] | None = None
    active: bool | None = None
    password: str | None = Field(None, min_length=MIN_PASSWORD_LENGTH, max_length=1024)


@router.get("/users")
def users(p: Principal = Depends(require("admin"))) -> list[dict]:
    with system_tx() as c:
        return repo.list_users(c, p.org_id)


@router.post("/users", status_code=201)
def create_user(body: NewUser, p: Principal = Depends(require("admin"))) -> dict:
    with system_tx() as c:
        if repo.find_user_by_email(c, body.email):
            raise HTTPException(409, "تعذر إنشاء مستخدم بهذا البريد الإلكتروني")
        uid = repo.create_user(c, p.org_id, body.email, body.name, hash_password(body.password), body.role)
    with org_tx(p.org_id) as c:
        repo.audit(
            c,
            p.org_id,
            "user.created",
            actor_user=p.user_id,
            target_type="user",
            target_id=uid,
            details={"role": body.role},
        )
    return {"id": uid, "email": body.email, "name": body.name, "role": body.role}


@router.patch("/users/{user_id}")
def update_user(user_id: str, body: UserPatch, p: Principal = Depends(require("admin"))) -> dict:
    with system_tx() as c:
        u = repo.get_user(c, p.org_id, user_id)
        if not u:
            raise HTTPException(404, "المستخدم غير موجود")
        if user_id == p.user_id and (body.role not in (None, "admin") or body.active is False):
            raise HTTPException(409, "لا يمكنك سحب صلاحية المدير من حسابك أو تعطيله")
        if body.role:
            c.execute(
                text("update users set role = :r where id = :id and org_id = :o"),
                {"r": body.role, "id": user_id, "o": p.org_id},
            )
        if body.active is not None:
            c.execute(
                text("update users set active = :a where id = :id and org_id = :o"),
                {"a": body.active, "id": user_id, "o": p.org_id},
            )
            if not body.active:
                c.execute(
                    text("update sessions set revoked_at = now() where user_id = :id and revoked_at is null"),
                    {"id": user_id},
                )
        if body.password:
            c.execute(
                text(
                    "update users set password_hash = :h, failed_logins = 0, locked_until = null where id = :id and org_id = :o"
                ),
                {"h": hash_password(body.password), "id": user_id, "o": p.org_id},
            )
            # A reset ends every existing session (a stolen one included).
            c.execute(
                text("update sessions set revoked_at = now() where user_id = :id and revoked_at is null"),
                {"id": user_id},
            )
    with org_tx(p.org_id) as c:
        repo.audit(
            c,
            p.org_id,
            "user.updated",
            actor_user=p.user_id,
            target_type="user",
            target_id=user_id,
            details={"role": body.role, "active": body.active, "password_reset": bool(body.password)},
        )
    return {"id": user_id, "updated": True}


@router.get("/audit")
def audit(p: Principal = Depends(require("admin")), c: Connection = Depends(org_conn)) -> list[dict]:
    return repo.audit_entries(c, p.org_id, None, limit=1000)
