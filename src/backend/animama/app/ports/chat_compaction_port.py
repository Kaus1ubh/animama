"""Chat compaction repository protocol."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol

from animama.domain.chat_compaction import ChatCompaction


class ChatCompactionRepository(Protocol):
    """Repository operations for durable chat compaction summaries."""

    async def create(self, compaction: ChatCompaction) -> ChatCompaction:
        raise NotImplementedError

    async def get_active(self, chat_id: str) -> ChatCompaction | None:
        raise NotImplementedError

    async def list_for_chat(self, chat_id: str, *, limit: int = 50) -> list[ChatCompaction]:
        raise NotImplementedError

    async def supersede_active(self, chat_id: str, *, superseded_at: datetime) -> int:
        raise NotImplementedError

    async def activate_new(self, compaction: ChatCompaction) -> ChatCompaction:
        raise NotImplementedError


__all__ = ["ChatCompactionRepository"]
