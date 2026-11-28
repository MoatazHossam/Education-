"""Runs the agents for one meeting as resumable stages.

Each stage saves its output (an artifact version, or a blob) before the next starts, so a retried
job continues where the last one stopped: transcription even resumes chunk by chunk. Every use
of a provider (local or external) is written to the processing register, and an external one is
used only after privacy.authorize.

Job kinds:
* ``process``: intake → transcribe → diarize → align → readable → analyse → verify → write →
  language review → render.
* ``reanalyse``: from analyse (after transcript corrections or speaker names).
* ``reverify``: verify → write → review → render (after transcript corrections).
* ``regenerate``: write → review → render (after reviewers' decisions or edits).
"""

from __future__ import annotations

import base64
import json
import logging
import shutil
import tempfile
import time
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path

from mahdar import privacy, storage
from mahdar.config import get_settings
from mahdar.db import repo
from mahdar.db.core import org_tx
from mahdar.documents import exports, html
from mahdar.documents.docx_builder import build_docx, check_docx
from mahdar.documents.pdf import check_pdf, render_pdf
from mahdar.jobs import queue
from mahdar.pipeline import analysis as analysis_agent
from mahdar.pipeline import audio, quality, readable, verification
from mahdar.pipeline import minutes as minutes_agent
from mahdar.pipeline.align import align, overlap_regions
from mahdar.pipeline.asr import AsrError, AsrOptions, RawSegment, RawWord, get_provider, merge_chunks, screen
from mahdar.pipeline.asr.base import build_prompt
from mahdar.pipeline.diarization import DiarizationError, Turn, diarize
from mahdar.pipeline.llm import LlmClient, LlmError, get_client
from mahdar.pipeline.schemas import Analysis, AudioQualityReport, MinutesDocument, Transcript, VerificationReport

log = logging.getLogger("mahdar.pipeline")

STAGES = [
    "intake",
    "transcribe",
    "diarize",
    "align",
    "readable",
    "analyse",
    "verify",
    "write",
    "review_language",
    "render",
]
WEIGHTS = {
    "intake": 0.03,
    "transcribe": 0.45,
    "diarize": 0.12,
    "align": 0.02,
    "readable": 0.06,
    "analyse": 0.12,
    "verify": 0.10,
    "write": 0.05,
    "review_language": 0.03,
    "render": 0.02,
}
START = {"process": "intake", "reanalyse": "analyse", "reverify": "verify", "regenerate": "write"}
STAGE_AR = {
    "intake": "استلام التسجيل وفحص الجودة",
    "transcribe": "تفريغ الكلام",
    "diarize": "تمييز المتحدثين",
    "align": "نسبة الكلام إلى المتحدثين",
    "readable": "إعداد النسخة المقروءة",
    "analyse": "التحليل الدلالي",
    "verify": "التحقق من الأدلة",
    "write": "صياغة المحضر",
    "review_language": "المراجعة اللغوية",
    "render": "إنشاء المستندات",
}


class StageError(Exception):
    def __init__(self, code: str, message_ar: str, *, retryable: bool):
        super().__init__(message_ar)
        self.code = code
        self.message_ar = message_ar
        self.retryable = retryable


class AwaitingAuthorization(Exception):
    def __init__(self, message_ar: str):
        super().__init__(message_ar)
        self.message_ar = message_ar


