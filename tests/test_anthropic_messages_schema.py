from __future__ import annotations

from typing import Any

import pytest

from animama.adapters.model_clients.anthropic_messages.schema import anthropic_strict_schema
from animama.app.chat.memory_tools import memory_tool_specs
from animama.app.main_structured_response import (
    build_main_structured_response_json_schema,
    build_main_structured_response_model,
)


def _walk(schema: object) -> list[dict[str, object]]:
    found: list[dict[str, object]] = []
    if isinstance(schema, dict):
        found.append(schema)
        for value in schema.values():
            found.extend(_walk(value))
    elif isinstance(schema, list):
        for value in schema:
            found.extend(_walk(value))
    return found


def test_nullable_type_list_becomes_any_of_with_filtered_enum() -> None:
    schema = {
        "type": "object",
        "properties": {
            "gesture": {
                "description": "Optional gesture id.",
                "enum": [None, "wave"],
                "type": ["string", "null"],
            }
        },
        "required": ["gesture"],
        "additionalProperties": False,
    }

    gesture = anthropic_strict_schema(schema)["properties"]["gesture"]

    assert gesture["description"] == "Optional gesture id."
    assert gesture["anyOf"] == [{"type": "string", "enum": ["wave"]}, {"type": "null"}]
    assert "type" not in gesture


def test_nullable_enum_with_only_null_collapses_to_a_null_type() -> None:
    output_type = build_main_structured_response_model(agent_id="no-gestures", gesture_ids=())

    converted = anthropic_strict_schema(build_main_structured_response_json_schema(output_type))
    gesture = converted["properties"]["gesture"]

    assert gesture["type"] == "null"
    assert "anyOf" not in gesture
    assert all(node.get("enum") != [] for node in _walk(converted))


def test_enum_without_null_does_not_admit_null() -> None:
    schema = {"type": ["string", "null"], "enum": ["a", "b"], "description": "Letter."}

    converted = anthropic_strict_schema(schema)

    assert converted == {"type": "string", "enum": ["a", "b"], "description": "Letter."}


def test_unsatisfiable_type_list_fails_clearly() -> None:
    with pytest.raises(ValueError, match="admits no value"):
        anthropic_strict_schema({"type": ["string", "null"], "enum": [5]})


def test_unsupported_constraints_move_into_descriptions() -> None:
    schema = {
        "type": "object",
        "properties": {
            "count": {"type": "integer", "minimum": 1, "maximum": 5, "description": "How many."},
            "paths": {"type": "array", "items": {"type": "string"}, "maxItems": 10},
        },
        "required": ["count", "paths"],
        "additionalProperties": False,
    }

    converted = anthropic_strict_schema(schema)

    count = converted["properties"]["count"]
    assert "minimum" not in count and "maximum" not in count
    assert "minimum: 1" in count["description"] and "maximum: 5" in count["description"]
    assert "maxItems" not in converted["properties"]["paths"]


def test_input_schema_is_not_mutated() -> None:
    schema: dict[str, Any] = {"type": "object", "properties": {"x": {"type": ["string", "null"]}}, "required": ["x"]}

    anthropic_strict_schema(schema)

    assert schema["properties"]["x"]["type"] == ["string", "null"]


def test_application_schemas_convert_without_type_lists_or_unsupported_keywords() -> None:
    output_type = build_main_structured_response_model(agent_id="schema-test", gesture_ids=("wave", "nod"))
    schemas = [build_main_structured_response_json_schema(output_type)]
    schemas += [
        spec["function"]["parameters"]
        for spec in memory_tool_specs(allow_reads=True, allow_writes=True, allow_uploaded_file_tools=True)
    ]

    for schema in schemas:
        for node in _walk(anthropic_strict_schema(schema)):
            assert not isinstance(node.get("type"), list)
            assert {"maxItems", "minimum", "maximum"}.isdisjoint(node)
            if node.get("type") == "object":
                assert node.get("additionalProperties") is False
