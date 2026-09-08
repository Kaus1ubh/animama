"""Durable Local content mutation results, retained after content deletion."""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, String, text
from sqlalchemy.dialects.postgresql import JSONB, TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from .sqlalchemy_base import SqlalchemyBase


class ORMContentMutationReceipt(SqlalchemyBase):
    """One immutable successful operation per owner, without a content item FK."""

    __tablename__ = "content_mutation_receipts"
    __table_args__ = (
        CheckConstraint("request_digest ~ '^[0-9a-f]{64}$'", name="content_mutation_digest"),
        CheckConstraint("jsonb_typeof(result) = 'object'", name="content_mutation_result_object"),
    )

    owner_user_id: Mapped[str] = mapped_column(String, primary_key=True)
    operation_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    request_digest: Mapped[str] = mapped_column(String(64), nullable=False)
    result: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=True), nullable=False, server_default=text("CURRENT_TIMESTAMP")
    )
