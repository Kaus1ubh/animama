"""SQLAlchemy adapter for the migration-seeded installation singleton."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from .installation_model import ORMInstallationSettings
from .installation_port import InstallationSettingsRepository


class SQLAlchemyInstallationSettingsRepository(InstallationSettingsRepository):
    """Read immutable ownership and flush write-once first-run completion."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_installation_principal_id(self) -> str:
        result = await self._session.execute(
            select(ORMInstallationSettings.installation_principal_id).where(ORMInstallationSettings.id == 1)
        )
        row = result.one_or_none()
        if row is None:
            raise RuntimeError("installation_settings singleton row is missing; run Alembic migrations")
        return row[0]

    async def get_first_run_completed_at(self) -> datetime | None:
        row = await self._session.get(ORMInstallationSettings, 1)
        if row is None:
            raise RuntimeError("installation_settings singleton row is missing; run Alembic migrations")
        return row.first_run_completed_at

    async def lock(self) -> ORMInstallationSettings:
        """Lock and return the singleton for a caller-owned transaction."""

        row = await self._session.scalar(
            select(ORMInstallationSettings).where(ORMInstallationSettings.id == 1).with_for_update()
        )
        if row is None:
            raise RuntimeError("installation_settings singleton row is missing; run Alembic migrations")
        return row

    async def complete_first_run(self, *, completed_at: datetime) -> bool:
        result = await self._session.execute(
            update(ORMInstallationSettings)
            .where(ORMInstallationSettings.id == 1, ORMInstallationSettings.first_run_completed_at.is_(None))
            .values(first_run_completed_at=completed_at)
        )
        await self._session.flush()
        return bool(result.rowcount)


__all__ = ["SQLAlchemyInstallationSettingsRepository"]
