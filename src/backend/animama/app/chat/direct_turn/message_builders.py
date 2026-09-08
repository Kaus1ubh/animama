from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from animama.app.model_clients import (
    MODEL_CLIENT_TOOL_CALL_ITEM_TYPE,
    MODEL_CLIENT_TOOL_RESULT_ITEM_TYPE,
    ModelClientFinal,
    ModelClientToolCall,
    ModelClientToolResult,
)
from animama.app.model_clients.event_summary import DEFAULT_STREAM_EVENT_SUMMARY_METADATA_KEY
from animama.app.util.json_values import json_safe_copy, safe_json_loads
from animama.domain import ModelProvider
from animama.domain.chat import ChatMessage, MessageRole
from animama.domain.usage import Usage

from .constants import OPENAI_RESPONSES_PROVIDER
from .types import DirectChatTurnRequest


def user_provider_message(content: str) -> dict[str, Any]:
    """Build the persisted provider-shaped user message."""

    return {"role": "user", "content": content}


def assistant_final_provider_message(final: ModelClientFinal) -> dict[str, Any]:
    """Build the persisted provider-shaped final assistant message."""

    return {"role": "assistant", "content": final.text}


def assistant_tool_call_prompt_message(
    tool_calls: tuple[ModelClientToolCall, ...],
) -> dict[str, Any]:
    """Build an OpenAI-compatible assistant message containing function calls."""

    return {
        "role": "assistant",
        "content": None,
        "tool_calls": [
            {
                "id": tool_call.id,
                "type": "function",
                "function": {
                    "name": tool_call.name,
                    "arguments": tool_call.arguments,
                },
            }
            for tool_call in tool_calls
        ],
    }


def tool_result_prompt_message(tool_call: ModelClientToolCall, tool_result: str) -> dict[str, Any]:
    """Build an OpenAI-compatible tool-result message for a function call."""

    return {
        "role": "tool",
        "tool_call_id": tool_call.id,
        "content": tool_result,
    }


def model_client_tool_call_prompt_item(tool_call: ModelClientToolCall) -> dict[str, Any]:
    """Build one provider-neutral tool-call history item for Responses."""

    return {
        "type": MODEL_CLIENT_TOOL_CALL_ITEM_TYPE,
        "call_id": tool_call.id,
        "tool_type": tool_call.tool_type,
        "name": tool_call.name,
        "arguments": tool_call.arguments,
    }


def model_client_tool_result_prompt_item(tool_result: ModelClientToolResult) -> dict[str, Any]:
    """Build one provider-neutral tool-result history item for Responses."""

    return {
        "type": MODEL_CLIENT_TOOL_RESULT_ITEM_TYPE,
        "call_id": tool_result.call_id,
        "tool_type": tool_result.tool_type,
        "status": tool_result.status,
        "output": tool_result.output,
    }


def internal_tool_call_message(
    *,
    request: DirectChatTurnRequest,
    model_provider: ModelProvider,
    tool_calls: tuple[ModelClientToolCall, ...],
    raw_provider_message: dict[str, Any],
) -> ChatMessage:
    """Persist an internal assistant tool-call transcript entry."""

    payload = {
        "tool_calls": [
            {
                "id": tool_call.id,
                "name": tool_call.name,
                "arguments": safe_json_loads(tool_call.arguments),
                "tool_type": tool_call.tool_type,
            }
            for tool_call in tool_calls
        ]
    }
    return ChatMessage(
        id=None,
        chat_id=request.chat_id,
        run_id=request.run_id,
        message_type="tool_call",
        role=MessageRole.ASSISTANT,
        content=json.dumps(raw_provider_message, ensure_ascii=True, separators=(",", ":")),
        data={"memory_tools": payload},
        usage=None,
        turn=None,
        created_at=None,
        model=model_provider.model,
        model_provider=model_provider.provider_type,
        internal=True,
        raw_provider_message=raw_provider_message,
    )


def internal_tool_result_message(
    *,
    request: DirectChatTurnRequest,
    model_provider: ModelProvider,
    tool_call: ModelClientToolCall,
    tool_result: ModelClientToolResult,
    raw_provider_message: dict[str, Any],
) -> ChatMessage:
    """Persist an internal direct memory tool-result transcript entry."""

    data = {
        "memory_tool_result": {
            "tool_call_id": tool_call.id,
            "tool_name": tool_call.name,
            "tool_type": tool_call.tool_type,
            "status": tool_result.status,
            "ok": tool_result_ok(tool_result.output),
        }
    }
    return ChatMessage(
        id=None,
        chat_id=request.chat_id,
        run_id=request.run_id,
        message_type="tool_result",
        role=MessageRole.TOOL,
        content=tool_result.output,
        data=data,
        usage=None,
        turn=None,
        created_at=None,
        model=model_provider.model,
        model_provider=model_provider.provider_type,
        internal=True,
        raw_provider_message=raw_provider_message,
    )


