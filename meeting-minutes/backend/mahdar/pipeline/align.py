"""Speaker attribution: assigns each recognised word to the diarization turn it overlaps most,
splits segments where the speaker changes, and rates how sure each attribution is.

A segment's speaker is "high" only when almost all its words sit inside one speaker's turn, it is
long enough to judge, and nobody else is speaking at the same time. Anything else is "medium",
"low" or "unknown", and the verification agent treats claims resting on such segments with care.
"""

from __future__ import annotations

from collections import Counter

from mahdar.pipeline.asr.base import RawSegment, RawWord
from mahdar.pipeline.diarization import Turn
from mahdar.pipeline.schemas import Interval, Segment, Speaker, Word


def overlap_regions(turns: list[Turn]) -> list[Interval]:
    out: list[Interval] = []
    ts = sorted(turns, key=lambda t: t.start)
    for i, a in enumerate(ts):
        for b in ts[i + 1 :]:
            if b.start >= a.end:
                break
            if b.speaker != a.speaker:
                s, e = max(a.start, b.start), min(a.end, b.end)
                if e - s >= 0.2:
                    out.append(Interval(start=round(s, 2), end=round(e, 2)))
    merged: list[Interval] = []
    for iv in sorted(out, key=lambda x: x.start):
        if merged and iv.start <= merged[-1].end:
            merged[-1] = Interval(start=merged[-1].start, end=max(merged[-1].end, iv.end))
        else:
            merged.append(iv)
    return merged


def _assign(word: RawWord, turns: list[Turn]) -> tuple[str | None, float, bool]:
    """(speaker, share of the word inside that speaker's turns, overlapped by another speaker)."""
    if word.speaker:
        return word.speaker, 1.0, False
    dur = max(0.01, word.end - word.start)
    by_spk: Counter[str] = Counter()
    for t in turns:
        if t.end <= word.start:
            continue
        if t.start >= word.end:
            break
        by_spk[t.speaker] += max(0.0, min(t.end, word.end) - max(t.start, word.start))
    if not by_spk:
        mid = (word.start + word.end) / 2
        near = min(turns, key=lambda t: min(abs(t.start - mid), abs(t.end - mid)), default=None)
        if near and min(abs(near.start - mid), abs(near.end - mid)) <= 1.0:
            return near.speaker, 0.0, False
        return None, 0.0, False
    top = by_spk.most_common(2)
    overlapped = len(top) > 1 and top[1][1] >= 0.3 * dur
    return top[0][0], min(1.0, top[0][1] / dur), overlapped


def align(raw: list[RawSegment], turns: list[Turn], *, diarized: bool) -> tuple[list[Segment], list[Speaker]]:
    turns = sorted(turns, key=lambda t: t.start)
    pieces: list[dict] = []
    for seg in raw:
        words = seg.words or [RawWord(w=seg.text, start=seg.start, end=seg.end, p=1.0, speaker=seg.speaker)]
        info = [(w, *_assign(w, turns)) if (turns or w.speaker) else (w, None, 0.0, False) for w in words]
        # Smooth single-word islands: one word attributed to someone else inside a run is far more
        # often a boundary error than a real one-word interjection.
        for i in range(1, len(info) - 1):
            prev_s, cur_s, next_s = info[i - 1][1], info[i][1], info[i + 1][1]
            if cur_s != prev_s and prev_s == next_s and prev_s is not None:
                w, _, share, ov = info[i]
                info[i] = (w, prev_s, share * 0.5, True if ov else ov)
        run: list[tuple[RawWord, str | None, float, bool]] = []
        for item in info:
            if run and item[1] != run[-1][1]:
                pieces.append({"seg": seg, "run": run})
                run = []
            run.append(item)
        if run:
            pieces.append({"seg": seg, "run": run})

    label_map: dict[str, str] = {}
    speaking: Counter[str] = Counter()
    segments: list[Segment] = []
    for n, piece in enumerate(pieces, start=1):
        seg: RawSegment = piece["seg"]
        run = piece["run"]
        raw_spk = run[0][1]
        spk_id = None
        if raw_spk is not None:
            if raw_spk not in label_map:
                label_map[raw_spk] = f"SPK_{len(label_map) + 1}"
            spk_id = label_map[raw_spk]
        start, end = run[0][0].start, run[-1][0].end
        whole = len(run) == len(seg.words) if seg.words else True
        text = seg.text if whole else " ".join(w.w for w, *_ in run)
        flags = set(seg.flags)
        share = sum(s for _, _, s, _ in run) / len(run)
        overlapped = any(ov for *_, ov in run)
        if overlapped:
            flags.add("overlap")
        if end - start < 1.0 and len(run) <= 2:
            flags.add("short_turn")
        if not diarized or spk_id is None:
            conf = "unknown"
        elif share >= 0.9 and not overlapped and end - start >= 1.5:
            conf = "high"
        elif share >= 0.7 and not overlapped:
            conf = "medium"
        else:
            conf = "low"
        if conf in ("low",) or (conf == "medium" and "short_turn" in flags):
            flags.add("uncertain_speaker")
        if spk_id:
            speaking[spk_id] += end - start
        segments.append(
            Segment(
                id=f"S{n:04d}",
                start=round(start, 3),
                end=round(end, 3),
                speaker_id=spk_id,
                speaker_confidence=conf,
                text_verbatim=text.strip(),
                text_readable=text.strip(),
                words=[
                    Word(w=w.w, start=w.start, end=w.end, p=w.p, speaker_id=label_map.get(s) if s else None)
                    for w, s, _, _ in run
                ],
                avg_logprob=seg.avg_logprob,
                no_speech_prob=seg.no_speech_prob,
                flags=sorted(flags),  # type: ignore[arg-type]
                excluded=bool(flags & {"possible_hallucination", "no_speech"}),
            )
        )
    speakers = [
        Speaker(id=sid, label=f"المتحدث {i}", speaking_seconds=round(speaking[sid], 1))
        for i, sid in enumerate(sorted(label_map.values(), key=lambda x: int(x.split("_")[1])), start=1)
    ]
    return segments, speakers
