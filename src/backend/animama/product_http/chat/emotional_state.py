"""Store an Anima's emotional state as a chat turn's emotion updates arrive."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from animama.domain.emotions import emotional_state_from_values
from animama.domain.events import EmotionUpdatePayload
from animama.logging import get_logger

from .setup_helpers import TurnSessions

_log = get_logger("product_http.chat.emotional_state")


async def persist_emotional_state_update(
    sessions: TurnSessions,
    anima_id: str,
    payload: EmotionUpdatePayload | Mapping[str, Any] | Any,
) -> bool:
    """Persist one direct-chat emotion update for the owner's Anima.

    Returns whether the payload carried emotions; an unchanged state is not written.
    """

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
    updated = emotional_state_from_values(emotions)
    async with sessions.write() as session:
        repositories = sessions.repositories(session)
        if await repositories.animas.record_emotional_state(
            user_id=sessions.principal.id, anima_id=anima_id, emotional_state=updated
        ):
            await repositories.unit_of_work.commit()
            _log.info("EmotionalState Updated", anima_id=anima_id, updated=updated)
    return True


__all__ = ["persist_emotional_state_update"]
