"""Repository protocol for per-Anima Reflection coverage."""

from __future__ import annotations

from typing import Protocol

from animama.domain.memory_manager import AnimaMemoryReflection


class AnimaMemoryReflectionRepository(Protocol):
    """Read and move each Anima's Reflection coverage inside the caller's transaction."""

    async def get(self, *, user_id: str, anima_id: str, for_update: bool = False) -> AnimaMemoryReflection | None:
        """Return the owner's coverage for one Anima, or ``None`` when nothing is covered yet."""

        raise NotImplementedError

    async def put(self, reflection: AnimaMemoryReflection) -> AnimaMemoryReflection:
        """Create or replace one Anima's coverage without committing."""

        raise NotImplementedError

    async def delete(self, *, user_id: str, anima_id: str) -> None:
        """Remove one Anima's coverage, so every remaining turn is uncovered again."""

        raise NotImplementedError


__all__ = ["AnimaMemoryReflectionRepository"]
