"""Queries. Content is sealed (encrypted) here and nowhere else, with associated data naming the
row it belongs to; callers see plain Python values."""

from __future__ import annotations

import hashlib
import json
import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import Connection, text

from mahdar.storage import keyring


def _seal(obj: Any, aad: str) -> bytes:
    return keyring().seal(json.dumps(obj, ensure_ascii=False, default=str).encode(), aad)


def _open(blob: bytes | memoryview | None, aad: str) -> Any:
    if blob is None:
        return None
    return json.loads(keyring().open(bytes(blob), aad))


def new_uuid() -> str:
    return str(uuid.uuid4())


# --- organizations and users ------------------------------------------------------------------
DEFAULT_ORG_SETTINGS: dict[str, Any] = {
    # External processing: which providers may receive which kind of data. Empty: local only.
    "privacy": {"audio": [], "transcript": [], "max_classification_external": "internal"},
    # Days to keep each kind of data; null keeps it until deleted.
    "retention": {"audio_days": None, "transcript_days": None, "documents_days": None},
    "quality_gates": {
        "max_low_confidence_word_ratio": 0.15,
        "min_evidence_coverage": 1.0,
        "max_unverified_critical": 0,
        "max_potential_omissions": 0,
    },
    "branding": {"org_name_ar": None, "logo_blob_id": None, "footer_text": None},
}


def create_org(conn: Connection, name: str, settings: dict | None = None) -> str:
    org_id = new_uuid()
    merged = json.loads(json.dumps(DEFAULT_ORG_SETTINGS))
    for k, v in (settings or {}).items():
        merged[k] = {**merged.get(k, {}), **v} if isinstance(v, dict) else v
    conn.execute(
        text("insert into organizations (id, name, settings) values (:id, :n, cast(:s as jsonb))"),
        {"id": org_id, "n": name, "s": json.dumps(merged)},
    )
    return org_id


def get_org(conn: Connection, org_id: str) -> dict | None:
    row = conn.execute(text("select * from organizations where id = :id"), {"id": org_id}).mappings().first()
    if not row:
        return None
    org = dict(row)
    settings = json.loads(json.dumps(DEFAULT_ORG_SETTINGS))
    for k, v in (org["settings"] or {}).items():
        settings[k] = {**settings.get(k, {}), **v} if isinstance(v, dict) and isinstance(settings.get(k), dict) else v
    org["settings"] = settings
    return org


def update_org_settings(conn: Connection, org_id: str, section: str, values: dict) -> dict:
    org = get_org(conn, org_id)
    if org is None:
        raise KeyError(org_id)
    settings = org["settings"]
    settings[section] = {**settings.get(section, {}), **values}
    conn.execute(
        text("update organizations set settings = cast(:s as jsonb) where id = :id"),
        {"s": json.dumps(settings), "id": org_id},
    )
    return settings


def create_user(conn: Connection, org_id: str, email: str, name: str, password_hash: str, role: str) -> str:
    uid = new_uuid()
    conn.execute(
        text(
            "insert into users (id, org_id, email, name, password_hash, role) values (:id, :org, :e, :n, :p, :r)"
        ),
        {"id": uid, "org": org_id, "e": email.strip().lower(), "n": name, "p": password_hash, "r": role},
    )
    return uid


def find_user_by_email(conn: Connection, email: str) -> dict | None:
    row = conn.execute(text("select * from users where lower(email) = lower(:e)"), {"e": email.strip()}).mappings().first()
    return dict(row) if row else None


def get_user(conn: Connection, org_id: str, user_id: str) -> dict | None:
    row = (
        conn.execute(text("select * from users where id = :id and org_id = :org"), {"id": user_id, "org": org_id})
        .mappings()
        .first()
    )
    return dict(row) if row else None


def list_users(conn: Connection, org_id: str) -> list[dict]:
    rows = conn.execute(
        text("select id, email, name, role, active, last_login_at, created_at from users where org_id = :org order by created_at"),
        {"org": org_id},
    ).mappings()
    return [dict(r) for r in rows]


