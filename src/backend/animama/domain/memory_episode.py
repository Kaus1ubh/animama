from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from typing import Any

MEMORY_EPISODE_KIND_CHAT_TURN = "chat_turn"
MEMORY_EPISODE_LOG_ENTRY_KIND = "episode_log"

MEMORY_EPISODE_STATUS_PENDING = "pending"
MEMORY_EPISODE_STATUS_PROCESSED = "processed"
MEMORY_EPISODE_STATUSES = frozenset(
    {
        MEMORY_EPISODE_STATUS_PENDING,
        MEMORY_EPISODE_STATUS_PROCESSED,
    }
)


def new_memory_episode_item_id() -> str:
    """Return a durable ID for an episodic memory item."""

    return f"mei-{uuid.uuid4()}"


def episode_path_for_date(local_date: date) -> str:
    """Return the generated user-scope memory path for one local episode day."""

    if not isinstance(local_date, date) or isinstance(local_date, datetime):
        raise ValueError("local_date must be a date")
    iso_date = local_date.isoformat()
    return f"episodes/{local_date:%Y}/{local_date:%m}/{iso_date}.md"


@dataclass(slots=True)
class MemoryEpisodeItem:
    """Raw chronological note captured from a completed user/anima interaction."""

    id: str
    user_id: str
    source_anima_id: str | None
    source_chat_id: str | None
    source_run_id: str | None
    source_message_id: str | None
    occurred_at: datetime
    local_date: date
    local_timezone: str | None
    episode_path: str
    kind: str
    text: str
    status: str
    processed_at: datetime | None = None
    processed_by_run_id: str | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


__all__ = [
    "MEMORY_EPISODE_KIND_CHAT_TURN",
    "MEMORY_EPISODE_LOG_ENTRY_KIND",
    "MEMORY_EPISODE_STATUS_PENDING",
    "MEMORY_EPISODE_STATUS_PROCESSED",
    "MEMORY_EPISODE_STATUSES",
    "MemoryEpisodeItem",
    "episode_path_for_date",
    "new_memory_episode_item_id",
]
