"""Command line: ``python -m mahdar.cli <command>`` (or ``mahdar <command>``).

migrate            apply database migrations (and create/update the mahdar_app role if MAHDAR_APP_DB_PASSWORD is set)
create-admin       create an organization and its first administrator
create-user        add a user to an organization
check-config       refuse a production configuration with missing or weak secrets (exit 1)
selfcheck          FFmpeg, Arabic fonts, DOCX and PDF rendering, interface files (exit 1 on a problem)
worker-health      exit 0 when a worker has beaten within two minutes (container health check)
models download    download the speech models (faster-whisper, sherpa-onnx diarization)
process-file       run the whole pipeline on a local recording, without the API (testing, evaluation)
export             write a processed meeting's documents to a folder
evaluate           score processed evaluation recordings against their human-written references
purge-expired      apply the retention policies now
rotate-data-key    re-encrypt stored values with the current MAHDAR_DATA_KEY
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
import tarfile
import tempfile
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path


def _print(obj) -> None:
    print(json.dumps(obj, ensure_ascii=False, indent=1, default=str))


def cmd_migrate(_a) -> int:
    from mahdar.db.core import migrate

    applied = migrate(os.environ.get("MAHDAR_APP_DB_PASSWORD") or None)
    print(f"migrations applied: {applied or 'none (up to date)'}")
    return 0


def _create_org_and_admin(org_name: str, email: str, name: str, password: str) -> tuple[str, str]:
    from mahdar.db import repo
    from mahdar.db.core import org_tx, system_tx
    from mahdar.security.passwords import hash_password

    with system_tx() as c:
        org_id = repo.create_org(c, org_name)
        uid = repo.create_user(c, org_id, email, name, hash_password(password), "admin")
    with org_tx(org_id) as c:
        repo.audit(
            c, org_id, "org.created", actor_kind="system", target_type="user", target_id=uid, details={"role": "admin"}
        )
    return org_id, uid


def _password(arg: str | None) -> str:
    pw = arg or os.environ.get("MAHDAR_ADMIN_PASSWORD")
    if not pw:
        pw = getpass.getpass("Password (at least 12 characters): ")
    return pw


def cmd_create_admin(a) -> int:
    org_id, uid = _create_org_and_admin(a.org, a.email, a.name or a.email.split("@")[0], _password(a.password))
    print(f"organization {org_id}, administrator {uid}")
    return 0


def cmd_create_user(a) -> int:
    from mahdar.db import repo
    from mahdar.db.core import org_tx, system_tx
    from mahdar.security.passwords import hash_password

    with system_tx() as c:
        uid = repo.create_user(
            c, a.org_id, a.email, a.name or a.email.split("@")[0], hash_password(_password(a.password)), a.role
        )
    with org_tx(a.org_id) as c:
        repo.audit(
            c,
            a.org_id,
            "user.created",
            actor_kind="system",
            target_type="user",
            target_id=uid,
            details={"role": a.role},
        )
    print(uid)
    return 0


def cmd_check_config(_a) -> int:
    from mahdar.config import check_production, get_settings

    problems = check_production(get_settings())
    for p in problems:
        print(f"configuration error: {p}", file=sys.stderr)
    if not problems:
        print("configuration ok")
    return 1 if problems else 0


def cmd_selfcheck(a) -> int:
    from mahdar.documents import html
    from mahdar.documents.docx_builder import build_docx, check_docx
    from mahdar.documents.pdf import check_pdf, render_pdf
    from mahdar.pipeline.schemas import Block, MinutesDocument, Section, TableRow

    problems = []
    for tool in ("ffmpeg", "ffprobe"):
        if not shutil.which(tool):
            problems.append(f"{tool} is not installed")
    fonts = subprocess.run(["fc-list", ":lang=ar", "family"], capture_output=True, text=True).stdout
    for fam in ("Noto Naskh Arabic", "Noto Kufi Arabic"):
        if fam not in fonts:
            problems.append(f"font missing: {fam}")
    doc = MinutesDocument(
        title="محضر اجتماع",
        status_label="مسودة تتطلب المراجعة",
        classification_label="داخلي",
        meeting_info={"موضوع الاجتماع": "فحص ذاتي"},
        sections=[
            Section(
                key="info",
                title="أولاً: بيانات الاجتماع",
                table_columns=["البيان", "القيمة"],
                rows=[
                    TableRow(
                        id="M1", cells={"البيان": "موضوع الاجتماع", "القيمة": "فحص ذاتي لعرض المستندات"}, item_ids=[]
                    )
                ],
            ),
            Section(
                key="topics",
                title="ثالثاً: الموضوعات التي تمت مناقشتها",
                blocks=[
                    Block(
                        id="B1",
                        kind="paragraph",
                        text="نوقشت إمكانية ربط نظام ERP مع Dynamics 365 عن طريق API، مع التأكيد على ضرورة مراجعة التكلفة البالغة 2,400,000 جنيه قبل اتخاذ قرار.",
                    ),
                    Block(id="B2", kind="bullet", text="رُفع مستوى الخدمة المستهدف (SLA) من 99.5٪ إلى 99.9٪."),
                ],
            ),
            Section(
                key="decisions",
                title="رابعاً: القرارات المعتمدة",
                table_columns=["رقم", "القرار", "المسؤول", "تاريخ التنفيذ", "المرجع"],
                rows=[
                    TableRow(
                        id="D1",
                        cells={
                            "رقم": "1",
                            "القرار": "اعتماد ميزانية المرحلة الأولى.",
                            "المسؤول": "لم يُحدد",
                            "تاريخ التنفيذ": "15 يناير",
                            "المرجع": "S0007 (01:07.6)",
                        },
                        item_ids=["I1"],
                    )
                ],
            ),
        ],
    )
    docx = build_docx(doc, org_name="فحص")
    dc = check_docx(docx)
    if not dc["ok"]:
        problems += [f"docx: {p}" for p in dc["problems"]]
    texts = [b.text for s in doc.sections for b in s.blocks] + [
        v for s in doc.sections for r in s.rows for v in r.cells.values()
    ]
    out = Path(a.out) if a.out else None
    pdf = render_pdf(html.minutes_html(doc, org_name="فحص", logo_data_uri=None))
    pc = check_pdf(pdf, texts, render_dir=out / "pages" if out else None)
    if not pc["ok"]:
        problems += [f"pdf: {p}" for p in pc["problems"]]
    if out:
        out.mkdir(parents=True, exist_ok=True)
        (out / "selfcheck.docx").write_bytes(docx)
        (out / "selfcheck.pdf").write_bytes(pdf)
    web = os.environ.get("MAHDAR_WEB_DIR")
    if web and not (Path(web) / "index.html").exists():
        problems.append(f"interface not found in {web}")
    _print(
        {
            "ok": not problems,
            "problems": problems,
            "pdf_fonts": [f["name"] for f in pc["fonts"]],
            "pdf_word_coverage": pc["word_coverage"],
        }
    )
    return 1 if problems else 0


def cmd_worker_health(_a) -> int:
    from mahdar.db.core import system_tx
    from mahdar.jobs.queue import last_worker_beat

    with system_tx() as c:
        beat = last_worker_beat(c)
    ok = beat is not None and beat > datetime.now(UTC) - timedelta(minutes=2)
    print("healthy" if ok else f"no recent heartbeat (last: {beat})")
    return 0 if ok else 1


SHERPA = {
    "sherpa-onnx-pyannote-segmentation-3-0": "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    "wespeaker_en_voxceleb_resnet34_LM.onnx": "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34_LM.onnx",
}


def cmd_models(a) -> int:
    from mahdar.config import get_settings

    s = get_settings()
    base = s.resolved_models_dir
    os.environ.setdefault("HF_HOME", str(base / "huggingface"))
    sherpa = base / "sherpa"
    sherpa.mkdir(parents=True, exist_ok=True)
    for name, url in SHERPA.items():
        dst = sherpa / name
        if dst.exists():
            print(f"present: {name}")
            continue
        print(f"downloading {name}")
        with tempfile.NamedTemporaryFile(delete=False) as tmp, urllib.request.urlopen(url, timeout=300) as r:  # noqa: S310 (fixed https URLs)
            shutil.copyfileobj(r, tmp)
        if url.endswith(".tar.bz2"):
            with tarfile.open(tmp.name, "r:bz2") as t:
                t.extractall(sherpa, filter="data")
        else:
            shutil.move(tmp.name, dst)
        Path(tmp.name).unlink(missing_ok=True)
    from faster_whisper.utils import download_model

    for m in a.whisper or [s.whisper_model]:
        print(f"whisper {m}: {download_model(m)}")
    return 0


def _ensure_org(name: str) -> str:
    from sqlalchemy import text

    from mahdar.db import repo
    from mahdar.db.core import system_tx

    with system_tx() as c:
        row = c.execute(
            text("select id from organizations where name = :n order by created_at limit 1"), {"n": name}
        ).first()
        if row:
            return str(row[0])
        return repo.create_org(c, name)


def cmd_process_file(a) -> int:
    from mahdar import storage
    from mahdar.db import repo
    from mahdar.db.core import org_tx, system_tx
    from mahdar.jobs import queue
    from mahdar.pipeline import audio
    from mahdar.pipeline.orchestrator import run_job

    path = Path(a.path)
    s = __import__("mahdar.config", fromlist=["get_settings"]).get_settings()
    audio.validate(
        path, filename=path.name, max_bytes=s.max_upload_mb * 1_000_000, max_seconds=s.max_duration_minutes * 60
    )
    org_id = a.org_id or _ensure_org(a.org)
    meta = json.loads(Path(a.meta).read_text(encoding="utf-8")) if a.meta else {}
    meta.setdefault("title", path.stem)
    glossary = json.loads(Path(a.glossary).read_text(encoding="utf-8")) if a.glossary else []
    with org_tx(org_id) as c:
        existing = {g["term"] for g in repo.list_glossary(c)}
        for g in glossary:
            if g["term"] not in existing:
                repo.upsert_glossary(c, org_id, g)
        if a.allow_external:
            repo.update_org_settings(
                c,
                org_id,
                "privacy",
                {"transcript": a.allow_external.split(","), "max_classification_external": "confidential"},
            )
        mid = repo.create_meeting(c, org_id, None, meta, a.classification)
    bid = storage.new_id()
    key, size, sha = storage.put_file(org_id, bid, path)
    with org_tx(org_id) as c:
        repo.add_blob(
            c,
            blob_id=bid,
            org_id=org_id,
            meeting_id=mid,
            kind="audio_original",
            storage_key=key,
            size=size,
            sha256=sha,
            content_type="audio/*",
            filename=path.name,
        )
        jid = queue.enqueue(c, org_id, mid, "process")
    with system_tx() as c:
        job = (
            c.execute(
                __import__("sqlalchemy").text(
                    "update jobs set status='running', attempts=1, locked_by='cli', heartbeat_at=now() "
                    "where id = :id returning *"
                ),
                {"id": jid},
            )
            .mappings()
            .first()
        )
    run_job(dict(job))
    with org_tx(org_id) as c:
        m = repo.get_meeting(c, mid)
        j = queue.latest_job(c, mid)
    _print(
        {
            "org_id": org_id,
            "meeting_id": mid,
            "status": m["status"],
            "minutes_status": m["minutes_status"],
            "critical_open": m["critical_open"],
            "error": j.get("error"),
            "stages": j.get("stages"),
        }
    )
    if a.out:
        return cmd_export(argparse.Namespace(org_id=org_id, meeting_id=mid, out=a.out))
    return 0 if m["status"] in ("review", "awaiting_authorization") else 1


def cmd_export(a) -> int:
    from mahdar import storage
    from mahdar.db import repo
    from mahdar.db.core import org_tx

    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    with org_tx(a.org_id) as c:
        docs = repo.latest_artifact(c, a.meeting_id, "documents")
        arts = {
            k: repo.latest_artifact(c, a.meeting_id, k)
            for k in ("audio_quality", "transcript", "analysis", "verification", "minutes")
        }
        blobs = {k: repo.get_blob(c, v) for k, v in (docs[1]["blobs"].items() if docs else [])}
    for b in blobs.values():
        if b:
            (out / b["filename"]).write_bytes(storage.read_bytes(b["storage_key"], str(b["id"])))
    for k, v in arts.items():
        if v:
            (out / f"{k}.json").write_text(
                json.dumps(v[1], ensure_ascii=False, indent=1, default=str), encoding="utf-8"
            )
    if docs:
        (out / "documents.json").write_text(
            json.dumps(docs[1], ensure_ascii=False, indent=1, default=str), encoding="utf-8"
        )
    print(f"written to {out}")
    return 0


def cmd_evaluate(a) -> int:
    from mahdar.evaluation.runner import evaluate_dir

    report = evaluate_dir(Path(a.results), Path(a.dataset))
    if a.out:
        Path(a.out).parent.mkdir(parents=True, exist_ok=True)
        Path(a.out).write_text(json.dumps(report, ensure_ascii=False, indent=1), encoding="utf-8")
    _print(report["summary"])
    return 0


def cmd_purge(_a) -> int:
    from mahdar.retention import sweep

    _print(sweep())
    return 0


def cmd_rotate(_a) -> int:
    from mahdar.security.rotate import rotate_all

    _print(rotate_all())
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="mahdar")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("migrate").set_defaults(fn=cmd_migrate)
    p = sub.add_parser("create-admin")
    p.add_argument("--org", required=True)
    p.add_argument("--email", required=True)
    p.add_argument("--name")
    p.add_argument("--password", help="or MAHDAR_ADMIN_PASSWORD, or prompted")
    p.set_defaults(fn=cmd_create_admin)
    p = sub.add_parser("create-user")
    p.add_argument("--org-id", required=True)
    p.add_argument("--email", required=True)
    p.add_argument("--name")
    p.add_argument("--role", choices=["admin", "approver", "editor", "viewer"], default="editor")
    p.add_argument("--password")
    p.set_defaults(fn=cmd_create_user)
    sub.add_parser("check-config").set_defaults(fn=cmd_check_config)
    p = sub.add_parser("selfcheck")
    p.add_argument("--out", help="folder for the sample DOCX, PDF and page images")
    p.set_defaults(fn=cmd_selfcheck)
    sub.add_parser("worker-health").set_defaults(fn=cmd_worker_health)
    p = sub.add_parser("models")
    p.add_argument("action", choices=["download"])
    p.add_argument("--whisper", action="append", help="faster-whisper model name (repeatable)")
    p.set_defaults(fn=cmd_models)
    p = sub.add_parser("process-file")
    p.add_argument("path")
    p.add_argument("--org", default="تقييم")
    p.add_argument("--org-id")
    p.add_argument("--meta", help="JSON file: title, date, location, expected_speakers...")
    p.add_argument("--glossary", help="JSON file: [{term, variants, category, note}]")
    p.add_argument("--classification", default="internal", choices=["public", "internal", "confidential", "secret"])
    p.add_argument("--allow-external", help="providers the organization allows for transcripts, e.g. anthropic")
    p.add_argument("--out", help="write the documents and artifacts here")
    p.set_defaults(fn=cmd_process_file)
    p = sub.add_parser("export")
    p.add_argument("--org-id", required=True)
    p.add_argument("--meeting-id", required=True)
    p.add_argument("--out", required=True)
    p.set_defaults(fn=cmd_export)
    p = sub.add_parser("evaluate")
    p.add_argument("--results", default="backend/test-output/runs", help="folder with one exported run per recording")
    p.add_argument("--dataset", default="evaluation")
    p.add_argument("--out")
    p.set_defaults(fn=cmd_evaluate)
    sub.add_parser("purge-expired").set_defaults(fn=cmd_purge)
    sub.add_parser("rotate-data-key").set_defaults(fn=cmd_rotate)
    a = ap.parse_args(argv)
    return int(a.fn(a) or 0)


if __name__ == "__main__":
    sys.exit(main())
