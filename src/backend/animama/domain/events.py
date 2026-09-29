from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum
from typing import Any, Literal

from .emotions import EmotionValue


class EventType(str, Enum):
    FOLLOWUP_REQUESTED = "followup.requested"
    EMOTION_UPDATE = "emotion.update"
    USER_RESPONSE = "user.response"
    AVATAR_GESTURE_REQUESTED = "avatar.gesture.requested"
    STT_TRANSCRIPT = "stt.transcript"
    AVATAR_BLENDSHAPE_FRAME = "avatar.blendshape.frame"
    AVATAR_BLENDSHAPE_SEGMENT = "avatar.blendshape.segment"
    RUN_STARTED = "run.started"
    RUN_COMPLETED = "run.completed"
    ERROR = "error"
    DROP = "drop"
    CONTROL_SHUTDOWN = "control.shutdown"
    CRISIS_SUPPORT = "safety.crisis_support"
    MEMORY_UPDATED = "memory.updated"
    RUN_STATUS = "run.status"


@dataclass(slots=True)
class EmotionUpdatePayload:
    """Full-state emotion payload emitted by direct chat emotion producers."""

    run_id: str
    node_id: str
    emotions: list[EmotionValue]
    emotional_tone: str | None = None
    emotional_intensity: int | None = None
    promoted_emotion: str | None = None
    demoted_emotion: str | None = None


@dataclass(slots=True)
class CrisisSupportPayload:
    """A crisis signal for one run; the route adds localized resources (spec R4).

    Carries no message text. ``source`` is ``"local"`` or ``"moderation"``.
    """

    run_id: str
    source: Literal["moderation"]


RunStatusKind = Literal["summarizing_context", "searching_web"]
RunStatusPhase = Literal["started", "finished"]


@dataclass(slots=True)
class RunStatusPayload:
    """Backend work before or between reply text, shown while the reply is pending.

    ``summarizing_context`` covers pre-send compaction; ``searching_web`` covers
    an application web search. Each ``started`` is followed by ``finished``.
    """

    run_id: str
    status: RunStatusKind
    phase: RunStatusPhase


@dataclass(slots=True)
class MemoryUpdatedPayload:
    """What one persisted turn remembered, for the chat's memory cue.

    ``memory_cue`` is ``{"episode": {"text"} | None, "memories": {"entry_id",
    "version", "excerpt"} | None}`` with at least one part present;
    ``message_id`` is the turn's final visible assistant message.
    """

    run_id: str
    message_id: int | None
    memory_cue: Mapping[str, Any]


@dataclass(slots=True)
class AvatarGestureRequestedPayload:
    """Avatar gesture selected by a primary assistant response."""

    run_id: str
    node_id: str
    gesture: str
    runtime_revision: str | None = None


@dataclass(slots=True)
class UserResponsePayload:
    """Assistant response text or hidden structured metadata for one chat run.

    `is_delta`, `part_index`, and `part_final` describe semantic stream chunks.
    For main structured responses, the hidden `emotional_tone` part may also
    carry `emotional_intensity` so downstream state sees the paired delivery
    metadata before speech chunks arrive.
    """

    value: Any
    node_id: str | None = None
    run_id: str | None = None
    is_delta: bool | None = None
    response_format: str | None = None
    response_part: str | None = None
    part_index: int | None = None
    part_final: bool | None = None
    emotional_intensity: int | None = None


@dataclass(slots=True)
class SttTranscriptPayload:
    text: str
    is_final: bool
    run_id: str | None = None


@dataclass(slots=True)
class AvatarBlendshapeFramePayload:
    run_id: str | None
    frame_index: int
    time_sec: float
    values: list[float]
    job_id: str | None = None
    segment_id: str | None = None


@dataclass(slots=True)
class RunStartedPayload:
    run_id: str


@dataclass(slots=True)
class RunCompletedPayload:
    run_id: str


@dataclass(slots=True)
class ErrorPayload:
    message: str
    code: str | None = None
    run_id: str | None = None
    details: Mapping[str, Any] | None = None


@dataclass(slots=True)
class Event:
    event_id: str
    anima_id: str
    type: EventType
    payload: Any
    chat_id: str | None = None
    user_id: str | None = None
    correlation_id: str | None = None
    causation_id: str | None = None
    version: str = "2025-10-01"
