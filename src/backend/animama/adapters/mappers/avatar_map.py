"""Avatar mapper: domain ↔ ORM ↔ schema conversions."""

from __future__ import annotations

from animama.app.contracts.avatar import PyAvatarCreate, PyAvatarResponse
from animama.domain.avatar import Avatar
from animama.orm.avatar import ORMAvatar


def avatar_domain_to_orm(avatar: Avatar) -> ORMAvatar:
    """Convert Avatar domain object to ORM model."""
    return ORMAvatar(
        id=avatar.id,
        name=avatar.name,
        file_path=avatar.file_path,
        identity=avatar.identity,
        user_id=avatar.user_id,
        model_type=avatar.model_type,
        animation_profile=avatar.animation_profile,
        private=avatar.private,
        created_by_id=avatar.created_by_id,
        last_updated_by_id=avatar.last_updated_by_id,
        catalog_item_id=avatar.catalog_item_id,
        presentation_revision=avatar.presentation_revision,
    )


def avatar_orm_to_domain(orm: ORMAvatar) -> Avatar:
    """Convert ORM model to Avatar domain object."""
    return Avatar(
        id=orm.id,
        name=orm.name,
        file_path=orm.file_path,
        identity=orm.identity,
        user_id=orm.user_id,
        model_type=orm.model_type,
        animation_profile=orm.animation_profile,
        private=orm.private,
        created_by_id=orm.created_by_id,
        last_updated_by_id=orm.last_updated_by_id,
        created_at=orm.created_at,
        updated_at=orm.updated_at,
        catalog_item_id=orm.catalog_item_id,
        presentation_revision=orm.presentation_revision,
    )


def avatar_domain_to_schema(avatar: Avatar) -> PyAvatarResponse:
    """Convert Avatar domain object to response schema."""
    return PyAvatarResponse(
        id=avatar.id,
        name=avatar.name,
        file_path=avatar.file_path,
        identity=avatar.identity,
        user_id=avatar.user_id,
        model_type=avatar.model_type,
        animation_profile=avatar.animation_profile,
        private=avatar.private,
        created_at=avatar.created_at,
        updated_at=avatar.updated_at,
        catalog_item_id=avatar.catalog_item_id,
        source=(
            {"type": "catalog", "avatar_id": avatar.id, "catalog_item_id": avatar.catalog_item_id}
            if avatar.catalog_item_id
            else {"type": "builtin", "avatar_id": avatar.id, "version": 1}
        ),
        presentation_revision=avatar.presentation_revision,
    )


def avatar_schema_to_domain(schema: PyAvatarCreate) -> Avatar:
    """Convert create schema to Avatar domain object."""
    return Avatar(
        id=schema.id,
        name=schema.name,
        file_path=schema.file_path,
        identity=schema.identity,
        user_id=schema.user_id,
        model_type=schema.model_type,
        animation_profile=schema.animation_profile,
        private=schema.private,
        catalog_item_id=None,
    )


__all__ = [
    "avatar_domain_to_orm",
    "avatar_orm_to_domain",
    "avatar_domain_to_schema",
    "avatar_schema_to_domain",
]
