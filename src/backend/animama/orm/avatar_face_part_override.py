"""Owner-scoped face-part corrections for read-only (Included) Avatars."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, ForeignKey, String
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import text as sa_text

from .sqlalchemy_base import SqlalchemyBase


class ORMAvatarFacePartOverride(SqlalchemyBase):
    """One owner's ``animama/avatar-face-parts/1`` correction for one Avatar item.

    Included Avatar bytes are never written, so the correction lives here and
    applies only while ``avatar_revision_sha256`` still equals the item's current
    revision. A stale row is ignored rather than deleted; deleting the catalog
    item removes it.
    """

    __tablename__ = "avatar_face_part_overrides"
    __table_args__ = (
        CheckConstraint(
            "avatar_revision_sha256 ~ '^[0-9a-f]{64}$'",
            name="avatar_revision_sha256_format",
        ),
        CheckConstraint("jsonb_typeof(parts) = 'object'", name="parts_object"),
    )

    owner_user_id: Mapped[str] = mapped_column(String, primary_key=True)
    avatar_item_id: Mapped[str] = mapped_column(
        String,
        ForeignKey(
            "content_catalog_items.id",
            ondelete="CASCADE",
            name="fk_avatar_face_part_overrides_avatar_item_id",
        ),
        primary_key=True,
    )
    avatar_revision_sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    # The complete validated correction object, including ``schema`` and ``vrm_sha256``.
    parts: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
        onupdate=sa_text("CURRENT_TIMESTAMP"),
    )


__all__ = ["ORMAvatarFacePartOverride"]
