"""Per-Anima Reflection coverage of chat history."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import TIMESTAMP, CheckConstraint, ForeignKey, Integer, String, text as sa_text
from sqlalchemy.orm import Mapped, mapped_column

from .sqlalchemy_base import SqlalchemyBase


class ORMAnimaMemoryReflection(SqlalchemyBase):
    """The last chat message an applied Reflection covered for one Anima.

    The row is removed with its Anima. ``run_id`` records the Reflection whose
    approved ``MEMORIES.md`` change set the coverage; it has no foreign key so
    coverage never depends on Memory Manager run retention.
    """

    __tablename__ = "anima_memory_reflections"
    __table_args__ = (CheckConstraint("covered_through_message_id >= 1", name="message_id_positive"),)

    anima_id: Mapped[str] = mapped_column(String, ForeignKey("anima.id", ondelete="CASCADE"), primary_key=True)
    user_id: Mapped[str] = mapped_column(String, nullable=False)
    covered_through_created_at: Mapped[datetime] = mapped_column(TIMESTAMP(timezone=False), nullable=False)
    covered_through_message_id: Mapped[int] = mapped_column(Integer, nullable=False)
    run_id: Mapped[str] = mapped_column(String, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        TIMESTAMP(timezone=False),
        nullable=False,
        server_default=sa_text("CURRENT_TIMESTAMP"),
        onupdate=sa_text("CURRENT_TIMESTAMP"),
    )


__all__ = ["ORMAnimaMemoryReflection"]
