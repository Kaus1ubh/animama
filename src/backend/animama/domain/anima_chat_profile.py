from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class AnimaChatProfile:
    """Product-level model selection profile for one anima's normal chat."""

    anima_id: str
    default_model_provider_id: str
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


__all__ = ["AnimaChatProfile"]
