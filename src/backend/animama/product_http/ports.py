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

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.contracts.runtime_capabilities import RuntimeCapabilities
from animama.app.ports.anima_chat_profile_port import AnimaChatProfileRepository
from animama.app.ports.anima_port import AnimaRepository
from animama.app.ports.anima_presentation_port import AnimaPresentationRepository
from animama.app.ports.avatar_port import AvatarRepository
from animama.app.ports.chat_message_port import ChatMessageRepository
from animama.app.ports.chat_port import ChatRepository
from animama.app.ports.content_catalog import ContentCatalog
from animama.app.ports.content_store import ContentStore
from animama.app.ports.memory_entry_port import MemoryEntryRepository
from animama.app.ports.memory_episode_port import MemoryEpisodeRepository
from animama.app.ports.model_provider_port import ModelProviderRepository
from animama.app.ports.settings_port import AnimaSettingsRepository, UserSettingsRepository
from animama.app.ports.uow_port import UnitOfWork
from animama.app.ports.user_profile_port import UserProfileRepository
from animama.app.safety.crisis_resources import CrisisResourceTable
from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.app.services.anima_runtime_service import AnimaRuntimeService
from animama.app.services.avatar_face_parts_service import AvatarFacePartsService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_export import DownloadLease
from animama.app.services.content_package_service import ContentPackageService
from animama.app.services.content_save_service import ContentSaveService
from animama.app.services.embedding_refresh_service import EmbeddingRefreshStatus
from animama.app.services.memory_manager_service import MemoryManagerService
from animama.app.services.model_provider_catalog_service import ModelCatalogPolicy
from animama.app.services.model_role_resolver import ModelRoleDefaults, ModelRoleResolver
from animama.app.services.typed_content_service import TypedContentService
from animama.domain.content_catalog import VerifiedContentFile
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.principal import get_current_principal


class ProductRepositories(Protocol):
    """Repositories over one owner session; families add theirs as they move."""

    @property
    def animas(self) -> AnimaRepository: ...

    @property
    def anima_chat_profiles(self) -> AnimaChatProfileRepository: ...

    @property
    def anima_presentations(self) -> AnimaPresentationRepository: ...

    @property
    def model_providers(self) -> ModelProviderRepository:
        """The composition's model catalog, which an Anima's chat model must name."""
        ...

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
    def avatars(self) -> AvatarRepository: ...

    @property
    def content_catalog(self) -> ContentCatalog:
        """The owner's view of the content catalog, without content stores."""
        ...

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
class ProductContent:
    """Content services for one owner over one session.

    A composition builds them on the session its ports opened and may release
    resources when the request ends.
    """

    catalog: ContentCatalogService
    saves: ContentSaveService
    typed: TypedContentService
    face_parts: AvatarFacePartsService
    packages: ContentPackageService
    store: ContentStore
    runtime: AnimaRuntimeService


@dataclass(frozen=True)
class ProductPolicy:
    """Owner limits a composition enforces on the shared routes."""

    memory_file_max_bytes: int


