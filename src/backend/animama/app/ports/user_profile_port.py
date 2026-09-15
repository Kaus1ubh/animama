"""Persistence port for private local profiles."""

from __future__ import annotations

from typing import Protocol

from ...domain.user_profile import UserProfile


class UserProfileRepositoryConflictError(Exception):
    """Raised when database uniqueness rejects a profile or claim mutation."""


class UserProfileRepositoryConsistencyError(Exception):
    """Raised when persisted profile state disappears during mutation."""


class UserProfileRepository(Protocol):
    """Repository operations used by the User Profile application service."""

    async def get_profile(self, user_id: str, *, for_update: bool = False) -> UserProfile | None:
        raise NotImplementedError

    async def create_profile(self, profile: UserProfile) -> UserProfile:
        raise NotImplementedError

    async def update_profile(self, profile: UserProfile) -> UserProfile:
        raise NotImplementedError


__all__ = [
    "UserProfileRepository",
    "UserProfileRepositoryConflictError",
    "UserProfileRepositoryConsistencyError",
]
