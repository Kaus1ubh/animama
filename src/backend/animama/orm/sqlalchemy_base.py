from __future__ import annotations

from .base import Base


class SqlalchemyBase(Base):
    """Abstract base for Animama ORM models; repositories own all query logic."""

    __abstract__ = True
