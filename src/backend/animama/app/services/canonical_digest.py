"""Canonical JSON and its SHA-256 digest, the form loadout and runtime revisions are hashed in.

Persisted revisions and request digests depend on these exact bytes: keys sorted,
no whitespace, and non-ASCII text kept literal before UTF-8 encoding.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> str:
    """Serialize ``value`` with sorted keys, compact separators and literal Unicode."""

    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def canonical_digest(value: Any) -> str:
    """Return the hex SHA-256 of ``canonical_json(value)`` encoded as UTF-8."""

    return hashlib.sha256(canonical_json(value).encode()).hexdigest()


__all__ = ["canonical_digest", "canonical_json"]
