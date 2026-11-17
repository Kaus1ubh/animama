from __future__ import annotations

from typing import Any

# Imported directly, not through importlib: PyInstaller bundles only modules it
# can see, and a frozen runtime without pgvector cannot write vector columns.
from pgvector.sqlalchemy import Vector
from sqlalchemy import MetaData
from sqlalchemy.orm import DeclarativeBase

# Naming convention for Alembic-friendly migrations (optional but helpful)
NAMING_CONVENTION: dict[str, str] = {
    "ix": "ix_%(column_0_label)s",
    "uq": "uq_%(table_name)s_%(column_0_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)


def vector_type(dim: int | None = None) -> Any:
    """Return the pgvector column type that stores embeddings, with ``dim`` dimensions if given."""

    return Vector(dim) if dim else Vector()
