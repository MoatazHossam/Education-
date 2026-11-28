"""Login, logout and the current user. Five failed logins lock an account for 15 minutes; a login
takes the same time whether or not the e-mail address exists."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import text

from mahdar.api.deps import COOKIE, Principal, _secret, current_user
from mahdar.config import get_settings
from mahdar.db import repo
from mahdar.db.core import org_tx, system_tx
from mahdar.security.passwords import issue_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
LOCK_AFTER = 5
LOCK_MINUTES = 15


class LoginIn(BaseModel):
    email: str = Field(max_length=320)
    password: str = Field(max_length=1024)


@router.post("/login")
def login(body: LoginIn, response: Response, request: Request) -> dict:
    s = get_settings()
    now = datetime.now(UTC)
    with system_tx() as c:
        user = repo.find_user_by_email(c, body.email)
    locked = bool(user and user["locked_until"] and user["locked_until"] > now)
    ok = verify_password(body.password, user["password_hash"] if user else None)
    if not user or not ok or locked or not user["active"]:
        # Recorded in its own committed transaction: the error below must not roll it back.
        if user and not locked:
            # Atomic: parallel guesses each count (a read-then-write would let them overwrite each other).
            with system_tx() as c:
                c.execute(
                    text(
                        "update users set failed_logins = failed_logins + 1, locked_until = case "
                        "when failed_logins + 1 >= :n then now() + make_interval(mins => :m) else locked_until end where id = :id"
                    ),
                    {"n": LOCK_AFTER, "m": LOCK_MINUTES, "id": user["id"]},
                )
        if user:
            with org_tx(str(user["org_id"])) as oc:
                repo.audit(
                    oc, str(user["org_id"]), "auth.login_failed", actor_user=str(user["id"]), details={"locked": locked}
                )
        raise HTTPException(
            401, "تعذر الدخول: البريد الإلكتروني أو كلمة المرور غير صحيحة، أو الحساب مقفل مؤقتاً بعد محاولات متكررة"
        )
    with system_tx() as c:
        c.execute(
            text("update users set failed_logins = 0, locked_until = null, last_login_at = now() where id = :id"),
            {"id": user["id"]},
        )
        sid = repo.create_session(c, str(user["id"]), str(user["org_id"]), now + timedelta(hours=s.session_hours))
    token = issue_token(
        _secret(), session_id=sid, user_id=str(user["id"]), org_id=str(user["org_id"]), hours=s.session_hours
    )
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        samesite="strict",
        secure=s.public_url.startswith("https://"),
        max_age=s.session_hours * 3600,
        path="/",
    )
    with org_tx(str(user["org_id"])) as oc:
        repo.audit(oc, str(user["org_id"]), "auth.login", actor_user=str(user["id"]))
    return {
        "id": str(user["id"]),
        "name": user["name"],
        "email": user["email"],
        "role": user["role"],
        "org_id": str(user["org_id"]),
    }


@router.post("/logout")
def logout(response: Response, p: Principal = Depends(current_user)) -> dict:
    with system_tx() as c:
        repo.revoke_session(c, p.session_id)
    with org_tx(p.org_id) as c:
        repo.audit(c, p.org_id, "auth.logout", actor_user=p.user_id)
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(p: Principal = Depends(current_user)) -> dict:
    with org_tx(p.org_id) as c:
        org = repo.get_org(c, p.org_id)
    return {
        "id": p.user_id,
        "name": p.name,
        "email": p.email,
        "role": p.role,
        "org_id": p.org_id,
        "org_name": org["name"] if org else "",
    }
