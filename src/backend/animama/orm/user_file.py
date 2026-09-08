from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, TIMESTAMP, BigInteger, CheckConstraint, Index, String, Text, text as sa_text
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMUserFile(SqlalchemyBase, TimestampMixin):
    """Account-owned original file upload metadata."""

    __tablename__ = "user_file"
    __table_args__ = (
        CheckConstraint("declared_size_bytes > 0", name="declared_size_bytes_positive"),
        CheckConstraint("stored_size_bytes IS NULL OR stored_size_bytes > 0", name="stored_size_bytes_positive"),
        Index("ix_user_file_user_id_created_at", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    storage_locator: Mapped[str] = mapped_column(String, nullable=False, unique=True, index=True)
    original_filename: Mapped[str] = mapped_column(String, nullable=False)
    normalized_extension: Mapped[str] = mapped_column(String, nullable=False)
    declared_content_type: Mapped[str | None] = mapped_column(String, nullable=True)
    detected_content_type: Mapped[str | None] = mapped_column(String, nullable=True)
    declared_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False)
    stored_size_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String, nullable=True)
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        index=True,
        server_default=sa_text("'pending_upload'"),
    )
    upload_expires_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    processed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict)


__all__ = ["ORMUserFile"]
