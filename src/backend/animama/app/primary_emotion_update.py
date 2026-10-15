from __future__ import annotations

import random
import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from animama.app.voice_emotional_tone import normalize_elevenlabs_emotional_tone
from animama.domain.emotions import (
    EMOTION_GROUP_MEMBERS,
    NEUTRAL_EMOTION,
    OPPOSING_EMOTION_GROUPS,
    clamp_emotion_value,
    emotion_group_for_emotion,
    normalize_emotion_name,
    normalize_emotional_state,
    ordered_emotion_values,
)
from animama.domain.events import EmotionUpdatePayload, Event, EventType

OpposingEmotionChooser = Callable[[Sequence[str]], str]


def _raw_voice_intensity(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        raw = value
    elif isinstance(value, float) and value.is_integer():
        raw = int(value)
    elif isinstance(value, str):
        token = value.strip()
        if not re.fullmatch(r"[+-]?\d+", token):
            return None
        raw = int(token)
    else:
        return None
    if 1 <= raw <= 10:
        return raw
    return None


def voice_intensity_to_avatar_level(raw: object) -> int | None:
    """Map the model's 1-10 intensity to how far one turn shifts the emotion state.

    1-3 shifts by 1, 4-6 by 2 and 7-10 by 3. This scale drives the emotion
    state (and so Idle motion); Reactions use ``voice_intensity_to_reaction_intensity``.
    """

    value = _raw_voice_intensity(raw)
    if value is None:
        return None
    if value <= 3:
        return 1
    if value <= 6:
        return 2
    return 3


def voice_intensity_to_reaction_intensity(raw: object) -> int | None:
    """Map the model's 1-10 intensity to a Reaction intensity, 0 meaning no Reaction.

    1-2 plays none, then 3-4, 5-6, 7-8 and 9-10 select intensities 1-4 (Mild,
    Moderate, Strong, Intense). ``None`` marks an unusable model value.
    """

    value = _raw_voice_intensity(raw)
    if value is None:
        return None
    return (value - 1) // 2


def _default_opposing_emotion_chooser(candidates: Sequence[str]) -> str:
    return random.choice(tuple(candidates))


def _choose_opposing_emotion(
    candidates: Sequence[str],
    *,
    chooser: OpposingEmotionChooser,
) -> str | None:
    if not candidates:
        return None
    selected = normalize_emotion_name(chooser(candidates))
    if selected in candidates:
        return selected
    return normalize_emotion_name(candidates[0])


def build_primary_emotion_update_event(
    *,
    anima_id: str,
    chat_id: str | None,
    user_id: str | None,
    run_id: str,
    node_id: str,
    emotional_state: Mapping[str, Any] | None,
    emotional_tone: Any,
    emotional_intensity: Any,
    choose_opposing_emotion: OpposingEmotionChooser | None = None,
) -> Event:
    """Build the full-state emotion update caused by the main structured response."""

    current = normalize_emotional_state(emotional_state)
    # The state shift keeps its three-step scale; the event's intensity selects
    # the Reaction cell (0 plays none, while a turn at 1-2 still shifts the state).
    state_shift = voice_intensity_to_avatar_level(emotional_intensity)
    reaction_intensity = voice_intensity_to_reaction_intensity(emotional_intensity)
    tone = normalize_elevenlabs_emotional_tone(emotional_tone)
    promoted_emotion: str | None = None
    demoted_emotion: str | None = None
    event_tone = NEUTRAL_EMOTION

    if tone is not None and not tone.is_neutral and state_shift is not None and reaction_intensity is not None:
        event_tone = tone.canonical_emotion
        group = emotion_group_for_emotion(tone.canonical_emotion)
        opposing_group = OPPOSING_EMOTION_GROUPS.get(group or "")
        opposing_members = EMOTION_GROUP_MEMBERS.get(opposing_group or "", ())
        demoted = _choose_opposing_emotion(
            opposing_members,
            chooser=choose_opposing_emotion or _default_opposing_emotion_chooser,
        )
        if demoted is not None:
            promoted_emotion = tone.canonical_emotion
            demoted_emotion = demoted
            current[promoted_emotion] = clamp_emotion_value(current[promoted_emotion] + state_shift)
            current[demoted_emotion] = clamp_emotion_value(current[demoted_emotion] - state_shift)
        else:
            reaction_intensity = 0
            event_tone = NEUTRAL_EMOTION
    else:
        reaction_intensity = 0

    return Event(
        event_id=f"emotion-update-{run_id}-{node_id}",
        anima_id=anima_id,
        chat_id=chat_id,
        user_id=user_id,
        type=EventType.EMOTION_UPDATE,
        payload=EmotionUpdatePayload(
            run_id=run_id,
            node_id=node_id,
            emotions=ordered_emotion_values(current),
            emotional_tone=event_tone,
            emotional_intensity=reaction_intensity,
            promoted_emotion=promoted_emotion,
            demoted_emotion=demoted_emotion,
        ),
    )


__all__ = [
    "OpposingEmotionChooser",
    "build_primary_emotion_update_event",
    "voice_intensity_to_avatar_level",
    "voice_intensity_to_reaction_intensity",
]
