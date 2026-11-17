"""Persistence port for lightweight owner-scoped Anima presentations."""

from __future__ import annotations

from typing import Protocol

from animama.domain.anima_presentation import AnimaPresentationRecord


class AnimaPresentationRepository(Protocol):
    """Set-based source facts for presentation projection and delivery."""

    async def list_owned_presentation_records(
        self,
        *,
        user_id: str,
        anima_ids: tuple[str, ...],
    ) -> dict[str, AnimaPresentationRecord]: ...

    async def get_owned_presentation_record(
        self,
        *,
        user_id: str,
        anima_id: str,
    ) -> AnimaPresentationRecord | None: ...


__all__ = ["AnimaPresentationRepository"]
