"""API against a real PostgreSQL with row-level security (connections as mahdar_app)."""

from __future__ import annotations

import subprocess

import pytest
from fastapi.testclient import TestClient
from helpers import analysis, item, seg, transcript

H = {"X-Requested-With": "mahdar"}
PASSWORD = "correct horse battery staple"


@pytest.fixture(scope="module")
def app(database):
    import importlib

    import mahdar.main

    importlib.reload(mahdar.main)
    return mahdar.main.app


@pytest.fixture(scope="module")
def orgs(database):
    from mahdar.cli import _create_org_and_admin
    from mahdar.db import repo
    from mahdar.db.core import system_tx
    from mahdar.security.passwords import hash_password

    a_org, _a_admin = _create_org_and_admin("جهة أ", "admin-a@example.com", "مدير أ", PASSWORD)
    b_org, _ = _create_org_and_admin("جهة ب", "admin-b@example.com", "مدير ب", PASSWORD)
    with system_tx() as c:
        repo.create_user(c, a_org, "viewer-a@example.com", "مطلع", hash_password(PASSWORD), "viewer")
        repo.create_user(c, a_org, "editor-a@example.com", "محرر", hash_password(PASSWORD), "editor")
    return {"a": a_org, "b": b_org}


def login(app, email: str) -> TestClient:
    c = TestClient(app)
    r = c.post("/api/auth/login", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200, r.text
    return c


@pytest.fixture(scope="module")
def tone(tmp_path_factory):
    p = tmp_path_factory.mktemp("audio") / "tone.wav"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-ar", "16000", str(p)],
        check=True,
    )
    return p


def test_login_and_me(app, orgs):
    c = login(app, "admin-a@example.com")
    me = c.get("/api/auth/me").json()
    assert me["role"] == "admin" and me["org_name"] == "جهة أ"


def test_wrong_password_and_lockout(app, orgs):
    c = TestClient(app)
    for _ in range(5):
        assert (
            c.post(
                "/api/auth/login", json={"email": "editor-a@example.com", "password": "wrong-password-123"}
            ).status_code
            == 401
        )
    r = c.post("/api/auth/login", json={"email": "editor-a@example.com", "password": PASSWORD})
    assert r.status_code == 401 and "مقفل" in r.json()["detail"]
    from sqlalchemy import text

    from mahdar.db.core import system_tx

    with system_tx() as conn:
        conn.execute(
            text("update users set failed_logins = 0, locked_until = null where email = 'editor-a@example.com'")
        )


def test_state_changes_need_the_csrf_header(app, orgs):
    c = login(app, "admin-a@example.com")
    assert c.post("/api/glossary", json={"term": "ERP"}).status_code == 403
    assert (
        c.post(
            "/api/glossary", json={"term": "ERP", "variants": ["إي آر بي"], "category": "acronym"}, headers=H
        ).status_code
        == 201
    )


def test_viewer_cannot_upload_or_edit(app, orgs, tone):
    c = login(app, "viewer-a@example.com")
    with open(tone, "rb") as f:
        r = c.post("/api/meetings", data={"title": "اختبار"}, files={"file": ("tone.wav", f, "audio/wav")}, headers=H)
    assert r.status_code == 403
    assert c.post("/api/glossary", json={"term": "X"}, headers=H).status_code == 403


def test_upload_validation(app, orgs, tmp_path):
    c = login(app, "editor-a@example.com")
    bad = tmp_path / "notes.txt"
    bad.write_text("ليس ملفاً صوتياً")
    with open(bad, "rb") as f:
        r = c.post("/api/meetings", data={"title": "اختبار"}, files={"file": ("notes.txt", f, "text/plain")}, headers=H)
    assert r.status_code == 422 and "امتداد" in r.json()["detail"]
    fake = tmp_path / "fake.mp3"
    fake.write_bytes(b"not really audio" * 100)
    with open(fake, "rb") as f:
        r = c.post("/api/meetings", data={"title": "اختبار"}, files={"file": ("fake.mp3", f, "audio/mpeg")}, headers=H)
    assert r.status_code == 422


