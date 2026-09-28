from __future__ import annotations

from typing import Protocol

from animama.domain.model_connection import ModelConnection


class ModelConnectionRepository(Protocol):
    """Persistence operations for model connections."""

    async def get(self, connection_id: str) -> ModelConnection | None:
        raise NotImplementedError

    async def list_all(self) -> list[ModelConnection]:
        """Return active and inactive connections, built-in first, then by name."""

        raise NotImplementedError

    async def upsert(self, connection: ModelConnection) -> ModelConnection:
        raise NotImplementedError


__all__ = ["ModelConnectionRepository"]
