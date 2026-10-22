"""The bridge from a direct turn's domain events to SSE frames, and its terminal frames."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from contextlib import aclosing
from typing import Any

from animama.app.chat import DirectChatTurnExecutor, PreparedDirectChatTurn
from animama.domain.emotions import emotional_state_from_values
from animama.domain.events import ErrorPayload, Event, EventType, RunCompletedPayload
from animama.logging import get_logger
from animama.product_http.ports import ChatTurnStop

from .setup_helpers import TurnSessions
from .sse_events import (
    SseTextState,
    format_avatar_gesture_requested_event,
    format_crisis_support_event,
    format_emotion_update_event,
    format_error_event,
    format_memory_updated_event,
    format_run_completed_event,
    format_run_status_event,
    format_sse,
    format_user_response_event,
    persist_sse_side_effect,
)

_log = get_logger("product_http.chat.sse_runtime")
LeaseCheck = Callable[[], Awaitable[None]]
"""Awaited between frames; raises ``TurnStopped`` when the composition ends the turn."""
ExtraFrameWake = Callable[[], asyncio.Future[Any] | None]
"""The pending work whose completion readies an extra frame, so a stream waiting for events wakes for it."""
# Longest wait for a bridge event before the drain loop checks the lease and polls extra frames again.
_BRIDGE_POLL_SECONDS = 0.05


class TurnStopped(Exception):
    """The composition's lease ended the turn; ``stop`` carries the error frame's code and message."""

    def __init__(self, stop: ChatTurnStop) -> None:
        super().__init__(stop.code)
        self.stop = stop


class DirectChatEventBridge:
    """Request-local queue from app-domain turn events to SSE frame formatting."""

    def __init__(self, *, anima_id: str, queue_size: int = 512) -> None:
        self.anima_id = anima_id
        self._queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=queue_size)

    async def publish(self, event: Event) -> Event:
        """Queue events for this anima while preserving the app-layer return value."""

        if event.anima_id != self.anima_id:
            return event
        await self._queue.put(event)
        return event

    async def get(self) -> Event:
        return await self._queue.get()

    def get_nowait(self) -> Event:
        return self._queue.get_nowait()


async def drain_pending_events(
    bridge: DirectChatEventBridge,
    *,
    run_id: str,
    anima_id: str,
    sessions: TurnSessions,
    state: SseTextState,
    stream_user_response: bool,
    stream_emotion_update: bool,
    stream_error: bool = True,
) -> AsyncIterator[str]:
    """Flush currently queued direct-chat events without waiting for more."""

    while True:
        try:
            event = bridge.get_nowait()
        except asyncio.QueueEmpty:
            break
        async for frame in _handle_direct_event(
            event,
            run_id=run_id,
            anima_id=anima_id,
            sessions=sessions,
            state=state,
            stream_user_response=stream_user_response,
            stream_emotion_update=stream_emotion_update,
            stream_error=stream_error,
        ):
            yield frame


async def drain_events_while_task_runs(
    task: asyncio.Task[Any],
    bridge: DirectChatEventBridge,
    *,
    run_id: str,
    anima_id: str,
    sessions: TurnSessions,
    state: SseTextState,
    stream_user_response: bool,
    stream_emotion_update: bool,
    poll_extra_frame: Callable[[], str | None] | None = None,
    extra_frame_wake: ExtraFrameWake | None = None,
    check_lease: LeaseCheck | None = None,
) -> AsyncIterator[str]:
    """Drain the event bridge while the model-client task is still running.

    ``extra_frame_wake`` ends a wait for the next event as soon as its work
    completes, so a frame it readies is sent then rather than at the next poll.
    """

    while not task.done():
        if check_lease is not None:
            await check_lease()
        if poll_extra_frame is not None:
            # Optional subsystems such as TTS can become ready without publishing
            # app-domain events, so poll them between queue waits.
            frame = poll_extra_frame()
            if frame is not None:
                yield frame
                continue
        event = await _next_event(
            bridge,
            wake=extra_frame_wake() if extra_frame_wake is not None else None,
        )
        if event is None:
            continue
        async for frame in _handle_direct_event(
            event,
            run_id=run_id,
            anima_id=anima_id,
            sessions=sessions,
            state=state,
            stream_user_response=stream_user_response,
            stream_emotion_update=stream_emotion_update,
            stream_error=True,
        ):
            yield frame

    if poll_extra_frame is not None:
        frame = poll_extra_frame()
        if frame is not None:
            yield frame

    async for frame in drain_pending_events(
        bridge,
        run_id=run_id,
        anima_id=anima_id,
        sessions=sessions,
        state=state,
        stream_user_response=stream_user_response,
        stream_emotion_update=stream_emotion_update,
    ):
        yield frame


async def extra_frames_while_task_runs(
    task: asyncio.Task[Any],
    *,
    poll_extra_frame: Callable[[], str | None],
    extra_frame_wake: ExtraFrameWake,
) -> AsyncIterator[str]:
    """Yield extra frames as their work completes until ``task`` finishes; bridge events stay queued."""

    while True:
        frame = poll_extra_frame()
        if frame is not None:
            yield frame
            continue
        if task.done():
            return
        waiters: set[asyncio.Future[Any]] = {task}
        if (wake := extra_frame_wake()) is not None:
            waiters.add(wake)
        await asyncio.wait(waiters, return_when=asyncio.FIRST_COMPLETED)


async def _next_event(bridge: DirectChatEventBridge, *, wake: asyncio.Future[Any] | None) -> Event | None:
    """Wait for the bridge's next event; ``None`` after the poll interval or once ``wake`` completes."""

    next_event = asyncio.ensure_future(bridge.get())
    waiters: set[asyncio.Future[Any]] = {next_event}
    if wake is not None:
        waiters.add(wake)
    try:
        await asyncio.wait(waiters, timeout=_BRIDGE_POLL_SECONDS, return_when=asyncio.FIRST_COMPLETED)
    finally:
        if not next_event.done():
            # An unfinished get has taken nothing, so cancelling it leaves the event queued.
            next_event.cancel()
    return next_event.result() if next_event.done() else None


