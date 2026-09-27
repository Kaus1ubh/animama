"""Reusable owner-scoped bootstrap without installation or request knowledge."""

from __future__ import annotations

from collections.abc import Awaitable
from dataclasses import dataclass
from typing import Any, Protocol

from animama.app.anima_creation_contract import EnsureAnimaStartersRequest
from animama.app.ports.memory_entry_port import MemoryEntryRepository
from animama.app.ports.owner_profile_bootstrap_port import OwnerProfileBootstrapPort
from animama.app.ports.settings_port import UserSettingsRepository
from animama.app.ports.uow_port import UnitOfWork
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE
from animama.domain.settings import UserSettings

PROFILE_MEMORY_PATH = "PROFILE.md"
PROFILE_MEMORY_KIND = "user_profile"
# Who the user is, shared by every Anima. Each hint line is replaced by the owner.
PROFILE_TEMPLATE_V2 = """# About me

## Basics
Preferred name, pronouns, languages, location or time zone.

## Life right now
Work or study, home, and what this chapter of life looks like.

## People
The people and pets who matter to me.

## Interests
Hobbies, favorite media, food and things I'm into.

## Goals
What I'm working toward or hoping for.

## Routines
My usual daily or weekly rhythm.

## How I like to be treated
Tone, humor, directness, reply length and topics to avoid.
"""

BOOTSTRAP_STEPS = ("local_profile", "user_settings", "profile_memory", "starter_animas")


@dataclass(frozen=True, slots=True)
class OwnerBootstrapPolicy:
    """Select owner defaults without referring to a deployment composition."""

    profile_template_version: str
    starter_anima_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class OwnerBootstrapResult:
    """Bounded bootstrap status safe to expose through local runtime context."""

    failed_steps: tuple[str, ...] = ()

    @property
    def ready(self) -> bool:
        return not self.failed_steps


class OwnerStarterBootstrap(Protocol):
    async def ensure(self, *, user_id: str, request: EnsureAnimaStartersRequest) -> dict[str, Any]:
        raise NotImplementedError


class OwnerBootstrapService:
    """Create each missing owner default while preserving every existing value."""

    def __init__(
        self,
        *,
        profiles: OwnerProfileBootstrapPort,
        user_settings: UserSettingsRepository,
        memory_entries: MemoryEntryRepository,
        starters: OwnerStarterBootstrap,
        uow: UnitOfWork,
    ) -> None:
        self._profiles = profiles
        self._user_settings = user_settings
        self._memory_entries = memory_entries
        self._starters = starters
        self._uow = uow

    async def ensure(self, *, owner_id: str, policy: OwnerBootstrapPolicy) -> OwnerBootstrapResult:
        """Run isolated retry-safe steps and report only their stable identifiers."""

        failed: list[str] = []
        await self._run_step("local_profile", self._ensure_profile(owner_id), failed)
        await self._run_step("user_settings", self._ensure_settings(owner_id), failed)
        await self._run_step("profile_memory", self._ensure_profile_memory(owner_id, policy), failed)
        await self._run_step("starter_animas", self._ensure_starters(owner_id, policy), failed)
        return OwnerBootstrapResult(tuple(failed))

    async def _run_step(self, name: str, operation: Awaitable[None], failed: list[str]) -> None:
        try:
            await operation
            await self._uow.commit()
        except Exception:
            await self._uow.rollback()
            failed.append(name)

    async def _ensure_profile(self, owner_id: str) -> None:
        await self._profiles.ensure(owner_id=owner_id)

    async def _ensure_settings(self, owner_id: str) -> None:
        if await self._user_settings.get(owner_id) is None:
            await self._user_settings.upsert(UserSettings(user_id=owner_id))

    async def _ensure_profile_memory(self, owner_id: str, policy: OwnerBootstrapPolicy) -> None:
        existing = await self._memory_entries.get_entry_by_path(
            user_id=owner_id,
            anima_id=None,
            normalized_path=PROFILE_MEMORY_PATH.casefold(),
            type=MEMORY_ENTRY_TYPE_FILE,
        )
        if existing is not None:
            return
        memory = MemoryEntryService(
            memory_entries=self._memory_entries,
            uow=self._uow,
            commit_on_write=False,
        )
        await memory.put_file_by_path(
            user_id=owner_id,
            path=PROFILE_MEMORY_PATH,
            content=_profile_template(policy.profile_template_version),
            kind=PROFILE_MEMORY_KIND,
            description="Private installation-owner profile",
            metadata={
                "installation_bootstrap": {
                    "template_version": policy.profile_template_version,
                    "managed_entry_version": 1,
                }
            },
            change_metadata={"source_type": "installation_bootstrap"},
            expected_version=0,
        )

    async def _ensure_starters(self, owner_id: str, policy: OwnerBootstrapPolicy) -> None:
        if not policy.starter_anima_ids:
            return
        result = await self._starters.ensure(
            user_id=owner_id,
            request=EnsureAnimaStartersRequest(schema_version=1, repairs=[]),
        )
        configured = tuple(item.get("starter_id") for item in result.get("starters", ()))
        if configured != policy.starter_anima_ids or not result.get("complete"):
            raise RuntimeError("configured starter Animas require repair")


def _profile_template(version: str) -> str:
    if version != "2":
        raise ValueError(f"unsupported profile template version: {version}")
    return PROFILE_TEMPLATE_V2


__all__ = [
    "BOOTSTRAP_STEPS",
    "OwnerBootstrapPolicy",
    "OwnerBootstrapResult",
    "OwnerBootstrapService",
    "OwnerStarterBootstrap",
    "PROFILE_MEMORY_KIND",
    "PROFILE_MEMORY_PATH",
    "PROFILE_TEMPLATE_V2",
]