# --- sessions -----------------------------------------------------------------------------------
def create_session(conn: Connection, user_id: str, org_id: str, expires_at: datetime) -> str:
    sid = new_uuid()
    conn.execute(
        text("insert into sessions (id, user_id, org_id, expires_at) values (:id, :u, :o, :e)"),
        {"id": sid, "u": user_id, "o": org_id, "e": expires_at},
    )
    return sid


def active_session(conn: Connection, sid: str) -> dict | None:
    row = conn.execute(
        text(
            "select s.*, u.role, u.active, u.name, u.email from sessions s join users u on u.id = s.user_id "
            "where s.id = :id and s.revoked_at is null and s.expires_at > now()"
        ),
        {"id": sid},
    ).mappings().first()
    return dict(row) if row else None


def revoke_session(conn: Connection, sid: str) -> None:
    conn.execute(text("update sessions set revoked_at = now() where id = :id"), {"id": sid})


# --- meetings -----------------------------------------------------------------------------------
MEETING_COLUMNS = (
    "id, org_id, created_by, created_at, updated_at, meta_enc, classification, status, stage, progress, "
    "minutes_status, approved_by, approved_at, error_code, duration_seconds, critical_open, retention_until"
)


def _meeting(row: Any) -> dict:
    m = dict(row)
    m["meta"] = _open(m.pop("meta_enc"), f"meeting:{m['id']}:meta") or {}
    return m


def create_meeting(conn: Connection, org_id: str, user_id: str | None, meta: dict, classification: str) -> str:
    mid = new_uuid()
    conn.execute(
        text(
            "insert into meetings (id, org_id, created_by, meta_enc, classification) values (:id, :org, :u, :m, :c)"
        ),
        {"id": mid, "org": org_id, "u": user_id, "m": _seal(meta, f"meeting:{mid}:meta"), "c": classification},
    )
    return mid


def get_meeting(conn: Connection, meeting_id: str) -> dict | None:
    row = conn.execute(text(f"select {MEETING_COLUMNS} from meetings where id = :id"), {"id": meeting_id}).mappings().first()  # noqa: S608
    return _meeting(row) if row else None


def list_meetings(conn: Connection) -> list[dict]:
    rows = conn.execute(text(f"select {MEETING_COLUMNS} from meetings order by created_at desc limit 500")).mappings()  # noqa: S608
    return [_meeting(r) for r in rows]


_MEETING_FIELDS = {
    "status", "stage", "progress", "minutes_status", "approved_by", "approved_at", "error_code",
    "duration_seconds", "critical_open", "retention_until", "classification",
}


def update_meeting(conn: Connection, meeting_id: str, **fields: Any) -> None:
    bad = set(fields) - _MEETING_FIELDS
    if bad:
        raise ValueError(f"unknown meeting fields: {bad}")
    if not fields:
        return
    sets = ", ".join(f"{k} = :{k}" for k in fields)
    conn.execute(text(f"update meetings set {sets}, updated_at = now() where id = :id"), {**fields, "id": meeting_id})  # noqa: S608


def update_meeting_meta(conn: Connection, meeting_id: str, meta: dict) -> None:
    conn.execute(
        text("update meetings set meta_enc = :m, updated_at = now() where id = :id"),
        {"m": _seal(meta, f"meeting:{meeting_id}:meta"), "id": meeting_id},
    )


def delete_meeting(conn: Connection, meeting_id: str) -> None:
    conn.execute(text("delete from meetings where id = :id"), {"id": meeting_id})


