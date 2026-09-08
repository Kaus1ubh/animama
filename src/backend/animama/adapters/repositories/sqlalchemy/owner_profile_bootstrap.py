"""Local user-profile adapter for the neutral owner-bootstrap port."""

from __future__ import annotations

from animama.app.ports.owner_profile_bootstrap_port import OwnerProfileBootstrapResult
from animama.app.ports.user_profile_port import UserProfileRepository
from animama.domain.user_profile import UserProfile


class SQLAlchemyOwnerProfileBootstrapAdapter:
    """Create only the missing nullable-display-name local profile row."""

    def __init__(self, profiles: UserProfileRepository) -> None:
        self._profiles = profiles

    async def ensure(self, *, owner_id: str) -> OwnerProfileBootstrapResult:
        if await self._profiles.get_profile(owner_id) is not None:
            return OwnerProfileBootstrapResult(created=False)
        await self._profiles.create_profile(UserProfile(user_id=owner_id))
        return OwnerProfileBootstrapResult(created=True)


__all__ = ["SQLAlchemyOwnerProfileBootstrapAdapter"]
