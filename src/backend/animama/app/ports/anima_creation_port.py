"""Persistence boundary for retry receipts and backend-owned starter slots."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class CreationReceipt:
    spec_sha256: str
    anima_id: str
    result: dict[str, Any]
    deleted: bool = False


@dataclass(frozen=True, slots=True)
class StarterReceipt:
    starter_id: str
    spec_version: int
    state: str
    anima_id: str | None
    diagnostics: list[dict[str, Any]]


class AnimaCreationRepository(Protocol):
    """Methods flush into the caller's transaction; none commit independently."""

    async def lock_operation(self, *, user_id: str, operation: str, key: str) -> None: ...

    async def receipt(self, *, user_id: str, key: str) -> CreationReceipt | None: ...

    async def save_receipt(self, *, user_id: str, key: str, receipt: CreationReceipt) -> None: ...

    async def starter(self, *, user_id: str, starter_id: str) -> StarterReceipt | None: ...

    async def save_starter(self, *, user_id: str, receipt: StarterReceipt) -> None: ...

    async def legacy_candidates(self, *, user_id: str, avatar_id: str, profile_url: str) -> tuple[list[str], bool]:
        """Return proven matches plus whether any partial signature is ambiguous."""
        ...

    async def mapped_starter(self, *, user_id: str, anima_id: str) -> str | None: ...
