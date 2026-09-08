"""Neutral validation result and error types for typed content files."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


class ContentFileInvalidError(ValueError):
    """A file failed bounded structural or media validation."""

    def __init__(self, *, field: str, reason: str) -> None:
        super().__init__(f"Invalid {field}: {reason}")
        self.field = field
        self.reason = reason


@dataclass(frozen=True, slots=True)
class ContentFileValidation:
    """Trusted media type and metadata emitted by a bounded validator."""

    detected_media_type: str
    metadata: dict[str, Any]


__all__ = ["ContentFileInvalidError", "ContentFileValidation"]
