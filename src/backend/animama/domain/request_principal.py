"""Request-scoped ownership identity resolved by an application composition."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RequestPrincipal:
    """Opaque owner identity authorized for one request.

    The identifier is neither a credential nor necessarily an online account
    identifier. Local and hosted compositions resolve it through different
    trust boundaries while shared product routes use only ``id``.
    """

    id: str


__all__ = ["RequestPrincipal"]
