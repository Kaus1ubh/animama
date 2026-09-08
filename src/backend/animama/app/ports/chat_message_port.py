"""Chat message repository protocol."""

from __future__ import annotations

from typing import Protocol

from ...domain.chat import ChatMessage, ChatSearchResult


class ChatMessageRepository(Protocol):
    """Repository operations for persisted chat messages."""

    async def list_by_chat(
        self,
        chat_id: str,
        *,
        limit: int = 200,
        offset: int = 0,
        order: str = "asc",
        include_internal: bool = False,
    ) -> list[ChatMessage]:
        raise NotImplementedError

    async def recent_visible_history(
        self,
        chat_id: str,
        *,
        after_turn: int | None = None,
        limit: int = 200,
    ) -> list[ChatMessage]:
        raise NotImplementedError

    async def recent_model_history(
        self,
        chat_id: str,
        *,
        after_turn: int | None = None,
        limit: int = 200,
    ) -> list[ChatMessage]:
        raise NotImplementedError

    async def visible_history_since(
        self,
        chat_id: str,
        *,
        after_turn: int | None = None,
        limit: int | None = None,
    ) -> list[ChatMessage]:
        raise NotImplementedError

    async def search_for_user(
        self,
        *,
        user_id: str,
        query: str,
        limit: int,
        offset: int = 0,
    ) -> list[ChatSearchResult]:
        raise NotImplementedError

    async def append(self, message: ChatMessage) -> ChatMessage:
        raise NotImplementedError

    async def append_many(self, messages: list[ChatMessage]) -> list[ChatMessage]:
        raise NotImplementedError


__all__ = ["ChatMessageRepository"]
