"""Compact definition audit: identity text remains in memory entry versions."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import TIMESTAMP, CheckConstraint, ForeignKey, Integer, String, text as sa_text
from sqlalchemy.orm import Mapped, mapped_column

from .sqlalchemy_base import SqlalchemyBase


class ORMAnimaDefinitionRevision(SqlalchemyBase):
    """One immutable definition revision, including repair/adoption provenance."""

    __tablename__ = "anima_definition_revisions"
    __table_args__ = (
        CheckConstraint("aggregate_revision >= 1", name="anima_definition_revision_positive"),
        CheckConstraint(
            "(identity_entry_id IS NULL AND identity_version IS NULL) OR "
            "(identity_entry_id IS NOT NULL AND identity_version IS NOT NULL AND identity_version >= 1)",
            name="anima_definition_identity_pointer_valid",
        ),
    )

    anima_id: Mapped[str] = mapped_column(String, ForeignKey("anima.id", ondelete="CASCADE"), primary_key=True)
    aggregate_revision: Mapped[int] = mapped_column(Integer, primary_key=True)
    display_name: Mapped[str] = mapped_column(String(120), nullable=False)
    # Memory history deliberately outlives soft-deletion and has no row FK.
    identity_entry_id: Mapped[str | None] = mapped_column(String, nullable=True)
    identity_version: Mapped[int | None] = mapped_column(Integer, nullable=True)
    actor_id: Mapped[str | None] = mapped_column(String, nullable=True)
    reason: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )
