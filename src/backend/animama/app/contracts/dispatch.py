"""Shared dispatch contracts; delivery owns admission and transport."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from animama.app.contracts.elevenlabs import ElevenLabsChatTtsModelId
from animama.domain.events import EventType


class PyAnimaTtsRunOptions(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool | None = None
    provider: Literal["browser", "pocket_tts", "elevenlabs"] | None = None
    transport: Literal["auto", "direct"] | None = None
    language_code: str | None = Field(default=None, min_length=2, max_length=8)
    model_id: ElevenLabsChatTtsModelId | None = None
    finalized_chunking: Literal["sentence", "paragraph"] | None = None


class PyAnimaDispatchOptions(BaseModel):
    disable_emotion_updates: bool | None = None
    disable_emotion_influence: bool | None = None
    disable_memory_influence: bool | None = None
    disable_memory_updates: bool | None = None
    incognito: bool | None = None
    main_structured_response: bool | None = None
    native_tools: list[str] | None = None
    reasoning_effort: str | None = None
    tts: PyAnimaTtsRunOptions | None = None


class PyAnimaEventPublishRequest(BaseModel):
    type: EventType
    payload: dict[str, Any] = Field(default_factory=dict)
    topic: str | None = None
    correlation_id: str | None = None
    causation_id: str | None = None
    anima_ids: list[str] | None = None
    binary: bool = False
