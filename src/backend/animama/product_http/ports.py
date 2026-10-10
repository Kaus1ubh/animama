"""Ports each composition installs for the shared product routes (ADR 0021).

A composition installs one ``ProductPorts`` object with ``install_product_ports``
when it builds its app. Shared handlers obtain every collaborator through it and
never construct repositories or stores or read process-global settings. Without
ports, shared routes fail closed with 503 ``product_ports_unavailable``. Families add
the ports they need as they move into this package.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from typing import Annotated, Protocol, cast

from fastapi import Depends, FastAPI, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.contracts.runtime_capabilities import RuntimeCapabilities
from animama.app.ports.anima_port import AnimaRepository
from animama.app.ports.chat_message_port import ChatMessageRepository
from animama.app.ports.chat_port import ChatRepository
from animama.app.ports.memory_entry_port import MemoryEntryRepository
from animama.app.ports.memory_episode_port import MemoryEpisodeRepository
from animama.app.ports.settings_port import AnimaSettingsRepository, UserSettingsRepository
from animama.app.ports.uow_port import UnitOfWork
from animama.app.ports.user_profile_port import UserProfileRepository
from animama.app.safety.crisis_resources import CrisisResourceTable
from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.principal import get_current_principal


class ProductRepositories(Protocol):
    """Repositories over one owner session; families add theirs as they move."""

    @property
    def animas(self) -> AnimaRepository: ...

    @property
    def chats(self) -> ChatRepository: ...

    @property
    def chat_messages(self) -> ChatMessageRepository: ...

    @property
    def memory_entries(self) -> MemoryEntryRepository: ...

    @property
    def memory_episodes(self) -> MemoryEpisodeRepository: ...

    @property
    def user_settings(self) -> UserSettingsRepository: ...

    @property
    def anima_settings(self) -> AnimaSettingsRepository: ...

    @property
    def user_profiles(self) -> UserProfileRepository: ...

    @property
    def anima_loadouts(self) -> AnimaLoadoutService:
        """The Anima loadout aggregate, which works on the session directly."""
        ...

    @property
    def unit_of_work(self) -> UnitOfWork: ...


class ProductRefusal(Exception):
    """A composition-specific refusal a shared route reports as ``{"code": code}``."""

    def __init__(self, status_code: int, code: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


@dataclass(frozen=True)
class ProductPolicy:
    """Owner limits a composition enforces on the shared routes."""

    memory_file_max_bytes: int


class ProductPorts(Protocol):
    """The composition-owned collaborators of shared product handlers."""

    @property
    def policy(self) -> ProductPolicy: ...

    def read_session(self, principal: RequestPrincipal) -> AbstractAsyncContextManager[AsyncSession]:
        """Open a session for a handler that only reads ``principal``'s data."""
        ...

    def write_session(self, principal: RequestPrincipal) -> AbstractAsyncContextManager[AsyncSession]:
        """Open a session for a handler that changes ``principal``'s data.

        Handlers commit through the session as usual, but commit authority stays
        with the composition: it may defer a requested commit (for example to
        settle metering or recheck a lease) and must complete or roll it back when
        the context exits. That exit runs after the handler returns and before the
        response is sent.
        """
        ...

    def repositories(self, session: AsyncSession) -> ProductRepositories:
        """The product repositories over a session this composition opened."""
        ...

    async def update_display_name(self, session: AsyncSession, principal: RequestPrincipal, display_name: str) -> str:
        """Save ``principal``'s display name on ``session`` and return the stored value.

        Raises ``UserProfileNotFoundError`` or ``UserProfileInvalidError`` for the
        shared profile rules and ``ProductRefusal`` for the composition's own.
        """
        ...

    def crisis_resources(self) -> CrisisResourceTable:
        """The crisis-resource regions this composition offers its owners."""
        ...

    async def runtime_capabilities(self, session: AsyncSession, principal: RequestPrincipal) -> RuntimeCapabilities:
        """What this composition offers ``principal`` now, reading any stored state on ``session``."""
        ...

    def user_settings_changed(self, principal: RequestPrincipal) -> None:
        """Tell the composition ``principal``'s user settings changed.

        Called after the handler requested its commit; a composition that defers
        commits acts on it once the commit completes.
        """
        ...


def install_product_ports(app: FastAPI, ports: ProductPorts) -> None:
    """Install a composition's ports; the annotation lets type checks confirm conformance."""
    app.state.product_ports = ports


def get_product_ports(request: Request) -> ProductPorts:
    """Require the ports installed by the application factory."""
    ports = getattr(request.app.state, "product_ports", None)
    if ports is None:
        raise HTTPException(status_code=503, detail={"code": "product_ports_unavailable"})
    # Starlette state is dynamic; install_product_ports stores this protocol.
    return cast(ProductPorts, ports)


# A session opens only after the principal resolves, so unadmitted requests never
# reach the database, and the composition always knows whose session it opens.
async def get_read_session(
    ports: Annotated[ProductPorts, Depends(get_product_ports)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> AsyncIterator[AsyncSession]:
    async with ports.read_session(principal) as session:
        yield session


async def get_write_session(
    ports: Annotated[ProductPorts, Depends(get_product_ports)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> AsyncIterator[AsyncSession]:
    async with ports.write_session(principal) as session:
        yield session


ReadSession = Annotated[AsyncSession, Depends(get_read_session)]
# Function scope ends the session, and any deferred commit, before the response
# is sent, so a failed commit is reported instead of an earlier success. The
# session is therefore closed before a streaming body runs.
WriteSession = Annotated[AsyncSession, Depends(get_write_session, scope="function")]


Ports = Annotated[ProductPorts, Depends(get_product_ports)]


def get_read_repositories(
    ports: Annotated[ProductPorts, Depends(get_product_ports)], session: ReadSession
) -> ProductRepositories:
    return ports.repositories(session)


def get_write_repositories(
    ports: Annotated[ProductPorts, Depends(get_product_ports)], session: WriteSession
) -> ProductRepositories:
    return ports.repositories(session)


# Shared handlers take repositories rather than sessions, so they never build one.
ReadRepositories = Annotated[ProductRepositories, Depends(get_read_repositories)]
WriteRepositories = Annotated[ProductRepositories, Depends(get_write_repositories)]


def get_product_policy(ports: Annotated[ProductPorts, Depends(get_product_ports)]) -> ProductPolicy:
    return ports.policy


Policy = Annotated[ProductPolicy, Depends(get_product_policy)]
