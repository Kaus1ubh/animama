from __future__ import annotations

from datetime import datetime

from sqlalchemy import TIMESTAMP, ForeignKey, Integer, String, Text, text as sa_text
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMAvatarUpload(SqlalchemyBase, TimestampMixin):
    """Staged private asset upload tracked before anima finalization."""

    __tablename__ = "avatar_upload"

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    storage_locator: Mapped[str] = mapped_column(String, nullable=False, unique=True)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    declared_content_type: Mapped[str | None] = mapped_column(String, nullable=True)
    declared_size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    upload_type: Mapped[str] = mapped_column(String, nullable=False, server_default=sa_text("'avatar_vrm'"))
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=sa_text("'pending'"))
    expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    avatar_id: Mapped[str | None] = mapped_column(String, ForeignKey("avatar.id", ondelete="SET NULL"), nullable=True)
    anima_id: Mapped[str | None] = mapped_column(String, ForeignKey("anima.id", ondelete="SET NULL"), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


__all__ = ["ORMAvatarUpload"]
