from __future__ import annotations

from typing import Any

from animama.domain import AnimaChatProfile
from animama.orm import ORMAnimaChatProfile


def _domain_values(profile: AnimaChatProfile) -> dict[str, Any]:
    return {
        "anima_id": profile.anima_id,
        "default_model_provider_id": profile.default_model_provider_id,
        "reasoning_effort": profile.reasoning_effort,
        "metadata_": dict(profile.metadata or {}),
    }


def anima_chat_profile_domain_to_orm(profile: AnimaChatProfile) -> ORMAnimaChatProfile:
    """Create an ORM row from a anima chat profile domain object."""

    return ORMAnimaChatProfile(**_domain_values(profile))


def apply_anima_chat_profile_to_orm(
    orm: ORMAnimaChatProfile,
    profile: AnimaChatProfile,
) -> ORMAnimaChatProfile:
    """Update an ORM row in place from a anima chat profile domain object."""

    for name, value in _domain_values(profile).items():
        setattr(orm, name, value)
    return orm


def anima_chat_profile_orm_to_domain(orm: ORMAnimaChatProfile) -> AnimaChatProfile:
    """Map an ORM anima chat profile row into the framework-free domain type."""

    return AnimaChatProfile(
        anima_id=orm.anima_id,
        default_model_provider_id=orm.default_model_provider_id,
        reasoning_effort=orm.reasoning_effort,
        metadata=dict(orm.metadata_ or {}),
        created_at=orm.created_at,
        updated_at=orm.updated_at,
    )


__all__ = [
    "apply_anima_chat_profile_to_orm",
    "anima_chat_profile_domain_to_orm",
    "anima_chat_profile_orm_to_domain",
]
