from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.chat_compaction_repo import SQLAlchemyChatCompactionRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.chat_manager import ChatManager


def chat_manager(session: AsyncSession) -> ChatManager:
    return ChatManager(
        chats=SQLAlchemyChatRepository(session),
        messages=SQLAlchemyChatMessageRepository(session),
        compactions=SQLAlchemyChatCompactionRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )


__all__ = ["chat_manager"]