# --- artifacts ----------------------------------------------------------------------------------
def save_artifact(
    conn: Connection,
    org_id: str,
    meeting_id: str,
    kind: str,
    content: Any,
    *,
    user_id: str | None = None,
    agent: str | None = None,
    note: str | None = None,
) -> int:
    conn.execute(text("select pg_advisory_xact_lock(hashtext(:k))"), {"k": f"{meeting_id}:{kind}"})
    version = conn.execute(
        text("select coalesce(max(version), 0) + 1 from artifacts where meeting_id = :m and kind = :k"),
        {"m": meeting_id, "k": kind},
    ).scalar_one()
    aid = new_uuid()
    raw = json.dumps(content, ensure_ascii=False, default=str, sort_keys=True)
    conn.execute(
        text(
            "insert into artifacts (id, org_id, meeting_id, kind, version, content_enc, sha256, created_by_user, "
            "created_by_agent, note) values (:id, :org, :m, :k, :v, :c, :h, :u, :a, :n)"
        ),
        {
            "id": aid, "org": org_id, "m": meeting_id, "k": kind, "v": version,
            "c": keyring().seal(raw.encode(), f"artifact:{aid}"), "h": hashlib.sha256(raw.encode()).hexdigest(),
            "u": user_id, "a": agent, "n": note,
        },
    )
    return int(version)


def latest_artifact(conn: Connection, meeting_id: str, kind: str) -> tuple[int, Any] | None:
    row = conn.execute(
        text(
            "select id, version, content_enc from artifacts where meeting_id = :m and kind = :k and purged_at is null "
            "order by version desc limit 1"
        ),
        {"m": meeting_id, "k": kind},
    ).mappings().first()
    if not row:
        return None
    return int(row["version"]), _open(row["content_enc"], f"artifact:{row['id']}")


def artifact_version(conn: Connection, meeting_id: str, kind: str, version: int) -> Any:
    row = conn.execute(
        text("select id, content_enc from artifacts where meeting_id = :m and kind = :k and version = :v and purged_at is null"),
        {"m": meeting_id, "k": kind, "v": version},
    ).mappings().first()
    return _open(row["content_enc"], f"artifact:{row['id']}") if row else None


def list_artifact_versions(conn: Connection, meeting_id: str) -> list[dict]:
    rows = conn.execute(
        text(
            "select kind, version, created_at, created_by_user, created_by_agent, note, sha256, purged_at is not null as purged "
            "from artifacts where meeting_id = :m order by kind, version"
        ),
        {"m": meeting_id},
    ).mappings()
    return [dict(r) for r in rows]


def purge_artifacts(conn: Connection, meeting_id: str, kinds: list[str]) -> int:
    """Retention: the content goes, the version history (hashes, authors, dates) stays."""
    res = conn.execute(
        text(
            "update artifacts set content_enc = '\\x'::bytea, purged_at = now() "
            "where meeting_id = :m and kind = any(:k) and purged_at is null"
        ),
        {"m": meeting_id, "k": kinds},
    )
    return res.rowcount or 0


# --- blobs --------------------------------------------------------------------------------------
def add_blob(
    conn: Connection, *, blob_id: str, org_id: str, meeting_id: str | None, kind: str, storage_key: str,
    size: int, sha256: str, content_type: str, filename: str | None = None,
) -> None:
    conn.execute(
        text(
            "insert into blobs (id, org_id, meeting_id, kind, storage_key, size_bytes, sha256, content_type, filename_enc) "
            "values (:id, :org, :m, :k, :sk, :sz, :h, :ct, :fn)"
        ),
        {
            "id": blob_id, "org": org_id, "m": meeting_id, "k": kind, "sk": storage_key, "sz": size, "h": sha256,
            "ct": content_type, "fn": _seal(filename, f"blob:{blob_id}:filename") if filename else None,
        },
    )


def latest_blob(conn: Connection, meeting_id: str, kind: str) -> dict | None:
    row = conn.execute(
        text(
            "select * from blobs where meeting_id = :m and kind = :k and purged_at is null order by created_at desc limit 1"
        ),
        {"m": meeting_id, "k": kind},
    ).mappings().first()
    if not row:
        return None
    b = dict(row)
    b["filename"] = _open(b.pop("filename_enc"), f"blob:{b['id']}:filename")
    return b


def get_blob(conn: Connection, blob_id: str) -> dict | None:
    row = conn.execute(text("select * from blobs where id = :id and purged_at is null"), {"id": blob_id}).mappings().first()
    if not row:
        return None
    b = dict(row)
    b["filename"] = _open(b.pop("filename_enc"), f"blob:{b['id']}:filename")
    return b


