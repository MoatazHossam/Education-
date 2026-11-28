"""Password hashing (Argon2id) and session tokens."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime, timedelta

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

_hasher = PasswordHasher()  # Argon2id with the library's current recommended parameters
# A fixed hash checked when the email is unknown, so a login takes as long either way.
_DUMMY = _hasher.hash("not-a-real-password-" + secrets.token_hex(8))

MIN_PASSWORD_LENGTH = 12


def hash_password(password: str) -> str:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise ValueError(f"password must have at least {MIN_PASSWORD_LENGTH} characters")
    return _hasher.hash(password)


def verify_password(password: str, stored: str | None) -> bool:
    try:
        return _hasher.verify(stored or _DUMMY, password) and stored is not None
    except (VerificationError, InvalidHashError):
        return False


def issue_token(secret: str, *, session_id: str, user_id: str, org_id: str, hours: int) -> str:
    now = datetime.now(UTC)
    payload = {"sid": session_id, "sub": user_id, "org": org_id, "iat": now, "exp": now + timedelta(hours=hours)}
    return jwt.encode(payload, secret, algorithm="HS256")


def decode_token(secret: str, token: str) -> dict:
    return jwt.decode(token, secret, algorithms=["HS256"], options={"require": ["sid", "sub", "org", "exp"]})


def token_digest(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()
