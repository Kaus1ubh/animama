from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import asdict, is_dataclass
from datetime import date, datetime
from decimal import Decimal
from enum import Enum
from math import isfinite
from pathlib import Path
from typing import Any
from uuid import UUID

from animama.domain.usage import Usage


def json_safe_copy(value: Any) -> Any:
    """Return a JSON-shaped copy of nested metadata-like values."""

    if value is None or isinstance(value, str | bool | int):
        return value
    if isinstance(value, float):
        return value if isfinite(value) else None
    if isinstance(value, Decimal):
        return None if value.is_nan() or value.is_infinite() else str(value)
    if isinstance(value, datetime | date):
        return value.isoformat()
    if isinstance(value, UUID | Path):
        return str(value)
    if isinstance(value, Enum):
        return json_safe_copy(value.value)
    if isinstance(value, Usage):
        return {
            "requests": value.requests,
            "input_tokens": value.input_tokens,
            "output_tokens": value.output_tokens,
            "total_tokens": value.total_tokens,
        }
    if isinstance(value, Mapping):
        return {str(key): json_safe_copy(item) for key, item in value.items()}
    if isinstance(value, tuple | list):
        return [json_safe_copy(item) for item in value]
    if isinstance(value, set | frozenset):
        copied_items = [json_safe_copy(item) for item in value]
        return sorted(copied_items, key=repr)
    if is_dataclass(value) and not isinstance(value, type):
        return json_safe_copy(asdict(value))
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            return json_safe_copy(model_dump(mode="json"))
        except TypeError:
            return json_safe_copy(model_dump())
    if isinstance(value, bytes | bytearray | memoryview):
        return bytes(value).decode("utf-8", errors="replace")
    return str(value)


def json_safe_dict(value: Mapping[str, Any] | None) -> dict[str, Any]:
    """Return a dict whose nested values are safe for JSON/JSONB serialization."""

    copied = json_safe_copy(value or {})
    return copied if isinstance(copied, dict) else {}


def safe_json_loads(value: str) -> Any:
    try:
        return json.loads(value or "{}")
    except Exception:
        return value


__all__ = ["json_safe_copy", "json_safe_dict", "safe_json_loads"]
