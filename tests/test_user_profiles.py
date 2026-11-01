from __future__ import annotations

from uuid import uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.services.user_profile_service import UserProfileService, normalize_display_name
from animama.domain.user_profile import UserProfileInvalidError, UserProfilePatch


def _service(session: AsyncSession) -> UserProfileService:
    return UserProfileService(
        profiles=SQLAlchemyUserProfileRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )


def test_display_name_is_required_private_personalization() -> None:
    assert normalize_display_name("  Ada   Lovelace ") == "Ada Lovelace"
    assert normalize_display_name("x" * 30) == "x" * 30
    with pytest.raises(UserProfileInvalidError, match="length"):
        normalize_display_name("x" * 31)


@pytest.mark.parametrize("value", [None, "", "   ", "\t\n", "\u00a0"])
def test_display_name_rejects_missing_or_whitespace_only_values(value: str | None) -> None:
    with pytest.raises(UserProfileInvalidError, match="required"):
        normalize_display_name(value)


async def test_profile_ensure_is_idempotent_and_does_not_overwrite(async_session: AsyncSession) -> None:
    owner_id = f"owner-{uuid4()}"
    service = _service(async_session)

    first = await service.ensure_profile(user_id=owner_id)
    await service.update_profile(
        user_id=owner_id,
        patch=UserProfilePatch(display_name="Private Name", display_name_set=True),
    )
    replay = await service.ensure_profile(user_id=owner_id)

    assert first.display_name is None
    assert replay.display_name == "Private Name"


async def test_profiles_remain_isolated_by_explicit_owner(async_session: AsyncSession) -> None:
    first_id = f"owner-{uuid4()}"
    second_id = f"owner-{uuid4()}"
    service = _service(async_session)
    await service.ensure_profile(user_id=first_id)
    await service.ensure_profile(user_id=second_id)
    await service.update_profile(
        user_id=first_id,
        patch=UserProfilePatch(display_name="First", display_name_set=True),
    )

    first = await service.require_profile(first_id)
    second = await service.require_profile(second_id)
    assert first.display_name == "First"
    assert second.display_name is None
