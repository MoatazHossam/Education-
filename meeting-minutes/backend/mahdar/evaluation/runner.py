"""Scores exported runs (``mahdar.cli process-file --out <runs>/<recording id>``) against the
evaluation dataset (``evaluation/``: scenarios with expected items, recordings with reference
transcripts). Missing runs are reported, never guessed."""

from __future__ import annotations

import json
from pathlib import Path

from mahdar.evaluation import metrics
from mahdar.pipeline import arabic


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else None


def evaluate_run(run: Path, reference: dict, scenario: dict | None) -> dict:
    transcript = _load(run / "transcript.json")
    analysis = _load(run / "analysis.json")
    verification = _load(run / "verification.json")
    minutes = _load(run / "minutes.json")
    documents = _load(run / "documents.json")
    out: dict = {"id": reference["id"], "source": reference["source"]}
    if not transcript:
        out["error"] = "no transcript in this run"
        return out
    ref_text = " ".join(s["text"] for s in reference["segments"])
    hyp = " ".join(s["text_verbatim"] for s in transcript["segments"] if not s.get("excluded"))
    readable = " ".join(s["text_readable"] for s in transcript["segments"] if not s.get("excluded"))
    out["transcription"] = {
        "wer": metrics.wer(ref_text, hyp),
        "cer": metrics.cer(ref_text, hyp),
        "wer_readable": metrics.wer(ref_text, readable),
        "segments": len(transcript["segments"]),
        "excluded_segments": sum(1 for s in transcript["segments"] if s.get("excluded")),
        "asr": f"{transcript['asr_provider']}/{transcript['asr_model']}",
    }
    out["speakers"] = metrics.speaker_accuracy(reference["segments"], transcript["segments"])
    if analysis and verification:
        vby = {v["item_id"]: v for v in verification["items"]}
        items = [
            {
                **i,
                "final_type": vby.get(i["id"], {}).get("final_type", i["type"]),
                "status": vby.get(i["id"], {}).get("status"),
            }
            for i in analysis["items"]
        ]
        segs = {s["id"]: s for s in transcript["segments"]}
        statuses: dict[str, int] = {}
        for i in items:
            statuses[i["status"] or "none"] = statuses.get(i["status"] or "none", 0) + 1
        out["items"] = {
            "total": len(items),
            "by_status": statuses,
            "reclassified_by_verification": sum(1 for i in items if i["final_type"] != i["type"]),
            "analysis_model": f"{analysis['provider']}/{analysis['model']}",
            "independent_audit": verification.get("llm_used"),
        }
        unsupported = sum(1 for i in items if i["status"] in ("unsupported", "contradicted"))
        if scenario:
            mapping = (out["speakers"] or {}).get("mapping") or {}
            names = {sid: scenario.get("speaker_names", {}).get(ref) for ref, sid in mapping.items()}
            scores = metrics.item_scores(
                scenario["expected"],
                items,
                segs,
                scenario.get("glossary", []),
                {k: v for k, v in names.items() if v},
            )
            out["extraction"] = scores
            # Hallucination: items the transcript does not support, plus approved decisions with no
            # reference decision, over all items.
            out["hallucination_rate"] = round((unsupported + len(scores["invented_decisions"])) / max(1, len(items)), 4)
        out["evidence_coverage"] = verification["coverage"].get("evidence_coverage")
        out["unsupported_items_flagged"] = unsupported
        if minutes:
            # The safety figure: items the checks found unsupported or contradicted whose text still
            # reached the minutes (none should, unless a person accepted them).
            cited = {i for s in minutes["sections"] for x in [*s["blocks"], *s["rows"]] for i in x.get("item_ids", [])}
            out["unsupported_items_in_minutes"] = sorted(
                i["id"] for i in items if i["status"] in ("unsupported", "contradicted") and i["id"] in cited
            )
    if minutes:
        texts = [b["text"] for s in minutes["sections"] for b in s["blocks"]] + [
            v
            for s in minutes["sections"]
            if s["key"] not in ("info", "approval")
            for r in s["rows"]
            for v in r["cells"].values()
        ]
        out["minutes"] = {
            "status": minutes["status_label"],
            "invented_numbers": metrics.invented_numbers(texts, [ref_text]),
            "colloquial_words": sorted({w for t in texts for w in arabic.colloquial_words(t)}),
            "blocks_replaced_by_rules": sum(1 for i in minutes["issues"] if i["code"] == "writer_block_replaced"),
            "language_changes_refused": len(minutes.get("language_review", {}).get("refused", [])),
            "sections": [s["key"] for s in minutes["sections"]],
            "decisions_table_rows": sum(len(s["rows"]) for s in minutes["sections"] if s["key"] == "decisions"),
        }
    if documents:
        out["documents"] = {k: {"ok": v["ok"], "problems": v["problems"]} for k, v in documents["checks"].items()}
        out["quality_gates"] = {g["gate"]: g["passed"] for g in documents["quality"]["gates"]}
    return out


def evaluate_dir(results: Path, dataset: Path) -> dict:
    runs = []
    for ref_file in sorted((dataset / "recordings").glob("*.reference.json")):
        ref = json.loads(ref_file.read_text(encoding="utf-8"))
        scen_id = ref["id"].replace("_degraded", "")
        scen_file = dataset / "scenarios" / f"{scen_id}.json"
        scenario = _load(scen_file)
        run = results / ref["id"]
        if not run.exists():
            runs.append({"id": ref["id"], "error": "not processed"})
            continue
        runs.append(evaluate_run(run, ref, scenario))
    done = [r for r in runs if "error" not in r]
    summary = {
        "recordings": len(runs),
        "processed": len(done),
        "mean_wer": round(sum(r["transcription"]["wer"] for r in done) / len(done), 4) if done else None,
        "invented_decisions": sum(len(r.get("extraction", {}).get("invented_decisions", [])) for r in done),
        "not_decision_violations": sum(len(r.get("extraction", {}).get("not_decision_violations", [])) for r in done),
        "invented_numbers_in_minutes": sum(len(r.get("minutes", {}).get("invented_numbers", [])) for r in done),
        "documents_ok": all(all(d["ok"] for d in r.get("documents", {}).values()) for r in done),
        "per_recording": {
            r["id"]: {k: r[k] for k in ("transcription", "speakers", "hallucination_rate") if k in r} for r in done
        },
    }
    return {"summary": summary, "runs": runs}
