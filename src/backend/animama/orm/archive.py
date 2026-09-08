import uuid
from typing import TYPE_CHECKING, Any

from sqlalchemy import JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .mixins import OrganizationMixin, TimestampMixin
from .sqlalchemy_base import SqlalchemyBase

if TYPE_CHECKING:
    from .archive_passage import ORMArchivePassage


class ORMArchive(SqlalchemyBase, TimestampMixin, OrganizationMixin):
    """An archive represents a collection of archival passages owned by a anima."""

    __tablename__ = "archives"

    # Archive generates its own id
    id: Mapped[str] = mapped_column(String, primary_key=True, default=lambda: f"archive-{uuid.uuid4()}")

    # Archive-specific fields
    name: Mapped[str] = mapped_column(String, nullable=False, doc="The name of the archive")
    description: Mapped[str | None] = mapped_column(String, nullable=True, doc="A description of the archive")
    metadata_: Mapped[dict[str, Any] | None] = mapped_column(
        JSON, nullable=True, doc="Additional metadata for the archive"
    )

    # Relationships
    passages: Mapped[list["ORMArchivePassage"]] = relationship(
        "ORMArchivePassage",
        back_populates="archive",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