class Run:
    def __init__(self, job: dict):
        self.job = job
        self.org_id = str(job["org_id"])
        self.meeting_id = str(job["meeting_id"])
        self.settings = get_settings()
        self.tmp = Path(tempfile.mkdtemp(prefix="mahdar-"))
        self.usage: list[dict] = []
        self._last_beat = 0.0

    # --- helpers -----------------------------------------------------------------------------------
    def tx(self):
        return org_tx(self.org_id)

    def meeting(self) -> dict:
        with self.tx() as c:
            m = repo.get_meeting(c, self.meeting_id)
        if m is None:
            raise StageError("meeting_missing", "الاجتماع غير موجود (ربما حُذف).", retryable=False)
        return m

    def latest(self, kind: str):
        with self.tx() as c:
            return repo.latest_artifact(c, self.meeting_id, kind)

    def save(self, kind: str, content, agent: str, note: str | None = None) -> int:
        with self.tx() as c:
            return repo.save_artifact(c, self.org_id, self.meeting_id, kind, content, agent=agent, note=note)

    def progress(self, stage: str, within: float) -> None:
        done = sum(WEIGHTS[s] for s in STAGES[: STAGES.index(stage)])
        total = round(min(0.999, done + WEIGHTS[stage] * max(0.0, min(1.0, within))), 4)
        now = time.monotonic()
        if now - self._last_beat < 2 and within not in (0.0, 1.0):
            return
        self._last_beat = now
        with self.tx() as c:
            queue.heartbeat(c, str(self.job["id"]), stage=stage, progress=total)
            repo.update_meeting(c, self.meeting_id, stage=stage, progress=total)

    def record(
        self, stage: str, provider: str, model: str | None, data_kind: str, external: bool, detail: dict | None = None
    ) -> None:
        with self.tx() as c:
            repo.record_processing(
                c,
                self.org_id,
                self.meeting_id,
                stage=stage,
                provider=provider,
                model=model,
                data_kind=data_kind,
                external=external,
                detail=detail,
            )

    def blob_file(self, kind: str) -> Path:
        with self.tx() as c:
            b = repo.latest_blob(c, self.meeting_id, kind)
        if b is None:
            raise StageError(
                "audio_missing", "لا يوجد ملف صوتي محفوظ لهذا الاجتماع (ربما انتهت مدة الاحتفاظ به).", retryable=False
            )
        dst = self.tmp / f"{kind}{Path(b['filename'] or '').suffix or '.bin'}"
        if not dst.exists():
            storage.read_to_file(b["storage_key"], str(b["id"]), dst)
        return dst

    def store_blob(self, kind: str, data: bytes | Path, content_type: str, filename: str) -> str:
        bid = storage.new_id()
        if isinstance(data, Path):
            key, size, sha = storage.put_file(self.org_id, bid, data)
        else:
            key, size, sha = storage.put_bytes(self.org_id, bid, data)
        with self.tx() as c:
            repo.add_blob(
                c,
                blob_id=bid,
                org_id=self.org_id,
                meeting_id=self.meeting_id,
                kind=kind,
                storage_key=key,
                size=size,
                sha256=sha,
                content_type=content_type,
                filename=filename,
            )
        return bid

    def llm_for(self, stage: str, meeting: dict, *, required: bool) -> LlmClient | None:
        provider = self.settings.llm_provider
        if provider == "none":
            if required:
                raise AwaitingAuthorization(
                    "لم يُعدّ نموذج لغوي للتحليل (MAHDAR_LLM_PROVIDER=none). التفريغ جاهز للمراجعة."
                )
            return None
        try:
            with self.tx() as c:
                decision = privacy.authorize(c, self.org_id, meeting, provider, "transcript")
        except privacy.NotAuthorized as exc:
            if required:
                raise AwaitingAuthorization(exc.reason_ar) from exc
            return None
        model = (
            self.settings.llm_verification_model if stage == "verify" and self.settings.llm_verification_model else None
        )
        client = get_client(provider, model)
        client._mahdar_external = decision.external  # type: ignore[attr-defined]
        return client

    def note_usage(self, stage: str, client: LlmClient | None, usage: list[dict]) -> None:
        if client is None or not usage:
            return
        self.usage += usage
        self.record(
            stage,
            client.provider,
            usage[-1].get("model"),
            "transcript",
            getattr(client, "_mahdar_external", True),
            {
                "calls": len(usage),
                "input_tokens": sum(u.get("input_tokens", 0) for u in usage),
                "output_tokens": sum(u.get("output_tokens", 0) for u in usage),
                "cache_read_tokens": sum(u.get("cache_read_tokens", 0) for u in usage),
                "served_by_fallback": any(u.get("served_by_fallback") for u in usage),
            },
        )

    def context(self) -> tuple[dict, list[dict], dict]:
        with self.tx() as c:
            m = repo.get_meeting(c, self.meeting_id)
            glossary = repo.list_glossary(c)
            org = repo.get_org(c, self.org_id)
        return m, glossary, org

    # --- stages ------------------------------------------------------------------------------------
    def intake(self) -> AudioQualityReport:
        existing = self.latest("audio_quality")
        with self.tx() as c:
            norm = repo.latest_blob(c, self.meeting_id, "audio_normalized")
        if existing and norm:
            return AudioQualityReport(**existing[1])
        self.progress("intake", 0.0)
        original = self.blob_file("audio_original")
        try:
            p = audio.probe(original)
            norm_path = audio.normalize(original, self.tmp / "normalized.wav")
            report = audio.analyse(
                original,
                norm_path,
                p,
                chunk_minutes=self.settings.chunk_minutes,
                overlap_seconds=self.settings.chunk_overlap_seconds,
            )
        except audio.AudioError as exc:
            raise StageError(exc.code, exc.message_ar, retryable=False) from exc
        self.store_blob("audio_normalized", norm_path, "audio/wav", "normalized.wav")
        self.save("audio_quality", report.model_dump(), "audio_intake")
        with self.tx() as c:
            repo.update_meeting(c, self.meeting_id, duration_seconds=report.duration_seconds)
        self.record("intake", "ffmpeg", None, "audio", False, {"duration": report.duration_seconds})
        if any(i.code == "no_speech" for i in report.issues):
            raise StageError("no_speech", "لم يُرصد كلام في التسجيل.", retryable=False)
        return report

    def transcribe(self, q: AudioQualityReport, meeting: dict, glossary: list[dict]) -> list[RawSegment]:
        provider = get_provider(self.settings.asr_provider)
        with self.tx() as c:
            try:
                decision = privacy.authorize(c, self.org_id, meeting, provider.name, "audio")
            except privacy.NotAuthorized as exc:
                raise StageError("asr_not_authorized", exc.reason_ar, retryable=False) from exc
        norm = self.blob_file("audio_normalized")
        terms = [g["term"] for g in glossary]
        opts = AsrOptions(
            language="ar",
            locale=meeting["meta"].get("locale") or "ar-EG",
            prompt=build_prompt(terms),
            hotwords=terms,
            expected_speakers=meeting["meta"].get("expected_speakers"),
        )
        done = self.latest("asr_chunks")
        state = (
            done[1]
            if done and done[1].get("provider") == provider.name and done[1].get("model") == provider.model
            else {"provider": provider.name, "model": provider.model, "chunks": {}}
        )
        for chunk in q.chunks:
            key = str(chunk.index)
            if key in state["chunks"]:
                continue

            def prog(x: float, i=chunk.index) -> None:
                self.progress("transcribe", (i + x) / len(q.chunks))

            try:
                segs = provider.transcribe(norm, chunk.start, chunk.end, opts, prog)
            except AsrError as exc:
                raise StageError("asr_failed", f"تعذر تفريغ الكلام: {exc}", retryable=exc.retryable) from exc
            state["chunks"][key] = {"start": chunk.start, "end": chunk.end, "segments": [_raw_to_dict(s) for s in segs]}
            self.save("asr_chunks", state, "transcription", note=f"chunk {chunk.index + 1}/{len(q.chunks)}")
        self.record("transcribe", provider.name, provider.model, "audio", decision.external, {"chunks": len(q.chunks)})
        if provider.name == "faster_whisper":
            from mahdar.pipeline.asr.faster_whisper_provider import release

            release()
        merged = merge_chunks(
            [
                (v["start"], v["end"], [_raw_from_dict(s) for s in v["segments"]])
                for _, v in sorted(state["chunks"].items(), key=lambda kv: int(kv[0]))
            ]
        )
        speech = audio.speech_regions(audio.load_samples(norm))
        return screen(merged, speech, opts.prompt)

    def diarize(self, meeting: dict, asr_diarizes: bool) -> list[Turn]:
        existing = self.latest("diarization")
        prov = self.settings.diarization_provider
        if existing and existing[1].get("provider") == prov:
            return [Turn(**t) for t in existing[1]["turns"]]
        self.progress("diarize", 0.0)
        if prov == "asr" and not asr_diarizes:
            prov = "sherpa_onnx"
        try:
            turns = diarize(prov, self.blob_file("audio_normalized"), meeting["meta"].get("expected_speakers"))
        except DiarizationError as exc:
            raise StageError("diarization_failed", f"تعذر تمييز المتحدثين: {exc}", retryable=exc.retryable) from exc
        self.save("diarization", {"provider": prov, "turns": [t.__dict__ for t in turns]}, "diarization")
        self.record("diarize", prov, None, "audio", False, {"turns": len(turns)})
        return turns

    # --- the whole run -----------------------------------------------------------------------------
    def execute(self) -> None:
        kind = self.job["kind"]
        start = START[kind]
        with self.tx() as c:
            repo.update_meeting(c, self.meeting_id, status="processing", error_code=None)
        meeting, glossary, org = self.context()
        try:
            if STAGES.index(start) <= STAGES.index("align"):
                self._stage("intake")
                q = self.intake()
                self._stage("transcribe")
                raw = self.transcribe(q, meeting, glossary)
                self._stage("diarize")
                asr_prov = get_provider(self.settings.asr_provider)
                turns = self.diarize(meeting, asr_prov.diarizes)
                self._stage("align")
                diarized = bool(turns) or (self.settings.diarization_provider == "asr" and asr_prov.diarizes)
                segs, speakers = align(raw, turns, diarized=diarized)
                q = q.model_copy(update={"overlap_regions": overlap_regions(turns)})
                self.save("audio_quality", q.model_dump(), "audio_intake", note="overlaps from diarization")
                tr = Transcript(
                    recording_sha256=q.recording_sha256,
                    asr_provider=asr_prov.name,
                    asr_model=asr_prov.model,
                    diarization_provider=self.settings.diarization_provider if diarized else "none",
                    segments=segs,
                    speakers=speakers,
                )
                self._stage("readable")
                llm = self.llm_for("readable", meeting, required=False)
                tr, usage, stats = readable.build(tr, glossary, llm, lambda x: self.progress("readable", x))
                self.note_usage("readable", llm, usage)
                self.save(
                    "transcript",
                    tr.model_dump(),
                    "transcription",
                    note=json.dumps({"readable": stats}, ensure_ascii=False),
                )
                self.progress("readable", 1.0)
            transcript = Transcript(**self.latest("transcript")[1])
            meeting, glossary, org = self.context()
            if STAGES.index(start) <= STAGES.index("analyse"):
                self._stage("analyse")
                llm = self.llm_for("analyse", meeting, required=True)
                an, usage = analysis_agent.analyse(
                    transcript,
                    _llm_meta(meeting),
                    glossary,
                    llm,
                    context_budget=self.settings.llm_context_tokens,
                    progress=lambda x: self.progress("analyse", x),
                )
                self.note_usage("analyse", llm, usage)
                self.save("analysis", an.model_dump(), "analysis")
                if kind == "reanalyse":
                    self._reset_item_reviews()
            an = Analysis(**self.latest("analysis")[1])
            if STAGES.index(start) <= STAGES.index("verify"):
                self._stage("verify")
                llm = self.llm_for("verify", meeting, required=False)
                rep, usage = verification.verify(
                    transcript,
                    an,
                    meta=_llm_meta(meeting),
                    glossary=glossary,
                    llm=llm,
                    progress=lambda x: self.progress("verify", x),
                )
                self.note_usage("verify", llm, usage)
                self.record("verify", "rules", None, "transcript", False, {"items": len(rep.items)})
                self.save("verification", rep.model_dump(), "verification")
            self.render(meeting, glossary, org, transcript, an)
        finally:
            shutil.rmtree(self.tmp, ignore_errors=True)

    def _stage(self, stage: str) -> None:
        with self.tx() as c:
            queue.record_stage(
                c,
                str(self.job["id"]),
                {"stage": stage, "label_ar": STAGE_AR[stage], "at": datetime.now(UTC).isoformat()},
            )
        self.progress(stage, 0.0)

    def _reset_item_reviews(self) -> None:
        r = self.latest("review")
        if r and r[1].get("items"):
            self.save(
                "review",
                {**r[1], "items": {}, "superseded_items": r[1]["items"]},
                "system",
                note="item reviews reset after re-analysis",
            )

    def render(self, meeting: dict, glossary: list[dict], org: dict, transcript: Transcript, an: Analysis) -> None:
        rep = VerificationReport(**self.latest("verification")[1])
        review = (self.latest("review") or (0, {}))[1]
        q0 = quality.evaluate(transcript, an, rep, review, org["settings"].get("quality_gates", {}))
        status = quality.minutes_status(q0, meeting["minutes_status"], bool(review.get("reviewed_by")))
        approval = None
        if status == "approved" and meeting.get("approved_at"):
            approval = {"name": review.get("approved_by_name", ""), "date": str(meeting["approved_at"])[:10]}
        self._stage("write")
        llm = self.llm_for("write", meeting, required=False)
        people = [g["term"] for g in glossary if g.get("category") == "person"]
        doc, usage = minutes_agent.build_minutes(
            transcript=transcript,
            analysis=an,
            verification=rep,
            review=review,
            meta=meeting["meta"],
            classification=meeting["classification"],
            minutes_status=status,
            approval=approval,
            glossary=glossary,
            llm=llm,
        )
        self.note_usage("write", llm, usage)
        self._stage("review_language")
        llm = self.llm_for("review_language", meeting, required=False)
        doc, usage = minutes_agent.review_language(doc, llm, people)
        self.note_usage("review_language", llm, usage)
        self._stage("render")
        files, checks = render_documents(
            doc,
            transcript=transcript,
            analysis=an,
            verification=rep,
            review=review,
            quality_=q0,
            meeting=meeting,
            org=org,
            tmp=self.tmp,
        )
        q1 = quality.evaluate(transcript, an, rep, review, org["settings"].get("quality_gates", {}), checks)
        status = quality.minutes_status(q1, meeting["minutes_status"], bool(review.get("reviewed_by")))
        label = minutes_agent.STATUS_LABELS[status]
        if label != doc.status_label:
            # Rendering checks can change the status: the label and the info table follow it.
            sections = [
                sec.model_copy(
                    update={
                        "rows": [
                            r.model_copy(update={"cells": {**r.cells, "القيمة": label}})
                            if r.cells.get("البيان") == "حالة المحضر"
                            else r
                            for r in sec.rows
                        ]
                    }
                )
                if sec.key == "info"
                else sec
                for sec in doc.sections
            ]
            doc = doc.model_copy(update={"status_label": label, "sections": sections})
            files, checks = render_documents(
                doc,
                transcript=transcript,
                analysis=an,
                verification=rep,
                review=review,
                quality_=q1,
                meeting=meeting,
                org=org,
                tmp=self.tmp,
            )
        version = self.save("minutes", doc.model_dump(), "writer", note=f"status {status}")
        blob_ids = {}
        for kind, (data, ctype, name) in files.items():
            blob_ids[kind] = self.store_blob(kind, data, ctype, name)
        processing = []
        with self.tx() as c:
            processing = [
                {k: (str(v) if isinstance(v, datetime) else v) for k, v in r.items()}
                for r in repo.processing_records(c, self.meeting_id)
            ]
        eff = minutes_agent.effective_items(an, rep, review)
        export = exports.export_json(
            meeting={**meeting, "minutes_status": status},
            transcript=transcript,
            analysis=an,
            verification=rep,
            minutes=doc,
            eff=eff,
            quality=q1,
            processing=processing,
        )
        blob_ids["export_json"] = self.store_blob(
            "export_json",
            json.dumps(export, ensure_ascii=False, indent=1, default=str).encode(),
            "application/json",
            "meeting.json",
        )
        self.save(
            "documents",
            {
                "minutes_version": version,
                "blobs": blob_ids,
                "checks": checks,
                "quality": q1,
                "generated_at": datetime.now(UTC).isoformat(),
                "usage": self.usage,
            },
            "documents",
        )
        with self.tx() as c:
            repo.update_meeting(
                c,
                self.meeting_id,
                status="review",
                stage="done",
                progress=1.0,
                minutes_status=status,
                critical_open=q1["open_critical"],
                error_code=None,
            )
            repo.audit(
                c,
                self.org_id,
                "minutes.generated",
                actor_kind="agent",
                target_type="meeting",
                target_id=self.meeting_id,
                meeting_id=self.meeting_id,
                details={"status": status, "open_critical": q1["open_critical"], "minutes_version": version},
            )


