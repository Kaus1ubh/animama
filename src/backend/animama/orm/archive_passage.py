from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, ForeignKey, Integer, String, Text, text as sa_text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import vector_type
from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase

if TYPE_CHECKING:
    from .archive import ORMArchive
    from .tag import ORMPassageTag


class ORMArchivePassage(SqlalchemyBase, TimestampMixin):
    """Passages stored in archives as archival memories"""

    __tablename__ = "archive_passages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    archive_id: Mapped[str] = mapped_column(String, ForeignKey("archives.id", ondelete="CASCADE"), nullable=False)

    # Content fields
    text: Mapped[str] = mapped_column(Text, nullable=False, doc="Passage text content")

    embedding: Mapped[list[float] | None] = mapped_column(vector_type(), nullable=True)
    # Catalog row id of the embedding model that produced ``embedding``.
    embedding_model_id: Mapped[str | None] = mapped_column(String, nullable=True)
    # Times ``embedding_rejected_model_id`` rejected this text on its own;
    # re-embedding records it without a vector after the third rejection.
    embedding_rejections: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default=sa_text("0"))
    embedding_rejected_model_id: Mapped[str | None] = mapped_column(String, nullable=True)

    # Metadata fields
    tags: Mapped[list[str] | None] = mapped_column(JSON, nullable=True, doc="Tags associated with this passage")
    metadata_: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True, doc="Additional metadata")

    # Source tracking (optional)
    source_id: Mapped[str | None] = mapped_column(String, nullable=True, doc="The data source of the passage")
    file_id: Mapped[str | None] = mapped_column(String, nullable=True, doc="The file this passage was derived from")

    # Relationships
    archive: Mapped["ORMArchive"] = relationship("ORMArchive", lazy="selectin")
    passage_tags: Mapped[list["ORMPassageTag"]] = relationship(
        "ORMPassageTag", back_populates="passage", cascade="all, delete-orphan", lazy="selectin"
    )
