"""SQLAlchemy ChatMessageRepository adapter."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import asc, desc, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from ....app.ports.chat_message_port import ChatMessageRepository
from ....domain.chat import ChatMessage, ChatSearchResult
from ....orm.chat_messages import ORMChatMessage
from ...mappers.chat_message_map import chat_message_domain_to_orm, chat_message_orm_to_domain


def _snippet_for_query(content: str | None, query: str, *, max_chars: int = 220) -> str:
    text_value = " ".join((content or "").split())
    if len(text_value) <= max_chars:
        return text_value

    terms = [term.lower() for term in re.findall(r"[A-Za-z0-9_]{2,}", query)]
    lowered = text_value.lower()
    first_idx = -1
    for term in terms:
        idx = lowered.find(term)
        if idx >= 0 and (first_idx < 0 or idx < first_idx):
            first_idx = idx

    if first_idx < 0:
        return f"{text_value[: max_chars - 3].rstrip()}..."

    window_start = max(0, first_idx - max_chars // 3)
    window_end = min(len(text_value), window_start + max_chars)
    if window_end - window_start < max_chars:
        window_start = max(0, window_end - max_chars)

    prefix = "..." if window_start > 0 else ""
    suffix = "..." if window_end < len(text_value) else ""
    return f"{prefix}{text_value[window_start:window_end].strip()}{suffix}"


def _prefix_tsquery_for_query(query: str) -> str:
    terms = [term.lower() for term in re.findall(r"[A-Za-z0-9_]+", query) if len(term) >= 2]
    return " & ".join(f"{term}:*" for term in terms[:8])


def _search_row_to_domain(row: Any, query: str) -> ChatSearchResult:
    mapping = row._mapping
    return ChatSearchResult(
        message_id=int(mapping["message_id"]),
        chat_id=str(mapping["chat_id"]),
        anima_id=str(mapping["anima_id"]),
        anima_name=mapping["anima_name"],
        anima_profile_picture_url=mapping["anima_profile_picture_url"],
        chat_title=mapping["chat_title"],
        snippet=_snippet_for_query(mapping["content"], query),
        score=float(mapping["score"] or 0.0),
        turn=mapping["turn"],
        created_at=mapping["created_at"],
    )


class SQLAlchemyChatMessageRepository(ChatMessageRepository):
    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_by_chat(
        self,
        chat_id: str,
        *,
        limit: int = 200,
        offset: int = 0,
        order: str = "asc",
        include_internal: bool = False,
    ) -> list[ChatMessage]:
        ordering = (
            (
                asc(ORMChatMessage.turn).nulls_last(),
                asc(ORMChatMessage.created_at),
                asc(ORMChatMessage.id),
            )
            if order.lower() == "asc"
            else (
                desc(ORMChatMessage.turn).nulls_last(),
                desc(ORMChatMessage.created_at),
                desc(ORMChatMessage.id),
            )
        )
        stmt = select(ORMChatMessage).where(ORMChatMessage.chat_id == chat_id)
        if not include_internal:
            stmt = stmt.where(ORMChatMessage.internal.is_(False))
        stmt = stmt.order_by(*ordering).offset(offset).limit(limit)
        res = await self._s.execute(stmt)
        return [chat_message_orm_to_domain(row) for row in res.scalars()]

    async def recent_visible_history(
        self,
        chat_id: str,
        *,
        after_turn: int | None = None,
        limit: int = 200,
    ) -> list[ChatMessage]:
        stmt = select(ORMChatMessage).where(
            ORMChatMessage.chat_id == chat_id,
            ORMChatMessage.internal.is_(False),
            ORMChatMessage.role.in_(["user", "assistant"]),
        )
        if after_turn is not None:
            stmt = stmt.where(ORMChatMessage.turn > after_turn)
        stmt = stmt.order_by(
            desc(ORMChatMessage.turn).nulls_last(),
            desc(ORMChatMessage.created_at),
            desc(ORMChatMessage.id),
        ).limit(limit)
        res = await self._s.execute(stmt)
        messages = [chat_message_orm_to_domain(row) for row in res.scalars()]
        messages.reverse()
        return messages

    async def recent_model_history(
        self,
        chat_id: str,
        *,
        after_turn: int | None = None,
        limit: int = 200,
    ) -> list[ChatMessage]:
        stmt = select(ORMChatMessage).where(
            ORMChatMessage.chat_id == chat_id,
            (
                (ORMChatMessage.internal.is_(False) & ORMChatMessage.role.in_(["user", "assistant"]))
                | (
                    ORMChatMessage.internal.is_(True)
                    & ORMChatMessage.role.in_(["assistant", "tool"])
                    & ORMChatMessage.message_type.in_(["tool_call", "tool_result"])
                )
            ),
        )
        if after_turn is not None:
            stmt = stmt.where(ORMChatMessage.turn > after_turn)
        stmt = stmt.order_by(
            desc(ORMChatMessage.turn).nulls_last(),
            desc(ORMChatMessage.created_at),
            desc(ORMChatMessage.id),
        ).limit(limit)
        res = await self._s.execute(stmt)
        messages = [chat_message_orm_to_domain(row) for row in res.scalars()]
        messages.reverse()
        return messages

    async def visible_history_since(
        self,
        chat_id: str,
        *,
        after_turn: int | None = None,
        limit: int | None = None,
    ) -> list[ChatMessage]:
        stmt = (
            select(ORMChatMessage)
            .where(
                ORMChatMessage.chat_id == chat_id,
                ORMChatMessage.internal.is_(False),
                ORMChatMessage.role.in_(["user", "assistant"]),
            )
            .order_by(
                asc(ORMChatMessage.turn).nulls_last(),
                asc(ORMChatMessage.created_at),
                asc(ORMChatMessage.id),
            )
        )
        if after_turn is not None:
            stmt = stmt.where(ORMChatMessage.turn > after_turn)
        if limit is not None:
            stmt = stmt.limit(limit)
        res = await self._s.execute(stmt)
        return [chat_message_orm_to_domain(row) for row in res.scalars()]

    async def search_for_user(
        self,
        *,
        user_id: str,
        query: str,
        limit: int,
        offset: int = 0,
    ) -> list[ChatSearchResult]:
        stmt = text("""
            WITH search_query AS (
                SELECT
                    CASE
                        WHEN :prefix_query != ''
                        THEN to_tsquery('english', :prefix_query)
                        ELSE NULL
                    END AS value
            ),
            matching_messages AS (
                SELECT
                    m.id AS message_id,
                    m.chat_id,
                    c.anima_id,
                p.display_name AS anima_name,
                    p.profile_picture_url AS anima_profile_picture_url,
                    c.title AS chat_title,
                    COALESCE(
                        NULLIF(
                            COALESCE(NULLIF(m.message_data #>> '{structured,speech}', ''), '') ||
                            CASE
                                WHEN NULLIF(m.message_data #>> '{structured,speech}', '') IS NOT NULL
                                    AND NULLIF(m.message_data #>> '{structured,display}', '') IS NOT NULL
                                THEN ' '
                                ELSE ''
                            END ||
                            COALESCE(NULLIF(m.message_data #>> '{structured,display}', ''), ''),
                            ''
                        ),
                        m.content
                    ) AS content,
                    m.turn,
                    m.created_at,
                    ts_rank_cd(m.search_vector, search_query.value) AS score
                FROM chat_messages m
                JOIN chats c ON c.id = m.chat_id
                JOIN anima p ON p.id = c.anima_id
                LEFT JOIN avatar a ON a.id = p.avatar_id
                CROSS JOIN search_query
                WHERE c.user_id = :user_id
                    AND m.internal IS FALSE
                    AND m.role IN ('user', 'assistant')
                    AND m.content IS NOT NULL
                    AND search_query.value IS NOT NULL
                    AND m.search_vector @@ search_query.value
            ),
            best_chat_messages AS (
                SELECT
                    matching_messages.*,
                    row_number() OVER (
                        PARTITION BY matching_messages.chat_id
                        ORDER BY
                            matching_messages.score DESC,
                            matching_messages.created_at DESC,
                            matching_messages.message_id DESC
                    ) AS chat_match_rank
                FROM matching_messages
            )
            SELECT
                message_id,
                chat_id,
                anima_id,
                anima_name,
                anima_profile_picture_url,
                chat_title,
                content,
                turn,
                created_at,
                score
            FROM best_chat_messages
            WHERE chat_match_rank = 1
            ORDER BY score DESC, created_at DESC, message_id DESC
            LIMIT :limit OFFSET :offset
        """)
        rows = await self._s.execute(
            stmt,
            {
                "user_id": user_id,
                "prefix_query": _prefix_tsquery_for_query(query),
                "limit": max(1, int(limit)),
                "offset": max(0, int(offset)),
            },
        )
        return [_search_row_to_domain(row, query) for row in rows]

    async def append(self, message: ChatMessage) -> ChatMessage:
        orm = chat_message_domain_to_orm(message)
        self._s.add(orm)
        await self._s.flush()
        await self._s.refresh(orm)
        return chat_message_orm_to_domain(orm)

    async def append_many(self, messages: list[ChatMessage]) -> list[ChatMessage]:
        orms: list[ORMChatMessage] = [chat_message_domain_to_orm(message) for message in messages]
        self._s.add_all(orms)
        await self._s.flush()
        for orm in orms:
            await self._s.refresh(orm)
        return [chat_message_orm_to_domain(orm) for orm in orms]


__all__ = ["SQLAlchemyChatMessageRepository"]
