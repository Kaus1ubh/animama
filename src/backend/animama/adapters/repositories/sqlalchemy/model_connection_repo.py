from __future__ import annotations

from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.mappers.model_connection_map import (
    apply_model_connection_to_orm,
    model_connection_domain_to_orm,
    model_connection_orm_to_domain,
)
from animama.app.ports.model_connection_port import ModelConnectionRepository
from animama.domain.model_connection import BUILTIN_OPENAI_CONNECTION_ID, MODEL_SOURCE_BUILTIN, ModelConnection
from animama.orm import ORMModelConnection


class SQLAlchemyModelConnectionRepository(ModelConnectionRepository):
    """SQLAlchemy-backed model connection repository."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, connection_id: str) -> ModelConnection | None:
        orm = await self._s.get(ORMModelConnection, connection_id, populate_existing=True)
        return model_connection_orm_to_domain(orm) if orm is not None else None

    async def list_all(self) -> list[ModelConnection]:
        """List connections: the default OpenAI connection, other built-ins, then owner connections by name."""

        builtin_first = case(
            (ORMModelConnection.id == BUILTIN_OPENAI_CONNECTION_ID, 0),
            (ORMModelConnection.source == MODEL_SOURCE_BUILTIN, 1),
            else_=2,
        )
        stmt = select(ORMModelConnection).order_by(builtin_first, ORMModelConnection.name, ORMModelConnection.id)
        res = await self._s.execute(stmt)
        return [model_connection_orm_to_domain(orm) for orm in res.scalars()]

    async def upsert(self, connection: ModelConnection) -> ModelConnection:
        orm = await self._s.get(ORMModelConnection, connection.id)
        if orm is None:
            orm = model_connection_domain_to_orm(connection)
            self._s.add(orm)
        else:
            apply_model_connection_to_orm(orm, connection)
        await self._s.flush()
        await self._s.refresh(orm)
        return model_connection_orm_to_domain(orm)


__all__ = ["SQLAlchemyModelConnectionRepository"]