def tool_result_ok(value: str) -> bool | None:
    """Extract the boolean success flag from a JSON tool result when present."""

    parsed = safe_json_loads(value)
    if isinstance(parsed, Mapping) and isinstance(parsed.get("ok"), bool):
        return bool(parsed["ok"])
    return None


def chat_metadata_patch_from_prompt(prompt: Any) -> dict[str, Any] | None:
    """Return chat metadata that should be refreshed after a successful turn."""

    metadata = getattr(prompt, "metadata", None)
    if not isinstance(metadata, Mapping):
        return None
    memory_context = metadata.get("memory_context")
    if not isinstance(memory_context, Mapping):
        return None
    return {"memory_context": json_safe_copy(memory_context)}


def assistant_messages_for_persistence(
    *,
    request: DirectChatTurnRequest,
    structured: Mapping[str, Any],
    final: ModelClientFinal,
    model_provider: ModelProvider,
    internal_tool_messages: list[ChatMessage] | None = None,
) -> ChatMessage | list[ChatMessage]:
    """Build final assistant history rows, including any internal tool rows."""

    assistant_msg = assistant_message(
        request=request,
        content=final.text,
        structured=structured,
        final=final,
        model_provider=model_provider,
        usage=final.usage,
        raw_provider_message=assistant_final_provider_message(final),
    )
    if internal_tool_messages:
        return [*internal_tool_messages, assistant_msg]
    return assistant_msg


def assistant_message(
    *,
    request: DirectChatTurnRequest,
    content: str,
    structured: Mapping[str, Any],
    final: ModelClientFinal,
    model_provider: ModelProvider,
    usage: Usage | None,
    raw_provider_message: dict[str, Any],
) -> ChatMessage:
    """Build the public assistant message that will be written to chat history."""

    return ChatMessage(
        id=None,
        chat_id=request.chat_id,
        run_id=request.run_id,
        message_type="message",
        role=MessageRole.ASSISTANT,
        content=content,
        data=assistant_message_data(
            structured=structured,
            final=final,
            model_provider=model_provider,
        ),
        usage=usage,
        turn=None,
        created_at=None,
        model=model_provider.model,
        model_provider=model_provider.provider_type,
        raw_provider_message=raw_provider_message,
    )


def assistant_message_data(
    *,
    structured: Mapping[str, Any],
    final: ModelClientFinal,
    model_provider: ModelProvider,
) -> dict[str, Any]:
    """Build JSONB-safe assistant `message_data` for durable chat history."""

    raw_provider_metadata = json_safe_copy(final.raw_provider_metadata)
    data: dict[str, Any] = {
        "structured": json_safe_copy(structured),
        "model_client": {
            "provider_type": model_provider.provider_type,
            "model_provider_id": model_provider.id,
            "raw_provider_metadata": raw_provider_metadata,
        },
    }
    openai_metadata = openai_metadata_from_final(raw_provider_metadata, model_provider=model_provider)
    if openai_metadata is not None:
        data["openai"] = openai_metadata
    return data


def openai_metadata_from_final(
    raw_provider_metadata: Mapping[str, Any],
    *,
    model_provider: ModelProvider,
) -> dict[str, Any] | None:
    """Extract Responses continuation/phase metadata for later prompt assembly."""

    if model_provider.provider_type != OPENAI_RESPONSES_PROVIDER:
        return None
    response_id = raw_provider_metadata.get("response_id")
    if not isinstance(response_id, str) or not response_id.strip():
        return None
    keys = {
        "provider",
        "api",
        "model",
        "response_id",
        "previous_response_id",
        "output_item_ids",
        "message_item_ids",
        "message_phases",
        "native_tool_summaries",
        "output_item_id",
        "output_index",
        "annotations",
        "phase",
        "phase_counts",
        "service_tier",
        DEFAULT_STREAM_EVENT_SUMMARY_METADATA_KEY,
        "unknown_output_item_types",
    }
    metadata = json_safe_copy({key: raw_provider_metadata[key] for key in keys if key in raw_provider_metadata})
    metadata["provider"] = OPENAI_RESPONSES_PROVIDER
    metadata["api"] = "responses"
    metadata.setdefault("model", model_provider.model)
    metadata["response_id"] = response_id.strip()
    return metadata


__all__ = [
    "assistant_messages_for_persistence",
    "assistant_tool_call_prompt_message",
    "chat_metadata_patch_from_prompt",
    "internal_tool_call_message",
    "internal_tool_result_message",
    "model_client_tool_call_prompt_item",
    "model_client_tool_result_prompt_item",
    "tool_result_prompt_message",
    "user_provider_message",
]
