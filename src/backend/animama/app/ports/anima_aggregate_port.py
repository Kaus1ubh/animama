"""Caller-owned transaction and typed composition contract for Anima creation."""

from __future__ import annotations

from typing import Protocol

from animama.domain.anima_creation import ResolvedAnimaSpec

from .anima_chat_profile_port import AnimaChatProfileRepository
from .anima_port import AnimaRepository
from .avatar_port import AvatarRepository
from .memory_entry_port import MemoryEntryRepository
from .model_provider_port import ModelProviderRepository
from .settings_port import AnimaSettingsRepository
from .uow_port import UnitOfWork


class AnimaLoadoutComposer(Protocol):
    """Compose Revision 1 without running a separately committed equip command."""

    async def initialize(self, *, user_id: str, anima_id: str, spec: ResolvedAnimaSpec) -> None: ...


class AnimaAggregateUnitOfWork(UnitOfWork, Protocol):
    """Every collaborator participates in the caller's one database transaction."""

    animas: AnimaRepository
    avatars: AvatarRepository
    memory_entries: MemoryEntryRepository
    model_providers: ModelProviderRepository
    chat_profiles: AnimaChatProfileRepository
    settings: AnimaSettingsRepository
    loadouts: AnimaLoadoutComposer
