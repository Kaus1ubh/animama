from __future__ import annotations

from datetime import datetime

from sqlalchemy import CheckConstraint, SmallInteger, Text, text as sa_text
from sqlalchemy.dialects.postgresql import TIMESTAMP
from sqlalchemy.orm import Mapped, mapped_column

from animama.orm.mixins import TimestampMixin
from animama.orm.sqlalchemy_base import SqlalchemyBase


class ORMInstallationSettings(SqlalchemyBase, TimestampMixin):
    """Durable local owner and first-run state for one installation."""

    __tablename__ = "installation_settings"
    __table_args__ = (CheckConstraint("id = 1", name="singleton_id"),)

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, server_default=sa_text("1"))
    installation_principal_id: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    first_run_completed_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=True), nullable=True)


__all__ = ["ORMInstallationSettings"]
