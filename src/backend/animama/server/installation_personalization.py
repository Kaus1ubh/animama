"""Atomic local first-run completion and managed profile-memory synchronization."""

from __future__ import annotations

import re
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.companion_safety_repo import SQLAlchemyCompanionSafetyRepository
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

_PREFERRED_NAME_PREFIX = "Preferred name:"
_HEADING_RE = re.compile(r"^#{1,6}\s")
_BASICS_HEADING_RE = re.compile(r"^#{1,6}\s+basics\s*$", re.IGNORECASE)
_MAX_CONFLICT_RETRIES = 3


class InstallationPersonalizationError(RuntimeError):
    """Base class for local personalization state errors."""


class InstallationPrincipalMismatchError(InstallationPersonalizationError):
    """The asserted request owner does not match the local singleton."""


class FirstRunIncompleteError(InstallationPersonalizationError):
    """A normal profile edit was attempted before onboarding completed."""


class AdultConfirmationRequiredError(InstallationPersonalizationError):
    """First run cannot complete without the owner's 18+ confirmation (spec R6)."""


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
        self._safety = SQLAlchemyCompanionSafetyRepository(session)
        self._uow = SQLAlchemyUnitOfWork(session)
        self._before_commit = before_commit

    async def complete_onboarding(
        self,
        *,
        principal_id: str,
        display_name: str | None,
        adult_confirmed: bool,
    ) -> InstallationPersonalizationResult:
        """Complete first run; records the owner's 18+ self-attestation in the same transaction."""

        if not adult_confirmed:
            raise AdultConfirmationRequiredError("first run requires confirming the owner is 18 or older")
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
                is_adult = await self._safety.get_age_status(principal_id) == "adult"
                if complete_first_run and completed_at is not None and has_name and is_adult:
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
                    normalized_path=PROFILE_MEMORY_PATH.casefold(),
                    type=MEMORY_ENTRY_TYPE_FILE,
                )
                if complete_first_run and entry is None:
                    raise InstallationBootstrapIncompleteError("bootstrap profile memory is missing")
                if entry is not None and _is_bootstrap_managed(entry):
                    await self._update_managed_memory(
                        principal_id=principal_id,
                        entry=entry,
                        display_name=display_name,
                    )

                if profile.display_name != display_name:
                    await self._profiles.update_profile(replace(profile, display_name=display_name))

                if complete_first_run and not is_adult:
                    await self._safety.record_age_status(
                        principal_id, status="adult", source="self_attestation", recorded_at=datetime.now(UTC)
                    )
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
        content = with_preferred_name(entry.content or "", display_name)
        if content == entry.content:
            return
        metadata = dict(entry.metadata or {})
        metadata["installation_bootstrap"] = {
            **(metadata.get("installation_bootstrap") or {}),
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


def with_preferred_name(content: str, display_name: str | None) -> str:
    """Set, replace or remove the managed ``Preferred name:`` line in any profile text.

    An existing line is updated in place. A new line goes under a ``Basics``
    heading when there is one, otherwise under the first heading, otherwise at
    the top, so the result does not depend on the bootstrap template's wording.
    """

    lines = content.splitlines(keepends=True)
    existing = next((i for i, line in enumerate(lines) if line.startswith(_PREFERRED_NAME_PREFIX)), None)
    if not display_name:
        if existing is not None:
            del lines[existing]
        return "".join(lines)
    name_line = f"{_PREFERRED_NAME_PREFIX} {display_name}\n"
    if existing is not None:
        lines[existing] = name_line
        return "".join(lines)
    headings = [i for i, line in enumerate(lines) if _HEADING_RE.match(line)]
    basics = next((i for i in headings if _BASICS_HEADING_RE.match(lines[i].rstrip("\n"))), None)
    anchor = basics if basics is not None else (headings[0] if headings else None)
    if anchor is None:
        return name_line + content
    if not lines[anchor].endswith("\n"):
        lines[anchor] += "\n"
    lines.insert(anchor + 1, name_line)
    return "".join(lines)


def _is_bootstrap_managed(entry: MemoryEntry) -> bool:
    """A profile stays managed until any other write moves it past the last managed version."""

    bootstrap = (entry.metadata or {}).get("installation_bootstrap")
    return isinstance(bootstrap, dict) and bootstrap.get("managed_entry_version") == entry.version


__all__ = [
    "FirstRunIncompleteError",
    "InstallationBootstrapIncompleteError",
    "InstallationPersonalizationResult",
    "InstallationPersonalizationService",
    "InstallationPrincipalMismatchError",
    "with_preferred_name",
]
