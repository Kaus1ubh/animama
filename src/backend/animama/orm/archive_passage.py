import os
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase

if TYPE_CHECKING:
    from .archive import ORMArchive
    from .tag import ORMPassageTag

try:
    from pgvector.sqlalchemy import Vector  # type: ignore
except ImportError:
    Vector = None

# Get embedding dimension from environment or use default
# This allows flexibility for different embedding models
EMBEDDING_DIM = int(os.getenv("ANIMAMA_EMBEDDING_DIM", "1536"))


class ORMArchivePassage(SqlalchemyBase, TimestampMixin):
    """Passages stored in archives as archival memories"""

    __tablename__ = "archive_passages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    archive_id: Mapped[str] = mapped_column(String, ForeignKey("archives.id", ondelete="CASCADE"), nullable=False)

    # Content fields
    text: Mapped[str] = mapped_column(Text, nullable=False, doc="Passage text content")

    # Embedding field - use pgvector if available, otherwise JSON
    # Using dimensionless Vector() for maximum flexibility, or configurable dimension
    if Vector is not None:
        try:
            # Try dimensionless vector first (pgvector 0.5.0+)
            _embedding_col = Vector()
        except (TypeError, ValueError):
            # Fall back to configured dimension
            _embedding_col = Vector(EMBEDDING_DIM)
    else:
        _embedding_col = JSON

    embedding: Mapped[list[float] | None] = mapped_column(_embedding_col, nullable=True)

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
