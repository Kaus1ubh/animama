from __future__ import annotations

from typing import Any

from sqlalchemy import (
    JSON,
    BigInteger,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
    text as sa_text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import vector_type
from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMUserFileChunk(SqlalchemyBase, TimestampMixin):
    """Searchable chunk extracted from an account-owned uploaded file."""

    __tablename__ = "user_file_chunk"
    __table_args__ = (
        UniqueConstraint("file_id", "chunk_index", name="uq_user_file_chunk_file_id_chunk_index"),
        Index("ix_user_file_chunk_user_file", "user_id", "file_id"),
        Index("ix_user_file_chunk_user_created_at", "user_id", "created_at"),
        Index("ix_user_file_chunk_user_embedding_model", "user_id", "embedding_model_id"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    file_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("user_file.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # Contextualized text that was embedded, when it differs from ``text``;
    # re-embedding uses it so refreshed vectors match freshly processed ones.
    embedding_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(vector_type(), nullable=True)
    # Catalog row id of the embedding model that produced ``embedding``.
    embedding_model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Times ``embedding_rejected_model_id`` rejected this text on its own;
    # re-embedding records it without a vector after the third rejection.
    embedding_rejections: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=sa_text("0"))
    embedding_rejected_model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    char_count: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    token_estimate: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict)


Index(
    "ix_user_file_chunk_text_fts",
    func.to_tsvector(sa_text("'english'"), ORMUserFileChunk.text),
    postgresql_using="gin",
)


__all__ = ["ORMUserFileChunk"]
