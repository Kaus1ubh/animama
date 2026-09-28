"""Local composition for the migration-owned installation principal and defaults."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_creation_repo import SQLAlchemyAnimaCreationRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.owner_profile_bootstrap import SQLAlchemyOwnerProfileBootstrapAdapter
from animama.adapters.repositories.sqlalchemy.settings_repo import SQLAlchemyUserSettingsRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.services.anima_creation_service import AnimaCreationService
from animama.app.services.anima_creation_sources import AnimaCreationSources
from animama.app.services.anima_starter_service import STARTER_ANIMA_SPECS, AnimaStarterService
from animama.app.services.owner_bootstrap_service import (
    OwnerBootstrapPolicy,
    OwnerBootstrapService,
)
from animama.local.installation_principal import InstallationPrincipalService
from animama.local.installation_repository import SQLAlchemyInstallationSettingsRepository
from animama.logging_config import get_logger
from animama.server.config import Settings
from animama.server.content_startup import rescan_content_once
from animama.server.local_runtime import LocalRuntimePaths

_log = get_logger("server.local_installation_bootstrap")

LOCAL_OWNER_BOOTSTRAP_POLICY = OwnerBootstrapPolicy(
    profile_template_version="2",
    starter_anima_ids=tuple(spec.id for spec in STARTER_ANIMA_SPECS),
)


@dataclass(frozen=True, slots=True)
class LocalBootstrapState:
    """Current bounded status for the local installation bootstrap."""

    principal_id: str
    failed_steps: tuple[str, ...]
    content_ready: bool = True

    @property
    def status(self) -> str:
        return "ready" if not self.failed_steps else "repair_required"


OwnerServiceFactory = Callable[[AsyncSession], OwnerBootstrapService]
ContentReconciler = Callable[[str], Awaitable[None]]


class LocalInstallationBootstrapService:
    """Resolve one local owner, reconcile content, and ensure owner defaults."""

    def __init__(
        self,
        *,
        session_factory: async_sessionmaker[AsyncSession],
        owner_service_factory: OwnerServiceFactory,
        reconcile_content: ContentReconciler,
        policy: OwnerBootstrapPolicy = LOCAL_OWNER_BOOTSTRAP_POLICY,
    ) -> None:
        self._session_factory = session_factory
        self._owner_service_factory = owner_service_factory
        self._reconcile_content = reconcile_content
        self._policy = policy
        self._lock = asyncio.Lock()
        self._state: LocalBootstrapState | None = None

    @property
    def state(self) -> LocalBootstrapState | None:
        return self._state

    async def require_principal(self) -> str:
        async with self._session_factory() as session:
            repository = SQLAlchemyInstallationSettingsRepository(session)
            return await InstallationPrincipalService(repository).require_principal()

    async def ensure(self) -> LocalBootstrapState:
        """Serialize retries and retain only safe step identifiers."""

        async with self._lock:
            principal_id = await self.require_principal()
            reconciliation_failed = False
            try:
                await self._reconcile_content(principal_id)
            except Exception as exc:
                reconciliation_failed = True
                _log.warning(
                    "Local content reconciliation failed during bootstrap",
                    error_type=type(exc).__name__,
                )

            async with self._session_factory() as session:
                result = await self._owner_service_factory(session).ensure(
                    owner_id=principal_id,
                    policy=self._policy,
                )
            failed_steps = result.failed_steps
            if reconciliation_failed and "starter_animas" not in failed_steps:
                failed_steps = (*failed_steps, "starter_animas")
            self._state = LocalBootstrapState(
                principal_id=principal_id, failed_steps=failed_steps, content_ready=not reconciliation_failed
            )
            return self._state


def create_local_installation_bootstrap_service(
    *,
    session_factory: async_sessionmaker[AsyncSession],
    paths: LocalRuntimePaths,
    settings: Settings,
) -> LocalInstallationBootstrapService:
    """Assemble local SQLAlchemy/filesystem adapters behind neutral owner seams."""

    store = FilesystemContentStore(
        included_root=paths.included_root,
        included_sources=paths.included_sources,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )

    def owner_service(session: AsyncSession) -> OwnerBootstrapService:
        aggregate_uow = SQLAlchemyAnimaAggregateUnitOfWork(session)
        creation = AnimaCreationService(
            uow=aggregate_uow,
            receipts=SQLAlchemyAnimaCreationRepository(session),
            sources=AnimaCreationSources(
                catalog=SQLAlchemyContentCatalog(session),
                store=store,
                max_identity_bytes=settings.anima_memory_file_max_bytes,
            ),
            default_model_provider_id=settings.anima_default_model_provider_id,
        )
        return OwnerBootstrapService(
            profiles=SQLAlchemyOwnerProfileBootstrapAdapter(SQLAlchemyUserProfileRepository(session)),
            user_settings=SQLAlchemyUserSettingsRepository(session),
            memory_entries=SQLAlchemyMemoryEntryRepository(session),
            starters=AnimaStarterService(creation),
            uow=SQLAlchemyUnitOfWork(session),
        )

    async def reconcile(owner_id: str) -> None:
        await rescan_content_once(paths, owner_id=owner_id, session_factory=session_factory)

    return LocalInstallationBootstrapService(
        session_factory=session_factory,
        owner_service_factory=owner_service,
        reconcile_content=reconcile,
    )


__all__ = [
    "LOCAL_OWNER_BOOTSTRAP_POLICY",
    "LocalBootstrapState",
    "LocalInstallationBootstrapService",
    "create_local_installation_bootstrap_service",
]
