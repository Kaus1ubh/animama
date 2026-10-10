"""The local composition's ports for the shared product routes (ADR 0021)."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request, Response
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.avatar_face_part_override_repo import (
    SQLAlchemyAvatarFacePartOverrideRepository,
)
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.contracts.runtime_capabilities import RuntimeCapabilities
from animama.app.safety.crisis_resources import CrisisResourceTable
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.anima_runtime_service import AnimaRuntimeService
from animama.app.services.avatar_face_parts_service import AvatarFacePartsService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService
from animama.app.services.content_save_service import ContentSaveService
from animama.app.services.typed_content_service import TypedContentService
from animama.domain.content_catalog import VerifiedContentFile
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.delivery import verified_file_response
from animama.product_http.ports import ProductContent, ProductPolicy, ProductRefusal
from animama.server.companion_safety import runtime_crisis_resources
from animama.server.config import Settings
from animama.server.deps import get_async_session_factory
from animama.server.embedding_refresh import wake_embedding_refresh
from animama.server.installation_personalization import (
    FirstRunIncompleteError,
    InstallationPersonalizationService,
    InstallationPrincipalMismatchError,
)
from animama.server.local_runtime import LocalRuntimePaths
from animama.server.runtime_capabilities import local_runtime_capabilities, runtime_settings_for


def local_product_content(session: AsyncSession, paths: LocalRuntimePaths, settings: Settings) -> ProductContent:
    """Build the local content services over ``session`` and existing runtime paths.

    Nothing here creates directories: startup prepared ``paths``.
    """

    store = FilesystemContentStore(
        included_root=paths.included_root,
        included_sources=paths.included_sources,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )
    catalog = SQLAlchemyContentCatalog(session)
    content = ContentCatalogService(store=store, catalog=catalog)
    saves = ContentSaveService(content=content)
    overrides = SQLAlchemyAvatarFacePartOverrideRepository(session)
    packages = ContentPackageService(
        content=content,
        exports_root=paths.exports_staging_root,
        imports_root=paths.imports_staging_root,
        anima_sources=AnimaPackageSourceService(
            catalog=content.mutations.catalog,
            sources=SQLAlchemyAnimaPackageSourceRepository(session),
            max_identity_bytes=settings.anima_memory_file_max_bytes,
        ),
        profiles=SQLAlchemyUserProfileRepository(session),
        uow=SQLAlchemyAnimaAggregateUnitOfWork(session),
        default_model_provider_id=settings.anima_default_model_provider_id,
        max_identity_bytes=settings.anima_memory_file_max_bytes,
        face_part_overrides=overrides,
    )
    return ProductContent(
        catalog=content,
        saves=saves,
        typed=TypedContentService(catalog=catalog, content=content),
        face_parts=AvatarFacePartsService(
            catalog=catalog, overrides=overrides, store=store, saves=saves, commit=session.commit
        ),
        packages=packages,
        store=store,
        runtime=AnimaRuntimeService(session, store=store),
    )


def local_file_response(file: VerifiedContentFile, *, if_none_match: str | None, revalidate: bool) -> Response:
    """The local policy: private bytes revalidated by ETag, or never stored; no Range or HEAD."""

    cache_control = "private, no-cache" if revalidate else "private, no-store"
    return verified_file_response(file, if_none_match=if_none_match, cache_control=cache_control)


class LocalProductPorts:
    """Serve shared routes from the local app's own database resources.

    Construction performs no IO: each session resolves the app's lazily created
    factory when it opens. The installation has one owner, so sessions do not vary
    by principal, and local handlers' commits take effect immediately.
    """

    def __init__(self, app: FastAPI) -> None:
        self._app = app

    @property
    def policy(self) -> ProductPolicy:
        # The app's own runtime settings, read per request like the sessions.
        settings = runtime_settings_for(self._app)
        return ProductPolicy(memory_file_max_bytes=settings.anima_memory_file_max_bytes)

    @asynccontextmanager
    async def read_session(self, principal: RequestPrincipal) -> AsyncIterator[AsyncSession]:
        async with get_async_session_factory(self._app)() as session:
            yield session

    write_session = read_session

    def repositories(self, session: AsyncSession) -> SQLAlchemyProductRepositories:
        return SQLAlchemyProductRepositories(session)

    @asynccontextmanager
    async def content(self, session: AsyncSession, principal: RequestPrincipal) -> AsyncIterator[ProductContent]:
        # Startup prepares the runtime paths; a request never creates them.
        paths = getattr(self._app.state, "local_runtime_paths", None)
        if not isinstance(paths, LocalRuntimePaths):
            raise HTTPException(status_code=503, detail={"code": "content_unavailable"})
        yield local_product_content(session, paths, runtime_settings_for(self._app))

    def file_response(
        self, request: Request, file: VerifiedContentFile, *, if_none_match: str | None, revalidate: bool
    ) -> Response:
        return local_file_response(file, if_none_match=if_none_match, revalidate=revalidate)

    async def update_display_name(self, session: AsyncSession, principal: RequestPrincipal, display_name: str) -> str:
        # The installation owner's name also personalizes its memory files.
        try:
            result = await InstallationPersonalizationService(session).update_display_name(
                principal_id=principal.id, display_name=display_name
            )
        except FirstRunIncompleteError as exc:
            raise ProductRefusal(409, "first_run_incomplete") from exc
        except InstallationPrincipalMismatchError as exc:
            raise ProductRefusal(403, "installation_principal_mismatch") from exc
        return result.display_name

    def crisis_resources(self) -> CrisisResourceTable:
        # The packaged table, or an operator-supplied one (ANIMAMA_CRISIS_RESOURCES_PATH).
        return runtime_crisis_resources(runtime_settings_for(self._app))

    async def runtime_capabilities(self, session: AsyncSession, principal: RequestPrincipal) -> RuntimeCapabilities:
        return await local_runtime_capabilities(self._app, session)

    def user_settings_changed(self, principal: RequestPrincipal) -> None:
        # The embeddings role may have changed; re-check stored vectors now.
        wake_embedding_refresh(self._app)
