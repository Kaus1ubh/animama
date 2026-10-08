"""Convert application JSON schemas to Anthropic strict-schema form.

Anthropic strict tools and structured outputs accept a subset of JSON Schema.
The SDK's ``transform_schema`` moves unsupported constraints such as integer
bounds and ``maxItems`` into descriptions, but it rejects ``type`` lists such as
``["string", "null"]``, which Pydantic emits for optional fields. Those are
rewritten to ``anyOf`` first. Local validation still enforces the original
constraints after the model replies.
"""

from __future__ import annotations

import copy
from typing import Any

from anthropic import transform_schema

_TYPE_VALUE_CHECKS: dict[str, type | tuple[type, ...]] = {
    "string": str,
    "integer": int,
    "number": (int, float),
    "boolean": bool,
    "object": dict,
    "array": list,
}
_SHARED_KEYS = frozenset({"description", "title", "default"})


def anthropic_strict_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of ``schema`` that Anthropic strict mode accepts."""

    return transform_schema(_expand_type_lists(copy.deepcopy(schema)))


def _expand_type_lists(node: Any) -> Any:
    if isinstance(node, list):
        return [_expand_type_lists(item) for item in node]
    if not isinstance(node, dict):
        return node
    expanded = {key: _expand_type_lists(value) for key, value in node.items()}
    types = expanded.get("type")
    if not isinstance(types, list):
        return expanded
    shared = {key: expanded[key] for key in _SHARED_KEYS if key in expanded}
    specific = {key: value for key, value in expanded.items() if key not in _SHARED_KEYS | {"type", "enum"}}
    enum = expanded.get("enum")
    variants = []
    for type_name in types:
        variant: dict[str, Any] = {"type": type_name}
        if isinstance(enum, list):
            allowed = [value for value in enum if _matches_type(value, type_name)]
            # A type the enum gives no value for admits nothing; drop it rather
            # than emit an empty enum, or a null branch the enum excludes.
            if not allowed:
                continue
            if type_name != "null":
                variant["enum"] = allowed
        if type_name != "null":
            variant.update(specific)
        variants.append(variant)
    if not variants:
        raise ValueError(f"Schema admits no value: types {types!r} with enum {enum!r}.")
    if len(variants) == 1:
        return {**shared, **variants[0]}
    return {**shared, "anyOf": variants}


def _matches_type(value: Any, type_name: str) -> bool:
    if type_name == "null":
        return value is None
    expected = _TYPE_VALUE_CHECKS.get(type_name)
    if expected is None:
        return False
    if type_name in {"integer", "number"} and isinstance(value, bool):
        return False
    return isinstance(value, expected)


__all__ = ["anthropic_strict_schema"]