def render_documents(
    doc: MinutesDocument,
    *,
    transcript: Transcript,
    analysis: Analysis,
    verification: VerificationReport,
    review: dict,
    quality_: dict,
    meeting: dict,
    org: dict,
    tmp: Path,
) -> tuple[dict, dict]:
    branding = org["settings"].get("branding", {})
    org_name = branding.get("org_name_ar") or org.get("name")
    logo = None
    logo_uri = None
    if branding.get("logo_blob_id"):
        with org_tx(org["id"]) as c:
            b = repo.get_blob(c, branding["logo_blob_id"])
        if b:
            logo = storage.read_bytes(b["storage_key"], str(b["id"]))
            logo_uri = f"data:{b['content_type']};base64,{base64.b64encode(logo).decode()}"
    title = meeting["meta"].get("title") or "اجتماع"
    files: dict[str, tuple[bytes, str, str]] = {}
    checks: dict[str, dict] = {}
    docx = build_docx(doc, org_name=org_name, logo=logo, footer_note=branding.get("footer_text"))
    checks["minutes_docx"] = check_docx(docx)
    files["minutes_docx"] = (
        docx,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "minutes.docx",
    )
    texts = [b.text for s in doc.sections for b in s.blocks] + [
        v for s in doc.sections for r in s.rows for v in r.cells.values()
    ]
    pdf = render_pdf(html.minutes_html(doc, org_name=org_name, logo_data_uri=logo_uri))
    checks["minutes_pdf"] = check_pdf(pdf, texts)
    files["minutes_pdf"] = (pdf, "application/pdf", "minutes.pdf")
    ev = render_pdf(
        html.evidence_html(
            title=title,
            transcript=transcript,
            analysis=analysis,
            verification=verification,
            quality=quality_,
            classification_label=doc.classification_label,
        )
    )
    checks["evidence_pdf"] = check_pdf(ev, [i.statement for i in analysis.items])
    files["evidence_pdf"] = (ev, "application/pdf", "evidence-report.pdf")
    tp = render_pdf(
        html.transcript_html(
            title=title, transcript=transcript, readable=True, classification_label=doc.classification_label
        )
    )
    checks["transcript_pdf"] = check_pdf(tp, [s.text_readable for s in transcript.segments])
    files["transcript_pdf"] = (tp, "application/pdf", "transcript.pdf")
    sp = render_pdf(html.summary_html(doc=doc, org_name=org_name))
    files["summary_pdf"] = (sp, "application/pdf", "executive-summary.pdf")
    eff = minutes_agent.effective_items(analysis, verification, review)
    files["actions_csv"] = (exports.actions_csv(eff, transcript), "text/csv; charset=utf-8", "action-items.csv")
    files["transcript_txt"] = (
        exports.transcript_text(transcript, readable=False),
        "text/plain; charset=utf-8",
        "transcript-verbatim.txt",
    )
    _ = tmp
    return files, checks


