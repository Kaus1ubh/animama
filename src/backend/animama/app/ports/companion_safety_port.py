"""Per-owner companion-safety state a chat turn reads and updates (spec R2)."""

from __future__ import annotations

from typing import Protocol

from animama.app.safety.ai_notice import AiNoticeState


class CompanionSafetyStateRepository(Protocol):
    """AI notice state; changes become durable through the session's unit of work."""

    async def lock_ai_notice_state(self, user_id: str) -> AiNoticeState:
        """Return the owner's notice state, locked until the transaction ends."""
        ...

    async def save_ai_notice_state(self, user_id: str, state: AiNoticeState) -> None:
        """Replace the owner's locked notice state."""
        ...


__all__ = ["CompanionSafetyStateRepository"]
