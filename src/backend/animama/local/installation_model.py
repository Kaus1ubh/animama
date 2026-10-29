from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, SmallInteger, String, Text, text as sa_text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from animama.orm.mixins import TimestampMixin
from animama.orm.sqlalchemy_base import SqlalchemyBase


class ORMInstallationSettings(SqlalchemyBase, TimestampMixin):
    """Durable local owner and first-run state for one installation."""

    __tablename__ = "installation_settings"
    __table_args__ = (CheckConstraint("id = 1", name="singleton_id"),)

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, server_default=sa_text("1"))
    installation_principal_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    first_run_completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


class ORMEpisodeProcessingSettings(SqlalchemyBase, TimestampMixin):
    """The owner's automatic episode-processing setting (spec #775, R11), local composition only.

    Its own table rather than user preferences, which a settings save replaces wholesale,
    and rather than ``installation_settings``, so a database created before it still starts.
    """

    __tablename__ = "episode_processing_settings"
    __table_args__ = (
        CheckConstraint(
            "threshold IS NULL OR threshold = 0 OR threshold BETWEEN 5 AND 50",
            name="threshold_valid",
        ),
    )

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    # NULL is the default threshold and 0 is Off.
    threshold: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    # When the threshold last changed; failures before it no longer pause processing.
    reset_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


__all__ = ["ORMEpisodeProcessingSettings", "ORMInstallationSettings"]