@pytest.fixture(scope="module")
def meeting(app, orgs, tone):
    """An uploaded meeting with a transcript, an analysis and a verification already stored."""
    c = login(app, "editor-a@example.com")
    with open(tone, "rb") as f:
        r = c.post(
            "/api/meetings",
            data={"title": "اجتماع اختبار", "meeting_date": "2026-12-01", "classification": "confidential"},
            files={"file": ("tone.wav", f, "audio/wav")},
            headers=H,
        )
    assert r.status_code == 201, r.text
    mid = r.json()["id"]
    from mahdar.db import repo
    from mahdar.db.core import org_tx
    from mahdar.pipeline.verification import verify

    t = transcript(
        seg("S0001", "SPK_1", "إذن تقرر اعتماد ميزانية المرحلة الأولى بمبلغ مليونين وأربعمائة ألف جنيه.", 0, 6),
        seg("S0002", "SPK_2", "إحنا شايفين إن النظام ده ممكن يوفر وقت، بس محتاجين نراجع التكلفة الأول.", 6, 12),
    )
    an = analysis(
        item(
            "I001",
            "decision_approved",
            "تقرر اعتماد ميزانية المرحلة الأولى بمبلغ 2,400,000 جنيه.",
            [("S0001", "تقرر اعتماد ميزانية المرحلة الأولى")],
        ),
        item("I002", "decision_approved", "تقرر اعتماد النظام.", [("S0002", "النظام ده ممكن يوفر وقت")]),
    )
    rep, _ = verify(t, an, meta={}, glossary=[], llm=None)
    with org_tx(orgs["a"]) as conn:
        repo.save_artifact(conn, orgs["a"], mid, "transcript", t.model_dump(), agent="test")
        repo.save_artifact(conn, orgs["a"], mid, "analysis", an.model_dump(), agent="test")
        repo.save_artifact(conn, orgs["a"], mid, "verification", rep.model_dump(), agent="test")
    return mid


def test_upload_is_queued_and_audited(app, meeting):
    c = login(app, "editor-a@example.com")
    d = c.get(f"/api/meetings/{meeting}").json()
    assert d["status"] == "uploaded" and d["job"]["status"] == "queued" and d["classification"] == "confidential"
    actions = [e["action"] for e in c.get(f"/api/meetings/{meeting}/audit").json()]
    assert "meeting.uploaded" in actions


def test_other_organization_cannot_see_the_meeting(app, meeting):
    b = login(app, "admin-b@example.com")
    assert b.get(f"/api/meetings/{meeting}").status_code == 404
    assert b.get(f"/api/meetings/{meeting}/transcript").status_code == 404
    assert b.get("/api/meetings").json() == []
    assert b.get(f"/api/meetings/{meeting}/audio?start=0&end=1").status_code == 404


def test_row_level_security_blocks_queries_without_the_right_organization(meeting, orgs):
    # Even a raw query on the application role sees nothing outside its organization.
    from sqlalchemy import text

    from mahdar.db.core import org_tx, system_tx

    with system_tx() as c:
        assert c.execute(text("select count(*) from meetings")).scalar_one() == 0
        assert c.execute(text("select count(*) from artifacts")).scalar_one() == 0
    with org_tx(orgs["b"]) as c:
        assert c.execute(text("select count(*) from meetings")).scalar_one() == 0
    with org_tx(orgs["a"]) as c:
        assert c.execute(text("select count(*) from meetings")).scalar_one() >= 1


def test_content_is_encrypted_at_rest(meeting, orgs):
    from sqlalchemy import text

    from mahdar.db.core import owner_engine

    with owner_engine().connect() as c:
        raw = b"".join(bytes(r[0]) for r in c.execute(text("select content_enc from artifacts")))
        meta = b"".join(bytes(r[0]) for r in c.execute(text("select meta_enc from meetings")))
    assert "ميزانية".encode() not in raw and "اجتماع اختبار".encode() not in meta


def test_items_review_is_recorded_with_before_and_after(app, meeting):
    c = login(app, "editor-a@example.com")
    data = c.get(f"/api/meetings/{meeting}/items").json()
    by_id = {i["id"]: i for i in data["items"]}
    assert by_id["I001"]["verification"]["status"] == "verified_rules_only"
    assert by_id["I002"]["verification"]["final_type"] in ("proposal", "agreement_tentative")
    r = c.post(
        f"/api/meetings/{meeting}/items/I002/review", json={"decision": "rejected", "note": "رأي وليس قراراً"}, headers=H
    )
    assert r.status_code == 200
    entry = next(e for e in c.get(f"/api/meetings/{meeting}/audit").json() if e["action"] == "item.rejected")
    assert entry["details"]["after"]["decision"] == "rejected" and entry["actor_name"] == "محرر"


def test_viewer_cannot_review(app, meeting):
    c = login(app, "viewer-a@example.com")
    assert (
        c.post(f"/api/meetings/{meeting}/items/I001/review", json={"decision": "accepted"}, headers=H).status_code
        == 403
    )


def test_speaker_naming_is_versioned(app, meeting):
    c = login(app, "editor-a@example.com")
    r = c.patch(
        f"/api/meetings/{meeting}/speakers/SPK_1", json={"display_name": "أحمد علي", "title": "رئيس اللجنة"}, headers=H
    )
    assert r.status_code == 200 and r.json()["speaker"]["confirmed"] is True
    t = c.get(f"/api/meetings/{meeting}/transcript").json()
    assert t["version"] >= 2 and t["speakers"][0]["display_name"] == "أحمد علي"


