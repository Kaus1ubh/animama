from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text, UniqueConstraint, text as sa_text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .mixins import AuditMixin, TimestampMixin
from .sqlalchemy_base import SqlalchemyBase

if TYPE_CHECKING:
    from .anima import ORMAnima


class ORMAvatar(SqlalchemyBase, TimestampMixin, AuditMixin):
    """Avatar: VRM avatar model available for animas."""

    __tablename__ = "avatar"
    # Names are unique within one owner. NULLS NOT DISTINCT makes the ownerless
    # Included/seeded rows one shared namespace instead of exempting them.
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_avatar_owner_name", postgresql_nulls_not_distinct=True),
    )

    id: Mapped[str] = mapped_column(String, primary_key=True)
    name: Mapped[str] = mapped_column(String, nullable=False)
    file_path: Mapped[str] = mapped_column(String, nullable=False)
    identity: Mapped[str] = mapped_column(Text, nullable=False, server_default=sa_text("''"))
    # Optional creator (application-level FK to auth user id)
    user_id: Mapped[str | None] = mapped_column(String, nullable=True)
    model_type: Mapped[str] = mapped_column(String, nullable=False, server_default=sa_text("'vrm'"))
    animation_profile: Mapped[str | None] = mapped_column(String, nullable=True)
    private: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=sa_text("false"))
    catalog_item_id: Mapped[str | None] = mapped_column(
        String,
        ForeignKey("content_catalog_items.id", ondelete="RESTRICT"),
        nullable=True,
        unique=True,
    )
    presentation_revision: Mapped[int] = mapped_column(Integer, nullable=False, server_default=sa_text("1"))

    # Backref to animas using this avatar
    animas: Mapped[list[ORMAnima]] = relationship(
        "ORMAnima",
        back_populates="avatar",
        lazy="selectin",
        # Let the RESTRICT FK reject deletion; never silently clear a live
        # Anima's guarded Avatar selection through ORM relationship cascades.
        passive_deletes="all",
    )


__all__ = ["ORMAvatar"]
