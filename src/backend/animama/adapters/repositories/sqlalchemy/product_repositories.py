"""The shared product repositories over one SQLAlchemy owner session (ADR 0021).

Compositions return this bundle from ``ProductPorts.repositories``: the local app
directly, and a hosted consumer on its tenant-bound sessions or wrapped with its own
accounting. Each repository is created on first use and shares the session's
transaction.
"""

from __future__ import annotations

from functools import cached_property

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.memory_episode_repo import SQLAlchemyMemoryEpisodeRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork


class SQLAlchemyProductRepositories:
    """Repositories for the shared product routes, all on ``session``."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    @cached_property
    def animas(self) -> SQLAlchemyAnimaRepository:
        return SQLAlchemyAnimaRepository(self._session)

    @cached_property
    def chats(self) -> SQLAlchemyChatRepository:
        return SQLAlchemyChatRepository(self._session)

    @cached_property
    def chat_messages(self) -> SQLAlchemyChatMessageRepository:
        return SQLAlchemyChatMessageRepository(self._session)

    @cached_property
    def memory_entries(self) -> SQLAlchemyMemoryEntryRepository:
        return SQLAlchemyMemoryEntryRepository(self._session)

    @cached_property
    def memory_episodes(self) -> SQLAlchemyMemoryEpisodeRepository:
        return SQLAlchemyMemoryEpisodeRepository(self._session)

    @cached_property
    def unit_of_work(self) -> SQLAlchemyUnitOfWork:
        return SQLAlchemyUnitOfWork(self._session)
