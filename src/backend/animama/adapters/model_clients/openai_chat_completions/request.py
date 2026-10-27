from __future__ import annotations

from collections.abc import Mapping
from typing import Any

import httpx2

from animama.app.model_catalog import STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT
from animama.app.model_clients import ModelClientProviderError, ModelClientRequest
from animama.app.model_clients.prompt import prompt_messages
from animama.app.model_connection_presets import DEEPSEEK_REASONING_EFFORTS
from animama.domain import ModelProvider
from animama.domain.model_connection import (
    BUILTIN_OPENAI_CONNECTION_ID,
    REASONING_MODE_DEEPSEEK_THINKING,
    REASONING_MODE_OMIT,
    ModelConnectionCompatibility,
)

from .._common import jsonable, openai_cache_breakpoint_text_part

# Explicit breakpoints on the latest replies in history. The previous reply
# reads the entry the last request wrote; the latest reply writes the next one.
_CACHE_BREAKPOINT_REPLY_COUNT = 2


def create_chat_completion_kwargs(
    spec: ModelClientRequest, *, timeout: float | httpx2.Timeout | None
) -> dict[str, Any]:
    """Translate a provider-neutral request into Chat Completions SDK kwargs.

    The selected row's connection compatibility options decide which
    OpenAI-specific fields are sent.
    """

    compatibility = _compatibility(spec)
    payload: dict[str, Any] = {
        "model": spec.model_provider.model,
        "stream": True,
    }
    if spec.limits is not None:
        payload["max_completion_tokens"] = spec.limits.max_output_tokens
    if compatibility.send_stream_usage:
        payload["stream_options"] = jsonable(spec.prompt.stream_options or {"include_usage": True})
    payload["messages"] = _messages_for_spec(spec)
    response_format = _response_format_for_spec(spec)
    if response_format is not None:
        payload["response_format"] = response_format

    reasoning_effort = _reasoning_effort_for_spec(spec, compatibility=compatibility)
    if reasoning_effort is not None:
        payload["reasoning_effort"] = reasoning_effort
    if compatibility.reasoning_mode == REASONING_MODE_DEEPSEEK_THINKING:
        payload["extra_body"] = {"thinking": _deepseek_thinking_config(spec, reasoning_effort=reasoning_effort)}
    if spec.prompt.prompt_cache_key and compatibility.send_openai_extensions:
        payload["prompt_cache_key"] = spec.prompt.prompt_cache_key
    if spec.prompt.tools:
        payload["tools"] = _tools_for_spec(spec, compatibility=compatibility)
        if spec.prompt.parallel_tool_calls is not None and compatibility.send_openai_extensions:
            payload["parallel_tool_calls"] = bool(spec.prompt.parallel_tool_calls)
    if spec.prompt.tool_choice is not None:
        payload["tool_choice"] = jsonable(spec.prompt.tool_choice)
    if timeout is not None:
        payload["timeout"] = timeout
    return payload


def _compatibility(spec: ModelClientRequest) -> ModelConnectionCompatibility:
    connection = spec.model_provider.connection
    return connection.compatibility if connection is not None else ModelConnectionCompatibility()


def _messages_for_spec(spec: ModelClientRequest) -> list[dict[str, Any]]:
    messages = prompt_messages(spec.prompt)
    if not spec.model_provider.accepts_developer_role:
        # The turn context already travels in the user message; only
        # within-turn instructions (forced final, repair) remain to fold.
        return _messages_with_developer_role_folded_into_system(messages)
    if spec.model_provider.connection_id == BUILTIN_OPENAI_CONNECTION_ID:
        return _messages_with_cache_breakpoints(messages)
    return messages


