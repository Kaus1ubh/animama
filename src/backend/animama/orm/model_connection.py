from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, CheckConstraint, Float, String
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMModelConnection(SqlalchemyBase, TimestampMixin):
    """Model server endpoint and credential reference for catalog rows.

    ``credential_env`` stores only an environment variable name; key values
    are never persisted.
    """

    __tablename__ = "model_connections"
    __table_args__ = (CheckConstraint("source IN ('builtin', 'owner')", name="source_valid"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    source: Mapped[str] = mapped_column(String, nullable=False, default="owner")
    name: Mapped[str] = mapped_column(String, nullable=False)
    preset: Mapped[str] = mapped_column(String, nullable=False)
    base_url: Mapped[str | None] = mapped_column(String, nullable=True)
    credential_env: Mapped[str | None] = mapped_column(String, nullable=True)
    compatibility: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    timeout_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


__all__ = ["ORMModelConnection"]
