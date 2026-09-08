"""Unit of Work protocol (Stage 2)."""

from __future__ import annotations

from typing import Protocol


class UnitOfWork(Protocol):
    """Boundary for atomic persistence operations.

    Implementations should coordinate commits/rollbacks for repository
    operations executed within a logical unit of work.
    """

    async def commit(self) -> None:
        raise NotImplementedError

    async def rollback(self) -> None:
        raise NotImplementedError