async def run_prepared_direct_turn(
    executor: DirectChatTurnExecutor,
    prepared_turn: PreparedDirectChatTurn,
    bridge: DirectChatEventBridge,
) -> list[Event]:
    """Run the prepared app-layer turn and mirror each event to the route bridge."""

    request = prepared_turn.request
    _log.info(
        "Direct chat app turn task started",
        anima_id=request.anima_id,
        chat_id=request.chat_id,
        run_id=request.run_id,
        model_provider_id=prepared_turn.model_request.model_provider.id,
        provider_type=prepared_turn.model_request.model_provider.provider_type,
        model=prepared_turn.model_request.model_provider.model,
    )
    events: list[Event] = []
    try:
        # Closing the turn's stream when this task is cancelled (for example while a
        # full bridge waits for a slow client) stops its provider stream before the
        # task ends, so nothing still runs when the lease settles.
        async with aclosing(executor.stream_prepared_turn(prepared_turn)) as turn_events:
            async for event in turn_events:
                events.append(event)
                await bridge.publish(event)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _log.warning(
            "Direct chat app turn task failed",
            anima_id=request.anima_id,
            chat_id=request.chat_id,
            run_id=request.run_id,
            exc_type=exc.__class__.__name__,
            error=str(exc),
        )
        raise
    _log.info(
        "Direct chat app turn task completed",
        anima_id=request.anima_id,
        chat_id=request.chat_id,
        run_id=request.run_id,
        event_count=len(events),
        error_count=sum(1 for event in events if event.type == EventType.ERROR),
    )
    return events


def unexpected_error_event(
    exc: BaseException,
    *,
    anima_id: str,
    chat_id: str,
    user_id: str,
    run_id: str,
) -> Event:
    """Represent an unhandled route/runtime exception as a direct-chat ERROR event."""

    return Event(
        event_id=f"err-{run_id}-direct-chat",
        anima_id=anima_id,
        chat_id=chat_id,
        user_id=user_id,
        type=EventType.ERROR,
        payload=ErrorPayload(
            message=str(exc),
            code="runtime.node_error",
            run_id=run_id,
            details={
                "node_id": "direct-chat:model-client",
                "runner": "DirectChatTurnExecutor",
                "exc_type": exc.__class__.__name__,
            },
        ),
    )


