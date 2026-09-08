from __future__ import annotations

from collections.abc import Mapping
from dataclasses import fields
from typing import Any

from animama.domain.usage import Usage

from .event_types import MCEvent

_MAX_DETAIL_STRING_LENGTH = 256
_MAX_DETAIL_SEQUENCE_LENGTH = 64
_MAX_DETAIL_MAPPING_KEYS = 64

_SAFE_DETAIL_KEYS = frozenset(
    {
        "action_type",
        "annotation_count",
        "annotation_index",
        "annotations_count",
        "argument_length",
        "arguments_fragment_length",
        "arguments_length",
        "choice0_used",
        "choice_finish_reasons",
        "choice_count",
        "choice_index",
        "choice_indexes",
        "choices_count",
        "chunk_index",
        "completed_missing",
        "content_index",
        "content_length",
        "created",
        "delta_field_names",
        "event_type",
        "field_names",
        "finish_reason",
        "finish_reasons",
        "function_name",
        "id",
        "incomplete_reason",
        "index",
        "item_id",
        "item_type",
        "logprobs_present",
        "model",
        "multi_choice",
        "missing_final_answer_phase",
        "object",
        "output_item_type",
        "phase_counts",
        "output_index",
        "path_length",
        "phase",
        "provider_event_type",
        "provider_error_code",
        "provider_error_param",
        "query_count",
        "refusal_length",
        "response_id",
        "result_count",
        "role",
        "kind",
        "sequence_number",
        "service_tier",
        "source_count",
        "status",
        "stream_position",
        "system_fingerprint",
        "text_length",
        "tool_call_id",
        "tool_call_index",
        "tool_name",
        "tool_type",
        "unknown_field_names",
        "usage_missing",
        "usage_seen",
    }
)

_SAFE_SUFFIXES = (
    "_count",
    "_counts",
    "_id",
    "_ids",
    "_index",
    "_indexes",
    "_length",
    "_lengths",
    "_name",
    "_names",
    "_reason",
    "_reasons",
    "_seen",
    "_status",
    "_type",
    "_types",
)

_UNSAFE_KEY_FRAGMENTS = (
    "api_key",
    "argument_json",
    "authorization",
    "bearer",
    "body",
    "content",
    "input",
    "message",
    "password",
    "payload",
    "prompt",
    "raw",
    "result",
    "secret",
    "text",
    "token",
    "url",
    "uri",
)


def sanitize_model_client_stream_event(event: MCEvent) -> dict[str, Any]:
    """Return a JSON-safe stream event summary without raw provider content."""

    payload: dict[str, Any] = {
        "provider_type": event.provider_type,
        "api": event.api,
        "model": event.model,
        "provider_event_type": event.provider_event_type,
        "kind": event.kind,
    }
    for event_field in fields(event):
        key = event_field.name
        if key in {"provider_type", "api", "model", "provider_event_type", "details", "kind", "usage"}:
            continue
        value = getattr(event, key)
        if value is not None and _is_safe_typed_field(key):
            payload[key] = value
    usage = getattr(event, "usage", None)
    if usage is not None:
        payload["usage"] = _usage_to_dict(usage)
    details = _sanitize_mapping(event.details)
    if details:
        payload["details"] = details
    return payload


def _is_safe_typed_field(key: str) -> bool:
    return key in {
        "action_type",
        "annotation_count",
        "arguments_fragment_length",
        "arguments_length",
        "content_index",
        "content_length",
        "finish_reason",
        "incomplete_reason",
        "item_id",
        "item_type",
        "logprobs_present",
        "output_index",
        "path_length",
        "phase",
        "provider_error_code",
        "provider_error_param",
        "query_count",
        "response_id",
        "result_count",
        "source_count",
        "status",
        "text_length",
        "tool_call_id",
        "tool_name",
        "tool_type",
    }


def _usage_to_dict(usage: Usage) -> dict[str, Any]:
    return {
        "requests": int(usage.requests or 0),
        "input_tokens": int(usage.input_tokens or 0),
        "output_tokens": int(usage.output_tokens or 0),
        "total_tokens": int(usage.total_tokens or 0),
        "input_tokens_details": {
            "cached_tokens": int(usage.input_tokens_details.cached_tokens or 0),
            "audio_tokens": int(getattr(usage.input_tokens_details, "audio_tokens", 0) or 0),
        },
        "output_tokens_details": {
            "reasoning_tokens": int(usage.output_tokens_details.reasoning_tokens or 0),
            "audio_tokens": int(getattr(usage.output_tokens_details, "audio_tokens", 0) or 0),
            "accepted_prediction_tokens": int(
                getattr(usage.output_tokens_details, "accepted_prediction_tokens", 0) or 0
            ),
            "rejected_prediction_tokens": int(
                getattr(usage.output_tokens_details, "rejected_prediction_tokens", 0) or 0
            ),
        },
    }


def _sanitize_mapping(value: Mapping[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for raw_key, raw_value in list(value.items())[:_MAX_DETAIL_MAPPING_KEYS]:
        key = str(raw_key).strip()
        if not _is_safe_key(key):
            continue
        sanitized = _sanitize_value(raw_value)
        if sanitized is not None:
            result[key] = sanitized
    return result


def _is_safe_key(key: str) -> bool:
    normalized = key.lower()
    if normalized in _SAFE_DETAIL_KEYS:
        return True
    if any(fragment in normalized for fragment in _UNSAFE_KEY_FRAGMENTS):
        return False
    return normalized.endswith(_SAFE_SUFFIXES)


def _sanitize_value(value: Any) -> Any:
    if value is None:
        return None
    if isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        stripped = value.strip()
        if not stripped:
            return None
        if len(stripped) <= _MAX_DETAIL_STRING_LENGTH:
            return stripped
        return f"{stripped[:_MAX_DETAIL_STRING_LENGTH]}...[truncated]"
    if isinstance(value, Mapping):
        nested = _sanitize_mapping(value)
        return nested or None
    if isinstance(value, list | tuple | set | frozenset):
        items = [_sanitize_value(item) for item in list(value)[:_MAX_DETAIL_SEQUENCE_LENGTH]]
        return [item for item in items if item is not None]
    return str(type(value).__name__)


__all__ = ["sanitize_model_client_stream_event"]
