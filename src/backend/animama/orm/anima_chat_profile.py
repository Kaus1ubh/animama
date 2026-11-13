from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import ForeignKey, String, text as sa_text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase

if TYPE_CHECKING:
    from .anima import ORMAnima
    from .model_provider import ORMModelProvider


class ORMAnimaChatProfile(SqlalchemyBase, TimestampMixin):
    """Anima-level default model provider and reasoning effort for direct chat."""

    __tablename__ = "anima_chat_profiles"

    anima_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("anima.id", ondelete="CASCADE"),
        primary_key=True,
    )
    default_model_provider_id: Mapped[str] = mapped_column(
        String,
        ForeignKey("model_providers.id"),
        nullable=False,
    )
    # The owner's effort for the default model; null means that model's default.
    reasoning_effort: Mapped[str | None] = mapped_column(String(16), nullable=True)
    metadata_: Mapped[dict[str, Any]] = mapped_column(
        "metadata",
        JSONB,
        nullable=False,
        server_default=sa_text("'{}'::jsonb"),
    )

    anima: Mapped[ORMAnima] = relationship("ORMAnima", lazy="selectin")
    default_model_provider: Mapped[ORMModelProvider] = relationship("ORMModelProvider", lazy="selectin")


AnimaChatProfile = ORMAnimaChatProfile

__all__ = ["ORMAnimaChatProfile", "AnimaChatProfile"]
