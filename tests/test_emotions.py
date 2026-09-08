from __future__ import annotations

from animama.domain.anima import Anima
from animama.domain.emotions import (
    TRACKED_EMOTIONS,
    apply_sparse_updates,
    default_emotional_state,
    emotion_values_payload,
    emotional_state_from_values,
    normalize_sparse_updates,
    ordered_emotion_values,
    top_emotion_groups,
)
from animama.domain.vfx import normalize_avatar_vfx_ids, selectable_avatar_vfx_catalog


def test_anima_create_defaults_to_canonical_emotional_state() -> None:
    dom = Anima(id="anima-emotion", emotional_state=default_emotional_state())

    assert dom.emotional_state == default_emotional_state()


def test_normalize_sparse_updates_enforces_budgets_and_active_demotions() -> None:
    current = {
        "joy": 10,
        "gratitude": 4,
        "fear": 2,
    }
    updates = normalize_sparse_updates(
        current,
        [
            {"emotion": "joy", "delta": 4},
            {"emotion": "gratitude", "delta": 4},
            {"emotion": "optimism", "delta": 3},
            {"emotion": "fear", "delta": -2},
            {"emotion": "sadness", "delta": -2},
            {"emotion": "nervousness", "delta": -2},
        ],
    )

    assert [(item.emotion, item.delta) for item in updates] == [
        ("joy", 4),
        ("gratitude", 1),
        ("fear", -2),
    ]


def test_apply_sparse_updates_clamps_and_emits_ordered_full_state() -> None:
    updated = apply_sparse_updates(
        {"joy": 29, "fear": 1},
        [
            {"emotion": "joy", "delta": 4},
            {"emotion": "fear", "delta": -3},
            {"emotion": "curiosity", "delta": 2},
        ],
    )
    values = ordered_emotion_values(updated)

    assert updated["joy"] == 30
    assert updated["fear"] == 0
    assert updated["curiosity"] == 1
    assert [item.emotion for item in values] == list(TRACKED_EMOTIONS)
    assert emotional_state_from_values(values) == updated
    assert emotion_values_payload(values)[0]["emotion"] == TRACKED_EMOTIONS[0]


def test_top_emotion_groups_derive_group_average_and_peak() -> None:
    groups = top_emotion_groups(
        {
            "joy": 12,
            "excitement": 9,
            "amusement": 3,
            "gratitude": 8,
            "confidence": 4,
        },
        limit=2,
    )

    assert [(group.group, round(group.average, 1)) for group in groups] == [
        ("delight", 8.0),
        ("esteem", 4.0),
    ]
    assert groups[0].peak is not None
    assert groups[0].peak.emotion == "joy"


def test_selectable_avatar_vfx_catalog_contains_only_selectable_entries() -> None:
    catalog = selectable_avatar_vfx_catalog()

    assert catalog
    assert all(entry.is_selectable for entry in catalog)
    assert all(entry.emotions for entry in catalog)
    assert all(entry.description for entry in catalog)


def test_normalize_avatar_vfx_ids_dedupes_and_enforces_region_rules() -> None:
    result = normalize_avatar_vfx_ids(
        [
            "star",
            "eye_o",
            "eyebag_1",
            "angry",
            "emote_!",
            "texture_black_1",
            "texture_sick_1",
            "star",
            "unknown",
        ],
        emotional_state={},
    )

    assert list(result.accepted_ids) == [
        "star",
        "angry",
        "emote_!",
        "texture_black_1",
        "texture_sick_1",
    ]
    assert "texture_black_1" in result.threshold_miss_ids
    assert "texture_sick_1" in result.threshold_miss_ids
    assert [(item.effect_id, item.reason) for item in result.dropped] == [
        ("eye_o", "region_conflict"),
        ("eyebag_1", "manual_only"),
        ("star", "duplicate"),
        ("unknown", "unknown"),
    ]
