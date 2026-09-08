from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    TIMESTAMP,
    Boolean,
    CheckConstraint,
    Computed,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    Text,
    text as sa_text,
)
from sqlalchemy.dialects.postgresql import JSONB, TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .sqlalchemy_base import SqlalchemyBase


class ORMChatMessage(SqlalchemyBase):
    """Persisted message row belonging directly to a chat."""

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    chat_id: Mapped[str] = mapped_column(String, ForeignKey("chats.id", ondelete="CASCADE"), nullable=False)
    run_id: Mapped[str | None] = mapped_column(String, nullable=True)
    message_type: Mapped[str | None] = mapped_column(String, nullable=True)
    role: Mapped[str | None] = mapped_column(String, nullable=True)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    model: Mapped[str | None] = mapped_column(String, nullable=True)
    model_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed(
            "to_tsvector('english'::regconfig, "
            "coalesce(nullif("
            "coalesce(nullif(message_data #>> '{structured,speech}', ''), '') || "
            "case when nullif(message_data #>> '{structured,speech}', '') is not null "
            "and nullif(message_data #>> '{structured,display}', '') is not null "
            "then ' ' else '' end || "
            "coalesce(nullif(message_data #>> '{structured,display}', ''), ''), ''), "
            "content, ''::text))",
            persisted=True,
        ),
        nullable=False,
    )
    message_data: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=sa_text("'{}'::jsonb"))
    raw_provider_message: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cached_input_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    output_reasoning_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    turn: Mapped[int | None] = mapped_column(Integer, nullable=True)
    internal: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default=sa_text("false"))
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )

    chat = relationship("ORMChat", back_populates="messages")

    __table_args__ = (
        CheckConstraint("turn IS NULL OR turn >= 1", name="ck_chat_messages_turn_positive"),
        ForeignKeyConstraint(
            ["model_provider", "model"],
            ["model_providers.provider_type", "model_providers.model"],
            name="fk_chat_messages_model_provider_pair",
        ),
        Index("idx_chat_messages_chat_time", "chat_id", "created_at"),
        Index("idx_chat_messages_chat_turn", "chat_id", "turn"),
        Index("uq_chat_messages_chat_turn", "chat_id", "turn", unique=True),
        Index("idx_chat_messages_run_id", "run_id"),
        Index("idx_chat_messages_model_provider", "model_provider", "model"),
        Index("idx_chat_messages_chat_model_provider", "chat_id", "model_provider", "model"),
        Index(
            "ix_chat_messages_content_fts",
            "search_vector",
            postgresql_using="gin",
            postgresql_where=sa_text("internal IS false AND role IN ('user', 'assistant') AND content IS NOT NULL"),
        ),
    )


ChatMessage = ORMChatMessage

__all__ = ["ORMChatMessage", "ChatMessage"]
