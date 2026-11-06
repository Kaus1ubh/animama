"""Private local profile creation and validation."""

from __future__ import annotations

from dataclasses import replace

from animama.app.ports.uow_port import UnitOfWork
from animama.app.ports.user_profile_port import UserProfileRepository, UserProfileRepositoryConflictError
from animama.domain.user_profile import (
    UserProfile,
    UserProfileInvalidError,
    UserProfileNotFoundError,
    UserProfilePatch,
)

DISPLAY_NAME_MAX_LENGTH = 30


def normalize_display_name(value: str | None) -> str:
    """Require a nonblank private name whenever personalization is saved."""

    if value is None:
        raise UserProfileInvalidError(field="display_name", reason="required")
    normalized = " ".join(value.split())
    if not normalized:
        raise UserProfileInvalidError(field="display_name", reason="required")
    if len(normalized) > DISPLAY_NAME_MAX_LENGTH:
        raise UserProfileInvalidError(field="display_name", reason="length")
    return normalized


class UserProfileService:
    """Create an unnamed bootstrap profile and require a name on later writes."""

    def __init__(self, *, profiles: UserProfileRepository, uow: UnitOfWork) -> None:
        self._profiles = profiles
        self._uow = uow

    async def ensure_profile(self, *, user_id: str) -> UserProfile:
        """Idempotently create the private profile for one explicit owner."""

        existing = await self._profiles.get_profile(user_id)
        if existing is not None:
            return existing
        try:
            created = await self._profiles.create_profile(UserProfile(user_id=user_id))
            await self._uow.commit()
            return created
        except UserProfileRepositoryConflictError:
            await self._uow.rollback()
            existing = await self._profiles.get_profile(user_id)
            if existing is not None:
                return existing
            raise

    async def get_profile(self, user_id: str) -> UserProfile | None:
        return await self._profiles.get_profile(user_id)

    async def require_profile(self, user_id: str, *, for_update: bool = False) -> UserProfile:
        profile = await self._profiles.get_profile(user_id, for_update=for_update)
        if profile is None:
            raise UserProfileNotFoundError
        return profile

    async def update_profile(self, *, user_id: str, patch: UserProfilePatch) -> UserProfile:
        """Update the explicitly supplied display name and commit once."""

        profile = await self.require_profile(user_id, for_update=True)
        if not patch.display_name_set:
            return profile
        display_name = normalize_display_name(patch.display_name)
        if display_name == profile.display_name:
            return profile
        stored = await self._profiles.update_profile(replace(profile, display_name=display_name))
        await self._uow.commit()
        return stored


__all__ = ["DISPLAY_NAME_MAX_LENGTH", "UserProfileService", "normalize_display_name"]
