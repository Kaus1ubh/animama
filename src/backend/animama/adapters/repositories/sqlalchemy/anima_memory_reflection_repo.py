"""SQLAlchemy repository for per-Anima Reflection coverage."""

from __future__ import annotations

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from ....app.ports.anima_memory_reflection_port import AnimaMemoryReflectionRepository
from ....domain.chat import ChatHistoryPosition
from ....domain.memory_manager import AnimaMemoryReflection
from ....orm.anima_memory_reflection import ORMAnimaMemoryReflection


def _to_domain(orm: ORMAnimaMemoryReflection) -> AnimaMemoryReflection:
    return AnimaMemoryReflection(
        anima_id=orm.anima_id,
        user_id=orm.user_id,
        covered_through=ChatHistoryPosition(
            created_at=orm.covered_through_created_at,
            message_id=orm.covered_through_message_id,
        ),
        run_id=orm.run_id,
        updated_at=orm.updated_at,
    )


class SQLAlchemyAnimaMemoryReflectionRepository(AnimaMemoryReflectionRepository):
    """Owner-scoped coverage rows; writes join the caller's transaction."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    async def get(self, *, user_id: str, anima_id: str, for_update: bool = False) -> AnimaMemoryReflection | None:
        stmt = select(ORMAnimaMemoryReflection).where(
            ORMAnimaMemoryReflection.anima_id == anima_id,
            ORMAnimaMemoryReflection.user_id == user_id,
        )
        if for_update:
            stmt = stmt.with_for_update()
        orm = (await self._s.execute(stmt.execution_options(populate_existing=True))).scalar_one_or_none()
        return _to_domain(orm) if orm is not None else None

    async def put(self, reflection: AnimaMemoryReflection) -> AnimaMemoryReflection:
        values = {
            "anima_id": reflection.anima_id,
            "user_id": reflection.user_id,
            "covered_through_created_at": reflection.covered_through.created_at,
            "covered_through_message_id": reflection.covered_through.message_id,
            "run_id": reflection.run_id,
        }
        stmt = (
            insert(ORMAnimaMemoryReflection)
            .values(**values)
            .on_conflict_do_update(
                index_elements=[ORMAnimaMemoryReflection.anima_id],
                set_={**values, "updated_at": func.now()},
                # The key is the Anima; never let one owner overwrite another's row.
                where=ORMAnimaMemoryReflection.user_id == reflection.user_id,
            )
            .returning(ORMAnimaMemoryReflection)
            .execution_options(populate_existing=True)
        )
        orm = (await self._s.execute(stmt)).scalar_one()
        return _to_domain(orm)

    async def delete(self, *, user_id: str, anima_id: str) -> None:
        await self._s.execute(
            delete(ORMAnimaMemoryReflection).where(
                ORMAnimaMemoryReflection.anima_id == anima_id,
                ORMAnimaMemoryReflection.user_id == user_id,
            )
        )


__all__ = ["SQLAlchemyAnimaMemoryReflectionRepository"]
