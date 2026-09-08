"""User Profile ORM and domain mapping helpers."""

from __future__ import annotations

from animama.domain.user_profile import UserProfile
from animama.orm.user_profile import ORMUserProfile


def user_profile_orm_to_domain(orm: ORMUserProfile) -> UserProfile:
    return UserProfile(
        user_id=orm.user_id,
        display_name=orm.display_name,
        created_at=orm.created_at,
        updated_at=orm.updated_at,
    )


def user_profile_domain_to_orm(profile: UserProfile) -> ORMUserProfile:
    values: dict[str, object] = {
        "user_id": profile.user_id,
        "display_name": profile.display_name,
    }
    if profile.created_at is not None:
        values["created_at"] = profile.created_at
    if profile.updated_at is not None:
        values["updated_at"] = profile.updated_at
    return ORMUserProfile(**values)


def apply_user_profile_to_orm(orm: ORMUserProfile, profile: UserProfile) -> ORMUserProfile:
    orm.display_name = profile.display_name
    return orm


__all__ = [
    "apply_user_profile_to_orm",
    "user_profile_domain_to_orm",
    "user_profile_orm_to_domain",
]
