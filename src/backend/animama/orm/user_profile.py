"""Private local profile persistence."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, String, text as sa_text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from .sqlalchemy_base import SqlalchemyBase


class ORMUserProfile(SqlalchemyBase):
    """Nullable display name keyed by the local owner principal."""

    __tablename__ = "user_profiles"
    __table_args__ = (
        CheckConstraint(
            "display_name IS NULL OR char_length(display_name) BETWEEN 1 AND 80",
            name="display_name_length",
        ),
    )

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    display_name: Mapped[str | None] = mapped_column(String(80), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
        onupdate=sa_text("CURRENT_TIMESTAMP"),
    )


__all__ = ["ORMUserProfile"]
