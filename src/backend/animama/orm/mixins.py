from __future__ import annotations

from datetime import datetime

from sqlalchemy import TIMESTAMP, String, text as sa_text
from sqlalchemy.orm import Mapped, declarative_mixin, mapped_column


@declarative_mixin
class TimestampMixin:
    __abstract__ = True

    created_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False), nullable=False, server_default=sa_text("CURRENT_TIMESTAMP")
    )
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
        onupdate=sa_text("CURRENT_TIMESTAMP"),
    )


@declarative_mixin
class AuditMixin:
    __abstract__ = True

    created_by_id: Mapped[str | None] = mapped_column(String, nullable=True)
    last_updated_by_id: Mapped[str | None] = mapped_column(String, nullable=True)


@declarative_mixin
class OrganizationMixin:
    __abstract__ = True

    organization_id: Mapped[str | None] = mapped_column(String, nullable=True)
