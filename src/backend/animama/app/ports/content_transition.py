"""Binding and retained-original boundaries for the local idle format transition."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(frozen=True, slots=True)
class IdleTransitionBinding:
    """An exact pre-transition equipment selection, including implicit starters."""

    anima_id: str
    loadout_revision: int
    aggregate_revision: int
    binding_id: str | None
    config: dict[str, Any] = field(default_factory=dict)


class ContentTransitionBindings(Protocol):
    """Rewrite equipment in the caller's content mutation transaction."""

    async def idle_consumers(
        self, *, user_id: str, item_id: str, is_starter: bool
    ) -> tuple[IdleTransitionBinding, ...]:
        """Read exact explicit selections and consumers of an implicit starter."""
        ...

    async def replace_idle(self, *, user_id: str, before: IdleTransitionBinding, item_id: str) -> None:
        """Recheck a selection, bind its converted Style and retire pool overrides."""
        ...
