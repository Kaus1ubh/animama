from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class AnimaChatProfile:
    """Product-level model selection profile for one anima's normal chat.

    ``reasoning_effort`` is the owner's effort for ``default_model_provider_id``;
    ``None`` means that model's default preselection.
    """

    anima_id: str
    default_model_provider_id: str
    reasoning_effort: str | None = None
    metadata: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


__all__ = ["AnimaChatProfile"]
