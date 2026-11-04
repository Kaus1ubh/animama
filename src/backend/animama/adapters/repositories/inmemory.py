"""Small in-memory repository implementations for focused tests."""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import replace

from animama.app.ports import AnimaRepository, UnitOfWork
from animama.domain import Anima


class InMemoryUnitOfWork(UnitOfWork):
    async def commit(self) -> None:  # pragma: no cover - no-op
        return None

    async def rollback(self) -> None:  # pragma: no cover - no-op
        return None


class InMemoryAnimaRepository(AnimaRepository):
    def __init__(self) -> None:
        self._store: dict[str, Anima] = {}

    async def get(self, anima_id: str) -> Anima | None:
        return self._store.get(anima_id)

    async def list(self, *, ids: Iterable[str] | None = None) -> list[Anima]:
        if ids is None:
            return list(self._store.values())
        idset = set(ids)
        return [anima for anima_id, anima in self._store.items() if anima_id in idset]

    async def create(self, anima: Anima) -> Anima:
        self._store[anima.id] = replace(anima)
        return self._store[anima.id]

    async def update(self, anima: Anima) -> Anima:
        self._store[anima.id] = replace(anima)
        return self._store[anima.id]

    async def delete(self, anima_id: str) -> bool:
        return self._store.pop(anima_id, None) is not None