def direct_run_completed_frame(
    *,
    anima_id: str,
    chat_id: str,
    user_id: str,
    run_id: str,
) -> str | None:
    """Build the canonical public completion frame for a direct chat run."""

    completed_event = Event(
        event_id=f"run-completed-{run_id}",
        anima_id=anima_id,
        chat_id=chat_id,
        user_id=user_id,
        type=EventType.RUN_COMPLETED,
        payload=RunCompletedPayload(run_id=run_id),
    )
    return format_run_completed_event(
        completed_event,
        run_id=run_id,
        chat_id=chat_id,
    )


def fallback_run_completed_frame(*, run_id: str, chat_id: str) -> str:
    """Build a minimal completion frame when normal formatting cannot run."""

    return format_sse(
        "run.completed",
        {"run_id": run_id, "chat_id": chat_id},
        event_id=f"run-completed-{run_id}",
    )


async def _handle_direct_event(
    event: Event,
    *,
    run_id: str,
    anima_id: str,
    sessions: TurnSessions,
    state: SseTextState,
    stream_user_response: bool,
    stream_emotion_update: bool,
    stream_error: bool,
) -> AsyncIterator[str]:
    """Persist side effects for one app event and format it into an SSE frame."""

    # Persistence runs before wire formatting so stateful side effects, such as
    # emotional-state updates, remain coupled to the same event the client sees.
    await persist_sse_side_effect(
        event,
        run_id=run_id,
        anima_id=anima_id,
        sessions=sessions,
    )

    frame: str | None = None
    if stream_user_response and event.type == EventType.USER_RESPONSE:
        frame = format_user_response_event(
            event,
            run_id=run_id,
            state=state,
        )
    elif stream_emotion_update and event.type == EventType.EMOTION_UPDATE:
        updated_emotional_state = _emotional_state_from_update_event(event, run_id=run_id)
        if updated_emotional_state is not None:
            # `SseTextState` is later used for run.completed and TTS payloads, so
            # keep it in sync with streamed emotion updates.
            state.emotional_state = updated_emotional_state
        frame = format_emotion_update_event(event, run_id=run_id)
    elif event.type == EventType.AVATAR_GESTURE_REQUESTED:
        frame = format_avatar_gesture_requested_event(event, run_id=run_id)
    elif stream_error and event.type == EventType.ERROR:
        frame = format_error_event(event, run_id=run_id, public_error_text=state.public_error_text)
    elif event.type == EventType.CRISIS_SUPPORT:
        frame = format_crisis_support_event(run_id=run_id, source=event.payload.source, state=state)
    elif event.type == EventType.MEMORY_UPDATED:
        frame = format_memory_updated_event(event, run_id=run_id)
    elif event.type == EventType.RUN_STATUS:
        frame = format_run_status_event(event, run_id=run_id)
    if frame is None:
        return
    # Crisis frames are never logged: detection results are sensitive and logs persist.
    if event.type != EventType.CRISIS_SUPPORT:
        _log.info(
            "Direct chat SSE frame emitted",
            anima_id=anima_id,
            chat_id=event.chat_id,
            run_id=run_id,
            event_id=event.event_id,
            event_type=event.type.value,
            response_part=getattr(event.payload, "response_part", None),
        )
    yield frame


def _emotional_state_from_update_event(event: Event, *, run_id: str) -> dict[str, int] | None:
    payload = getattr(event, "payload", None)
    value = getattr(payload, "run_id", None) if payload is not None else None
    if value != run_id:
        return None
    emotions = getattr(payload, "emotions", None)
    if emotions is None and isinstance(payload, Mapping):
        emotions = payload.get("emotions")
    if emotions is None:
        return None
    return emotional_state_from_values(emotions)
