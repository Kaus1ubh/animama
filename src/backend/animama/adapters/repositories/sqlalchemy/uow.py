"""SQLAlchemy UnitOfWork adapter for application ports (Stage 6 wiring)."""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from ....app.ports import UnitOfWork
from ....logging import get_logger


class SQLAlchemyUnitOfWork(UnitOfWork):
    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._log = get_logger("adapters.sqlalchemy.uow")

    async def commit(self) -> None:
        await self._session.commit()
        self._log.info("DB Commit")

    async def rollback(self) -> None:
        await self._session.rollback()
        self._log.info("DB Rollback")
