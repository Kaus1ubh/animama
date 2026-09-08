"""Tag and PassageTag ORM models for efficient tag querying"""

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase

if TYPE_CHECKING:
    from .archive_passage import ORMArchivePassage


class ORMTag(SqlalchemyBase, TimestampMixin):
    """Tags that can be associated with passages"""

    __tablename__ = "tags"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)

    # Relationships
    passages: Mapped[list["ORMPassageTag"]] = relationship(
        "ORMPassageTag", back_populates="tag", cascade="all, delete-orphan"
    )


class ORMPassageTag(SqlalchemyBase, TimestampMixin):
    """Junction table linking passages to tags"""

    __tablename__ = "passage_tags"

    passage_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("archive_passages.id", ondelete="CASCADE"), primary_key=True
    )
    tag_id: Mapped[int] = mapped_column(Integer, ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True)

    # Relationships
    passage: Mapped["ORMArchivePassage"] = relationship("ORMArchivePassage", back_populates="passage_tags")
    tag: Mapped["ORMTag"] = relationship("ORMTag", back_populates="passages")
