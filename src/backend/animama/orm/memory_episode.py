from __future__ import annotations

from datetime import date, datetime
from typing import Any

from sqlalchemy import TIMESTAMP, CheckConstraint, Date, Index, String, Text, text as sa_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMMemoryEpisodeItem(SqlalchemyBase, TimestampMixin):
    """Source-of-truth row for a raw episodic memory note."""

    __tablename__ = "memory_episode_items"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'processed')",
            name="memory_episode_items_status_valid",
        ),
        CheckConstraint("length(text) > 0", name="memory_episode_items_text_non_empty"),
        CheckConstraint("length(episode_path) > 0", name="memory_episode_items_episode_path_non_empty"),
        Index("ix_memory_episode_items_user_status_occurred", "user_id", "status", "occurred_at"),
        Index("ix_memory_episode_items_user_local_date_occurred", "user_id", "local_date", "occurred_at"),
        Index("ix_memory_episode_items_user_episode_path", "user_id", "episode_path"),
        Index("ix_memory_episode_items_source_chat_run", "source_chat_id", "source_run_id"),
        Index(
            "uq_memory_episode_items_chat_turn_run",
            "user_id",
            "source_chat_id",
            "source_run_id",
            "kind",
            unique=True,
            postgresql_where=sa_text("source_chat_id IS NOT NULL AND source_run_id IS NOT NULL AND kind = 'chat_turn'"),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    source_anima_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    source_chat_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    source_run_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    source_message_id: Mapped[str | None] = mapped_column(String, nullable=True, index=True)
    occurred_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=True), nullable=False)
    local_date: Mapped[date] = mapped_column(Date, nullable=False)
    local_timezone: Mapped[str | None] = mapped_column(String(128), nullable=True)
    episode_path: Mapped[str] = mapped_column(String(512), nullable=False)
    kind: Mapped[str] = mapped_column(String, nullable=False, default="chat_turn", server_default="chat_turn")
    text: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, default="pending", server_default="pending")
    processed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)
    processed_by_run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        default=dict,
        server_default=sa_text("'{}'::jsonb"),
    )


MemoryEpisodeItem = ORMMemoryEpisodeItem

__all__ = ["MemoryEpisodeItem", "ORMMemoryEpisodeItem"]
