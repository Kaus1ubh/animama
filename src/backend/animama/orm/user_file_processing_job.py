from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import JSON, TIMESTAMP, ForeignKey, Index, Integer, String, Text, text as sa_text
from sqlalchemy.orm import Mapped, mapped_column

from animama.domain.user_file_processing import JOB_STATUS_QUEUED, JOB_TYPE_PROCESS_FILE

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMUserFileProcessingJob(SqlalchemyBase, TimestampMixin):
    """Durable processing queue row for user-file parser workers."""

    __tablename__ = "user_file_processing_job"
    __table_args__ = (
        Index("ix_user_file_processing_job_status_run_after_created_at", "status", "run_after", "created_at"),
        Index("ix_user_file_processing_job_file_status", "file_id", "status"),
        Index("ix_user_file_processing_job_user_created_at", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    file_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("user_file.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    job_type: Mapped[str] = mapped_column(String, nullable=False, server_default=sa_text(f"'{JOB_TYPE_PROCESS_FILE}'"))
    status: Mapped[str] = mapped_column(
        String,
        nullable=False,
        index=True,
        server_default=sa_text(f"'{JOB_STATUS_QUEUED}'"),
    )
    attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sa_text("0"))
    max_attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sa_text("3"))
    run_after: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
    )
    locked_by: Mapped[str | None] = mapped_column(String, nullable=True)
    locked_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict)


__all__ = ["ORMUserFileProcessingJob"]
