"""The real speech models on the evaluation recordings (CI job "pipeline"; needs the models:
python -m mahdar.cli models download). The thresholds are deliberately loose: they catch a broken
pipeline, not a slightly worse model — docs/EVALUATION.md has the measured numbers."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest
from conftest import RECORDINGS, SCENARIOS

from mahdar.evaluation import metrics

pytestmark = pytest.mark.models

WER_LIMIT = {"large-v3": 0.25, "large-v3-turbo": 0.3, "medium": 0.35, "small": 0.5}


@pytest.fixture(scope="module")
def s1(tmp_path_factory):
    from mahdar.pipeline import audio
    from mahdar.pipeline.align import align
    from mahdar.pipeline.asr import AsrOptions, get_provider, merge_chunks, screen
    from mahdar.pipeline.asr.base import build_prompt
    from mahdar.pipeline.diarization import diarize

    src = RECORDINGS / "s1_formal_decisions.mp3"
    work = tmp_path_factory.mktemp("s1")
    probe = audio.validate(src, filename=src.name, max_bytes=500_000_000, max_seconds=3600)
    norm = audio.normalize(src, work / "norm.wav")
    q = audio.analyse(src, norm, probe, chunk_minutes=1.0, overlap_seconds=2.0)  # force several chunks
    prov = get_provider("faster_whisper", os.environ.get("MAHDAR_WHISPER_MODEL", "large-v3"))
    opts = AsrOptions(prompt=build_prompt(["البوابة الإلكترونية"]))
    raw = merge_chunks([(c.start, c.end, prov.transcribe(norm, c.start, c.end, opts)) for c in q.chunks])
    raw = screen(raw, audio.speech_regions(audio.load_samples(norm)), opts.prompt)
    turns = diarize("sherpa_onnx", norm, 3)
    segments, speakers = align(raw, turns, diarized=True)
    return {"quality": q, "segments": segments, "speakers": speakers, "model": prov.model}


def test_intake_quality_and_chunks(s1):
    q = s1["quality"]
    assert q.overall in ("good", "fair") and q.speech_ratio > 0.6 and len(q.chunks) >= 2
    assert abs(q.duration_seconds - 135.6) < 1.0


def test_transcription_against_the_human_reference(s1):
    ref = json.loads((RECORDINGS / "s1_formal_decisions.reference.json").read_text(encoding="utf-8"))
    hyp = " ".join(s.text_verbatim for s in s1["segments"] if not s.excluded)
    wer = metrics.wer(" ".join(r["text"] for r in ref["segments"]), hyp)
    assert wer <= WER_LIMIT.get(s1["model"], 0.5), wer
    # The facts the minutes depend on survive recognition.
    from mahdar.pipeline import arabic

    nums = arabic.extract_numbers(hyp)
    assert 2400000 in nums and 85 in nums


def test_three_speakers_found_and_mostly_right(s1):
    ref = json.loads((RECORDINGS / "s1_formal_decisions.reference.json").read_text(encoding="utf-8"))
    result = metrics.speaker_accuracy(ref["segments"], [s.model_dump() for s in s1["segments"]])
    assert result["detected_speakers"] == 3
    assert result["accuracy"] >= 0.7, result


def test_pipeline_without_a_language_model_stops_safely(database, tmp_path):
    """No model configured: the transcript is kept and the meeting waits; nothing is invented."""
    from mahdar.cli import main
    from mahdar.db import repo
    from mahdar.db.core import org_tx

    meta = tmp_path / "meta.json"
    meta.write_text(
        json.dumps(json.loads((SCENARIOS / "s4_financial.json").read_text(encoding="utf-8"))["meeting"]),
        encoding="utf-8",
    )
    out = tmp_path / "out"
    code = main(
        [
            "process-file",
            str(RECORDINGS / "s4_financial.m4a"),
            "--org",
            "اختبار",
            "--meta",
            str(meta),
            "--out",
            str(out),
        ]
    )
    assert code == 0
    tr = json.loads((out / "transcript.json").read_text(encoding="utf-8"))
    assert tr["segments"] and len(tr["speakers"]) >= 2
    assert not (out / "analysis.json").exists() and not (out / "minutes.json").exists()
    from sqlalchemy import text

    with org_tx(_org(database)) as c:
        status = c.execute(text("select status from meetings order by created_at desc limit 1")).scalar_one()
        assert status == "awaiting_authorization"
        assert any(
            r["stage"] == "transcribe" and not r["external"]
            for r in repo.processing_records(
                c, str(c.execute(text("select id from meetings order by created_at desc limit 1")).scalar_one())
            )
        )


def _org(_db) -> str:
    from sqlalchemy import text

    from mahdar.db.core import owner_engine

    with owner_engine().connect() as c:
        return str(c.execute(text("select id from organizations where name = 'اختبار'")).scalar_one())


_ = Path
