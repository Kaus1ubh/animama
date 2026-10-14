from __future__ import annotations

from typing import Any

from sqlalchemy import Boolean, ForeignKey, String, text as sa_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMUserSettings(SqlalchemyBase, TimestampMixin):
    __tablename__ = "user_settings"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    theme: Mapped[str] = mapped_column(String, nullable=False, server_default=sa_text("'anima'"))
    # UI Locale tag; NULL follows the system language. See ``domain.settings.UiLocale``.
    locale: Mapped[str | None] = mapped_column(String, nullable=True)
    last_active_anima_id: Mapped[str | None] = mapped_column(String, nullable=True)
    preferences: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=sa_text("'{}'::jsonb"))


class ORMAnimaSettings(SqlalchemyBase, TimestampMixin):
    __tablename__ = "anima_settings"

    user_id: Mapped[str] = mapped_column(String, primary_key=True)
    anima_id: Mapped[str] = mapped_column(String, ForeignKey("anima.id", ondelete="CASCADE"), primary_key=True)
    theme: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    background: Mapped[str | None] = mapped_column(String, nullable=True)
    favorited: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_text("false"))
    preferences: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, server_default=sa_text("'{}'::jsonb"))


__all__ = ["ORMUserSettings", "ORMAnimaSettings"]
