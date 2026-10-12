"""Gemini text-to-speech models and prebuilt voices offered as an Anima voice."""

from __future__ import annotations

from typing import Literal, get_args

from pydantic import BaseModel

GeminiTtsModelId = Literal["gemini-3.8-flash-lite-tts", "gemini-3.8-flash-tts"]
SUPPORTED_GEMINI_TTS_MODEL_IDS: tuple[GeminiTtsModelId, ...] = get_args(GeminiTtsModelId)
DEFAULT_GEMINI_TTS_MODEL_ID: GeminiTtsModelId = "gemini-3.8-flash-lite-tts"

GeminiPrebuiltVoice = Literal[
    "Zephyr",
    "Puck",
    "Charon",
    "Kore",
    "Fenrir",
    "Leda",
    "Orus",
    "Aoede",
    "Callirrhoe",
    "Autonoe",
    "Enceladus",
    "Iapetus",
    "Umbriel",
    "Algieba",
    "Despina",
    "Erinome",
    "Algenib",
    "Rasalgethi",
    "Laomedeia",
    "Achernar",
    "Alnilam",
    "Schedar",
    "Gacrux",
    "Pulcherrima",
    "Achird",
    "Zubenelgenubi",
    "Vindemiatrix",
    "Sadachbia",
    "Sadaltager",
    "Sulafat",
]
"""Google's prebuilt speech voices (speech generation docs, checked 2026-10-11)."""
GEMINI_PREBUILT_VOICES: tuple[GeminiPrebuiltVoice, ...] = get_args(GeminiPrebuiltVoice)
DEFAULT_GEMINI_VOICE: GeminiPrebuiltVoice = "Kore"


class GeminiTtsCapability(BaseModel):
    """Gemini voice options a composition offers; absent where Gemini voice is not offered."""

    models: list[GeminiTtsModelId]
    default_model: GeminiTtsModelId
    voices: list[GeminiPrebuiltVoice]
    default_voice: GeminiPrebuiltVoice


def gemini_tts_capability() -> GeminiTtsCapability:
    return GeminiTtsCapability(
        models=list(SUPPORTED_GEMINI_TTS_MODEL_IDS),
        default_model=DEFAULT_GEMINI_TTS_MODEL_ID,
        voices=list(GEMINI_PREBUILT_VOICES),
        default_voice=DEFAULT_GEMINI_VOICE,
    )


def gemini_voice_or_default(value: object) -> GeminiPrebuiltVoice:
    """The stored voice when it names a prebuilt voice, otherwise the default."""

    for voice in GEMINI_PREBUILT_VOICES:
        if value == voice:
            return voice
    return DEFAULT_GEMINI_VOICE


__all__ = [
    "DEFAULT_GEMINI_TTS_MODEL_ID",
    "DEFAULT_GEMINI_VOICE",
    "GEMINI_PREBUILT_VOICES",
    "SUPPORTED_GEMINI_TTS_MODEL_IDS",
    "GeminiPrebuiltVoice",
    "GeminiTtsCapability",
    "GeminiTtsModelId",
    "gemini_tts_capability",
    "gemini_voice_or_default",
]
