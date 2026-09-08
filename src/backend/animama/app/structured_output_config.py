from __future__ import annotations

from collections.abc import Mapping
from typing import Any

STRUCTURED_OUTPUT_COLLECTION_VERSION = 2
STRUCTURED_OUTPUT_OUTPUTS_KEY = "outputs"


def build_structured_output_collection(
    *,
    outputs: Mapping[str, Mapping[str, Any]] | None = None,
    default: str | None = None,
) -> dict[str, Any]:
    normalized_outputs: dict[str, dict[str, Any]] = {}
    for key, value in (outputs or {}).items():
        kind = str(key).strip()
        if not kind:
            continue
        payload = dict(value)
        payload.setdefault("kind", kind)
        normalized_outputs[kind] = payload

    result: dict[str, Any] = {
        "version": STRUCTURED_OUTPUT_COLLECTION_VERSION,
        STRUCTURED_OUTPUT_OUTPUTS_KEY: normalized_outputs,
    }
    if default and default in normalized_outputs:
        result["default"] = default
    return result


def get_structured_output_schema(
    structured_output: Mapping[str, Any] | None,
    kind: str,
) -> dict[str, Any] | None:
    if not isinstance(structured_output, Mapping):
        return None
    outputs = structured_output.get(STRUCTURED_OUTPUT_OUTPUTS_KEY)
    if not isinstance(outputs, Mapping):
        return None
    schema = outputs.get(kind)
    return dict(schema) if isinstance(schema, Mapping) else None


def get_default_structured_output_schema(structured_output: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(structured_output, Mapping):
        return None
    default = structured_output.get("default")
    if not isinstance(default, str) or not default.strip():
        return None
    return get_structured_output_schema(structured_output, default.strip())


def set_structured_output_schema(
    structured_output: Mapping[str, Any] | None,
    *,
    kind: str,
    schema: Mapping[str, Any],
    default: bool = False,
) -> dict[str, Any]:
    existing_outputs = (
        structured_output.get(STRUCTURED_OUTPUT_OUTPUTS_KEY) if isinstance(structured_output, Mapping) else None
    )
    outputs: dict[str, dict[str, Any]] = {}
    if isinstance(existing_outputs, Mapping):
        for key, value in existing_outputs.items():
            if isinstance(value, Mapping):
                outputs[str(key)] = dict(value)

    output_kind = str(kind).strip()
    payload = dict(schema)
    payload.setdefault("kind", output_kind)
    outputs[output_kind] = payload

    current_default = structured_output.get("default") if isinstance(structured_output, Mapping) else None
    default_kind = output_kind if default else (current_default if isinstance(current_default, str) else None)
    return build_structured_output_collection(outputs=outputs, default=default_kind)


def has_structured_output_schema(structured_output: Mapping[str, Any] | None, kind: str) -> bool:
    return get_structured_output_schema(structured_output, kind) is not None


__all__ = [
    "STRUCTURED_OUTPUT_COLLECTION_VERSION",
    "STRUCTURED_OUTPUT_OUTPUTS_KEY",
    "build_structured_output_collection",
    "get_default_structured_output_schema",
    "get_structured_output_schema",
    "has_structured_output_schema",
    "set_structured_output_schema",
]
