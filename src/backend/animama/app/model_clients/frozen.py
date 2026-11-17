"""Immutable copies of provider metadata, so stream consumers cannot mutate it."""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Any


def freeze_value(value: Any) -> Any:
    """Recursively freeze provider metadata: mappings, sequences and sets become read-only."""

    if isinstance(value, Mapping):
        return MappingProxyType({str(key): freeze_value(item) for key, item in value.items()})
    if isinstance(value, list | tuple):
        return tuple(freeze_value(item) for item in value)
    if isinstance(value, set | frozenset):
        return frozenset(freeze_value(item) for item in value)
    return value


def frozen_mapping(value: Mapping[str, Any] | None) -> Mapping[str, Any]:
    """Return an immutable mapping for provider metadata fields."""

    if value is None:
        return MappingProxyType({})
    frozen = freeze_value(value)
    if not isinstance(frozen, Mapping):
        return MappingProxyType({})
    return frozen


__all__ = ["freeze_value", "frozen_mapping"]
