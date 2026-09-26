"""Per-owner companion-safety state: AI-notice cadence and age status."""

from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import CheckConstraint, Date, String, text as sa_text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMCompanionSafetyState(SqlalchemyBase, TimestampMixin):
    """One row per owner principal; never stores message content."""

    __tablename__ = "companion_safety_state"
    __table_args__ = (
        CheckConstraint("age_status IN ('unknown', 'adult', 'minor')", name="age_status"),
        CheckConstraint(
            "age_status_source IS NULL OR age_status_source IN ('self_attestation')",
            name="age_status_source",
        ),
    )

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    age_status: Mapped[str] = mapped_column(String, nullable=False, server_default=sa_text("'unknown'"))
    age_status_source: Mapped[str | None] = mapped_column(String, nullable=True)
    age_status_recorded_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    last_notice_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    last_notice_local_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    interaction_started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    last_turn_started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


__all__ = ["ORMCompanionSafetyState"]
