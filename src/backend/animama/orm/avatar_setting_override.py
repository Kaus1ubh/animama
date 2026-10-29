"""Owner-scoped per-Avatar settings: wind and ambient forces, wind strength, and materials."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import text as sa_text

from .sqlalchemy_base import SqlalchemyBase


class ORMAvatarSettingOverride(SqlalchemyBase):
    """One owner's non-Automatic settings for one Local or Included Avatar item.

    A NULL column means Automatic (for the wind strength, 100 percent), and
    the repository removes a row once every column is NULL. Rows are bound to
    the item only, not to its revision or model bytes, so an updated Avatar
    keeps them; deleting the catalog item removes them.
    """

    __tablename__ = "avatar_setting_overrides"
    __table_args__ = (
        CheckConstraint("spring_mode IN ('on', 'off', 'springs_off')", name="spring_mode_values"),
        CheckConstraint("wind_strength BETWEEN 0 AND 200", name="wind_strength_range"),
        CheckConstraint("material_mode IN ('liltoon', 'simple')", name="material_mode_values"),
    )

    owner_user_id: Mapped[str] = mapped_column(String, primary_key=True)
    avatar_item_id: Mapped[str] = mapped_column(
        String,
        ForeignKey(
            "content_catalog_items.id",
            ondelete="CASCADE",
            name="fk_avatar_setting_overrides_avatar_item_id",
        ),
        primary_key=True,
    )
    spring_mode: Mapped[str | None] = mapped_column(String, nullable=True)
    wind_strength: Mapped[int | None] = mapped_column(Integer, nullable=True)
    material_mode: Mapped[str | None] = mapped_column(String, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
        onupdate=sa_text("CURRENT_TIMESTAMP"),
    )


__all__ = ["ORMAvatarSettingOverride"]
