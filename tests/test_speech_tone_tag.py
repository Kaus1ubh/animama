"""ElevenLabs starts each reply in its emotional tone, unless the model chose its own (#479, D3)."""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from animama.app.main_structured_response import (
    MAIN_STRUCTURED_RESPONSE_FORMAT,
    MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE,
    MAIN_STRUCTURED_RESPONSE_PART_SPEECH,
)
from animama.app.voice_emotional_tone import ELEVENLABS_EMOTIONAL_TONE_VALUES, elevenlabs_tone_tag
from animama.domain.audio_tags import ProviderSpeechText, find_audio_tags, opens_with_delivery_tag
from animama.product_http.chat.sse_events import SseTextState, format_user_response_event


@pytest.mark.parametrize(
    ("tone", "state", "tag"),
    [
        (None, None, "[friendly]"),
        ("neutral", {"joy": 16}, "[friendly]"),
        ("joy", None, "[happy]"),
        ("joy", {"joy": 0}, "[slightly happy]"),
        ("joy", {"joy": 5}, "[happy]"),
        ("joy", {"joy": 16}, "[very happy]"),
        ("excitement", None, "[excited]"),
    ],
)
def test_the_tone_tag_follows_the_tone_and_its_level_as_gemini_style_does(
    tone: str | None, state: dict[str, int] | None, tag: str
) -> None:
    assert elevenlabs_tone_tag(emotional_tone=tone, emotional_state=state) == tag


def _event(value: str, part: str, **extra: object) -> SimpleNamespace:
    payload = {
        "run_id": "run-1",
        "value": value,
        "response_format": MAIN_STRUCTURED_RESPONSE_FORMAT,
        "response_part": part,
        "is_delta": True,
        **extra,
    }
    return SimpleNamespace(event_id="event-1", payload=payload)


def _speech_frames(state: SseTextState, *speech: str, tone: str = "joy") -> list[dict[str, object]]:
    assert (
        format_user_response_event(
            _event(tone, MAIN_STRUCTURED_RESPONSE_PART_EMOTIONAL_TONE, emotional_intensity=7),
            run_id="run-1",
            state=state,
        )
        is None
    )
    frames = [
        format_user_response_event(_event(text, MAIN_STRUCTURED_RESPONSE_PART_SPEECH), run_id="run-1", state=state)
        for text in speech
    ]
    return [json.loads(frame.split("data: ", 1)[1]) for frame in frames if frame is not None]


def test_only_the_first_elevenlabs_speech_frame_carries_the_tone_tag() -> None:
    state = SseTextState(emotional_state={"joy": 16}, speech_tone_tag_pending=True)

    first, second = _speech_frames(state, "Hello there.", " How are you?")

    assert first["speech_tone_tag"] == "[very happy]"
    assert first["text"] == "Hello there."
    assert "speech_tone_tag" not in second


@pytest.mark.parametrize("opening", ["[excited] Hello there.", "[sad, laughs] Oh.", "  <softly> Hi."])
def test_no_tone_tag_when_the_model_opens_with_its_own_direction(opening: str) -> None:
    state = SseTextState(speech_tone_tag_pending=True)

    [frame] = _speech_frames(state, opening)

    assert "speech_tone_tag" not in frame


def test_a_leading_sound_still_gets_the_tone_tag() -> None:
    [frame] = _speech_frames(SseTextState(speech_tone_tag_pending=True), "[laughs] Oh wow.", tone="neutral")

    assert frame["speech_tone_tag"] == "[friendly]"


def test_other_voices_get_no_tone_tag() -> None:
    [frame] = _speech_frames(SseTextState(), "Hello there.")

    assert "speech_tone_tag" not in frame


@pytest.mark.parametrize("tone", ELEVENLABS_EMOTIONAL_TONE_VALUES)
@pytest.mark.parametrize("level", [None, {"joy": 0, "sadness": 0}, {"joy": 30, "sadness": 30}])
def test_every_tone_tag_is_a_delivery_direction_that_passes_uncapped(tone: str, level: dict[str, int] | None) -> None:
    tag = elevenlabs_tone_tag(emotional_tone=tone, emotional_state=level)
    elevenlabs = ProviderSpeechText("elevenlabs")
    elevenlabs.prepare("[laughs] [sighs] Hi.")

    assert [found.label for found in find_audio_tags(tag)] == [tag]
    assert opens_with_delivery_tag(f"{tag} Hi.")
    assert elevenlabs.prepare(f"{tag} Hi.") == f"{tag} Hi."
