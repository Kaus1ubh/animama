from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from animama.domain.emotions import (
    NEUTRAL_EMOTION,
    emotion_value_level,
    normalize_emotion_name,
    normalize_emotional_state,
)
from animama.logging import get_logger

_log = get_logger("app.voice_emotional_tone")

CANONICAL_EMOTION_TO_ELEVENLABS_TONE: dict[str, str] = {
    NEUTRAL_EMOTION: NEUTRAL_EMOTION,
    "admiration": "impressed",
    "caring": "gentle",
    "love": "affectionate",
    "respect": "respectful",
    "confidence": "confident",
    "gratitude": "grateful",
    "amusement": "amused",
    "excitement": "excited",
    "joy": "happy",
    "desire": "eager",
    "curiosity": "curious",
    "optimism": "hopeful",
    "fear": "scared",
    "nervousness": "nervous",
    "confusion": "confused",
    "anger": "angry",
    "annoyance": "irritated",
    "disapproval": "stern",
    "disgust": "disgusted",
    "embarrassment": "embarrassed",
    "remorse": "regretful",
    "disappointment": "disappointed",
    "grief": "sorrowful",
    "sadness": "sad",
}

DEFAULT_ELEVENLABS_V3_TONE_KEY = "friendly"
DEFAULT_ELEVENLABS_V3_PREFIX = f"[{DEFAULT_ELEVENLABS_V3_TONE_KEY}]"

ELEVENLABS_TONE_TO_CANONICAL_EMOTION: dict[str, str] = {
    tone: emotion for emotion, tone in CANONICAL_EMOTION_TO_ELEVENLABS_TONE.items()
}

ELEVENLABS_EMOTIONAL_TONE_VALUES: tuple[str, ...] = tuple(dict.fromkeys(CANONICAL_EMOTION_TO_ELEVENLABS_TONE.values()))

VOICE_EMOTIONAL_TONE_VALUES: tuple[str, ...] = tuple(
    dict.fromkeys(
        (
            *CANONICAL_EMOTION_TO_ELEVENLABS_TONE.keys(),
            *CANONICAL_EMOTION_TO_ELEVENLABS_TONE.values(),
        )
    )
)


@dataclass(frozen=True, slots=True)
class ElevenLabsEmotionalTone:
    canonical_emotion: str
    tone_key: str

    @property
    def is_neutral(self) -> bool:
        return self.canonical_emotion == NEUTRAL_EMOTION


@dataclass(frozen=True, slots=True)
class ElevenLabsTonePrefixResult:
    text: str
    canonical_emotion: str | None
    tone_key: str | None
    intensity_level: int | None
    prefix: str | None
    applied: bool


def _normalize_tone_token(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    token = value.strip().lower()
    return token or None


def normalize_elevenlabs_emotional_tone(value: Any) -> ElevenLabsEmotionalTone | None:
    token = _normalize_tone_token(value)
    if token is None:
        return None
    canonical = normalize_emotion_name(token, allow_neutral=True)
    if canonical is None:
        canonical = ELEVENLABS_TONE_TO_CANONICAL_EMOTION.get(token)
    if canonical is None:
        return None
    tone_key = CANONICAL_EMOTION_TO_ELEVENLABS_TONE.get(canonical)
    if tone_key is None:
        return None
    return ElevenLabsEmotionalTone(canonical_emotion=canonical, tone_key=tone_key)


def validate_voice_emotional_tone(
    value: Any,
    *,
    context: str = "main_structured_response",
    warn: bool = True,
) -> str:
    token = _normalize_tone_token(value)
    if token is None:
        if warn:
            _log.warning(
                "Main structured emotional_tone missing or blank; ElevenLabs v3 will use the friendly default prefix",
                context=context,
                raw_type=type(value).__name__,
            )
        return NEUTRAL_EMOTION
    if normalize_elevenlabs_emotional_tone(token) is None:
        if warn:
            _log.warning(
                "Main structured emotional_tone is not allowlisted; ElevenLabs v3 will use the friendly default prefix",
                context=context,
                emotional_tone=token,
            )
        return NEUTRAL_EMOTION
    return token


def elevenlabs_v3_text_with_emotional_prefix(
    *,
    text: str,
    emotional_tone: Any,
    emotional_state: Mapping[str, Any] | None,
) -> ElevenLabsTonePrefixResult:
    base_text = text.strip()
    tone = normalize_elevenlabs_emotional_tone(emotional_tone)
    if not base_text:
        return ElevenLabsTonePrefixResult(
            text=text,
            canonical_emotion=tone.canonical_emotion if tone is not None else None,
            tone_key=tone.tone_key if tone is not None else None,
            intensity_level=None,
            prefix=None,
            applied=False,
        )

    if tone is None or tone.is_neutral:
        return ElevenLabsTonePrefixResult(
            text=f"{DEFAULT_ELEVENLABS_V3_PREFIX} {base_text}",
            canonical_emotion=tone.canonical_emotion if tone is not None else None,
            tone_key=DEFAULT_ELEVENLABS_V3_TONE_KEY,
            intensity_level=None,
            prefix=DEFAULT_ELEVENLABS_V3_PREFIX,
            applied=True,
        )

    if emotional_state is None:
        return ElevenLabsTonePrefixResult(
            text=text,
            canonical_emotion=tone.canonical_emotion,
            tone_key=tone.tone_key,
            intensity_level=None,
            prefix=None,
            applied=False,
        )

    normalized_state = normalize_emotional_state(emotional_state)
    level = emotion_value_level(normalized_state.get(tone.canonical_emotion))

    if level <= 0:
        prefix = f"[slightly {tone.tone_key}]"
    elif level == 1:
        prefix = f"[{tone.tone_key}]"
    else:
        prefix = f"[very {tone.tone_key}]"

    return ElevenLabsTonePrefixResult(
        text=f"{prefix} {base_text}",
        canonical_emotion=tone.canonical_emotion,
        tone_key=tone.tone_key,
        intensity_level=level,
        prefix=prefix,
        applied=True,
    )


# Continuity text an earlier finalized speech segment hands to the next one.
FINALIZED_TTS_PREVIOUS_TEXT_LIMIT = 500


def bounded_finalized_tts_previous_text(*texts: str | None) -> str | None:
    """Return normalized provider context text capped to the continuity budget."""

    normalized = " ".join(" ".join(text.split()) for text in texts if isinstance(text, str) and text.strip()).strip()
    if not normalized:
        return None
    return normalized[-FINALIZED_TTS_PREVIOUS_TEXT_LIMIT:]


__all__ = [
    "CANONICAL_EMOTION_TO_ELEVENLABS_TONE",
    "FINALIZED_TTS_PREVIOUS_TEXT_LIMIT",
    "DEFAULT_ELEVENLABS_V3_PREFIX",
    "DEFAULT_ELEVENLABS_V3_TONE_KEY",
    "ELEVENLABS_TONE_TO_CANONICAL_EMOTION",
    "ELEVENLABS_EMOTIONAL_TONE_VALUES",
    "VOICE_EMOTIONAL_TONE_VALUES",
    "ElevenLabsEmotionalTone",
    "ElevenLabsTonePrefixResult",
    "bounded_finalized_tts_previous_text",
    "elevenlabs_v3_text_with_emotional_prefix",
    "normalize_elevenlabs_emotional_tone",
    "validate_voice_emotional_tone",
]
