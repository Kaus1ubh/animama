"""SQLAlchemy ChatMessageRepository adapter."""

from __future__ import annotations

import re
from collections.abc import Mapping
from typing import Any

from sqlalchemy import Select, String, and_, asc, cast, desc, exists, func, literal, not_, select, text, tuple_
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import aliased

from ....app.ports.chat_message_port import ChatMessageRepository
from ....domain.chat import (
    AnimaHistoryTurn,
    AnimaHistoryTurnBatch,
    ChatHistoryPosition,
    ChatMessage,
    ChatSearchResult,
)
from ....orm.chat_messages import ORMChatMessage
from ....orm.chats import ORMChat
from ...mappers.chat_message_map import chat_message_domain_to_orm, chat_message_orm_to_domain

# An assistant reply stores this block when memory updates were off for its turn.
_MEMORY_UPDATES_DISABLED = {"memory": {"updates_enabled": False}}


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


def _reflection_turn_key() -> Any:
    """Group a turn's rows: they share a chat and run; a row without a run is its own turn."""

    return func.coalesce(ORMChatMessage.run_id, literal("message:") + cast(ORMChatMessage.id, String))


def _reflection_messages(
    *columns: Any,
    user_id: str,
    anima_id: str,
    after: ChatHistoryPosition | None,
    through: ChatHistoryPosition | None,
) -> Select[Any]:
    """Select ``columns`` of the owner's visible user/assistant rows with one Anima that a Reflection may read.

    A turn is the rows of one chat run: the owner's message and the Anima's
    visible reply share ``chat_id`` and ``run_id``. When that reply recorded
    memory updates as disabled, every row of the turn is excluded, including the
    owner's message. A row without a run is a turn of its own. Positions compare
    rows by ``(created_at, id)``: ``after`` is exclusive, ``through`` inclusive.
    """

    reply = aliased(ORMChatMessage)
    turn_updates_disabled = exists().where(
        reply.chat_id == ORMChatMessage.chat_id,
        reply.run_id == ORMChatMessage.run_id,
        reply.internal.is_(False),
        reply.role == "assistant",
        reply.message_data.contains(_MEMORY_UPDATES_DISABLED),
    )
    conditions = [
        ORMChat.user_id == user_id,
        ORMChat.anima_id == anima_id,
        ORMChatMessage.internal.is_(False),
        ORMChatMessage.role.in_(["user", "assistant"]),
        # A row without a run has no partner; check its own flag.
        not_(and_(ORMChatMessage.role == "assistant", ORMChatMessage.message_data.contains(_MEMORY_UPDATES_DISABLED))),
        ~turn_updates_disabled,
    ]
    position = tuple_(ORMChatMessage.created_at, ORMChatMessage.id)
    if after is not None:
        conditions.append(position > tuple_(literal(after.created_at), literal(after.message_id)))
    if through is not None:
        conditions.append(position <= tuple_(literal(through.created_at), literal(through.message_id)))
    return (
        select(*columns)
        .select_from(ORMChatMessage)
        .join(ORMChat, ORMChat.id == ORMChatMessage.chat_id)
        .where(*conditions)
    )


def _reflection_turns(
    *,
    user_id: str,
    anima_id: str,
    after: ChatHistoryPosition | None,
    through: ChatHistoryPosition | None,
) -> Select[Any]:
    """Group readable rows into turns positioned at their last message, oldest first.

    Each row is ``(chat_id, turn_key, last_created_at, last_message_id)``;
    callers add a window count, offset or limit.
    """

    rows = _reflection_messages(
        ORMChatMessage.id,
        ORMChatMessage.chat_id,
        ORMChatMessage.created_at,
        _reflection_turn_key().label("turn_key"),
        user_id=user_id,
        anima_id=anima_id,
        after=after,
        through=through,
    ).subquery()
    last_created_at = func.max(rows.c.created_at).label("last_created_at")
    last_message_id = func.max(rows.c.id).label("last_message_id")
    return (
        select(rows.c.chat_id, rows.c.turn_key, last_created_at, last_message_id)
        .group_by(rows.c.chat_id, rows.c.turn_key)
        .order_by(asc(last_created_at), asc(last_message_id))
    )


