from __future__ import annotations

from typing import Any

from openai.types.chat.chat_completion_chunk import (
    ChatCompletionChunk,
    Choice,
    ChoiceDeltaToolCall,
    ChoiceDeltaToolCallFunction,
)

from animama.app.model_clients import MCFunctionToolCallDeltaEvent, ModelClientDelta, ModelClientToolCall

from .events import chunk_identity_details
from .support import chat_stream_event_delta


def merge_tool_call_deltas_from_choice(
    tool_call_parts: dict[int, dict[str, Any]],
    chunk: ChatCompletionChunk,
    choice: Choice,
    *,
    provider_type: str,
    model: str,
) -> tuple[ModelClientDelta, ...]:
    """Merge streamed Chat Completions function tool-call fragments."""

    raw_tool_calls = choice.delta.tool_calls
    if not raw_tool_calls:
        return ()
    events: list[ModelClientDelta] = []
    chunk_details = chunk_identity_details(chunk, {})
    for fallback_index, raw_tool_call in enumerate(raw_tool_calls):
        event = merge_tool_call_delta(
            tool_call_parts,
            raw_tool_call,
            fallback_index=fallback_index,
            choice_index=choice.index,
            chunk_details=chunk_details,
            provider_type=provider_type,
            model=model,
        )
        if event is not None:
            events.append(event)
    return tuple(events)


def merge_tool_call_delta(
    tool_call_parts: dict[int, dict[str, Any]],
    raw_tool_call: ChoiceDeltaToolCall,
    *,
    fallback_index: int,
    choice_index: int,
    chunk_details: dict[str, Any],
    provider_type: str,
    model: str,
) -> ModelClientDelta | None:
    """Merge one streamed function-call fragment and emit an observability event."""

    index = raw_tool_call.index if isinstance(raw_tool_call.index, int) else fallback_index
    current = tool_call_parts.setdefault(index, {"id": "", "name": "", "arguments": []})
    call_id = raw_tool_call.id
    if isinstance(call_id, str) and call_id:
        current["id"] = call_id
    function = raw_tool_call.function
    name = tool_call_function_name(function)
    if name is not None:
        current["name"] = name
    arguments = tool_call_function_arguments(function)
    if arguments:
        current["arguments"].append(arguments)
    if not call_id and name is None and arguments is None:
        return None
    return chat_stream_event_delta(
        event_cls=MCFunctionToolCallDeltaEvent,
        provider_type=provider_type,
        model=model,
        provider_event_type="chat.completion.chunk.tool_call_delta",
        output_index=choice_index,
        tool_type="function",
        tool_name=str(current.get("name") or "") or None,
        tool_call_id=str(current.get("id") or "") or None,
        arguments_fragment_length=len(arguments) if isinstance(arguments, str) else 0,
        details={
            **chunk_details,
            "choice_index": choice_index,
            "tool_call_index": index,
        },
    )


def tool_call_function_name(function: ChoiceDeltaToolCallFunction | None) -> str | None:
    """Extract a streamed function name fragment from the SDK type."""

    if function is None:
        return None
    name = function.name
    if isinstance(name, str) and name:
        return name
    return None


def tool_call_function_arguments(function: ChoiceDeltaToolCallFunction | None) -> str | None:
    """Extract streamed function argument text from the SDK type."""

    if function is None:
        return None
    arguments = function.arguments
    if isinstance(arguments, str) and arguments:
        return arguments
    if isinstance(arguments, str):
        return ""
    return None


def tool_calls_from_parts(tool_call_parts: dict[int, dict[str, Any]]) -> tuple[ModelClientToolCall, ...]:
    """Build provider-neutral tool calls after all chunks have been consumed."""

    calls: list[ModelClientToolCall] = []
    for index in sorted(tool_call_parts):
        part = tool_call_parts[index]
        name = str(part.get("name") or "").strip()
        if not name:
            continue
        call_id = str(part.get("id") or f"toolcall-{index}").strip()
        calls.append(
            ModelClientToolCall(
                id=call_id,
                name=name,
                arguments="".join(part.get("arguments") or []),
            )
        )
    return tuple(calls)


__all__ = ["merge_tool_call_deltas_from_choice", "tool_calls_from_parts"]
