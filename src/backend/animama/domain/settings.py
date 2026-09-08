from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any


@dataclass(slots=True)
class UserSettings:
    user_id: str
    theme: str = "anima"
    locale: str = "en-US"
    last_active_anima_id: str | None = None
    preferences: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True)
class AnimaSettings:
    user_id: str
    anima_id: str
    theme: dict[str, Any] | None = None
    background: str | None = None
    favorited: bool = False
    preferences: dict[str, Any] = field(default_factory=dict)
    created_at: datetime | None = None
    updated_at: datetime | None = None


__all__ = ["UserSettings", "AnimaSettings"]
