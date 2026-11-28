from mahdar.pipeline.align import align, overlap_regions
from mahdar.pipeline.asr.base import RawSegment, RawWord, merge_chunks, screen
from mahdar.pipeline.audio import plan_chunks
from mahdar.pipeline.diarization import Turn


def words(text: str, start: float, step: float = 0.5):
    return [RawWord(w=w, start=start + i * step, end=start + i * step + step * 0.9, p=0.9) for i, w in enumerate(text.split())]


def test_chunk_plan_cuts_at_silences_with_overlap():
    chunks = plan_chunks(1900, [(590, 594), (1190, 1195)], target_s=600, overlap_s=2)
    assert len(chunks) == 3
    assert chunks[0].start == 0 and abs(chunks[0].end - 594) < 0.01  # cut at the silence's middle (592) + 2 s
    assert abs(chunks[1].start - 590) < 0.01  # 2 s of overlap before the cut
    assert chunks[-1].end == 1900
    # A remainder shorter than a fifth of a chunk is not split off.
    assert len(plan_chunks(1300, [(590, 594)], target_s=600, overlap_s=2)) == 2


def test_merge_keeps_each_word_once_across_an_overlap():
    a = [RawSegment(start=0, end=11, text="", words=words("واحد اتنين تلاتة اربعة خمسة ستة سبعة تمانية تسعة عشرة حداشر اتناشر", 5))]
    # The same words, at the same times, recognised again at the start of the next chunk.
    b = [RawSegment(start=9, end=12, text="", words=words("تسعة عشرة حداشر اتناشر تلتاشر اربعتاشر", 9))]
    merged = merge_chunks([(0.0, 11.0, a), (9.0, 14.0, b)])
    text = " ".join(w.w for s in merged for w in s.words)
    for w in ["واحد", "تسعة", "عشرة", "حداشر", "اتناشر", "تلتاشر", "اربعتاشر"]:
        assert text.split().count(w) == 1, (w, text)


def test_screen_flags_stock_hallucinations_and_loops():
    segs = [
        RawSegment(start=0, end=3, text="اشتركوا في القناة", no_speech_prob=0.9),
        RawSegment(start=3, end=8, text="نعم نعم نعم نعم نعم نعم", compression_ratio=3.0),
        RawSegment(start=8, end=12, text="نراجع الميزانية الأسبوع القادم", words=words("نراجع الميزانية الأسبوع القادم", 8)),
    ]
    out = screen(segs, speech=[(8, 12)], prompt=None)
    assert "possible_hallucination" in out[0].flags
    assert "repetition" in out[1].flags
    assert not out[2].flags


def test_align_splits_at_speaker_change_and_rates_confidence():
    raw = [RawSegment(start=0, end=6, text="", words=words("أقترح أن نؤجل الموضوع موافق تماماً", 0, 1.0))]
    turns = [Turn(0, 3.95, "s0"), Turn(4.0, 6.0, "s1")]
    segments, speakers = align(raw, turns, diarized=True)
    assert [s.speaker_id for s in segments] == ["SPK_1", "SPK_2"]
    assert segments[0].text_verbatim == "أقترح أن نؤجل الموضوع"
    assert segments[0].speaker_confidence == "high"
    assert len(speakers) == 2 and speakers[0].label == "المتحدث 1"


def test_overlapping_speech_is_flagged():
    raw = [RawSegment(start=0, end=4, text="", words=words("لا لا ده مش صحيح", 0, 0.8))]
    turns = [Turn(0, 4, "s0"), Turn(1.0, 3.0, "s1")]
    segments, _ = align(raw, turns, diarized=True)
    assert any("overlap" in s.flags for s in segments)
    assert overlap_regions(turns)[0].start == 1.0


def test_without_diarization_speaker_is_unknown():
    raw = [RawSegment(start=0, end=2, text="مرحبا بكم", words=words("مرحبا بكم", 0))]
    segments, speakers = align(raw, [], diarized=False)
    assert segments[0].speaker_id is None and segments[0].speaker_confidence == "unknown" and not speakers
