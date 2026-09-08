"""Composition-neutral profile bootstrap seam."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True, slots=True)
class OwnerProfileBootstrapResult:
    """Report whether the composition created its private owner profile."""

    created: bool


class OwnerProfileBootstrapPort(Protocol):
    """Ensure composition-specific private profile state for an owner."""

    async def ensure(self, *, owner_id: str) -> OwnerProfileBootstrapResult:
        raise NotImplementedError


__all__ = ["OwnerProfileBootstrapPort", "OwnerProfileBootstrapResult"]
