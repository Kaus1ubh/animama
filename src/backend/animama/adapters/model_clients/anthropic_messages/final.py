"""Extract the provider-neutral final from a completed Anthropic message."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from animama.app.model_clients import ModelClientToolCall
from animama.domain.usage import Usage, UsageInputDetails, UsageOutputDetails

from .._common import get_value, jsonable
from .support import ANTHROPIC_API, ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE, clean_str, optional_int

STOP_REASON_TOOL_USE = "tool_use"
STOP_REASON_MAX_TOKENS = "max_tokens"
STOP_REASON_REFUSAL = "refusal"
_USAGE_FIELDS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")


@dataclass(frozen=True, slots=True)
class MessageFinalParts:
    """Final text, tool calls, usage and safe metadata from one Anthropic message.

    ``content`` is the message's content blocks in request form, kept only for
    the turn's next round (never persisted). ``refusal_category`` is the
    ``stop_details`` category when the model declined the turn.
    """

    text: str
    tool_calls: tuple[ModelClientToolCall, ...]
    usage: Usage
    metadata: dict[str, Any]
    content: list[dict[str, Any]]
    stop_reason: str | None
    refusal_category: str | None


def message_final_parts(message: Any, *, stream_iterations: list[Any] | None = None) -> MessageFinalParts:
    """Read a completed (accumulated) SDK ``Message``.

    ``stream_iterations`` are usage iterations seen on the stream's
    ``message_delta``, used when the accumulated usage does not carry them.

    A reply cut off at ``max_tokens`` offers no tool calls, because a
    truncated tool input is incomplete; its text goes to local validation and
    the structured-reply repair like other truncated replies.
    """

    content = [content_block_param(block) for block in get_value(message, "content", None) or ()]
    stop_reason = clean_str(get_value(message, "stop_reason"))
    text = "".join(
        block["text"] for block in content if block.get("type") == "text" and isinstance(block.get("text"), str)
    )
    tool_calls: tuple[ModelClientToolCall, ...] = ()
    if stop_reason != STOP_REASON_MAX_TOKENS:
        tool_calls = tuple(
            ModelClientToolCall(
                id=str(block.get("id") or ""),
                name=str(block.get("name") or ""),
                arguments=json.dumps(block.get("input") or {}, ensure_ascii=False, separators=(",", ":")),
            )
            for block in content
            if block.get("type") == "tool_use"
        )
    usage_value = get_value(message, "usage")
    iterations = _iterations(usage_value) or list(stream_iterations or ())
    stop_details = _stop_details(get_value(message, "stop_details"))
    message_id = clean_str(get_value(message, "id"))
    model = clean_str(get_value(message, "model"))
    anthropic: dict[str, Any] = {
        "message_id": message_id,
        "model": model,
        "stop_reason": stop_reason,
        "usage": usage_summary(usage_value, iterations=iterations),
        "block_types": [str(block.get("type") or "") for block in content],
    }
    if stop_details:
        anthropic["stop_details"] = stop_details
    metadata: dict[str, Any] = {
        "provider": ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE,
        "api": ANTHROPIC_API,
        "model": model,
        "message_id": message_id,
        "stop_reason": stop_reason,
        "anthropic": {key: value for key, value in anthropic.items() if value is not None},
    }
    return MessageFinalParts(
        text=text,
        tool_calls=tool_calls,
        usage=usage_from_anthropic(usage_value, iterations=iterations),
        metadata={key: value for key, value in metadata.items() if value is not None},
        content=content,
        stop_reason=stop_reason,
        refusal_category=clean_str(stop_details.get("category")) if stop_reason == STOP_REASON_REFUSAL else None,
    )


def content_block_param(block: Any) -> dict[str, Any]:
    """Return a response content block in the form a later request resends unchanged."""

    to_dict = getattr(block, "to_dict", None)
    data = to_dict(mode="json", exclude_none=True) if callable(to_dict) else jsonable(block)
    if not isinstance(data, dict):
        return {}
    # SDK-local helper field, not part of the API block.
    data.pop("parsed_output", None)
    return data


def usage_from_anthropic(usage: Any, *, iterations: list[Any] | None = None) -> Usage:
    """Convert Anthropic usage, summing server-side ``iterations`` when present.

    Input counts every prompt token: uncached, cache reads and cache writes.
    Cached input is the cache reads; cache writes are recorded separately.
    Thinking tokens are reasoning tokens, which later turns never replay.
    """

    if usage is None:
        return Usage()
    entries = iterations or _iterations(usage) or [usage]
    counts = {name: sum(optional_int(get_value(entry, name)) for entry in entries) for name in _USAGE_FIELDS}
    input_tokens = counts["input_tokens"] + counts["cache_read_input_tokens"] + counts["cache_creation_input_tokens"]
    output_tokens = counts["output_tokens"]
    thinking_tokens = optional_int(get_value(get_value(usage, "output_tokens_details"), "thinking_tokens"))
    return Usage(
        requests=1,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        input_tokens_details=UsageInputDetails(
            cached_tokens=counts["cache_read_input_tokens"],
            cache_write_tokens=counts["cache_creation_input_tokens"],
        ),
        output_tokens_details=UsageOutputDetails(reasoning_tokens=thinking_tokens),
    )


def usage_summary(usage: Any, *, iterations: list[Any] | None = None) -> dict[str, Any] | None:
    """Return the raw Anthropic usage counts stored in ``data.anthropic``."""

    if usage is None:
        return None
    summary: dict[str, Any] = {name: optional_int(get_value(usage, name)) for name in _USAGE_FIELDS}
    thinking_tokens = optional_int(get_value(get_value(usage, "output_tokens_details"), "thinking_tokens"))
    if thinking_tokens:
        summary["thinking_tokens"] = thinking_tokens
    iterations = iterations or _iterations(usage)
    if iterations:
        summary["iterations"] = [
            {
                "type": clean_str(get_value(entry, "type")),
                **{name: optional_int(get_value(entry, name)) for name in _USAGE_FIELDS},
            }
            for entry in iterations
        ]
    return summary


def usage_iterations(usage: Any) -> list[Any]:
    """Return the server-side usage iterations reported with ``usage``, if any."""

    return _iterations(usage)


def _iterations(usage: Any) -> list[Any]:
    value = get_value(usage, "iterations")
    if value is None:
        extra = getattr(usage, "model_extra", None)
        value = extra.get("iterations") if isinstance(extra, Mapping) else None
    return list(value) if isinstance(value, list | tuple) else []


def _stop_details(value: Any) -> dict[str, Any]:
    """Keep the refusal type and category; the explanation text is not stored."""

    if value is None:
        return {}
    details = {"type": clean_str(get_value(value, "type")), "category": clean_str(get_value(value, "category"))}
    return {key: item for key, item in details.items() if item is not None}


__all__ = [
    "STOP_REASON_MAX_TOKENS",
    "STOP_REASON_REFUSAL",
    "STOP_REASON_TOOL_USE",
    "MessageFinalParts",
    "content_block_param",
    "usage_iterations",
    "message_final_parts",
    "usage_from_anthropic",
    "usage_summary",
]
