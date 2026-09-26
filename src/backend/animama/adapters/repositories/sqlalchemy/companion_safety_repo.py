"""SQLAlchemy access to per-owner companion-safety state."""

from __future__ import annotations

from datetime import datetime
from typing import cast

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.safety.age import AgeStatus, AgeStatusSource
from animama.app.safety.ai_notice import AiNoticeState
from animama.orm.companion_safety import ORMCompanionSafetyState


class SQLAlchemyCompanionSafetyRepository:
    """Caller-owned transactions; rows are created lazily per owner."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def lock(self, user_id: str) -> ORMCompanionSafetyState:
        """Ensure and row-lock the owner's state for a caller-owned transaction."""

        await self._session.execute(
            insert(ORMCompanionSafetyState).values(user_id=user_id).on_conflict_do_nothing(index_elements=["user_id"])
        )
        row = await self._session.scalar(
            select(ORMCompanionSafetyState)
            .where(ORMCompanionSafetyState.user_id == user_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        assert row is not None
        return row

    async def get_age_status(self, user_id: str) -> AgeStatus:
        status = await self._session.scalar(
            select(ORMCompanionSafetyState.age_status).where(ORMCompanionSafetyState.user_id == user_id)
        )
        return cast(AgeStatus, status or "unknown")

    async def record_age_status(
        self, user_id: str, *, status: AgeStatus, source: AgeStatusSource, recorded_at: datetime
    ) -> None:
        row = await self.lock(user_id)
        row.age_status = status
        row.age_status_source = source
        row.age_status_recorded_at = recorded_at
        await self._session.flush()


def ai_notice_state(row: ORMCompanionSafetyState) -> AiNoticeState:
    return AiNoticeState(
        last_notice_at=row.last_notice_at,
        last_notice_local_date=row.last_notice_local_date,
        interaction_started_at=row.interaction_started_at,
        last_turn_started_at=row.last_turn_started_at,
    )


def apply_ai_notice_state(row: ORMCompanionSafetyState, state: AiNoticeState) -> None:
    row.last_notice_at = state.last_notice_at
    row.last_notice_local_date = state.last_notice_local_date
    row.interaction_started_at = state.interaction_started_at
    row.last_turn_started_at = state.last_turn_started_at


__all__ = ["SQLAlchemyCompanionSafetyRepository", "ai_notice_state", "apply_ai_notice_state"]
