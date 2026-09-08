from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import TIMESTAMP, CheckConstraint, ForeignKey, Index, Integer, String, Text, text as sa_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMChatCompaction(SqlalchemyBase, TimestampMixin):
    """Persisted compaction summary for covered chat history."""

    __tablename__ = "chat_compactions"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active', 'superseded', 'failed')",
            name="ck_chat_cmp_status",
        ),
        CheckConstraint("source_message_count >= 0", name="ck_chat_cmp_source_msg_nonneg"),
        CheckConstraint(
            "input_tokens IS NULL OR input_tokens >= 0",
            name="ck_chat_cmp_input_nonneg",
        ),
        CheckConstraint(
            "output_tokens IS NULL OR output_tokens >= 0",
            name="ck_chat_cmp_output_nonneg",
        ),
        CheckConstraint(
            "cached_input_tokens IS NULL OR cached_input_tokens >= 0",
            name="ck_chat_cmp_cached_input_nonneg",
        ),
        CheckConstraint(
            "output_reasoning_tokens IS NULL OR output_reasoning_tokens >= 0",
            name="ck_chat_cmp_reasoning_nonneg",
        ),
        CheckConstraint(
            "total_tokens IS NULL OR total_tokens >= 0",
            name="ck_chat_cmp_total_nonneg",
        ),
        CheckConstraint(
            "start_turn IS NULL OR start_turn >= 1",
            name="ck_chat_cmp_start_turn_positive",
        ),
        CheckConstraint(
            "end_turn IS NULL OR end_turn >= 1",
            name="ck_chat_cmp_end_turn_positive",
        ),
        CheckConstraint(
            "start_turn IS NULL OR end_turn IS NULL OR start_turn <= end_turn",
            name="ck_chat_cmp_turn_order",
        ),
        Index("idx_chat_compactions_chat_status_created", "chat_id", "status", "created_at"),
        Index("idx_chat_compactions_chat_end_turn", "chat_id", "end_turn"),
        Index("idx_chat_compactions_user_created", "user_id", "created_at"),
        Index("idx_chat_compactions_anima_created", "anima_id", "created_at"),
        Index(
            "uq_chat_compactions_active_chat",
            "chat_id",
            unique=True,
            postgresql_where=sa_text("status = 'active'"),
        ),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    chat_id: Mapped[str] = mapped_column(String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    anima_id: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, server_default=sa_text("'active'"))
    summary_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    start_turn: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_turn: Mapped[int | None] = mapped_column(Integer, nullable=True)
    source_message_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sa_text("0"))
    model_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    prompt_version: Mapped[str | None] = mapped_column(String, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cached_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_reasoning_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=sa_text("'{}'::jsonb"),
    )
    superseded_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=False), nullable=True)


ChatCompaction = ORMChatCompaction

__all__ = ["ORMChatCompaction", "ChatCompaction"]
