from __future__ import annotations

import pytest

from animama.app.primary_emotion_update import (
    build_primary_emotion_update_event,
    voice_intensity_to_avatar_level,
)
from animama.domain.events import EmotionUpdatePayload, EventType


def _payload_state(payload: EmotionUpdatePayload) -> dict[str, int]:
    return {item.emotion: item.value for item in payload.emotions}


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        (1, 1),
        (3, 1),
        (4, 2),
        (6, 2),
        (7, 3),
        (10, 3),
        (0, None),
        (11, None),
        ("5", 2),
        ("bad", None),
        (True, None),
    ],
)
def test_voice_intensity_to_avatar_level(raw: object, expected: int | None) -> None:
    assert voice_intensity_to_avatar_level(raw) == expected


def test_primary_emotion_update_promotes_tone_and_demotes_opposing_emotion() -> None:
    event = build_primary_emotion_update_event(
        anima_id="anima-1",
        chat_id="chat-1",
        user_id="user-1",
        run_id="run-1",
        node_id="agent:primary",
        emotional_state={"joy": 2, "sadness": 5},
        emotional_tone="happy",
        emotional_intensity=5,
        choose_opposing_emotion=lambda _candidates: "sadness",
    )

    assert event.type == EventType.EMOTION_UPDATE
    payload = event.payload
    assert isinstance(payload, EmotionUpdatePayload)
    state = _payload_state(payload)
    assert state["joy"] == 4
    assert state["sadness"] == 3
    assert payload.emotional_tone == "joy"
    assert payload.emotional_intensity == 2
    assert payload.promoted_emotion == "joy"
    assert payload.demoted_emotion == "sadness"


def test_primary_emotion_update_clamps_promotion_and_demotion() -> None:
    event = build_primary_emotion_update_event(
        anima_id="anima-1",
        chat_id="chat-1",
        user_id="user-1",
        run_id="run-1",
        node_id="agent:primary",
        emotional_state={"joy": 29, "sadness": 1},
        emotional_tone="joy",
        emotional_intensity=10,
        choose_opposing_emotion=lambda _candidates: "sadness",
    )

    payload = event.payload
    assert isinstance(payload, EmotionUpdatePayload)
    state = _payload_state(payload)
    assert state["joy"] == 30
    assert state["sadness"] == 0
    assert payload.emotional_intensity == 3


@pytest.mark.parametrize("tone", [None, "", "friendly", "not-real", "neutral"])
def test_primary_emotion_update_noops_for_neutral_or_unusable_tone(tone: object) -> None:
    event = build_primary_emotion_update_event(
        anima_id="anima-1",
        chat_id="chat-1",
        user_id="user-1",
        run_id="run-1",
        node_id="agent:primary",
        emotional_state={"joy": 5},
        emotional_tone=tone,
        emotional_intensity=10,
        choose_opposing_emotion=lambda _candidates: pytest.fail("chooser should not be called"),
    )

    payload = event.payload
    assert isinstance(payload, EmotionUpdatePayload)
    state = _payload_state(payload)
    assert state["joy"] == 5
    assert payload.emotional_tone == "neutral"
    assert payload.emotional_intensity == 0
    assert payload.promoted_emotion is None
    assert payload.demoted_emotion is None


def test_primary_emotion_update_noops_when_intensity_is_missing() -> None:
    event = build_primary_emotion_update_event(
        anima_id="anima-1",
        chat_id="chat-1",
        user_id="user-1",
        run_id="run-1",
        node_id="agent:primary",
        emotional_state={"joy": 5},
        emotional_tone="joy",
        emotional_intensity=None,
        choose_opposing_emotion=lambda _candidates: pytest.fail("chooser should not be called"),
    )

    payload = event.payload
    assert isinstance(payload, EmotionUpdatePayload)
    state = _payload_state(payload)
    assert state["joy"] == 5
    assert payload.emotional_tone == "neutral"
    assert payload.emotional_intensity == 0