class ProductPorts(Protocol):
    """The composition-owned collaborators of shared product handlers.

    Shared dependencies call the synchronous members (``policy``,
    ``model_catalog_policy``, ``model_role_defaults``, ``repositories``,
    ``content``, ``file_response``, ``download_response``, ``crisis_resources``
    and ``user_settings_changed``) on the event loop, so they must not block.
    """

    @property
    def policy(self) -> ProductPolicy: ...

    @property
    def model_catalog_policy(self) -> ModelCatalogPolicy:
        """Which catalog rows this composition offers, and whether it validates role preferences."""
        ...

    @property
    def model_role_defaults(self) -> ModelRoleDefaults:
        """The operator's row for each model role, used when an owner assigns none."""
        ...

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

    def content(
        self, session: AsyncSession, principal: RequestPrincipal
    ) -> AbstractAsyncContextManager[ProductContent]:
        """Content services for ``principal`` over a session this composition opened.

        Through ``ReadContent`` the context stays open until the response ends, so
        streamed bytes remain readable; ``WriteContent`` ends it with its write
        session. A composition releases its content resources on exit.
        """
        ...

    def file_response(
        self, request: Request, file: VerifiedContentFile, *, if_none_match: str | None, revalidate: bool
    ) -> Response:
        """Deliver verified content bytes under this composition's caching policy.

        ``revalidate`` marks bytes a client may keep and revalidate by ETag; other
        bytes must not be stored. The response owns ``file`` and closes its handle.
        """
        ...

    async def json_response(
        self,
        request: Request,
        body: bytes,
        *,
        encoding: str,
        headers: dict[str, str],
        if_none_match: str | None,
        cacheable: bool,
    ) -> Response:
        """Deliver private runtime JSON under this composition's caching policy.

        ``encoding`` is the negotiated ``gzip`` or ``identity``; ``cacheable`` marks a
        body a client may keep and revalidate by ETag.
        """
        ...

    def download_response(self, request: Request, download: DownloadLease) -> Response:
        """Deliver a sealed package archive; the response owns and releases ``download``."""
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

    async def embedding_refresh_status(
        self, session: AsyncSession, principal: RequestPrincipal, embedding_model_id: str | None
    ) -> EmbeddingRefreshStatus:
        """Whether ``principal``'s stored vectors match the row doing the embeddings role.

        ``embedding_model_id`` is that row, or ``None`` while embeddings are off.
        """
        ...

    async def memory_manager(self, session: AsyncSession, principal: RequestPrincipal) -> MemoryManagerService:
        """``principal``'s Memory Manager over ``session``, on this composition's model runtime.

        A composition may wrap the service's operations with its own admission.
        """
        ...


def install_product_ports(app: FastAPI, ports: ProductPorts) -> None:
    """Install a composition's ports; the annotation lets type checks confirm conformance."""
    app.state.product_ports = ports


async def get_product_ports(request: Request) -> ProductPorts:
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


async def get_read_repositories(
    ports: Annotated[ProductPorts, Depends(get_product_ports)], session: ReadSession
) -> ProductRepositories:
    return ports.repositories(session)


async def get_write_repositories(
    ports: Annotated[ProductPorts, Depends(get_product_ports)], session: WriteSession
) -> ProductRepositories:
    return ports.repositories(session)


# Shared handlers take repositories rather than sessions, so they never build one.
ReadRepositories = Annotated[ProductRepositories, Depends(get_read_repositories)]
WriteRepositories = Annotated[ProductRepositories, Depends(get_write_repositories)]


async def get_read_content(
    ports: Annotated[ProductPorts, Depends(get_product_ports)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: ReadSession,
) -> AsyncIterator[ProductContent]:
    async with ports.content(session, principal) as content:
        yield content


async def get_write_content(
    ports: Annotated[ProductPorts, Depends(get_product_ports)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: WriteSession,
) -> AsyncIterator[ProductContent]:
    async with ports.content(session, principal) as content:
        yield content


# Read content stays open through a streamed body; write content ends with its
# session, before the response is sent.
ReadContent = Annotated[ProductContent, Depends(get_read_content)]
WriteContent = Annotated[ProductContent, Depends(get_write_content, scope="function")]


async def get_product_policy(ports: Annotated[ProductPorts, Depends(get_product_ports)]) -> ProductPolicy:
    return ports.policy


Policy = Annotated[ProductPolicy, Depends(get_product_policy)]


def model_role_resolver(ports: ProductPorts, repositories: ProductRepositories) -> ModelRoleResolver:
    """Resolve model roles from the owner's settings, the composition's catalog and its operator defaults."""

    return ModelRoleResolver(
        model_providers=repositories.model_providers,
        user_settings=repositories.user_settings,
        defaults=ports.model_role_defaults,
        # A composition without owner models applies only its operator defaults.
        owner_roles_enabled=ports.model_catalog_policy.owner_models_enabled,
    )
