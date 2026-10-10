"""Map raw Anthropic stream events to sanitized ``MC*`` observations and run statuses.

Observations carry identifiers, block types, lengths, stop reasons and usage,
never text, thinking, tool input, search results, summaries or signatures. The
SDK stream helper also yields derived events (``text``, ``thinking``,
``input_json``, ``signature``, ``citation``, ``compaction``) that repeat the
raw deltas; those are skipped.

Server-side work is reported as run statuses: ``searching_web`` from a
``web_search`` server-tool block's start to its result block's end, and
``summarizing_context`` while a compaction block streams.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from animama.app.model_clients import (
    MCAssistantMessageStartedEvent,
    MCEvent,
    MCFinishReasonEvent,
    MCFunctionToolCallDeltaEvent,
    MCFunctionToolCallDoneEvent,
    MCResponseProgressEvent,
    MCResponseStartedEvent,
    MCTerminalCompletedEvent,
    MCTextDeltaEvent,
    MCTextDoneEvent,
    MCUnknownProviderEvent,
    MCUsageEvent,
    ModelClientDelta,
    model_client_event_delta,
    model_client_run_status_delta,
)

from .._common import get_value
from .final import usage_from_anthropic, usage_iterations
from .support import ANTHROPIC_API, ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE, clean_str

_DERIVED_EVENT_TYPES = frozenset({"text", "thinking", "input_json", "signature", "citation", "compaction"})
WEB_SEARCH_TOOL_NAME = "web_search"
SERVER_TOOL_USE_BLOCK = "server_tool_use"
WEB_SEARCH_RESULT_BLOCK = "web_search_tool_result"
COMPACTION_BLOCK = "compaction"


@dataclass(slots=True)
class AnthropicStreamState:
    """Request-local stream facts the observations and final need."""

    message_id: str | None = None
    stop_reason: str | None = None
    message_stopped: bool = False
    block_types: dict[int, str] = field(default_factory=dict)
    tool_blocks: dict[int, tuple[str | None, str | None]] = field(default_factory=dict)
    iterations: list[Any] = field(default_factory=list)


def stream_event_type(event: Any) -> str:
    return str(get_value(event, "type", "") or "")


def public_text_delta(event: Any, state: AnthropicStreamState) -> str | None:
    """Return the text of a ``text_delta`` in a text block, the only public reply text."""

    if stream_event_type(event) != "content_block_delta":
        return None
    delta = get_value(event, "delta")
    if get_value(delta, "type") != "text_delta":
        return None
    index = get_value(event, "index")
    if isinstance(index, int) and state.block_types.get(index, "text") != "text":
        return None
    text = get_value(delta, "text")
    return text if isinstance(text, str) and text else None


def events_from_stream_event(event: Any, *, model: str, state: AnthropicStreamState) -> list[ModelClientDelta]:
    """Record stream facts in ``state`` and return the event's observations."""

    event_type = stream_event_type(event)
    if event_type in _DERIVED_EVENT_TYPES or event_type == "ping":
        return []
    index = get_value(event, "index")
    content_index = index if isinstance(index, int) else None
    observed: list[MCEvent] = []
    statuses: list[ModelClientDelta] = []
    common: dict[str, Any] = {
        "provider_type": ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE,
        "api": ANTHROPIC_API,
        "model": model,
        "provider_event_type": event_type,
    }
    if event_type == "message_start":
        state.message_id = clean_str(get_value(get_value(event, "message"), "id"))
        observed.append(MCResponseStartedEvent(**common, response_id=state.message_id, status="in_progress"))
    elif event_type == "content_block_start":
        block = get_value(event, "content_block")
        block_type = str(get_value(block, "type", "") or "")
        if content_index is not None:
            state.block_types[content_index] = block_type
        if block_type == "text":
            observed.append(
                MCAssistantMessageStartedEvent(
                    **common, response_id=state.message_id, content_index=content_index, item_type="text"
                )
            )
        elif block_type == "tool_use":
            name, call_id = clean_str(get_value(block, "name")), clean_str(get_value(block, "id"))
            if content_index is not None:
                state.tool_blocks[content_index] = (name, call_id)
            observed.append(
                MCFunctionToolCallDeltaEvent(
                    **common,
                    response_id=state.message_id,
                    content_index=content_index,
                    tool_type="function",
                    tool_name=name,
                    tool_call_id=call_id,
                    status="in_progress",
                )
            )
        else:
            observed.append(
                MCResponseProgressEvent(
                    **common,
                    response_id=state.message_id,
                    content_index=content_index,
                    status="in_progress",
                    item_type=block_type,
                )
            )
            if block_type == SERVER_TOOL_USE_BLOCK and get_value(block, "name") == WEB_SEARCH_TOOL_NAME:
                statuses.append(model_client_run_status_delta("searching_web", "started"))
            elif block_type == COMPACTION_BLOCK:
                statuses.append(model_client_run_status_delta("summarizing_context", "started"))
    elif event_type == "content_block_delta":
        observed.extend(_delta_events(event, common=common, state=state, content_index=content_index))
    elif event_type == "content_block_stop":
        block_type = state.block_types.get(content_index, "") if content_index is not None else ""
        if block_type == "text":
            observed.append(MCTextDoneEvent(**common, response_id=state.message_id, content_index=content_index))
        elif block_type == "tool_use" and content_index is not None:
            name, call_id = state.tool_blocks.get(content_index, (None, None))
            observed.append(
                MCFunctionToolCallDoneEvent(
                    **common,
                    response_id=state.message_id,
                    content_index=content_index,
                    tool_type="function",
                    tool_name=name,
                    tool_call_id=call_id,
                    status="completed",
                )
            )
        else:
            observed.append(
                MCResponseProgressEvent(
                    **common,
                    response_id=state.message_id,
                    content_index=content_index,
                    status="completed",
                    item_type=block_type or None,
                )
            )
            if block_type == WEB_SEARCH_RESULT_BLOCK:
                statuses.append(model_client_run_status_delta("searching_web", "finished"))
            elif block_type == COMPACTION_BLOCK:
                statuses.append(model_client_run_status_delta("summarizing_context", "finished"))
    elif event_type == "message_delta":
        state.stop_reason = clean_str(get_value(get_value(event, "delta"), "stop_reason")) or state.stop_reason
        usage = get_value(event, "usage")
        iterations = usage_iterations(usage)
        if iterations:
            state.iterations = iterations
        if state.stop_reason is not None:
            observed.append(
                MCFinishReasonEvent(**common, response_id=state.message_id, finish_reason=state.stop_reason)
            )
        if usage is not None:
            observed.append(
                MCUsageEvent(
                    **common, response_id=state.message_id, usage=usage_from_anthropic(usage, iterations=iterations)
                )
            )
    elif event_type == "message_stop":
        state.message_stopped = True
        observed.append(
            MCTerminalCompletedEvent(
                **common, response_id=state.message_id, status="completed", finish_reason=state.stop_reason
            )
        )
    else:
        observed.append(MCUnknownProviderEvent(**common, response_id=state.message_id, content_index=content_index))
    return [*(model_client_event_delta(item) for item in observed), *statuses]


