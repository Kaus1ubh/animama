"""Chat message repository protocol."""

from __future__ import annotations

from typing import Protocol

from animama.domain.chat import (
    AnimaHistoryTurn,
    AnimaHistoryTurnBatch,
    ChatHistoryPosition,
    ChatMessage,
    ChatSearchResult,
)


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
        limit: int | None = 200,
    ) -> list[ChatMessage]:
        """Return the newest replayable rows in turn order; ``limit=None`` returns every row."""

        raise NotImplementedError

    async def latest_compaction_block_turn(self, chat_id: str) -> int | None:
        """Return the turn of the newest visible assistant row whose stored content starts with a compaction block.

        That block (Anthropic server-side compaction) summarizes everything
        before it, so replay can start there.
        """

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

    async def select_reflection_batch(
        self,
        *,
        user_id: str,
        anima_id: str,
        after: ChatHistoryPosition | None,
        max_turns: int,
    ) -> AnimaHistoryTurnBatch:
        """Select up to ``max_turns`` of the owner's oldest turns with one Anima after ``after``.

        A turn is one persisted user message and the Anima's visible reply, which
        share a chat and run, across all of the Anima's chats. Internal rows are
        never part of a turn, and a turn whose reply recorded memory updates as
        disabled is skipped entirely, including its user message. The result also
        counts every such turn after ``after``.
        """

        raise NotImplementedError

    async def list_reflection_turns(
        self,
        *,
        user_id: str,
        anima_id: str,
        after: ChatHistoryPosition | None,
        through: ChatHistoryPosition,
        offset: int = 0,
        limit: int | None = None,
    ) -> list[AnimaHistoryTurn]:
        """List readable turns after ``after`` through ``through``, oldest first, paged by turn."""

        raise NotImplementedError

    async def append(self, message: ChatMessage) -> ChatMessage:
        raise NotImplementedError

    async def append_many(self, messages: list[ChatMessage]) -> list[ChatMessage]:
        raise NotImplementedError


__all__ = ["ChatMessageRepository"]