def _messages_with_cache_breakpoints(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Mark the system message and the last two history replies as explicit cache breakpoints.

    Only the built-in OpenAI connection receives these fields; other servers
    may reject unknown content-part fields. History is everything before the
    turn's user message (the last one), so tool rounds and repair replies of
    the current turn are never marked. The system message needs its own
    marker because a developer message directly after it (the compaction
    summary) would otherwise end the initial cached block. Three explicit
    writes plus the implicit one at the user message stay within OpenAI's limit
    of four.
    """

    user_indexes = [index for index, message in enumerate(messages) if message.get("role") == "user"]
    history_end = user_indexes[-1] if user_indexes else len(messages)
    reply_indexes = [
        index
        for index, message in enumerate(messages[:history_end])
        if message.get("role") == "assistant" and not message.get("tool_calls") and _has_text_content(message)
    ]
    marked = set(reply_indexes[-_CACHE_BREAKPOINT_REPLY_COUNT:])
    if messages and messages[0].get("role") == "system" and _has_text_content(messages[0]):
        marked.add(0)
    return [_with_cache_breakpoint(message) if index in marked else message for index, message in enumerate(messages)]


def _has_text_content(message: Mapping[str, Any]) -> bool:
    content = message.get("content")
    return isinstance(content, str) and bool(content)


def _with_cache_breakpoint(message: dict[str, Any]) -> dict[str, Any]:
    """Return the message with its text as one content part carrying a breakpoint."""

    return {**message, "content": [openai_cache_breakpoint_text_part(str(message["content"]), part_type="text")]}


def _tools_for_spec(spec: ModelClientRequest, *, compatibility: ModelConnectionCompatibility) -> Any:
    tools = jsonable(spec.prompt.tools)
    if compatibility.strip_function_strict:
        return tools_without_function_strict(tools)
    return tools


def tools_without_function_strict(tools: Any) -> Any:
    """Drop ``strict`` from function tool definitions for servers that reject it."""

    if not isinstance(tools, list):
        return tools
    stripped_tools: list[Any] = []
    for tool in tools:
        if not isinstance(tool, dict):
            stripped_tools.append(tool)
            continue
        next_tool = dict(tool)
        function = next_tool.get("function")
        if isinstance(function, dict) and "strict" in function:
            next_function = dict(function)
            next_function.pop("strict", None)
            next_tool["function"] = next_function
        stripped_tools.append(next_tool)
    return stripped_tools


def _messages_with_developer_role_folded_into_system(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Append developer text, in order, to the system message for rows without the role.

    The assembler never emits developer messages for these rows; this folds
    the forced-final and repair instructions added within a turn. Each ends
    with the Companion Guardrails, so the system message still ends with them.
    """

    developer_parts: list[str] = []
    remaining_messages: list[dict[str, Any]] = []
    for message in messages:
        if not isinstance(message, dict) or message.get("role") != "developer":
            remaining_messages.append(message)
            continue
        text = _message_content_text(message.get("content"))
        if text:
            developer_parts.append(text)
    if not developer_parts:
        return remaining_messages

    developer_text = "\n\n".join(developer_parts)
    for message in remaining_messages:
        if message.get("role") != "system":
            continue
        content = message.get("content")
        if isinstance(content, str) and content.strip():
            message["content"] = f"{content.rstrip()}\n\n{developer_text}"
            return remaining_messages

    return [{"role": "system", "content": developer_text}, *remaining_messages]


def _message_content_text(value: Any) -> str | None:
    if isinstance(value, str):
        text = value.strip()
        return text or None
    if isinstance(value, list):
        parts: list[str] = []
        for item in value:
            if isinstance(item, Mapping) and isinstance(item.get("text"), str):
                parts.append(item["text"])
        text = "\n".join(part.strip() for part in parts if part.strip())
        return text or None
    return None


def _response_format_for_spec(spec: ModelClientRequest) -> dict[str, Any] | None:
    if spec.prompt.response_format is None:
        return None
    if spec.model_provider.capabilities.structured_output_transport == STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT:
        return {"type": "json_object"}
    raw = jsonable(spec.prompt.response_format)
    return raw if isinstance(raw, dict) else None


def _reasoning_effort_for_spec(
    spec: ModelClientRequest,
    *,
    compatibility: ModelConnectionCompatibility,
) -> str | None:
    raw_effort = spec.prompt.reasoning_effort
    effort = raw_effort.strip() if isinstance(raw_effort, str) and raw_effort.strip() else None
    if compatibility.reasoning_mode == REASONING_MODE_OMIT:
        return None
    if compatibility.reasoning_mode == REASONING_MODE_DEEPSEEK_THINKING:
        return _deepseek_reasoning_effort(spec.model_provider, effort)
    return effort


def _deepseek_reasoning_effort(model_provider: ModelProvider, effort: str | None) -> str | None:
    if effort in {None, "none"}:
        return None
    if effort in DEEPSEEK_REASONING_EFFORTS:
        return effort
    raise ModelClientProviderError(
        f"DeepSeek reasoning_effort must be one of none, high, or max; received {effort}",
        code="unsupported_reasoning_effort",
        raw_metadata={
            "provider_type": model_provider.provider_type,
            "model": model_provider.model,
            "reasoning_effort": effort,
        },
    )


def _deepseek_thinking_config(spec: ModelClientRequest, *, reasoning_effort: str | None) -> dict[str, str]:
    if reasoning_effort is None:
        return {"type": "disabled"}
    metadata = spec.model_provider.metadata if isinstance(spec.model_provider.metadata, Mapping) else {}
    thinking = metadata.get("thinking")
    if isinstance(thinking, Mapping):
        thinking_type = thinking.get("type")
        if isinstance(thinking_type, str) and thinking_type.strip():
            return {"type": thinking_type.strip()}
    return {"type": "enabled"}


__all__ = ["create_chat_completion_kwargs"]
