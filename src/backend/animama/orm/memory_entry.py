from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    TIMESTAMP,
    BigInteger,
    CheckConstraint,
    Computed,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMMemoryEntry(SqlalchemyBase, TimestampMixin):
    """Current live or soft-deleted memory filesystem entry."""

    __tablename__ = "memory_entries"
    __table_args__ = (
        CheckConstraint("type IN ('file', 'directory')", name="memory_entries_type_valid"),
        CheckConstraint("version >= 1", name="memory_entries_version_positive"),
        CheckConstraint("size_bytes IS NULL OR size_bytes >= 0", name="memory_entries_size_bytes_non_negative"),
        CheckConstraint("length(name) > 0", name="memory_entries_name_non_empty"),
        CheckConstraint("length(path) > 0", name="memory_entries_path_non_empty"),
        CheckConstraint(
            "("
            "type = 'file' "
            "AND content IS NOT NULL "
            "AND content_sha256 IS NOT NULL "
            "AND size_bytes IS NOT NULL"
            ") OR ("
            "type = 'directory' "
            "AND content IS NULL "
            "AND content_sha256 IS NULL "
            "AND size_bytes IS NULL"
            ")",
            name="memory_entries_type_payload_valid",
        ),
        Index(
            "uq_memory_entries_non_root_sibling_name",
            "parent_id",
            "normalized_name",
            unique=True,
            postgresql_where=sa_text("parent_id IS NOT NULL AND deleted_at IS NULL"),
        ),
        Index(
            "uq_memory_entries_user_root_name",
            "user_id",
            "normalized_name",
            unique=True,
            postgresql_where=sa_text("parent_id IS NULL AND anima_id IS NULL AND deleted_at IS NULL"),
        ),
        Index(
            "uq_memory_entries_anima_root_name",
            "user_id",
            "anima_id",
            "normalized_name",
            unique=True,
            postgresql_where=sa_text("parent_id IS NULL AND anima_id IS NOT NULL AND deleted_at IS NULL"),
        ),
        Index(
            "uq_memory_entries_user_path",
            "user_id",
            "normalized_path",
            unique=True,
            postgresql_where=sa_text("anima_id IS NULL AND deleted_at IS NULL"),
        ),
        Index(
            "uq_memory_entries_anima_path",
            "user_id",
            "anima_id",
            "normalized_path",
            unique=True,
            postgresql_where=sa_text("anima_id IS NOT NULL AND deleted_at IS NULL"),
        ),
        Index("ix_memory_entries_user_parent", "user_id", "parent_id"),
        Index("ix_memory_entries_user_scope_path", "user_id", "anima_id", "normalized_path"),
        Index("ix_memory_entries_fts", "search_vector", postgresql_using="gin"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    anima_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    parent_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("memory_entries.id", ondelete="RESTRICT"),
        nullable=True,
        index=True,
    )
    type: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(128), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    normalized_path: Mapped[str] = mapped_column(String(512), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('english'::regconfig, "
            "coalesce(path, ''::text) || ' ' || "
            "coalesce(description, ''::text) || ' ' || "
            "coalesce(content, ''::text))",
            persisted=True,
        ),
        nullable=False,
    )
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, server_default=sa_text("'{}'::jsonb")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=False), nullable=True)


class ORMMemoryEntryVersion(SqlalchemyBase):
    """Internal append-only audit row for memory entry changes."""

    __tablename__ = "memory_entry_versions"
    __table_args__ = (
        CheckConstraint("type IN ('file', 'directory')", name="memory_entry_versions_type_valid"),
        CheckConstraint(
            "operation IN ('create', 'update', 'move', 'delete', 'undo', 'revert')",
            name="memory_entry_versions_operation_valid",
        ),
        CheckConstraint("version >= 1", name="memory_entry_versions_version_positive"),
        CheckConstraint("size_bytes IS NULL OR size_bytes >= 0", name="memory_entry_versions_size_non_negative"),
        Index("uq_memory_entry_versions_entry_version", "entry_id", "version", unique=True),
        Index("ix_memory_entry_versions_user_path", "user_id", "anima_id", "normalized_path"),
        Index("ix_memory_entry_versions_entry_version", "entry_id", "version"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    entry_id: Mapped[str] = mapped_column(String, nullable=False)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    anima_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    parent_id: Mapped[str | None] = mapped_column(String, nullable=True)
    type: Mapped[str] = mapped_column(String, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    normalized_name: Mapped[str] = mapped_column(String(128), nullable=False)
    path: Mapped[str] = mapped_column(String(512), nullable=False)
    normalized_path: Mapped[str] = mapped_column(String(512), nullable=False)
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    operation: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    kind: Mapped[str | None] = mapped_column(String, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata", JSONB, nullable=False, server_default=sa_text("'{}'::jsonb")
    )
    change_metadata_: Mapped[dict[str, Any]] = mapped_column(
        "change_metadata", JSONB, nullable=False, server_default=sa_text("'{}'::jsonb")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=False), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )


MemoryEntry = ORMMemoryEntry
MemoryEntryVersion = ORMMemoryEntryVersion

__all__ = ["MemoryEntry", "MemoryEntryVersion", "ORMMemoryEntry", "ORMMemoryEntryVersion"]
