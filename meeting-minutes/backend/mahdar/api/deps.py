"""Authentication and authorization for the API.

Sessions: a signed token in an HttpOnly, SameSite=Strict cookie (Secure over HTTPS), checked against
the sessions table on every request (logout and deactivation take effect immediately). State-changing
requests must carry ``X-Requested-With: mahdar``: a cross-site form cannot set that header and the
API allows no cross-origin requests, which closes CSRF.

Roles: viewer < editor < approver < admin. Every query runs in the session's organization's
transaction (row-level security), so another organization's data is unreachable even by a bug in
a route.
"""

from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass

import jwt
from fastapi import Depends, HTTPException, Request
from sqlalchemy import Connection

from mahdar.config import get_settings
from mahdar.db import repo
from mahdar.db.core import org_tx, system_tx
from mahdar.security.passwords import decode_token

COOKIE = "mahdar_session"
ROLES = ["viewer", "editor", "approver", "admin"]


@dataclass
class Principal:
    user_id: str
    org_id: str
    session_id: str
    role: str
    name: str
    email: str

    def at_least(self, role: str) -> bool:
        return ROLES.index(self.role) >= ROLES.index(role)


def _secret() -> str:
    s = get_settings()
    if s.secret_key is None:
        if s.env == "production":
            raise HTTPException(500, "server is not configured")
        return "development-only-secret-key-change-me-0000"
    return s.secret_key.get_secret_value()


def current_user(request: Request) -> Principal:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "يلزم تسجيل الدخول")
    try:
        claims = decode_token(_secret(), token)
    except jwt.PyJWTError as exc:
        raise HTTPException(401, "انتهت الجلسة، يرجى تسجيل الدخول مجدداً") from exc
    with system_tx() as c:
        sess = repo.active_session(c, claims["sid"])
    if not sess or not sess["active"] or str(sess["user_id"]) != claims["sub"] or str(sess["org_id"]) != claims["org"]:
        raise HTTPException(401, "انتهت الجلسة، يرجى تسجيل الدخول مجدداً")
    if request.method not in ("GET", "HEAD", "OPTIONS") and request.headers.get("x-requested-with") != "mahdar":
        raise HTTPException(403, "طلب غير مسموح")
    return Principal(
        user_id=str(sess["user_id"]),
        org_id=str(sess["org_id"]),
        session_id=str(sess["id"]),
        role=sess["role"],
        name=sess["name"],
        email=sess["email"],
    )


def require(role: str):
    def dep(p: Principal = Depends(current_user)) -> Principal:
        if not p.at_least(role):
            raise HTTPException(403, "ليست لديك صلاحية لهذا الإجراء")
        return p

    return dep


def org_conn(p: Principal = Depends(current_user)) -> Iterator[Connection]:
    with org_tx(p.org_id) as c:
        yield c


def meeting_or_404(c: Connection, meeting_id: str) -> dict:
    try:
        m = repo.get_meeting(c, meeting_id)
    except Exception as exc:  # malformed id
        raise HTTPException(404, "الاجتماع غير موجود") from exc
    if not m:
        raise HTTPException(404, "الاجتماع غير موجود")
    return m