def meeting_blobs(conn: Connection, meeting_id: str) -> list[dict]:
    rows = conn.execute(text("select * from blobs where meeting_id = :m"), {"m": meeting_id}).mappings()
    return [dict(r) for r in rows]


def mark_blob_purged(conn: Connection, blob_id: str) -> None:
    conn.execute(text("update blobs set purged_at = now() where id = :id"), {"id": blob_id})


# --- audit and processing register ------------------------------------------------------------
def audit(
    conn: Connection, org_id: str, action: str, *, actor_user: str | None = None, actor_kind: str = "user",
    target_type: str | None = None, target_id: str | None = None, meeting_id: str | None = None,
    details: dict | None = None,
) -> None:
    conn.execute(
        text(
            "insert into audit_log (org_id, actor_user, actor_kind, action, target_type, target_id, meeting_id, details_enc) "
            "values (:org, :u, :k, :a, :tt, :ti, :m, :d)"
        ),
        {
            "org": org_id, "u": actor_user, "k": actor_kind, "a": action, "tt": target_type, "ti": target_id,
            "m": meeting_id, "d": _seal(details, f"audit:{org_id}") if details is not None else None,
        },
    )


def audit_entries(conn: Connection, org_id: str, meeting_id: str | None = None, limit: int = 500) -> list[dict]:
    q = (
        "select a.id, a.at, a.actor_user, u.name as actor_name, a.actor_kind, a.action, a.target_type, a.target_id, "
        "a.meeting_id, a.details_enc from audit_log a left join users u on u.id = a.actor_user "
    )
    params: dict[str, Any] = {"lim": limit}
    if meeting_id:
        q += "where a.meeting_id = :m "
        params["m"] = meeting_id
    q += "order by a.at desc, a.id desc limit :lim"
    out = []
    for r in conn.execute(text(q), params).mappings():
        e = dict(r)
        e["details"] = _open(e.pop("details_enc"), f"audit:{org_id}")
        out.append(e)
    return out


def record_processing(
    conn: Connection, org_id: str, meeting_id: str | None, *, stage: str, provider: str, model: str | None,
    data_kind: str, external: bool, detail: dict | None = None,
) -> None:
    conn.execute(
        text(
            "insert into processing_records (org_id, meeting_id, stage, provider, model, data_kind, external, detail) "
            "values (:org, :m, :s, :p, :mo, :dk, :e, cast(:d as jsonb))"
        ),
        {
            "org": org_id, "m": meeting_id, "s": stage, "p": provider, "mo": model, "dk": data_kind, "e": external,
            "d": json.dumps(detail or {}),
        },
    )


def processing_records(conn: Connection, meeting_id: str) -> list[dict]:
    rows = conn.execute(
        text("select at, stage, provider, model, data_kind, external, detail from processing_records where meeting_id = :m order by at"),
        {"m": meeting_id},
    ).mappings()
    return [dict(r) for r in rows]


# --- glossary -----------------------------------------------------------------------------------
def list_glossary(conn: Connection) -> list[dict]:
    rows = conn.execute(text("select id, data_enc, updated_at from glossary_terms order by created_at")).mappings()
    out = []
    for r in rows:
        d = _open(r["data_enc"], f"glossary:{r['id']}") or {}
        out.append({"id": str(r["id"]), **d, "updated_at": r["updated_at"]})
    return out


def upsert_glossary(conn: Connection, org_id: str, data: dict, term_id: str | None = None) -> str:
    tid = term_id or new_uuid()
    sealed = _seal(data, f"glossary:{tid}")
    if term_id:
        res = conn.execute(
            text("update glossary_terms set data_enc = :d, updated_at = now() where id = :id"), {"d": sealed, "id": tid}
        )
        if not res.rowcount:
            raise KeyError(term_id)
    else:
        conn.execute(text("insert into glossary_terms (id, org_id, data_enc) values (:id, :org, :d)"), {"id": tid, "org": org_id, "d": sealed})
    return tid


def delete_glossary(conn: Connection, term_id: str) -> bool:
    return bool(conn.execute(text("delete from glossary_terms where id = :id"), {"id": term_id}).rowcount)
