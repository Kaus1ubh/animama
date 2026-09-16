"""Atomic local first-run completion and managed profile-memory synchronization."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.services.memory_entry_service import MemoryEntryConflictError, MemoryEntryService
from animama.app.services.owner_bootstrap_service import (
    PROFILE_MEMORY_KIND,
    PROFILE_MEMORY_PATH,
)
from animama.app.services.user_profile_service import normalize_display_name
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE, MemoryEntry
from animama.domain.user_profile import UserProfileNotFoundError
from animama.local.installation_repository import SQLAlchemyInstallationSettingsRepository

PROFILE_TEMPLATE_VERSION = "1"
_MAX_CONFLICT_RETRIES = 3


class InstallationPersonalizationError(RuntimeError):
    """Base class for local personalization state errors."""


class InstallationPrincipalMismatchError(InstallationPersonalizationError):
    """The asserted request owner does not match the local singleton."""


class FirstRunIncompleteError(InstallationPersonalizationError):
    """A normal profile edit was attempted before onboarding completed."""


class InstallationBootstrapIncompleteError(InstallationPersonalizationError):
    """Required local bootstrap state is missing during first-run completion."""


@dataclass(frozen=True, slots=True)
class InstallationPersonalizationResult:
    display_name: str
    first_run_completed_at: datetime


BeforeCommitHook = Callable[[], Awaitable[None]]


class InstallationPersonalizationService:
    """Write profile, managed memory, and first-run state in one transaction."""

    def __init__(self, session: AsyncSession, *, before_commit: BeforeCommitHook | None = None) -> None:
        self._session = session
        self._installations = SQLAlchemyInstallationSettingsRepository(session)
        self._profiles = SQLAlchemyUserProfileRepository(session)
        self._memory_entries = SQLAlchemyMemoryEntryRepository(session)
        self._uow = SQLAlchemyUnitOfWork(session)
        self._before_commit = before_commit

    async def complete_onboarding(
        self,
        *,
        principal_id: str,
        display_name: str | None,
    ) -> InstallationPersonalizationResult:
        normalized = normalize_display_name(display_name)
        return await self._write(principal_id=principal_id, display_name=normalized, complete_first_run=True)

    async def update_display_name(
        self,
        *,
        principal_id: str,
        display_name: str | None,
    ) -> InstallationPersonalizationResult:
        normalized = normalize_display_name(display_name)
        return await self._write(principal_id=principal_id, display_name=normalized, complete_first_run=False)

    async def _write(
        self,
        *,
        principal_id: str,
        display_name: str,
        complete_first_run: bool,
    ) -> InstallationPersonalizationResult:
        for attempt in range(_MAX_CONFLICT_RETRIES):
            try:
                installation = await self._installations.lock()
                if installation.installation_principal_id != principal_id:
                    raise InstallationPrincipalMismatchError("request principal does not own this installation")

                profile = await self._profiles.get_profile(principal_id, for_update=True)
                if profile is None:
                    raise UserProfileNotFoundError

                completed_at = installation.first_run_completed_at
                has_name = bool(profile.display_name and profile.display_name.strip())
                if complete_first_run and completed_at is not None and has_name:
                    # Named completion replays are read-only. An earlier Skip
                    # may still supply its required name without rekeying data.
                    await self._session.rollback()
                    assert profile.display_name is not None
                    return InstallationPersonalizationResult(profile.display_name, completed_at)
                if not complete_first_run and completed_at is None:
                    raise FirstRunIncompleteError("first run is not complete")

                entry = await self._memory_entries.get_entry_by_path_for_update(
                    user_id=principal_id,
                    anima_id=None,
                    normalized_path=PROFILE_MEMORY_PATH,
                    type=MEMORY_ENTRY_TYPE_FILE,
                )
                if complete_first_run and entry is None:
                    raise InstallationBootstrapIncompleteError("bootstrap profile memory is missing")
                if entry is not None and _is_bootstrap_managed(entry, current_display_name=profile.display_name):
                    await self._update_managed_memory(
                        principal_id=principal_id,
                        entry=entry,
                        display_name=display_name,
                    )

                if profile.display_name != display_name:
                    await self._profiles.update_profile(replace(profile, display_name=display_name))

                if complete_first_run and completed_at is None:
                    completed_at = datetime.now(UTC)
                    await self._installations.complete_first_run(completed_at=completed_at)
                assert completed_at is not None

                if self._before_commit is not None:
                    await self._before_commit()
                await self._uow.commit()
                return InstallationPersonalizationResult(display_name, completed_at)
            except MemoryEntryConflictError:
                await self._uow.rollback()
                if attempt + 1 == _MAX_CONFLICT_RETRIES:
                    raise
            except Exception:
                await self._uow.rollback()
                raise
        raise AssertionError("unreachable personalization retry state")

    async def _update_managed_memory(
        self,
        *,
        principal_id: str,
        entry: MemoryEntry,
        display_name: str | None,
    ) -> None:
        content = render_profile_document(display_name)
        if content == entry.content:
            return
        metadata = dict(entry.metadata or {})
        metadata["installation_bootstrap"] = {
            "template_version": PROFILE_TEMPLATE_VERSION,
            "managed_entry_version": entry.version + 1,
        }
        memory = MemoryEntryService(
            memory_entries=self._memory_entries,
            uow=self._uow,
            commit_on_write=False,
        )
        await memory.put_file_by_path(
            user_id=principal_id,
            path=PROFILE_MEMORY_PATH,
            content=content,
            kind=entry.kind or PROFILE_MEMORY_KIND,
            description=entry.description,
            metadata=metadata,
            change_metadata={"source_type": "installation_personalization"},
            expected_version=entry.version,
        )


def render_profile_document(display_name: str | None) -> str:
    """Render the one managed preferred-name line in template version 1."""

    suffix = f" {display_name}" if display_name else ""
    return (
        "# About Me\n\n"
        f"Preferred name:{suffix}\n\n"
        "Add anything you would like your Animas to remember about you here.\n"
    )


def _is_bootstrap_managed(entry: MemoryEntry, *, current_display_name: str | None) -> bool:
    bootstrap = (entry.metadata or {}).get("installation_bootstrap")
    return (
        isinstance(bootstrap, dict)
        and bootstrap.get("template_version") == PROFILE_TEMPLATE_VERSION
        and bootstrap.get("managed_entry_version") == entry.version
        and entry.content == render_profile_document(current_display_name)
    )


__all__ = [
    "FirstRunIncompleteError",
    "InstallationBootstrapIncompleteError",
    "InstallationPersonalizationResult",
    "InstallationPersonalizationService",
    "InstallationPrincipalMismatchError",
    "render_profile_document",
]
