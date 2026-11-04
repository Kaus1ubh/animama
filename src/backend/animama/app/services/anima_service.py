"""Anima service (Stage 4).

Business logic around anima aggregates using domain types and ports.
"""

from __future__ import annotations

from collections.abc import Iterable

from animama.app.ports import AnimaRepository, UnitOfWork
from animama.domain.anima import Anima
from animama.logging import get_logger


class AnimaService:
    def __init__(
        self,
        *,
        animas: AnimaRepository,
        uow: UnitOfWork,
    ) -> None:
        self._animas = animas
        self._uow = uow
        self._log = get_logger("app.services.anima")

    # CRUD
    async def create(self, anima: Anima) -> Anima:
        self._log.info(
            "Create Anima",
            id=anima.id,
        )
        stored = await self._animas.create(anima)
        await self._uow.commit()
        self._log.info("Anima Created", id=stored.id)
        return stored

    async def update(self, anima: Anima) -> Anima:
        self._log.info("Update Anima", id=anima.id)
        stored = await self._animas.update(anima)
        await self._uow.commit()
        self._log.info("Anima Updated", id=stored.id)
        return stored

    async def get(self, anima_id: str) -> Anima | None:
        self._log.info("Get Anima", id=anima_id)
        return await self._animas.get(anima_id)

    async def list(self, *, ids: Iterable[str] | None = None) -> list[Anima]:
        if ids is not None:
            ids_list = list(ids)
            self._log.info("List Animas", count=len(ids_list))
            return await self._animas.list(ids=ids_list)
        self._log.info("List Animas", count=None)
        return await self._animas.list(ids=None)

    async def delete(self, anima_id: str) -> bool:
        self._log.info("Delete Anima", id=anima_id)
        ok = await self._animas.delete(anima_id)
        await self._uow.commit()
        self._log.info("Anima Deleted", id=anima_id, ok=ok)
        return ok
