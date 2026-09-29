from __future__ import annotations

from sqlalchemy import CheckConstraint, Float, String
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase

WEB_SEARCH_SETTINGS_ID = "installation"


class ORMWebSearchSettings(SqlalchemyBase, TimestampMixin):
    """The installation's application web search backend (at most one row).

    ``credential_env`` stores only an environment variable name; key values
    are never persisted.
    """

    __tablename__ = "web_search_settings"
    __table_args__ = (
        CheckConstraint("id = 'installation'", name="single_row"),
        CheckConstraint("backend IN ('searxng', 'brave')", name="backend_valid"),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True, default=WEB_SEARCH_SETTINGS_ID)
    backend: Mapped[str] = mapped_column(String, nullable=False)
    base_url: Mapped[str | None] = mapped_column(String, nullable=True)
    credential_env: Mapped[str | None] = mapped_column(String, nullable=True)
    timeout_seconds: Mapped[float | None] = mapped_column(Float, nullable=True)


__all__ = ["ORMWebSearchSettings", "WEB_SEARCH_SETTINGS_ID"]
