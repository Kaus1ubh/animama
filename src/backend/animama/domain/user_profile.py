"""Private local personalization keyed by an owner principal."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime


@dataclass(slots=True)
class UserProfile:
    """Private, installation-local display-name preference."""

    user_id: str
    display_name: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


@dataclass(slots=True, frozen=True)
class UserProfilePatch:
    """Explicitly supplied local personalization fields."""

    display_name: str | None = None
    display_name_set: bool = False


class UserProfileError(Exception):
    """Base class for expected User Profile domain failures."""


class UserProfileNotFoundError(UserProfileError):
    """Raised when an authenticated user has not ensured a profile."""


class UserProfileInvalidError(UserProfileError):
    """Raised when mutable profile text is invalid."""

    def __init__(self, *, field: str, reason: str) -> None:
        super().__init__(f"Invalid {field}: {reason}")
        self.field = field
        self.reason = reason


__all__ = [
    "UserProfile",
    "UserProfileError",
    "UserProfileInvalidError",
    "UserProfileNotFoundError",
    "UserProfilePatch",
]