def _llm_meta(meeting: dict) -> dict:
    m = meeting["meta"]
    return {
        "العنوان": m.get("title"),
        "التاريخ": m.get("date"),
        "date": m.get("date"),
        "المكان": m.get("location"),
        "عدد المتحدثين المتوقع": m.get("expected_speakers"),
    }


def _raw_to_dict(s: RawSegment) -> dict:
    return {
        "start": s.start,
        "end": s.end,
        "text": s.text,
        "words": [w.__dict__ for w in s.words],
        "avg_logprob": s.avg_logprob,
        "no_speech_prob": s.no_speech_prob,
        "compression_ratio": s.compression_ratio,
        "speaker": s.speaker,
        "flags": sorted(s.flags),
    }


def _raw_from_dict(d: dict) -> RawSegment:
    return RawSegment(
        start=d["start"],
        end=d["end"],
        text=d["text"],
        words=[RawWord(**w) for w in d["words"]],
        avg_logprob=d["avg_logprob"],
        no_speech_prob=d["no_speech_prob"],
        compression_ratio=d["compression_ratio"],
        speaker=d["speaker"],
        flags=set(d["flags"]),
    )


def run_job(job: dict, on_retry: Callable[[], None] | None = None) -> None:
    """Runs one claimed job and records its outcome (called by the worker)."""
    org_id, meeting_id, job_id = str(job["org_id"]), str(job["meeting_id"]), str(job["id"])
    run = Run(job)
    try:
        run.execute()
        with org_tx(org_id) as c:
            queue.succeed(c, job_id)
    except AwaitingAuthorization as exc:
        with org_tx(org_id) as c:
            repo.update_meeting(c, meeting_id, status="awaiting_authorization", error_code="awaiting_authorization")
            repo.audit(
                c,
                org_id,
                "pipeline.awaiting_authorization",
                actor_kind="system",
                target_type="meeting",
                target_id=meeting_id,
                meeting_id=meeting_id,
                details={"reason_ar": exc.message_ar},
            )
            queue.record_stage(
                c, job_id, {"stage": "analyse", "status": "awaiting_authorization", "message_ar": exc.message_ar}
            )
            queue.succeed(c, job_id)
    except (StageError, LlmError) as exc:
        retryable = exc.retryable
        code = exc.code if isinstance(exc, StageError) else f"llm_{exc.kind}"
        message = exc.message_ar if isinstance(exc, StageError) else _llm_message(exc)
        with org_tx(org_id) as c:
            again = queue.fail(c, job, f"{code}: {exc}", retry=retryable)
            queue.record_stage(
                c,
                job_id,
                {
                    "stage": "error",
                    "status": "retrying" if again else "failed",
                    "message_ar": message,
                    "at": datetime.now(UTC).isoformat(),
                },
            )
            if not again:
                repo.update_meeting(c, meeting_id, status="failed", error_code=code)
                repo.audit(
                    c,
                    org_id,
                    "pipeline.failed",
                    actor_kind="system",
                    target_type="meeting",
                    target_id=meeting_id,
                    meeting_id=meeting_id,
                    details={"code": code, "message_ar": message},
                )
        log.warning("job failed", extra={"job": job_id, "code": code, "retry": retryable})
    except Exception as exc:  # unexpected: retried, then failed with a generic message
        log.exception("job crashed", extra={"job": job_id})
        with org_tx(org_id) as c:
            again = queue.fail(c, job, f"internal: {type(exc).__name__}: {exc}", retry=True)
            if not again:
                repo.update_meeting(c, meeting_id, status="failed", error_code="internal")
                queue.record_stage(
                    c,
                    job_id,
                    {"stage": "error", "status": "failed", "message_ar": "حدث خطأ داخلي غير متوقع أثناء المعالجة."},
                )


def _llm_message(exc: LlmError) -> str:
    return {
        "auth": "رفض مزوّد النموذج اللغوي بيانات الاعتماد (المفتاح غير صالح أو بلا صلاحية).",
        "refusal": "امتنع النموذج اللغوي عن معالجة هذا الطلب.",
        "truncated": "تجاوز رد النموذج اللغوي الحد الأقصى للطول.",
        "rate_limited": "تجاوز حد الطلبات لدى مزوّد النموذج اللغوي؛ ستُعاد المحاولة.",
        "unavailable": "تعذر الوصول إلى النموذج اللغوي؛ ستُعاد المحاولة.",
        "timeout": "انتهت مهلة النموذج اللغوي؛ ستُعاد المحاولة.",
        "config": "النموذج اللغوي غير مُعدّ بشكل صحيح.",
        "schema": "لم يطابق رد النموذج اللغوي البنية المطلوبة.",
        "invalid_json": "لم يطابق رد النموذج اللغوي البنية المطلوبة.",
    }.get(exc.kind, "خطأ لدى النموذج اللغوي.")
