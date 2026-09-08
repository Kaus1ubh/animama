from __future__ import annotations

from collections.abc import Iterable
from typing import Protocol

from animama.domain import ModelProvider


class ModelProviderRepository(Protocol):
    """Persistence operations for durable provider/model catalog rows."""

    async def list_active(self) -> list[ModelProvider]:
        raise NotImplementedError

    async def get(self, model_provider_id: str, *, for_update: bool = False) -> ModelProvider | None:
        """Read current configuration; optionally fence it in the caller's transaction."""

        raise NotImplementedError

    async def get_by_provider_model(self, provider_type: str, model: str) -> ModelProvider | None:
        raise NotImplementedError

    async def upsert_many(
        self,
        model_providers: Iterable[ModelProvider],
    ) -> list[ModelProvider]:
        raise NotImplementedError

    async def soft_retire_missing(self, active_ids: Iterable[str]) -> int:
        raise NotImplementedError


__all__ = ["ModelProviderRepository"]
