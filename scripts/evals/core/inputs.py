"""JSON input helpers shared by the evaluation tools."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable, Mapping
from pathlib import Path
from typing import Any

__all__ = ["EvalInputError", "read_json", "require_unique", "required_text"]


class EvalInputError(ValueError):
    """A loadout, prompt set or option the harness cannot use."""


def read_json(path: Path) -> tuple[Any, str]:
    """Return a file's parsed JSON and the SHA-256 of the exact bytes parsed."""

    try:
        raw = path.read_bytes()
        return json.loads(raw.decode("utf-8")), hashlib.sha256(raw).hexdigest()
    except (OSError, ValueError) as exc:
        raise EvalInputError(f"{path}: cannot read JSON ({exc})") from exc


def required_text(entry: Mapping[str, Any], key: str, where: str) -> str:
    value = entry.get(key)
    if not isinstance(value, str) or not value.strip():
        raise EvalInputError(f"{where}: {key!r} must be a non-empty string")
    return value.strip()


def require_unique(ids: Iterable[str], where: str) -> None:
    seen: set[str] = set()
    for item_id in ids:
        if item_id in seen:
            raise EvalInputError(f"{where}: duplicate id {item_id!r}")
        seen.add(item_id)