def _reflection_text(message: ORMChatMessage) -> str | None:
    """Return what the owner saw: the reply's display or speech text, else the stored content."""

    data = message.message_data if isinstance(message.message_data, Mapping) else {}
    structured = data.get("structured")
    if message.role == "assistant" and isinstance(structured, Mapping):
        for key in ("display", "speech"):
            value = structured.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    content = (message.content or "").strip()
    return content or None


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
        limit: int | None = 200,
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
        )
        if limit is not None:
            stmt = stmt.limit(limit)
        res = await self._s.execute(stmt)
        messages = [chat_message_orm_to_domain(row) for row in res.scalars()]
        messages.reverse()
        return messages

    async def latest_compaction_block_turn(self, chat_id: str) -> int | None:
        stmt = (
            select(ORMChatMessage.turn)
            .where(
                ORMChatMessage.chat_id == chat_id,
                ORMChatMessage.internal.is_(False),
                ORMChatMessage.role == "assistant",
                ORMChatMessage.turn.is_not(None),
                ORMChatMessage.raw_provider_message[("content", 0, "type")].astext == "compaction",
            )
            .order_by(desc(ORMChatMessage.turn))
            .limit(1)
        )
        return (await self._s.execute(stmt)).scalar_one_or_none()

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

    async def select_reflection_batch(
        self,
        *,
        user_id: str,
        anima_id: str,
        after: ChatHistoryPosition | None,
        max_turns: int,
    ) -> AnimaHistoryTurnBatch:
        turns = _reflection_turns(user_id=user_id, anima_id=anima_id, after=after, through=None)
        # The window count runs before LIMIT, so it counts every uncovered turn.
        batch = turns.add_columns(func.count().over().label("uncovered_turn_count")).limit(max(1, int(max_turns)))
        result = (await self._s.execute(batch)).all()
        if not result:
            return AnimaHistoryTurnBatch(turn_count=0, uncovered_turn_count=0, through=None)
        last = result[-1]
        return AnimaHistoryTurnBatch(
            turn_count=len(result),
            uncovered_turn_count=int(last.uncovered_turn_count),
            through=ChatHistoryPosition(created_at=last.last_created_at, message_id=int(last.last_message_id)),
        )

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
        turns = _reflection_turns(user_id=user_id, anima_id=anima_id, after=after, through=through)
        page = turns.offset(max(0, int(offset)))
        if limit is not None:
            page = page.limit(max(0, int(limit)))
        page_turns = page.subquery()
        turn_key = _reflection_turn_key()
        stmt = (
            _reflection_messages(
                ORMChatMessage,
                ORMChat.title,
                turn_key.label("turn_key"),
                user_id=user_id,
                anima_id=anima_id,
                after=after,
                through=through,
            )
            .join(
                page_turns,
                and_(page_turns.c.chat_id == ORMChatMessage.chat_id, page_turns.c.turn_key == turn_key),
            )
            .order_by(asc(ORMChatMessage.created_at), asc(ORMChatMessage.id))
        )
        grouped: dict[tuple[str, str], dict[str, Any]] = {}
        for message, chat_title, message_turn_key in (await self._s.execute(stmt)).all():
            turn = grouped.setdefault(
                (message.chat_id, message_turn_key),
                {"chat_id": message.chat_id, "chat_title": chat_title, "user": [], "anima": []},
            )
            text_value = _reflection_text(message)
            if text_value is not None:
                turn["user" if message.role == "user" else "anima"].append(text_value)
            # Rows arrive oldest first, so the last assignment is the turn's position.
            turn["position"] = ChatHistoryPosition(created_at=message.created_at, message_id=message.id)
        ordered = sorted(grouped.values(), key=lambda turn: turn["position"])
        return [
            AnimaHistoryTurn(
                chat_id=turn["chat_id"],
                chat_title=turn["chat_title"],
                user_text="\n\n".join(turn["user"]) or None,
                anima_text="\n\n".join(turn["anima"]) or None,
                position=turn["position"],
            )
            for turn in ordered
        ]

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
