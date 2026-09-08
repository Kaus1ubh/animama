from __future__ import annotations

import importlib
from typing import Any

from sqlalchemy import MetaData
from sqlalchemy.dialects.postgresql import JSONB
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


# Optional pgvector support (import at runtime; type-agnostic for mypy)
try:  # pragma: no cover - optional dependency
    _pgv = importlib.import_module("pgvector.sqlalchemy")
    _Vector = getattr(_pgv, "Vector", None)
except Exception:  # pragma: no cover - optional dependency
    _Vector = None

Vector: Any | None = _Vector


def vector_type(dim: int | None = None) -> Any:
    """Return a SQLAlchemy type to store embeddings.

    - If pgvector is installed, returns Vector(dim) or Vector() if dim is None.
    - Otherwise, returns JSONB as a fallback.
    """
    if Vector is not None:
        return Vector(dim) if dim else Vector()
    return JSONB
