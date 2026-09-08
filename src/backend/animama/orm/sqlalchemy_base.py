from __future__ import annotations

import inspect
from collections.abc import Callable, Iterable, Sequence
from functools import wraps
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.exc import TimeoutError
from sqlalchemy.ext.asyncio import AsyncSession

from .base import Base


def handle_db_timeout(func: Callable[..., Any]) -> Callable[..., Any]:
    """Decorator to convert SQLAlchemy TimeoutError into a cleaner exception."""
    if not inspect.iscoroutinefunction(func):

        @wraps(func)
        def wrapper(*args, **kwargs):
            try:
                return func(*args, **kwargs)
            except TimeoutError as e:  # pragma: no cover - relies on driver behavior
                raise RuntimeError(f"DB timeout in {func.__name__}") from e

        return wrapper

    @wraps(func)
    async def async_wrapper(*args, **kwargs):
        try:
            return await func(*args, **kwargs)
        except TimeoutError as e:  # pragma: no cover - relies on driver behavior
            raise RuntimeError(f"DB timeout in {func.__name__}") from e

    return async_wrapper


class SqlalchemyBase(Base):
    """Lightweight base with common async helpers for Anima ORM models.

    This intentionally provides a minimal surface (list/create/upsert/delete helpers)
    to avoid coupling to application-specific access control.
    """

    __abstract__ = True

    # -------------------------
    # Query helpers
    # -------------------------
    @classmethod
    @handle_db_timeout
    async def list_async(
        cls,
        *,
        db_session: AsyncSession,
        filters: dict[str, Any] | None = None,
        order_by: Any | None = None,
        limit: int | None = None,
        options: Sequence[Any] | None = None,
    ) -> list[Any]:
        stmt = select(cls)
        if filters:
            for key, value in filters.items():
                column = getattr(cls, key)
                stmt = stmt.where(column == value)
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        if limit is not None:
            stmt = stmt.limit(limit)
        if options:
            for opt in options:
                stmt = stmt.options(opt)
        res = await db_session.execute(stmt)
        return list(res.scalars())

    @classmethod
    @handle_db_timeout
    async def get_first_async(
        cls,
        *,
        db_session: AsyncSession,
        filters: dict[str, Any],
    ) -> Any | None:
        stmt = select(cls)
        for key, value in filters.items():
            column = getattr(cls, key)
            stmt = stmt.where(column == value)
        res = await db_session.execute(stmt)
        return res.scalars().first()

    # -------------------------
    # Mutation helpers
    # -------------------------
    @handle_db_timeout
    async def create_async(
        self,
        *,
        db_session: AsyncSession,
        commit: bool = True,
        refresh: bool = False,
    ) -> Any:
        db_session.add(self)
        if commit:
            await db_session.commit()
        else:  # Ensure PKs are assigned
            await db_session.flush()
        if refresh:
            await db_session.refresh(self)
        return self

    @classmethod
    @handle_db_timeout
    async def upsert_async(
        cls,
        *,
        db_session: AsyncSession,
        key_fields: dict[str, Any],
        update_fields: dict[str, Any] | None = None,
        commit: bool = True,
    ) -> SqlalchemyBase:
        update_fields = update_fields or {}
        stmt = select(cls)
        for k, v in key_fields.items():
            stmt = stmt.where(getattr(cls, k) == v)
        res = await db_session.execute(stmt)
        obj = res.scalars().first()
        if obj is None:
            obj = cls(**key_fields, **update_fields)
            db_session.add(obj)
        else:
            for k, v in update_fields.items():
                setattr(obj, k, v)
        if commit:
            await db_session.commit()
        else:
            await db_session.flush()
        return obj

    @classmethod
    @handle_db_timeout
    async def replace_rows_async(
        cls,
        *,
        db_session: AsyncSession,
        delete_filters: dict[str, Any],
        rows: Iterable[dict[str, Any]],
        commit: bool = True,
    ) -> None:
        del_stmt = delete(cls)
        for k, v in delete_filters.items():
            del_stmt = del_stmt.where(getattr(cls, k) == v)
        await db_session.execute(del_stmt)
        for row in rows:
            db_session.add(cls(**row))
        if commit:
            await db_session.commit()
        else:
            await db_session.flush()
