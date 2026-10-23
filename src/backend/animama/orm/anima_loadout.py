"""Persistence models for revisioned per-Anima content loadouts."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import text as sa_text

from .sqlalchemy_base import SqlalchemyBase


class ORMAnimaLoadout(SqlalchemyBase):
    """Owned optimistic-revision root for the typed Anima loadout."""

    __tablename__ = "anima_loadouts"
    __table_args__ = (
        CheckConstraint("revision > 0", name="revision_positive"),
        CheckConstraint("starter_catalog_version > 0", name="starter_catalog_version_positive"),
        Index("ix_anima_loadouts_owner_anima", "owner_user_id", "anima_id"),
    )

    anima_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("anima.id", ondelete="CASCADE"),
        primary_key=True,
    )
    owner_user_id: Mapped[str] = mapped_column(String, nullable=False)
    revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sa_text("1"))
    # The starter loadout version the loadout started from; Reaction pools read it.
    starter_catalog_version: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sa_text("1"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
        onupdate=sa_text("CURRENT_TIMESTAMP"),
    )


class ORMAnimaLoadoutMutationReceipt(SqlalchemyBase):
    """Durable idempotency receipt for a typed loadout commit."""

    __tablename__ = "anima_loadout_mutation_receipts"
    __table_args__ = (
        UniqueConstraint("owner_user_id", "anima_id", "idempotency_key", name="uq_anima_loadout_receipt_key"),
        Index("ix_anima_loadout_receipts_expiry", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String, nullable=False)
    anima_id: Mapped[str] = mapped_column(
        String, ForeignKey("anima_loadouts.anima_id", ondelete="CASCADE"), nullable=False
    )
    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    request_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    resulting_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )


class ORMAnimaLoadoutDiagnostic(SqlalchemyBase):
    """Durable warning for a rejected legacy or externally edited binding."""

    __tablename__ = "anima_loadout_diagnostics"
    __table_args__ = (Index("ix_anima_loadout_diagnostics_anima", "anima_id", "created_at"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    anima_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("anima_loadouts.anima_id", ondelete="CASCADE"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(String(64), nullable=False)
    slot_key: Mapped[str | None] = mapped_column(String(192), nullable=True)
    catalog_item_id: Mapped[str | None] = mapped_column(String, nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa_text("'{}'::jsonb"),
    )
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )


class ORMAnimaRuntimeSnapshot(SqlalchemyBase):
    """Persisted, renewable catalog issued to one mounted Anima route."""

    __tablename__ = "anima_runtime_snapshots"
    __table_args__ = (
        CheckConstraint(
            "jsonb_typeof(admitted_item_revisions) = 'object'",
            name="admitted_item_revisions_object",
        ),
        UniqueConstraint("owner_user_id", "anima_id", "effective_revision", name="uq_anima_runtime_snapshot_revision"),
        Index("ix_anima_runtime_snapshots_expiry", "expires_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    owner_user_id: Mapped[str] = mapped_column(String, nullable=False)
    anima_id: Mapped[str] = mapped_column(String, ForeignKey("anima.id", ondelete="CASCADE"), nullable=False)
    loadout_revision: Mapped[int] = mapped_column(Integer, nullable=False)
    effective_revision: Mapped[str] = mapped_column(String(128), nullable=False)
    catalog_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    admitted_item_revisions: Mapped[dict[str, str]] = mapped_column(
        JSONB,
        nullable=False,
        server_default=sa_text("'{}'::jsonb"),
    )
    catalog: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )


__all__ = [
    "ORMAnimaLoadout",
    "ORMAnimaLoadoutDiagnostic",
    "ORMAnimaLoadoutMutationReceipt",
    "ORMAnimaRuntimeSnapshot",
]
