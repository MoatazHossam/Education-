"""The evaluation recordings must not appear in the prompts: a model that has seen a test sentence as
an example can copy it, which both inflates the scores and fabricates items (observed: a 4B model
copied a prompt example taken from one recording into the minutes of another)."""

import inspect
import json
from pathlib import Path

from mahdar.pipeline import arabic
from mahdar.pipeline.llm import prompts

SCENARIOS = Path(__file__).resolve().parents[2] / "evaluation" / "scenarios"
N = 4


def _grams(words: list[str]) -> set[str]:
    return {" ".join(words[i : i + N]) for i in range(len(words) - N + 1)}


def test_no_evaluation_sentence_in_prompts():
    prompt_grams = _grams(arabic.normalize(inspect.getsource(prompts)).split())
    files = sorted(SCENARIOS.glob("*.json"))
    assert files, "evaluation scenarios not found"
    leaked = []
    for f in files:
        for turn in json.loads(f.read_text(encoding="utf-8"))["turns"]:
            leaked += [(f.name, g) for g in _grams(arabic.normalize(turn["text"]).split()) & prompt_grams]
    assert not leaked, f"prompt text copied from evaluation recordings: {leaked}"


def test_no_quoted_prompt_example_from_evaluation():
    """Short quoted examples ("…") escape the n-gram check; none of three words or more may occur in
    a recording's script."""
    import re

    src = inspect.getsource(prompts)
    examples = {arabic.normalize(q) for q in re.findall(r"[\"“«]([^\"”»\n]{4,80})[\"”»]", src)}
    examples = {e for e in examples if len(e.split()) >= 3 and re.search(r"[ء-ي]", e)}
    scripts = [
        " " + arabic.normalize(t["text"]) + " "
        for f in sorted(SCENARIOS.glob("*.json"))
        for t in json.loads(f.read_text(encoding="utf-8"))["turns"]
    ]
    leaked = sorted(e for e in examples if any(f" {e} " in s for s in scripts))
    assert not leaked, f"quoted prompt examples taken from evaluation recordings: {leaked}"
