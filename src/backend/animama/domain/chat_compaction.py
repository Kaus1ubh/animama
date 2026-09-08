from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from .usage import Usage

STATUS_ACTIVE = "active"
STATUS_SUPERSEDED = "superseded"
STATUS_FAILED = "failed"

CHAT_COMPACTION_STATUSES = {
    STATUS_ACTIVE,
    STATUS_SUPERSEDED,
    STATUS_FAILED,
}


@dataclass(slots=True)
class ChatCompaction:
    """Durable summary of covered chat history for active prompt context."""

    id: str | None
    chat_id: str
    user_id: str
    anima_id: str
    status: str = STATUS_ACTIVE
    summary_text: str | None = None
    start_turn: int | None = None
    end_turn: int | None = None
    source_message_count: int = 0
    model_provider: str | None = None
    model: str | None = None
    prompt_version: str | None = None
    usage: Usage | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None
    superseded_at: datetime | None = None


__all__ = [
    "CHAT_COMPACTION_STATUSES",
    "STATUS_ACTIVE",
    "STATUS_FAILED",
    "STATUS_SUPERSEDED",
    "ChatCompaction",
]
