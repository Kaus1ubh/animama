from __future__ import annotations

import inspect
from collections.abc import Mapping
from typing import Any


def jsonable(value: Any) -> Any:
    """Return a plain JSON-like value from immutable request mappings."""

    if isinstance(value, Mapping):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, tuple | list | set | frozenset):
        return [jsonable(item) for item in value]
    return value


def get_value(obj: Any, key: str, default: Any = None) -> Any:
    """Read a value from provider SDK objects or mapping-like payloads."""

    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


async def close_maybe_async(value: Any) -> None:
    """Call ``close``/``aclose`` on SDK resources when present."""

    for name in ("aclose", "close"):
        close = getattr(value, name, None)
        if not callable(close):
            continue
        result = close()
        if inspect.isawaitable(result):
            await result
        return


__all__ = [
    "close_maybe_async",
    "get_value",
    "jsonable",
]
