from __future__ import annotations

from collections.abc import Mapping
from typing import Any, Literal

from animama.domain.events import (
    AvatarGestureRequestedPayload,
    CrisisSupportPayload,
    ErrorPayload,
    Event,
    EventType,
    UserResponsePayload,
)

from .types import DirectChatTurnRequest


def user_response_event(
    request: DirectChatTurnRequest,
    text: str,
    *,
    response_format: str,
    response_part: str,
    event_id_suffix: str,
    is_delta: bool = False,
    part_index: int | None = None,
    part_final: bool | None = None,
    emotional_intensity: int | None = None,
) -> Event:
    """Build a direct-chat assistant response event.

    `is_delta`, `part_index`, and `part_final` describe semantic chunks such as
    complete speech sentences. They do not expose provider token deltas. For the
    hidden main-structured `emotional_tone` part, `emotional_intensity` carries
    the paired delivery metadata decoded before speech streaming starts.
    """

    return Event(
        event_id=f"user-response-{event_id_suffix}-{request.run_id}",
        anima_id=request.anima_id,
        chat_id=request.chat_id,
        user_id=request.user_id,
        type=EventType.USER_RESPONSE,
        payload=UserResponsePayload(
            value=text,
            node_id=request.node_id,
            run_id=request.run_id,
            is_delta=is_delta,
            response_format=response_format,
            response_part=response_part,
            part_index=part_index,
            part_final=part_final,
            emotional_intensity=emotional_intensity,
        ),
    )


def avatar_gesture_event(request: DirectChatTurnRequest, gesture: str) -> Event:
    return Event(
        event_id=f"avatar-gesture-{request.run_id}",
        anima_id=request.anima_id,
        chat_id=request.chat_id,
        user_id=request.user_id,
        type=EventType.AVATAR_GESTURE_REQUESTED,
        payload=AvatarGestureRequestedPayload(
            run_id=request.run_id,
            node_id=request.node_id,
            gesture=gesture,
            runtime_revision=request.runtime_revision,
        ),
    )


def error_event(
    request: DirectChatTurnRequest,
    *,
    message: str,
    code: str,
    details: Mapping[str, Any] | None = None,
) -> Event:
    return Event(
        event_id=f"error-{request.run_id}",
        anima_id=request.anima_id,
        chat_id=request.chat_id,
        user_id=request.user_id,
        type=EventType.ERROR,
        payload=ErrorPayload(message=message, code=code, run_id=request.run_id, details=details),
    )


def crisis_support_event(request: DirectChatTurnRequest, *, source: Literal["local", "moderation"]) -> Event:
    return Event(
        event_id=f"crisis-support-{request.run_id}",
        anima_id=request.anima_id,
        chat_id=request.chat_id,
        user_id=request.user_id,
        type=EventType.CRISIS_SUPPORT,
        payload=CrisisSupportPayload(run_id=request.run_id, source=source),
    )


__all__ = ["avatar_gesture_event", "crisis_support_event", "error_event", "user_response_event"]
