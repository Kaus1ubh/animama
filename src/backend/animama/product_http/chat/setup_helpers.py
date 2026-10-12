"""Small builders shared by the chat turn modules."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import TypeVar

from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.services.chat_manager import ChatManager
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import ProductPorts, ProductRepositories

_T = TypeVar("_T")


def chat_manager(repositories: ProductRepositories) -> ChatManager:
    return ChatManager(
        chats=repositories.chats,
        messages=repositories.chat_messages,
        compactions=repositories.chat_compactions,
        uow=repositories.unit_of_work,
    )


@dataclass(frozen=True)
class TurnSessions:
    """Short-lived owner sessions for the work that outlives a turn's setup session.

    Recording, memory tools, safety state, emotional state, titles, compaction and
    speech each open their own session, so the setup session closes before the
    stream starts. Writes go through the composition's write sessions, which keep
    its commit authority.
    """

    ports: ProductPorts
    principal: RequestPrincipal

    def read(self) -> AbstractAsyncContextManager[AsyncSession]:
        return self.ports.read_session(self.principal)

    def write(self) -> AbstractAsyncContextManager[AsyncSession]:
        return self.ports.write_session(self.principal)

    def repositories(self, session: AsyncSession) -> ProductRepositories:
        return self.ports.repositories(session)


async def with_short_lived_session(
    sessions: TurnSessions, operation: Callable[[ProductRepositories], Awaitable[_T]]
) -> _T:
    """Run ``operation`` on the repositories of one fresh write session."""

    async with sessions.write() as session:
        return await operation(sessions.repositories(session))


__all__ = ["TurnSessions", "chat_manager", "with_short_lived_session"]