def test_segment_correction_requires_a_reason(app, meeting):
    c = login(app, "editor-a@example.com")
    assert (
        c.patch(
            f"/api/meetings/{meeting}/transcript/segments/S0002", json={"text_verbatim": "x"}, headers=H
        ).status_code
        == 422
    )
    r = c.patch(
        f"/api/meetings/{meeting}/transcript/segments/S0002",
        json={"text_verbatim": "إحنا شايفين إن النظام ده ممكن يوفر وقت.", "reason": "استماع"},
        headers=H,
    )
    assert r.status_code == 200 and "edited" in r.json()["segment"]["flags"]


def test_cannot_approve_unreviewed_minutes(app, meeting):
    from mahdar.cli import _create_org_and_admin  # noqa: F401  (approver created below)
    from mahdar.db import repo
    from mahdar.db.core import system_tx
    from mahdar.security.passwords import hash_password

    c = login(app, "admin-a@example.com")
    org = c.get("/api/auth/me").json()["org_id"]
    with system_tx() as conn:
        if not repo.find_user_by_email(conn, "approver-a@example.com"):
            repo.create_user(conn, org, "approver-a@example.com", "معتمِد", hash_password(PASSWORD), "approver")
    a = login(app, "approver-a@example.com")
    r = a.post(f"/api/meetings/{meeting}/approve", headers=H)
    assert r.status_code == 409
    e = login(app, "editor-a@example.com")
    assert e.post(f"/api/meetings/{meeting}/approve", headers=H).status_code == 403


def test_privacy_settings_validate_providers(app, orgs):
    c = login(app, "admin-a@example.com")
    assert c.put("/api/org/privacy", json={"audio": ["nobody"], "transcript": []}, headers=H).status_code == 422
    r = c.put(
        "/api/org/privacy",
        json={"audio": [], "transcript": ["anthropic"], "max_classification_external": "internal"},
        headers=H,
    )
    assert r.status_code == 200 and r.json()["privacy"]["transcript"] == ["anthropic"]


def test_external_provider_needs_both_switches(orgs, meeting):
    import os

    from mahdar import privacy
    from mahdar.config import get_settings
    from mahdar.db import repo
    from mahdar.db.core import org_tx

    with org_tx(orgs["a"]) as c:
        m = repo.get_meeting(c, meeting)
        with pytest.raises(privacy.NotAuthorized):  # not allowed by the installation
            privacy.authorize(c, orgs["a"], m, "anthropic", "transcript")
    os.environ["MAHDAR_ALLOWED_EXTERNAL_PROVIDERS"] = "anthropic"
    get_settings.cache_clear()
    try:
        with org_tx(orgs["a"]) as c:
            m = repo.get_meeting(c, meeting)
            with pytest.raises(privacy.NotAuthorized) as exc:  # confidential > internal
                privacy.authorize(c, orgs["a"], m, "anthropic", "transcript")
            assert "تصنيف" in exc.value.reason_ar
            with pytest.raises(privacy.NotAuthorized):  # audio not allowed by the organization
                privacy.authorize(c, orgs["a"], {**m, "classification": "internal"}, "anthropic", "audio")
            assert privacy.authorize(
                c, orgs["a"], {**m, "classification": "internal"}, "anthropic", "transcript"
            ).external
            assert not privacy.authorize(c, orgs["a"], m, "faster_whisper", "audio").external
    finally:
        os.environ.pop("MAHDAR_ALLOWED_EXTERNAL_PROVIDERS")
        get_settings.cache_clear()


def test_delete_removes_files_and_keeps_the_audit(app, orgs, tone):
    c = login(app, "editor-a@example.com")
    with open(tone, "rb") as f:
        mid = c.post(
            "/api/meetings", data={"title": "للحذف"}, files={"file": ("tone.wav", f, "audio/wav")}, headers=H
        ).json()["id"]
    assert c.delete(f"/api/meetings/{mid}", headers=H).status_code == 200
    assert c.get(f"/api/meetings/{mid}").status_code == 404
    from mahdar.db import repo
    from mahdar.db.core import org_tx

    with org_tx(orgs["a"]) as conn:
        assert any(
            e["action"] == "meeting.deleted" and e["target_id"] == mid for e in repo.audit_entries(conn, orgs["a"])
        )


def test_health_and_openapi(app, database):
    c = TestClient(app)
    assert c.get("/healthz").json() == {"ok": True}
    assert c.get("/readyz").status_code == 200
    paths = c.get("/openapi.json").json()["paths"]
    assert "/api/meetings/{meeting_id}/items/{item_id}/review" in paths
    r = c.get("/healthz")
    assert "default-src 'self'" in r.headers["content-security-policy"]
