from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.domain.emotions import emotional_state_from_values, normalize_emotional_state
from animama.domain.events import EmotionUpdatePayload
from animama.logging_config import get_logger

from ..orm.anima import ORMAnima

_log = get_logger("server.emotional_state_persistence")


async def _persist_emotional_state(
    session_factory: async_sessionmaker[AsyncSession],
    anima_id: str,
    emotions: list[dict[str, Any]] | list[Any],
) -> None:
    async with session_factory() as sess:
        orm = await sess.get(ORMAnima, anima_id)
        if orm is None:
            return
        current = normalize_emotional_state(orm.emotional_state)
        updated = emotional_state_from_values(emotions)
        if updated == current:
            return
        orm.emotional_state = updated
        await sess.commit()
        _log.info("EmotionalState Updated", anima_id=anima_id, updated=updated)


async def persist_emotional_state_update(
    session_factory: async_sessionmaker[AsyncSession],
    anima_id: str,
    payload: EmotionUpdatePayload | Mapping[str, Any] | Any,
) -> bool:
    """Persist one direct-chat emotion update payload for a anima."""

    emotions: list[dict[str, Any]] | list[Any] | None = None
    if isinstance(payload, EmotionUpdatePayload):
        emotions = list(payload.emotions)
    elif isinstance(payload, Mapping):
        raw = payload.get("emotions")
        if isinstance(raw, list):
            emotions = raw
    else:
        raw = getattr(payload, "emotions", None)
        if isinstance(raw, list):
            emotions = raw
    if emotions is None:
        return False
    await _persist_emotional_state(session_factory, anima_id, emotions)
    return True
