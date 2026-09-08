"""Owner-lifetime creation and starter receipts, independent of live deletion."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, Index, Integer, String, text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from .sqlalchemy_base import SqlalchemyBase


class ORMAnimaCreationReceipt(SqlalchemyBase):
    """A committed result, not a persisted pending job or copy of the identity."""

    __tablename__ = "anima_creation_receipts"
    __table_args__ = (
        CheckConstraint("operation = 'live_anima_create_v1'", name="creation_operation"),
        CheckConstraint(
            "jsonb_typeof(result) = 'object' AND octet_length(result::text) <= 65536", name="creation_result_bounded"
        ),
        Index("ix_anima_creation_receipts_anima", "anima_id"),
    )

    owner_user_id: Mapped[str] = mapped_column(String, primary_key=True)
    operation: Mapped[str] = mapped_column(String(32), primary_key=True)
    idempotency_key: Mapped[str] = mapped_column(String(128), primary_key=True)
    spec_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # No Anima FK: its original ID must survive deliberate hard deletion.
    anima_id: Mapped[str] = mapped_column(String, nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


class ORMAnimaStarterReceipt(SqlalchemyBase):
    """One durable slot per owner/starter, never keyed by roster size or version."""

    __tablename__ = "anima_starter_receipts"
    __table_args__ = (
        CheckConstraint("starter_id IN ('starter:annie', 'starter:caitlyn')", name="starter_identity"),
        CheckConstraint("spec_version >= 1", name="starter_version"),
        CheckConstraint("state IN ('ready', 'deleted', 'legacy_unresolved')", name="starter_state"),
        CheckConstraint("state != 'ready' OR anima_id IS NOT NULL", name="starter_result_required"),
        Index("ix_anima_starter_receipts_anima", "anima_id"),
    )

    owner_user_id: Mapped[str] = mapped_column(String, primary_key=True)
    starter_id: Mapped[str] = mapped_column(String(32), primary_key=True)
    spec_version: Mapped[int] = mapped_column(Integer, nullable=False)
    state: Mapped[str] = mapped_column(String(32), nullable=False)
    anima_id: Mapped[str | None] = mapped_column(String, nullable=True)
    diagnostics: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), server_default=text("CURRENT_TIMESTAMP"), onupdate=text("CURRENT_TIMESTAMP")
    )
    deleted_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
