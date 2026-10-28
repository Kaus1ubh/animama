"""SQL catalog for readable Included and Local content files."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import text as sa_text

from .sqlalchemy_base import SqlalchemyBase

CONTENT_KINDS = (
    "avatar",
    "gesture",
    "pose",
    "pose_clip",
    "reaction",
    "particle_effect",
    "avatar_effect",
    "scene_effect",
    "sound_effect",
    "music_track",
    "appearance",
    "voice",
    "anima",
)

TYPED_LOADOUT_KINDS = (
    "avatar",
    "gesture",
    "reaction",
    "music_track",
    "appearance",
    "voice",
)

_TYPED_SLOT_CHECK = """(
    (kind = 'avatar' AND slot_key = 'avatar') OR
    (kind = 'gesture' AND (
        (slot_key LIKE 'gesture:%' AND char_length(slot_key) > 8) OR
        (slot_key LIKE 'idle:%' AND char_length(slot_key) > 5)
    )) OR
    (kind = 'reaction' AND slot_key LIKE 'reaction:%-_:_%') OR
    (kind = 'music_track' AND slot_key LIKE 'music:%' AND char_length(slot_key) > 6) OR
    (kind = 'appearance' AND slot_key IN ('appearance:profile', 'appearance:background')) OR
    (kind = 'voice' AND slot_key = 'voice')
)"""


class ORMContentCatalogItem(SqlalchemyBase):
    """Logical catalog identity reconciled from one readable filesystem entry."""

    __tablename__ = "content_catalog_items"
    __table_args__ = (
        CheckConstraint("source IN ('included', 'local')", name="source_values"),
        CheckConstraint("scope IN ('included', 'owner', 'installation_shared')", name="scope_values"),
        CheckConstraint(f"kind IN {CONTENT_KINDS!r}", name="kind_values"),
        CheckConstraint("status IN ('valid', 'invalid', 'missing', 'scan_required')", name="status_values"),
        CheckConstraint("char_length(display_name) BETWEEN 1 AND 120", name="display_name_length"),
        CheckConstraint(
            "revision_sha256 IS NULL OR revision_sha256 ~ '^[0-9a-f]{64}$'",
            name="revision_sha256_format",
        ),
        CheckConstraint(
            "(scope = 'owner' AND owner_user_id IS NOT NULL) OR (scope <> 'owner' AND owner_user_id IS NULL)",
            name="owner_scope_consistency",
        ),
        UniqueConstraint("source", "relative_locator", name="uq_content_catalog_source_locator"),
        Index("ix_content_catalog_kind_status", "kind", "status"),
        Index("ix_content_catalog_owner", "owner_user_id", "status"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    source_mount_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    scope: Mapped[str] = mapped_column(String(32), nullable=False)
    owner_user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    relative_locator: Mapped[str] = mapped_column(Text, nullable=False)
    descriptor_relative_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    logical_key: Mapped[str | None] = mapped_column(String(192), nullable=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False)
    revision_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=sa_text("'{}'::jsonb"))
    content_metadata: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, server_default=sa_text("'{}'::jsonb")
    )
    diagnostics: Mapped[list[dict[str, Any]]] = mapped_column(
        JSONB, nullable=False, server_default=sa_text("'[]'::jsonb")
    )
    scanned_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )
    # The content catalog's validator digests each row's ``updated_at``, so every
    # write must set it: SQLAlchemy's ``onupdate`` does, but raw SQL does not.
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
        onupdate=sa_text("CURRENT_TIMESTAMP"),
    )


class ORMContentCatalogFile(SqlalchemyBase):
    """Opaque exact-file registration; no absolute path is persisted."""

    __tablename__ = "content_catalog_files"
    __table_args__ = (
        CheckConstraint("size_bytes > 0", name="size_bytes_positive"),
        CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name="sha256_format"),
        CheckConstraint("ordinal > 0", name="ordinal_positive"),
        UniqueConstraint("item_id", "relative_path", name="uq_content_catalog_file_path"),
        Index("ix_content_catalog_files_item_ordinal", "item_id", "ordinal"),
    )

    file_ref: Mapped[str] = mapped_column(String, primary_key=True)
    item_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("content_catalog_items.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    relative_path: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(64), nullable=False)
    media_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
        onupdate=sa_text("CURRENT_TIMESTAMP"),
    )


class ORMContentCatalogDependency(SqlalchemyBase):
    """Declared dependency edge resolved to a catalog item when unambiguous."""

    __tablename__ = "content_catalog_dependencies"
    __table_args__ = (
        CheckConstraint("ordinal > 0", name="ordinal_positive"),
        UniqueConstraint("item_id", "declared_ref", name="uq_content_catalog_dependency_ref"),
        Index("ix_content_catalog_dependencies_target", "target_item_id"),
    )

    item_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("content_catalog_items.id", ondelete="CASCADE"),
        primary_key=True,
    )
    ordinal: Mapped[int] = mapped_column(Integer, primary_key=True)
    declared_ref: Mapped[str] = mapped_column(String(512), nullable=False)
    target_item_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("content_catalog_items.id", ondelete="SET NULL"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )


class ORMContentPreview(SqlalchemyBase):
    """Short-lived owner-scoped snapshot of one exact catalog revision."""

    __tablename__ = "content_previews"
    __table_args__ = (
        CheckConstraint("revision_sha256 ~ '^[0-9a-f]{64}$'", name="revision_sha256_format"),
        Index("ix_content_previews_expiry", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String, nullable=False)
    item_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("content_catalog_items.id", ondelete="CASCADE"),
        nullable=False,
    )
    revision_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )


class ORMContentPreviewFile(SqlalchemyBase):
    """Exact expected facts for one file in a content preview."""

    __tablename__ = "content_preview_files"
    __table_args__ = (
        CheckConstraint("source IN ('included', 'local')", name="source_values"),
        CheckConstraint("size_bytes > 0", name="size_bytes_positive"),
        CheckConstraint("sha256 ~ '^[0-9a-f]{64}$'", name="sha256_format"),
        CheckConstraint("ordinal > 0", name="ordinal_positive"),
    )

    preview_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("content_previews.id", ondelete="CASCADE"),
        primary_key=True,
    )
    file_ref: Mapped[str] = mapped_column(String, primary_key=True)
    source: Mapped[str] = mapped_column(String(16), nullable=False)
    source_mount_id: Mapped[str | None] = mapped_column(String(256), nullable=True)
    relative_path: Mapped[str] = mapped_column(Text, nullable=False)
    role: Mapped[str] = mapped_column(String(64), nullable=False)
    media_type: Mapped[str] = mapped_column(String(255), nullable=False)
    size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    ordinal: Mapped[int] = mapped_column(Integer, nullable=False)


class ORMAnimaContentBinding(SqlalchemyBase):
    """One logical catalog selection resolved to exact bytes on remount."""

    __tablename__ = "anima_content_bindings"
    __table_args__ = (
        CheckConstraint(f"kind IN {TYPED_LOADOUT_KINDS!r}", name="typed_kind_values"),
        CheckConstraint("char_length(slot_key) BETWEEN 1 AND 192", name="slot_key_length"),
        CheckConstraint(_TYPED_SLOT_CHECK, name="typed_slot_shape"),
        CheckConstraint("jsonb_typeof(config) = 'object'", name="config_object"),
        UniqueConstraint("anima_id", "slot_key", name="uq_anima_content_slot"),
        Index("ix_anima_content_bindings_item", "catalog_item_id"),
        Index(
            "uq_anima_music_autoplay",
            "anima_id",
            unique=True,
            postgresql_where=sa_text("kind = 'music_track' AND config @> '{\"autoplay\": true}'::jsonb"),
        ),
        Index(
            "uq_anima_music_catalog_item",
            "anima_id",
            "catalog_item_id",
            unique=True,
            postgresql_where=sa_text("kind = 'music_track'"),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    anima_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("anima_loadouts.anima_id", ondelete="CASCADE"),
        nullable=False,
    )
    slot_key: Mapped[str] = mapped_column(String(192), nullable=False)
    catalog_item_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("content_catalog_items.id", ondelete="RESTRICT"),
        nullable=False,
    )
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    config: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa_text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
        onupdate=sa_text("CURRENT_TIMESTAMP"),
    )


__all__ = [
    "ORMAnimaContentBinding",
    "ORMContentCatalogDependency",
    "ORMContentCatalogFile",
    "ORMContentCatalogItem",
    "ORMContentPreview",
    "ORMContentPreviewFile",
]
