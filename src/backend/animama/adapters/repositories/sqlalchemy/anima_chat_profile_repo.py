from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.mappers.anima_chat_profile_map import (
    anima_chat_profile_domain_to_orm,
    anima_chat_profile_orm_to_domain,
    apply_anima_chat_profile_to_orm,
)
from animama.app.ports import AnimaChatProfileRepository
from animama.domain import AnimaChatProfile
from animama.domain.model_provider import AnimaModelUsage
from animama.orm import ORMAnima, ORMAnimaChatProfile


class SQLAlchemyAnimaChatProfileRepository(AnimaChatProfileRepository):
    """SQLAlchemy-backed anima chat profile repository."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, anima_id: str) -> AnimaChatProfile | None:
        orm = await self._s.get(ORMAnimaChatProfile, anima_id)
        if orm is None:
            return None
        return anima_chat_profile_orm_to_domain(orm)

    async def get_many(self, anima_ids: tuple[str, ...]) -> dict[str, AnimaChatProfile]:
        """Return profiles for any number of Animas with one set query."""

        if not anima_ids:
            return {}
        rows = (
            await self._s.execute(select(ORMAnimaChatProfile).where(ORMAnimaChatProfile.anima_id.in_(anima_ids)))
        ).scalars()
        return {row.anima_id: anima_chat_profile_orm_to_domain(row) for row in rows}

    async def upsert(self, profile: AnimaChatProfile) -> AnimaChatProfile:
        orm = await self._s.get(ORMAnimaChatProfile, profile.anima_id)
        if orm is None:
            orm = anima_chat_profile_domain_to_orm(profile)
            self._s.add(orm)
        else:
            apply_anima_chat_profile_to_orm(orm, profile)
        await self._s.flush()
        await self._s.refresh(orm)
        return anima_chat_profile_orm_to_domain(orm)

    async def list_owned_for_models(
        self,
        *,
        owner_id: str,
        model_provider_ids: tuple[str, ...],
    ) -> list[AnimaModelUsage]:
        if not model_provider_ids:
            return []
        stmt = (
            select(ORMAnima.id, ORMAnima.display_name, ORMAnimaChatProfile.default_model_provider_id)
            .join(ORMAnimaChatProfile, ORMAnimaChatProfile.anima_id == ORMAnima.id)
            .where(
                ORMAnima.user_id == owner_id,
                ORMAnimaChatProfile.default_model_provider_id.in_(model_provider_ids),
            )
            .order_by(ORMAnima.display_name, ORMAnima.id)
        )
        rows = (await self._s.execute(stmt)).all()
        return [
            AnimaModelUsage(anima_id=anima_id, display_name=display_name, model_provider_id=model_provider_id)
            for anima_id, display_name, model_provider_id in rows
        ]


__all__ = ["SQLAlchemyAnimaChatProfileRepository"]
