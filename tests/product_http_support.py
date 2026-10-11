"""Test compositions for shared product routes (ADR 0021).

``product_app`` mounts routers with explicit ports and a test-only resolver.
``DeferredCommitPorts`` mimics a consumer's commit authority and refuses writes on
read sessions, and ``TwoOwnerComposition`` serves two owners from one database with
separate roots.
``install_local_ports`` gives local-app tests the local ports on their own session.
Nothing here is installed outside tests.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, cast

from fastapi import APIRouter, FastAPI, HTTPException, Request, Response, WebSocket
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.app.contracts.elevenlabs import (
    PyElevenLabsAudioResponse,
    PyElevenLabsSoundEffectsRequest,
    PyElevenLabsTextToSpeechRequest,
    PyElevenLabsVoice,
)
from animama.app.contracts.runtime_capabilities import RuntimeCapabilities
from animama.app.safety.crisis_resources import CrisisResourceTable, crisis_resource_table
from animama.app.services.content_package_export import DownloadLease
from animama.app.services.content_package_staging import PackageStageService
from animama.app.services.embedding_refresh_service import (
    EMBEDDINGS_STATE_CURRENT,
    EMBEDDINGS_STATE_OFF,
    EmbeddingRefreshStatus,
)
from animama.app.services.memory_manager_service import MemoryManagerService
from animama.app.services.model_provider_catalog_service import ModelCatalogPolicy
from animama.app.services.model_role_resolver import ModelRoleDefaults
from animama.app.services.user_profile_service import UserProfileService
from animama.domain.content_catalog import VerifiedContentFile
from animama.domain.request_principal import RequestPrincipal
from animama.domain.user_profile import UserProfilePatch
from animama.product_http.delivery import PackageDownloadResponse, encoded_json_response, verified_file_response
from animama.product_http.ports import (
    ProductContent,
    ProductPolicy,
    ProductPorts,
    install_product_ports,
    model_role_resolver,
)
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime
from animama.server.memory_manager import local_memory_manager_service
from animama.server.product_ports import LocalProductPorts, local_product_content

OWNER_HEADER = "X-Test-Owner"
# The local default limits and chat model (server/config.py).
TEST_POLICY = ProductPolicy(memory_file_max_bytes=32 * 1024)
TEST_ROLE_DEFAULTS = ModelRoleDefaults(chat="OpenAIResponsesHTTPAgent:gpt-6-luna")
# What a hosted consumer reports; the test doubles report it too.
HOSTED_CAPABILITIES = RuntimeCapabilities.model_validate_json(
    (Path(__file__).resolve().parents[1] / "contracts/runtime-capabilities/hosted.json").read_text()
)


class HeaderOwnerResolver:
    """Test-only: the request names its owner. Never install this outside tests."""

    def _owner(self, owner: str | None) -> RequestPrincipal:
        if not owner:
            raise HTTPException(status_code=401, detail={"code": "test_owner_missing"})
        return RequestPrincipal(id=owner)

    async def resolve_http(self, request: Request) -> RequestPrincipal:
        return self._owner(request.headers.get(OWNER_HEADER))

    async def resolve_websocket(self, websocket: WebSocket) -> RequestPrincipal:
        return self._owner(websocket.headers.get(OWNER_HEADER))


async def save_display_name(session: AsyncSession, principal: RequestPrincipal, display_name: str) -> str:
    """Apply only the shared profile rules, as a composition without local personalization would."""

    repositories = SQLAlchemyProductRepositories(session)
    profile = await UserProfileService(
        profiles=repositories.user_profiles, uow=repositories.unit_of_work
    ).update_profile(user_id=principal.id, patch=UserProfilePatch(display_name=display_name, display_name_set=True))
    assert profile.display_name is not None
    return profile.display_name


@dataclass
class FakeSpeech:
    """Records each speech operation with its owner and arguments; never calls a provider."""

    audio_upload_max_bytes: int = 1024
    calls: list[tuple[str, str, object]] = field(default_factory=list)

    async def clone_voice(
        self,
        principal: RequestPrincipal,
        *,
        name: str,
        files: list[tuple[str, bytes, str]],
        description: str | None,
        remove_background_noise: bool,
    ) -> PyElevenLabsVoice:
        self.calls.append(("clone", principal.id, (name, files, description, remove_background_noise)))
        return PyElevenLabsVoice(voice_id=f"voice-{principal.id}", name=name, labels={"owner_user_id": principal.id})

    async def synthesize_text(
        self, principal: RequestPrincipal, request: PyElevenLabsTextToSpeechRequest
    ) -> PyElevenLabsAudioResponse:
        self.calls.append(("text_to_speech", principal.id, request))
        return PyElevenLabsAudioResponse(audio_base64="", media_type="audio/mpeg", voice_id=request.voice_id)

    async def generate_sound_effect(
        self, principal: RequestPrincipal, request: PyElevenLabsSoundEffectsRequest
    ) -> PyElevenLabsAudioResponse:
        self.calls.append(("sound_effect", principal.id, request))
        return PyElevenLabsAudioResponse(audio_base64="", media_type="audio/mpeg")


class DoubleCollaborators:
    """The non-session collaborators both port doubles share.

    Content comes from a separate local tree per owner under ``content_root``, as a
    consumer keeps each owner's bytes apart; clients never store its bytes or JSON.
    """

    settings_changes: list[str]
    content_root: Path | None
    model_catalog_policy: ModelCatalogPolicy
    model_role_defaults: ModelRoleDefaults
    speech: FakeSpeech

    @asynccontextmanager
    async def content(self, session: AsyncSession, principal: RequestPrincipal) -> AsyncIterator[ProductContent]:
        if self.content_root is None:
            raise AssertionError("pass content_root to serve content routes")
        root = self.content_root / principal.id
        settings = Settings(animama_content_root=root / "content", animama_data_root=root / "data")
        paths = initialize_local_runtime(settings)
        stages = PackageStageService(imports_root=paths.imports_staging_root, exports_root=paths.exports_staging_root)
        yield local_product_content(session, paths, settings, stages)

    def file_response(
        self, request: Request, file: VerifiedContentFile, *, if_none_match: str | None, revalidate: bool
    ) -> Response:
        return verified_file_response(file, if_none_match=if_none_match, cache_control="private, no-store")

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
        return await encoded_json_response(body, encoding=encoding, headers=headers, cacheable=False)

    def download_response(self, request: Request, download: DownloadLease) -> Response:
        return PackageDownloadResponse(download)

    def repositories(self, session: AsyncSession) -> SQLAlchemyProductRepositories:
        return SQLAlchemyProductRepositories(session)

    async def update_display_name(self, session: AsyncSession, principal: RequestPrincipal, display_name: str) -> str:
        return await save_display_name(session, principal, display_name)

    def crisis_resources(self) -> CrisisResourceTable:
        return crisis_resource_table()

    async def runtime_capabilities(self, session: AsyncSession, principal: RequestPrincipal) -> RuntimeCapabilities:
        return HOSTED_CAPABILITIES

    def user_settings_changed(self, principal: RequestPrincipal) -> None:
        self.settings_changes.append(principal.id)

    async def embedding_refresh_status(
        self, session: AsyncSession, principal: RequestPrincipal, embedding_model_id: str | None
    ) -> EmbeddingRefreshStatus:
        # These compositions keep no vectors, so any embeddings role is current.
        state = EMBEDDINGS_STATE_OFF if embedding_model_id is None else EMBEDDINGS_STATE_CURRENT
        return EmbeddingRefreshStatus(state=state)

    async def memory_manager(self, session: AsyncSession, principal: RequestPrincipal) -> MemoryManagerService:
        # The model-free runtime drafts an approval for any message naming a markdown path.
        return await local_memory_manager_service(
            session,
            principal.id,
            roles=model_role_resolver(cast(ProductPorts, self), self.repositories(session)),
            runtime_settings=Settings(anima_memory_file_max_bytes=TEST_POLICY.memory_file_max_bytes),
            llm_skip=True,
        )


@dataclass
class DeferredCommitPorts(DoubleCollaborators):
    """Ports whose write sessions defer handler commits to the session's end.

    A handler's ``session.commit()`` only flushes. When the session ends after the
    handler returned, the composition commits if the handler asked to and rolls back
    otherwise; it also rolls back if the handler raised. This is the commit authority
    a hosted consumer keeps (for example to settle metering first). Limits: changes
    made after the last requested commit are committed with it, and
    ``session.begin()`` after a deferred commit fails because a transaction is open.
    Read sessions refuse to flush or commit, so a route classified ``read`` that
    writes fails its test. Each opened session records its owner in ``owners``.
    """

    session_factory: async_sessionmaker[AsyncSession]
    policy: ProductPolicy = field(default_factory=lambda: TEST_POLICY)
    model_catalog_policy: ModelCatalogPolicy = field(default_factory=ModelCatalogPolicy)
    model_role_defaults: ModelRoleDefaults = field(default_factory=lambda: TEST_ROLE_DEFAULTS)
    speech: FakeSpeech = field(default_factory=FakeSpeech)
    commits_requested: int = 0
    commits: int = 0
    rollbacks: int = 0
    owners: list[str] = field(default_factory=list)
    settings_changes: list[str] = field(default_factory=list)
    content_root: Path | None = None

    @asynccontextmanager
    async def read_session(self, principal: RequestPrincipal) -> AsyncIterator[AsyncSession]:
        self.owners.append(principal.id)
        async with self.session_factory() as session:

            def refuse_flush(*_: object) -> None:
                raise AssertionError("a read session flushed changes")

            async def refuse_commit() -> None:
                raise AssertionError("a read session committed")

            event.listen(session.sync_session, "before_flush", refuse_flush)
            session.commit = refuse_commit  # type: ignore[method-assign]
            yield session

    @asynccontextmanager
    async def write_session(self, principal: RequestPrincipal) -> AsyncIterator[AsyncSession]:
        self.owners.append(principal.id)
        async with self.session_factory() as session:
            commit = session.commit
            requested = False

            async def deferred_commit() -> None:
                nonlocal requested
                requested = True
                self.commits_requested += 1
                await session.flush()

            session.commit = deferred_commit  # type: ignore[method-assign]
            try:
                yield session
            except BaseException:
                await session.rollback()
                self.rollbacks += 1
                raise
            if requested:
                await commit()
                self.commits += 1
            else:
                await session.rollback()
                self.rollbacks += 1


@dataclass
class SessionPorts(DoubleCollaborators):
    """Ports that hand every shared route one existing session.

    For tests that mount shared routers beside local routers sharing one test session.
    """

    session: AsyncSession
    policy: ProductPolicy = field(default_factory=lambda: TEST_POLICY)
    model_catalog_policy: ModelCatalogPolicy = field(default_factory=ModelCatalogPolicy)
    model_role_defaults: ModelRoleDefaults = field(default_factory=lambda: TEST_ROLE_DEFAULTS)
    speech: FakeSpeech = field(default_factory=FakeSpeech)
    settings_changes: list[str] = field(default_factory=list)
    content_root: Path | None = None

    @asynccontextmanager
    async def read_session(self, principal: RequestPrincipal) -> AsyncIterator[AsyncSession]:
        yield self.session

    write_session = read_session


def install_local_ports(app: FastAPI, session: AsyncSession) -> None:
    """Serve shared routes through the local composition's ports, on one test session.

    For local-app tests that need local behavior from a shared route (personalization,
    the local crisis table or capability report) beside local routes on that session.
    """

    @asynccontextmanager
    async def session_factory() -> AsyncIterator[AsyncSession]:
        yield session

    app.state.session_factory = session_factory
    install_product_ports(app, LocalProductPorts(app))


def local_ports(*, policy: ModelCatalogPolicy | None = None) -> LocalProductPorts:
    """The local composition's ports for direct handler calls that pass their own session.

    The policy defaults to the local one (owner models and roles); runtime settings are the process's.
    """

    app = FastAPI()
    app.state.model_catalog_policy = policy or ModelCatalogPolicy.local()
    return LocalProductPorts(app)


def product_app(*routers: APIRouter, ports: ProductPorts | None, resolver: Any = None) -> FastAPI:
    """A bare app mounting shared routers with explicit ports and resolver."""

    app = FastAPI()
    app.state.request_principal_resolver = resolver or HeaderOwnerResolver()
    if ports is not None:
        install_product_ports(app, ports)
    for router in routers:
        app.include_router(router)
    return app


@dataclass
class TwoOwnerComposition:
    """Two owners served by one app and one database, each with its own root."""

    app: FastAPI
    root: Path
    owners: tuple[str, str] = ("owner-a", "owner-b")
    roots: dict[str, Path] = field(init=False)

    def __post_init__(self) -> None:
        self.roots = {}
        for owner in self.owners:
            self.roots[owner] = self.root / owner
            self.roots[owner].mkdir(parents=True)

    def client(self, owner: str) -> AsyncClient:
        """A client whose requests resolve to ``owner``, on the test's event loop."""

        return AsyncClient(transport=ASGITransport(app=self.app), base_url="http://test", headers={OWNER_HEADER: owner})
