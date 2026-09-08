"""Persistence boundary for installation-wide local settings."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol


class InstallationSettingsRepository(Protocol):
    """Read the migration-seeded installation principal and first-run state."""

    async def get_installation_principal_id(self) -> str:
        raise NotImplementedError

    async def get_first_run_completed_at(self) -> datetime | None:
        raise NotImplementedError

    async def complete_first_run(self, *, completed_at: datetime) -> bool:
        raise NotImplementedError


__all__ = ["InstallationSettingsRepository"]
