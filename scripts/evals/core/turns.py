"""Run one evaluation turn through chat's executor and collect what it played."""

from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from animama.app.chat import DirectChatTurnExecutor, DirectChatTurnRequest
from animama.app.chat.direct_turn.types import PreparedDirectChatTurn
from animama.app.main_structured_response import MainStructuredResponse
from animama.domain.events import Event, EventType

from .chat import EvalChats, history_rows, is_speech, replayed_reply
from .model_calls import BudgetedModelClient, CallRecord, Clock, reply_calls

__all__ = ["TurnOutcome", "execute_turn"]


@dataclass(frozen=True, slots=True)
class TurnOutcome:
    """What one turn sent, played and cost, as chat's stream and the budgeted client observed it."""

    prepared: PreparedDirectChatTurn
    events: tuple[Event, ...]
    calls: tuple[CallRecord, ...]
    """The model calls this turn made, in order: any memory tool rounds, its first reply, then any repair."""
    sent: float
    """Clock reading when the turn was sent, as ``chat:sse`` receives it."""
    finished: float
    """Clock reading when chat's reply stream ended."""
    first_output: float | None
    """Clock reading at chat's first spoken reply text, or ``None`` when no speech streamed."""
    refused: bool
    """The call budget refused one of this turn's calls, so the turn is incomplete and must not be scored."""
    gesture: str | None
    """The Gesture chat validated against the equipped list and sent to the avatar."""
    error: str | None
    """The error code chat's stream reported, or ``None``."""
    reply: MainStructuredResponse | None
    """The reply chat kept, rebuilt the way the executor recovers it; ``None`` for a failed turn."""
    recovery: str | None
    """``None`` for a reply that validated first time, else ``repaired``, ``salvaged`` or ``plain_text``."""


async def execute_turn(
    executor: DirectChatTurnExecutor,
    request: DirectChatTurnRequest,
    *,
    budget: BudgetedModelClient,
    chats: EvalChats | None,
    clock: Clock,
    on_prepared: Callable[[PreparedDirectChatTurn], Awaitable[None] | None] | None = None,
) -> TurnOutcome:
    """Send one turn, then append the history chat would replay to ``chats`` when it produced a reply.

    ``chats`` is ``None`` for a turn chat persists itself (memory on, not incognito): chat's own chat manager
    then keeps the history.

    ``on_prepared`` sees the prepared turn before it streams, so a measure of its prompt is kept even when
    the stream then fails or is interrupted; it may be a coroutine function, for example one that closes the
    turn's setup session as ``chat:sse`` does.
    """

    first_call = len(budget.calls)
    # Latency runs from sending the turn, as chat:sse receives it, until chat's stream ends.
    sent = clock()
    prepared = await executor.prepare_turn(request)
    if on_prepared is not None:
        pending = on_prepared(prepared)
        if inspect.isawaitable(pending):
            await pending
    events: list[Event] = []
    first_output: float | None = None
    async for event in executor.stream_prepared_turn(prepared):
        if first_output is None and is_speech(event):
            first_output = clock()
        events.append(event)
    finished = clock()
    calls = tuple(budget.calls[first_call:])
    if budget.refused:
        return TurnOutcome(
            prepared=prepared,
            events=tuple(events),
            calls=calls,
            sent=sent,
            finished=finished,
            first_output=first_output,
            refused=True,
            gesture=None,
            error=None,
            reply=None,
            recovery=None,
        )

    # The played Gesture is the one chat validated against the loadout and sent to the avatar.
    gesture = next(
        (event.payload.gesture for event in events if event.type is EventType.AVATAR_GESTURE_REQUESTED),
        None,
    )
    error = next(
        (event.payload.code or "error" for event in events if event.type is EventType.ERROR),
        None,
    )
    reply: MainStructuredResponse | None = None
    recovery: str | None = None
    if error is None:
        replies = reply_calls(calls)
        replayed = replayed_reply(
            [call.final_text for call in replies if call.final_text is not None],
            prepared.output_type,
            first_reply_deltas=replies[0].text_deltas if replies else (),
        )
        if replayed is not None:
            reply, replay_text, recovery = replayed
            if chats is not None:
                # Chat persists nothing for an incognito turn, so the runner keeps the history it would replay.
                chats.append(request.chat_id, history_rows(request, replay_text))
    return TurnOutcome(
        prepared=prepared,
        events=tuple(events),
        calls=calls,
        sent=sent,
        finished=finished,
        first_output=first_output,
        refused=False,
        gesture=gesture,
        error=error,
        reply=reply,
        recovery=recovery,
    )
