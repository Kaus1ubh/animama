from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.mappers.model_provider_map import (
    apply_model_provider_to_orm,
    model_provider_domain_to_orm,
    model_provider_orm_to_domain,
)
from animama.app.ports import ModelProviderRepository
from animama.domain import ModelProvider
from animama.orm import ORMModelProvider


class SQLAlchemyModelProviderRepository(ModelProviderRepository):
    """SQLAlchemy-backed model-provider catalog repository."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def list_active(self) -> list[ModelProvider]:
        stmt = (
            select(ORMModelProvider)
            .where(ORMModelProvider.active.is_(True))
            .order_by(ORMModelProvider.provider_label, ORMModelProvider.model_label, ORMModelProvider.id)
        )
        res = await self._s.execute(stmt)
        return [model_provider_orm_to_domain(row) for row in res.scalars()]

    async def get(self, model_provider_id: str, *, for_update: bool = False) -> ModelProvider | None:
        orm = await self._s.get(
            ORMModelProvider, model_provider_id, populate_existing=True, with_for_update=for_update or None
        )
        if orm is None:
            return None
        return model_provider_orm_to_domain(orm)

    async def get_by_provider_model(self, provider_type: str, model: str) -> ModelProvider | None:
        stmt = select(ORMModelProvider).where(
            ORMModelProvider.provider_type == provider_type,
            ORMModelProvider.model == model,
        )
        res = await self._s.execute(stmt)
        orm = res.scalar_one_or_none()
        if orm is None:
            return None
        return model_provider_orm_to_domain(orm)

    async def upsert_many(
        self,
        model_providers: Iterable[ModelProvider],
    ) -> list[ModelProvider]:
        stored: list[ModelProvider] = []
        for model_provider in model_providers:
            orm = await self._s.get(ORMModelProvider, model_provider.id)
            if orm is None:
                orm = model_provider_domain_to_orm(model_provider)
                self._s.add(orm)
            else:
                apply_model_provider_to_orm(orm, model_provider)
            await self._s.flush()
            await self._s.refresh(orm)
            stored.append(model_provider_orm_to_domain(orm))
        return stored

    async def soft_retire_missing(self, active_ids: Iterable[str]) -> int:
        active_id_set = set(active_ids)
        stmt = select(ORMModelProvider).where(ORMModelProvider.active.is_(True))
        if active_id_set:
            stmt = stmt.where(ORMModelProvider.id.notin_(active_id_set))
        res = await self._s.execute(stmt)
        now = datetime.utcnow()
        retired = 0
        for orm in res.scalars():
            orm.active = False
            orm.deprecated_at = orm.deprecated_at or now
            retired += 1
        if retired:
            await self._s.flush()
        return retired


__all__ = ["SQLAlchemyModelProviderRepository"]
