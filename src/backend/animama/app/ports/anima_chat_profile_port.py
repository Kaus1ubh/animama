from __future__ import annotations

from typing import Protocol

from animama.domain import AnimaChatProfile


class AnimaChatProfileRepository(Protocol):
    """Persistence for explicit anima chat profiles."""

    async def get(self, anima_id: str) -> AnimaChatProfile | None:
        raise NotImplementedError

    async def get_many(self, anima_ids: tuple[str, ...]) -> dict[str, AnimaChatProfile]:
        """Batch-load explicit profiles for list projections."""

        raise NotImplementedError

    async def upsert(self, profile: AnimaChatProfile) -> AnimaChatProfile:
        raise NotImplementedError


__all__ = ["AnimaChatProfileRepository"]
