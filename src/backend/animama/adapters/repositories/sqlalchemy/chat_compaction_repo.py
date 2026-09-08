"""SQLAlchemy ChatCompactionRepository adapter."""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import desc, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from ....app.ports.chat_compaction_port import ChatCompactionRepository
from ....domain.chat_compaction import STATUS_ACTIVE, STATUS_SUPERSEDED, ChatCompaction
from ....orm.chat_compactions import ORMChatCompaction
from ...mappers.chat_compaction_map import chat_compaction_domain_to_orm, chat_compaction_orm_to_domain


class SQLAlchemyChatCompactionRepository(ChatCompactionRepository):
    """Persist compaction summaries using SQLAlchemy async sessions."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def create(self, compaction: ChatCompaction) -> ChatCompaction:
        if not compaction.id:
            compaction.id = f"cmp-{uuid.uuid4().hex}"
        orm = chat_compaction_domain_to_orm(compaction)
        self._s.add(orm)
        await self._s.flush()
        await self._s.refresh(orm)
        return chat_compaction_orm_to_domain(orm)

    async def get_active(self, chat_id: str) -> ChatCompaction | None:
        stmt = (
            select(ORMChatCompaction)
            .where(
                ORMChatCompaction.chat_id == chat_id,
                ORMChatCompaction.status == STATUS_ACTIVE,
            )
            .order_by(desc(ORMChatCompaction.created_at), desc(ORMChatCompaction.id))
            .limit(1)
        )
        res = await self._s.execute(stmt)
        orm = res.scalar_one_or_none()
        return chat_compaction_orm_to_domain(orm) if orm is not None else None

    async def list_for_chat(self, chat_id: str, *, limit: int = 50) -> list[ChatCompaction]:
        stmt = (
            select(ORMChatCompaction)
            .where(ORMChatCompaction.chat_id == chat_id)
            .order_by(desc(ORMChatCompaction.created_at), desc(ORMChatCompaction.id))
            .limit(limit)
        )
        res = await self._s.execute(stmt)
        return [chat_compaction_orm_to_domain(row) for row in res.scalars()]

    async def supersede_active(self, chat_id: str, *, superseded_at: datetime) -> int:
        result = await self._s.execute(
            update(ORMChatCompaction)
            .where(
                ORMChatCompaction.chat_id == chat_id,
                ORMChatCompaction.status == STATUS_ACTIVE,
            )
            .values(status=STATUS_SUPERSEDED, superseded_at=superseded_at)
            .execution_options(synchronize_session="fetch")
        )
        await self._s.flush()
        return int(result.rowcount or 0)

    async def activate_new(self, compaction: ChatCompaction) -> ChatCompaction:
        compaction.status = STATUS_ACTIVE
        await self.supersede_active(compaction.chat_id, superseded_at=datetime.utcnow())
        return await self.create(compaction)


__all__ = ["SQLAlchemyChatCompactionRepository"]
