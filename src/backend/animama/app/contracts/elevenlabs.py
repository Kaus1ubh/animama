"""Shared elevenlabs contracts; delivery owns admission and transport."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class _ElevenLabsSchema(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PyElevenLabsVoiceSettings(_ElevenLabsSchema):
    stability: float | None = Field(default=None, ge=0.0, le=1.0)
    similarity_boost: float | None = Field(default=None, ge=0.0, le=1.0)
    style: float | None = Field(default=None, ge=0.0, le=1.0)
    use_speaker_boost: bool | None = None
    speed: float | None = Field(default=None, gt=0.0, le=4.0)


class PyElevenLabsVoice(_ElevenLabsSchema):
    voice_id: str
    name: str | None = None
    description: str | None = None
    preview_url: str | None = None
    labels: dict[str, str] = Field(default_factory=dict)
    category: str | None = None
    requires_verification: bool | None = None


class PyElevenLabsAnimaVoiceProfileInput(_ElevenLabsSchema):
    model_config = ConfigDict(extra="ignore")

    primary_voice: PyElevenLabsVoice


class PyElevenLabsTextToSpeechRequest(_ElevenLabsSchema):
    voice_id: str = Field(..., min_length=1)
    text: str = Field(..., min_length=1, max_length=5000)
    model_id: str | None = Field(default="eleven_multilingual_v2")
    output_format: str | None = Field(default="mp3_44100_128")
    voice_settings: PyElevenLabsVoiceSettings | None = None


class PyElevenLabsAudioResponse(_ElevenLabsSchema):
    audio_base64: str
    media_type: str
    output_format: str | None = None
    file_name: str | None = None
    voice_id: str | None = None


class PyElevenLabsSoundEffectsRequest(_ElevenLabsSchema):
    text: str = Field(..., min_length=1, max_length=1000)
    output_format: str | None = Field(default="mp3_44100_128")
    loop: bool | None = None
    duration_seconds: float | None = Field(default=None, gt=0.0, le=22.0)
    prompt_influence: float | None = Field(default=None, ge=0.0, le=1.0)
    model_id: str | None = None


ElevenLabsRealtimeEmotionLabel = Literal[
    "neutral",
    "affection",
    "esteem",
    "delight",
    "drive",
    "alarm",
    "rejection",
    "revulsion",
    "gloom",
]

ElevenLabsRealtimeTtsModelId = Literal[
    "eleven_multilingual_v2",
    "eleven_flash_v2_5",
]

ElevenLabsFinalizedTtsModelId = Literal["eleven_v3"]

ElevenLabsChatTtsModelId = Literal[
    "eleven_multilingual_v2",
    "eleven_flash_v2_5",
    "eleven_v3",
]

SUPPORTED_ELEVENLABS_REALTIME_TTS_MODEL_IDS: tuple[ElevenLabsRealtimeTtsModelId, ...] = (
    "eleven_multilingual_v2",
    "eleven_flash_v2_5",
)

SUPPORTED_ELEVENLABS_FINALIZED_TTS_MODEL_IDS: tuple[ElevenLabsFinalizedTtsModelId, ...] = ("eleven_v3",)

SUPPORTED_ELEVENLABS_CHAT_TTS_MODEL_IDS: tuple[ElevenLabsChatTtsModelId, ...] = (
    "eleven_multilingual_v2",
    "eleven_flash_v2_5",
    "eleven_v3",
)


class PyElevenLabsRealtimeTtsSessionRequest(_ElevenLabsSchema):
    anima_id: str = Field(..., min_length=1)
    run_id: str = Field(..., min_length=1)
    emotion_label: ElevenLabsRealtimeEmotionLabel | None = None
    emotion_intensity: int | None = Field(default=None, ge=0, le=3)
    language_code: str | None = Field(default=None, min_length=2, max_length=8)
    model_id: ElevenLabsRealtimeTtsModelId | None = None


class PyElevenLabsRealtimeTtsSessionResponse(_ElevenLabsSchema):
    voice_id: str
    model_id: str
    output_format: str
    sync_alignment: bool
    language_code: str | None = None
    token: str | None = None
    websocket_base_url: str | None = None


class PyElevenLabsFinalizedTtsStreamRequest(_ElevenLabsSchema):
    run_id: str | None = Field(default=None, min_length=1)
    text: str = Field(..., min_length=1, max_length=5000)
    model_id: ElevenLabsFinalizedTtsModelId = "eleven_v3"
    language_code: str | None = Field(default=None, min_length=2, max_length=8)
    text_basis: Literal["plain", "gruut_text_with_ws"] = "plain"

    @field_validator("text")
    @classmethod
    def trim_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("text must not be blank")
        return normalized

    @field_validator("run_id", "language_code")
    @classmethod
    def trim_optional_text(cls, value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        if not normalized:
            return None
        return normalized
