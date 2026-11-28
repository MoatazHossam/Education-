"""The evaluation's own scoring (a wrong metric would misreport accuracy)."""

from mahdar.evaluation import metrics

SEGS = {"S1": {"id": "S1", "text_verbatim": "سأتولى إعداد خطة اختبار الأداء", "text_readable": ""}}
EXPECTED = {"actions_assigned": [{"key": "A1", "keywords": ["اختبار الاداء"], "owner": "سارة"}]}


def _item(owner_name, speaker_id):
    return {
        "id": "I1",
        "type": "action_assigned",
        "final_type": "action_assigned",
        "statement": "إعداد خطة اختبار الأداء",
        "owner": {"name_as_spoken": owner_name, "speaker_id": speaker_id},
        "evidence": [{"segment_id": "S1", "quote": "سأتولى إعداد خطة اختبار الأداء"}],
    }


def test_owner_by_name_and_by_speaker():
    named = metrics.item_scores(EXPECTED, [_item("سارة", None)], SEGS, [], {})
    assert named["owner_accuracy"] == 1.0 and named["owner_identified"] == 1.0
    # The right speaker, not yet named: not an owner by name, but the right person.
    unnamed = metrics.item_scores(EXPECTED, [_item(None, "SPK_2")], SEGS, [], {"SPK_2": "سارة"})
    assert unnamed["owner_accuracy"] == 0.0 and unnamed["owner_identified"] == 1.0
    wrong = metrics.item_scores(EXPECTED, [_item(None, "SPK_1")], SEGS, [], {"SPK_2": "سارة", "SPK_1": "أحمد"})
    assert wrong["owner_identified"] == 0.0
