from __future__ import annotations

from typing import Protocol

from animama.domain import AnimaChatProfile
from animama.domain.model_provider import AnimaModelUsage


class AnimaChatProfileRepository(Protocol):
    """Persistence for explicit anima chat profiles."""

    async def get(self, anima_id: str) -> AnimaChatProfile | None:
        raise NotImplementedError

    async def get_many(self, anima_ids: tuple[str, ...]) -> dict[str, AnimaChatProfile]:
        """Batch-load explicit profiles for list projections."""

        raise NotImplementedError

    async def upsert(self, profile: AnimaChatProfile) -> AnimaChatProfile:
        raise NotImplementedError

    async def list_owned_for_models(
        self,
        *,
        owner_id: str,
        model_provider_ids: tuple[str, ...],
    ) -> list[AnimaModelUsage]:
        """Return the owner's Animas whose chat profile selects one of the rows."""

        raise NotImplementedError


__all__ = ["AnimaChatProfileRepository"]