def _delta_events(
    event: Any,
    *,
    common: dict[str, Any],
    state: AnthropicStreamState,
    content_index: int | None,
) -> list[MCEvent]:
    delta = get_value(event, "delta")
    delta_type = str(get_value(delta, "type", "") or "")
    detail = {**common, "provider_event_type": f"content_block_delta.{delta_type}"}
    if delta_type == "text_delta":
        text = get_value(delta, "text")
        return [
            MCTextDeltaEvent(
                **detail,
                response_id=state.message_id,
                content_index=content_index,
                text_length=len(text) if isinstance(text, str) else None,
            )
        ]
    if delta_type == "input_json_delta":
        fragment = get_value(delta, "partial_json")
        name, call_id = (
            state.tool_blocks.get(content_index, (None, None)) if content_index is not None else (None, None)
        )
        return [
            MCFunctionToolCallDeltaEvent(
                **detail,
                response_id=state.message_id,
                content_index=content_index,
                tool_type="function",
                tool_name=name,
                tool_call_id=call_id,
                arguments_fragment_length=len(fragment) if isinstance(fragment, str) else None,
                status="in_progress",
            )
        ]
    if delta_type in {"thinking_delta", "signature_delta", "citations_delta", "compaction_delta"}:
        return [
            MCResponseProgressEvent(
                **detail,
                response_id=state.message_id,
                content_index=content_index,
                status="in_progress",
                item_type=state.block_types.get(content_index) if content_index is not None else None,
            )
        ]
    return [MCUnknownProviderEvent(**detail, response_id=state.message_id, content_index=content_index)]


__all__ = [
    "AnthropicStreamState",
    "events_from_stream_event",
    "public_text_delta",
    "stream_event_type",
]
