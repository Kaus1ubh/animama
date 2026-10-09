"""Ordered successful-turn effects, independent of HTTP frames and persistence."""

from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import TypeVar

from .options import DirectChatOptions

Event = TypeVar("Event")


async def complete_successful_turn(
    *,
    options: DirectChatOptions,
    pending_events: AsyncIterator[Event],
    finish_session: Callable[[], Awaitable[Event | None]],
    speech_events: AsyncIterator[Event],
    finish_title: Callable[[], Awaitable[Event | None]],
    compact: Callable[[], Awaitable[object]],
    completed: Callable[[], Event | None],
) -> AsyncIterator[Event]:
    """Flush safety/emotion, speech, title, history compaction, then completion.

    Compositions supply their authorized persistence and speech adapters. They
    must pass only publishable speech events (never suppressed provider text),
    cancel in-flight effects on disconnect, and call this only for success.
    Memory-influence/update switches remain the turn executor's responsibility;
    history compaction is independent of memory updates. Incognito cannot run
    title or compaction side effects. No error is converted into success here.
    """
    async for event in pending_events:
        yield event
    session = await finish_session()
    if session is not None:
        yield session
    async for event in speech_events:
        yield event
    if not options.incognito:
        title = await finish_title()
        if title is not None:
            yield title
        await compact()
    final = completed()
    if final is not None:
        yield final
