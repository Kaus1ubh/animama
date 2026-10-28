"""SQLAlchemy adapter for the migration-seeded installation singleton."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import select, update
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

from .installation_model import ORMEpisodeProcessingSettings, ORMInstallationSettings
from .installation_port import InstallationSettingsRepository

# PostgreSQL's undefined_table: a database created before the table was added.
_UNDEFINED_TABLE = "42P01"


class SQLAlchemyInstallationSettingsRepository(InstallationSettingsRepository):
    """Read immutable ownership and flush write-once first-run completion."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_installation_principal_id(self) -> str:
        result = await self._session.execute(
            select(ORMInstallationSettings.installation_principal_id).where(ORMInstallationSettings.id == 1)
        )
        row = result.scalars().one_or_none()
        if row is None:
            raise RuntimeError("installation_settings singleton row is missing; run Alembic migrations")
        return row

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
            .returning(ORMInstallationSettings.id)
        )
        await self._session.flush()
        return result.scalar_one_or_none() is not None


class SQLAlchemyEpisodeProcessingSettingsRepository:
    """Read and store the owner's automatic episode-processing threshold."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get(self, *, user_id: str) -> tuple[int | None, datetime | None]:
        """Return the stored threshold (None for the default, 0 for Off) and when it last changed.

        A database created before this table reads as the defaults, so it keeps running
        until the owner resets it.
        """

        try:
            # A savepoint keeps a missing-table error from aborting the caller's transaction.
            async with self._session.begin_nested():
                row = await self._session.get(ORMEpisodeProcessingSettings, user_id)
        except DBAPIError as exc:
            if getattr(exc.orig, "sqlstate", None) == _UNDEFINED_TABLE:
                return None, None
            raise
        if row is None:
            return None, None
        return row.threshold, row.reset_at

    async def set_threshold(self, *, user_id: str, threshold: int, changed_at: datetime) -> None:
        """Store a threshold; a changed value also records when, which lifts a failure pause."""

        row = await self._session.scalar(
            select(ORMEpisodeProcessingSettings)
            .where(ORMEpisodeProcessingSettings.user_id == user_id)
            .with_for_update()
        )
        if row is None:
            self._session.add(ORMEpisodeProcessingSettings(user_id=user_id, threshold=threshold, reset_at=changed_at))
        elif row.threshold != threshold:
            row.threshold = threshold
            row.reset_at = changed_at
        await self._session.flush()


__all__ = ["SQLAlchemyEpisodeProcessingSettingsRepository", "SQLAlchemyInstallationSettingsRepository"]
