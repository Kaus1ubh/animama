from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any, Literal, cast

from openai.types.responses import (
    ApplyPatchToolParam,
    FunctionToolParam,
    ResponseFunctionToolCallParam,
    ResponseInputItemParam,
    ResponseTextConfigParam,
    ToolParam,
)
from openai.types.responses.response_create_params import (
    ContextManagement,
    ResponseCreateParamsStreaming,
)
from openai.types.responses.response_input_param import ApplyPatchCall, ApplyPatchCallOutput
from openai.types.shared.reasoning_effort import ReasoningEffort

from animama.app.model_clients import (
    MODEL_CLIENT_TOOL_CALL_ITEM_TYPE,
    MODEL_CLIENT_TOOL_RESULT_ITEM_TYPE,
    ModelClientRequest,
)
from animama.app.model_clients.prompt import (
    prompt_instruction_text,
    prompt_last_user_message,
    prompt_messages,
    prompt_tools,
)

from .._common import jsonable
from .support import (
    OPENAI_RESPONSES_ASSISTANT_PHASES,
    OPENAI_RESPONSES_ASSISTANT_PHASES_KEY,
    OPENAI_RESPONSES_HISTORY_METADATA_KEY,
    OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
    clean_str,
)

DEFAULT_WEB_SEARCH_CONTEXT_SIZE = "low"
DEFAULT_RESPONSES_COMPACTION_THRESHOLD_TOKENS = 200_000


def create_response_kwargs(
    spec: ModelClientRequest,
    previous_response_id: str | None,
    *,
    timeout: float | None,
    compaction_threshold_tokens: int | None = DEFAULT_RESPONSES_COMPACTION_THRESHOLD_TOKENS,
) -> dict[str, Any]:
    """Translate a provider-neutral request into Responses SDK kwargs."""

    store = spec.provider_options.store
    payload: ResponseCreateParamsStreaming = {
        "model": spec.model_provider.model,
        "input": responses_input_items(spec, has_previous_response_id=previous_response_id is not None),
        "stream": True,
        "store": True if store is None else store,
    }
    instructions = prompt_instruction_text(spec.prompt)
    if instructions is not None:
        # Keep request-local developer guidance such as the memory map in Responses
        # instructions. With previous_response_id, prior instructions are not
        # carried forward; putting the map in input items would persist multiple stale
        # copies in provider-managed chat history across turns.
        payload["instructions"] = instructions
    cache_key = spec.prompt.prompt_cache_key
    if cache_key is not None:
        payload["prompt_cache_key"] = cache_key
    if previous_response_id is not None:
        payload["previous_response_id"] = previous_response_id
    text_format = responses_text_format(spec.prompt.response_format)
    if text_format is not None:
        payload["text"] = text_format
    reasoning_effort = spec.prompt.reasoning_effort
    if isinstance(reasoning_effort, str) and reasoning_effort.strip():
        payload["reasoning"] = {"effort": cast(ReasoningEffort, reasoning_effort.strip())}
    context_management = responses_context_management(compaction_threshold_tokens)
    if context_management:
        payload["context_management"] = context_management
    tools = responses_tools(
        spec.provider_options.native_tools,
        prompt_tools(spec.prompt),
        memory_apply_patch_enabled=spec.provider_options.memory_apply_patch_enabled,
    )
    if tools:
        payload["tools"] = tools
        if spec.prompt.tool_choice is not None:
            payload["tool_choice"] = cast(Any, jsonable(spec.prompt.tool_choice))
        if spec.prompt.parallel_tool_calls is not None:
            payload["parallel_tool_calls"] = bool(spec.prompt.parallel_tool_calls)
    kwargs = cast(dict[str, Any], payload)
    if timeout is not None:
        kwargs["timeout"] = timeout
    return kwargs


def responses_context_management(compaction_threshold_tokens: int | None) -> list[ContextManagement]:
    """Build server-side compaction config for Responses auto-compaction."""

    if not isinstance(compaction_threshold_tokens, int) or compaction_threshold_tokens <= 0:
        return []
    return [
        {
            "type": "compaction",
            "compact_threshold": compaction_threshold_tokens,
        }
    ]


def responses_input_items(spec: ModelClientRequest, *, has_previous_response_id: bool) -> list[ResponseInputItemParam]:
    """Build Responses input items from prompt messages and continuation state."""

    messages = prompt_messages(spec.prompt)
    if has_previous_response_id:
        # With previous_response_id, the provider already has prior transcript
        # state. Send only the new user message, or the trailing tool outputs
        # needed to answer function calls from the previous response.
        tool_outputs = _trailing_call_outputs(messages)
        if tool_outputs:
            return tool_outputs
        return [_easy_input_message("user", prompt_last_user_message(spec.prompt, fallback=""))]
    assistant_phases_by_message_index = _assistant_phase_by_message_index(spec.prompt.metadata)
    items: list[ResponseInputItemParam] = []
    for message_index, message in enumerate(messages):
        exchange_item = _model_client_exchange_input_item(message)
        if exchange_item is not None:
            items.append(exchange_item)
            continue
        role = str(message.get("role") or "").strip().lower()
        if role in {"system", "developer"}:
            continue
        if role == "tool":
            tool_output = _function_call_output_from_tool_message(message)
            if tool_output is not None:
                items.append(tool_output)
            continue
        if role == "assistant":
            tool_calls = _function_call_items_from_assistant_message(message)
            if tool_calls:
                items.extend(tool_calls)
                continue
        content = message.get("content")
        if not isinstance(content, str) or not content:
            continue
        if role not in {"user", "assistant"}:
            role = "user"
        phase = assistant_phases_by_message_index.get(message_index) if role == "assistant" else None
        items.append(_easy_input_message(role, content, phase=phase))
    return items or [_easy_input_message("user", prompt_last_user_message(spec.prompt, fallback=""))]


def previous_response_id(spec: ModelClientRequest) -> str | None:
    """Return a Responses continuation cursor from a model-client request."""

    continuation = spec.continuation
    if continuation is None:
        return None
    if continuation.provider_type != OPENAI_RESPONSES_HTTP_PROVIDER_TYPE:
        return None
    cursor = continuation.cursor.strip()
    return cursor or None


def base_url_for_spec(spec: ModelClientRequest, default_base_url: str) -> str:
    """Resolve a per-provider base URL override for OpenAI-compatible servers."""

    base_url = spec.model_provider.provider_base_url or default_base_url
    return base_url.rstrip("/")


def _easy_input_message(role: str, content: str, *, phase: str | None = None) -> ResponseInputItemParam:
    """Build a Responses easy input item, preserving assistant phase if valid."""

    item: dict[str, Any] = {"role": role, "content": content}
    if role == "assistant" and phase in OPENAI_RESPONSES_ASSISTANT_PHASES:
        item["phase"] = phase
    return cast(ResponseInputItemParam, item)


def _assistant_phase_by_message_index(metadata: Mapping[str, Any]) -> dict[int, str]:
    """Read persisted assistant phases for explicit-history Responses prompts."""

    history = metadata.get(OPENAI_RESPONSES_HISTORY_METADATA_KEY)
    if not isinstance(history, Mapping):
        return {}
    raw_phases = history.get(OPENAI_RESPONSES_ASSISTANT_PHASES_KEY)
    if not isinstance(raw_phases, Mapping):
        return {}
    phases: dict[int, str] = {}
    for raw_index, raw_phase in raw_phases.items():
        try:
            index = int(raw_index)
        except (TypeError, ValueError):
            continue
        if not isinstance(raw_phase, str):
            continue
        phase = raw_phase.strip()
        if phase in OPENAI_RESPONSES_ASSISTANT_PHASES:
            phases[index] = phase
    return phases


def _trailing_call_outputs(messages: list[dict[str, Any]]) -> list[ResponseInputItemParam]:
    """Return trailing function or native outputs for cursor-backed continuation."""

    output_messages: list[dict[str, Any]] = []
    for message in reversed(messages):
        role = str(message.get("role") or "").strip().lower()
        if role in {"system", "developer"}:
            # Forced-final guidance is appended after a tool output but travels
            # through Responses `instructions`, not conversation input.
            continue
        if role != "tool" and message.get("type") != MODEL_CLIENT_TOOL_RESULT_ITEM_TYPE:
            break
        output_messages.append(message)
    if not output_messages:
        return []
    outputs: list[ResponseInputItemParam] = []
    for message in reversed(output_messages):
        tool_output = _model_client_tool_result_input_item(message)
        if tool_output is None:
            tool_output = _function_call_output_from_tool_message(message)
        if tool_output is not None:
            outputs.append(tool_output)
    return outputs


def _model_client_exchange_input_item(message: Mapping[str, Any]) -> ResponseInputItemParam | None:
    item_type = message.get("type")
    if item_type == MODEL_CLIENT_TOOL_CALL_ITEM_TYPE:
        return _model_client_tool_call_input_item(message)
    if item_type == MODEL_CLIENT_TOOL_RESULT_ITEM_TYPE:
        return _model_client_tool_result_input_item(message)
    return None


def _model_client_tool_call_input_item(message: Mapping[str, Any]) -> ResponseInputItemParam | None:
    call_id = clean_str(message.get("call_id"))
    tool_type = clean_str(message.get("tool_type"))
    if call_id is None or tool_type is None:
        return None
    arguments = message.get("arguments")
    if tool_type == "function":
        name = clean_str(message.get("name"))
        if name is None:
            return None
        item: ResponseFunctionToolCallParam = {
            "type": "function_call",
            "call_id": call_id,
            "name": name,
            "arguments": arguments if isinstance(arguments, str) else "",
            "status": "completed",
        }
        return cast(ResponseInputItemParam, item)
    if tool_type != "apply_patch":
        return None
    operation = _operation_from_arguments(arguments)
    if operation is None:
        return None
    patch_item: ApplyPatchCall = {
        "type": "apply_patch_call",
        "call_id": call_id,
        "operation": cast(Any, operation),
        "status": "completed",
    }
    return cast(ResponseInputItemParam, patch_item)


def _model_client_tool_result_input_item(message: Mapping[str, Any]) -> ResponseInputItemParam | None:
    if message.get("type") != MODEL_CLIENT_TOOL_RESULT_ITEM_TYPE:
        return None
    call_id = clean_str(message.get("call_id"))
    tool_type = clean_str(message.get("tool_type"))
    output = message.get("output")
    if call_id is None or tool_type is None or not isinstance(output, str):
        return None
    if tool_type == "function":
        return cast(
            ResponseInputItemParam,
            {"type": "function_call_output", "call_id": call_id, "output": output},
        )
    if tool_type != "apply_patch":
        return None
    status: Literal["completed", "failed"] = "completed" if message.get("status") == "completed" else "failed"
    item: ApplyPatchCallOutput = {
        "type": "apply_patch_call_output",
        "call_id": call_id,
        "status": status,
        "output": output,
    }
    return cast(ResponseInputItemParam, item)


def _operation_from_arguments(value: object) -> dict[str, Any] | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return None
    if not isinstance(parsed, dict):
        return None
    operation_type = parsed.get("type")
    path = parsed.get("path")
    if operation_type not in {"create_file", "update_file", "delete_file"} or not isinstance(path, str):
        return None
    if operation_type != "delete_file" and not isinstance(parsed.get("diff"), str):
        return None
    return parsed


def _function_call_items_from_assistant_message(message: Mapping[str, Any]) -> list[ResponseInputItemParam]:
    """Convert OpenAI-compatible assistant tool calls into Responses input items."""

    raw_tool_calls = message.get("tool_calls")
    if not isinstance(raw_tool_calls, list):
        return []
    items: list[ResponseInputItemParam] = []
    for raw_tool_call in raw_tool_calls:
        if not isinstance(raw_tool_call, Mapping):
            continue
        call_id = clean_str(raw_tool_call.get("id"))
        function = raw_tool_call.get("function")
        if not isinstance(function, Mapping) or call_id is None:
            continue
        name = clean_str(function.get("name"))
        if name is None:
            continue
        arguments = function.get("arguments")
        item: ResponseFunctionToolCallParam = {
            "type": "function_call",
            "call_id": call_id,
            "name": name,
            "arguments": arguments if isinstance(arguments, str) else "",
            "status": "completed",
        }
        items.append(cast(ResponseInputItemParam, item))
    return items


def _function_call_output_from_tool_message(message: Mapping[str, Any]) -> ResponseInputItemParam | None:
    """Convert an OpenAI-compatible tool message into Responses call output."""

    call_id = clean_str(message.get("tool_call_id"))
    content = message.get("content")
    if call_id is None or not isinstance(content, str):
        return None
    return cast(
        ResponseInputItemParam,
        {
            "type": "function_call_output",
            "call_id": call_id,
            "output": content,
        },
    )


def responses_text_format(response_format: Mapping[str, Any] | None) -> ResponseTextConfigParam | None:
    """Translate Chat Completions-style response_format to Responses text format."""

    if not isinstance(response_format, Mapping):
        return None
    raw = jsonable(response_format)
    if not isinstance(raw, dict):
        return None
    if raw.get("type") == "json_schema":
        schema_config = raw.get("json_schema")
        if not isinstance(schema_config, dict):
            return None
        return {
            "format": {
                "type": "json_schema",
                "name": str(schema_config.get("name") or "direct_chat_response"),
                "strict": bool(schema_config.get("strict", True)),
                "schema": schema_config.get("schema") or {},
            }
        }
    if raw.get("type") == "json_object":
        return {"format": {"type": "json_object"}}
    return None


def responses_tools(
    raw_tools: Any,
    prompt_function_tools: list[dict[str, Any]],
    *,
    memory_apply_patch_enabled: bool = False,
) -> list[ToolParam]:
    """Build Responses hosted/native tools plus prompt function tools."""

    requested = {str(value).strip() for value in (raw_tools or ()) if str(value).strip()}
    tools: list[ToolParam] = []
    if "web_search" in requested:
        tools.append(cast(ToolParam, {"type": "web_search", "search_context_size": DEFAULT_WEB_SEARCH_CONTEXT_SIZE}))
    if memory_apply_patch_enabled:
        apply_patch_tool: ApplyPatchToolParam = {"type": "apply_patch"}
        tools.append(cast(ToolParam, apply_patch_tool))
    for raw_tool in prompt_function_tools:
        tool = _responses_function_tool(raw_tool)
        if tool is not None:
            tools.append(cast(ToolParam, tool))
    return tools


def _responses_function_tool(raw_tool: Mapping[str, Any]) -> FunctionToolParam | None:
    """Translate an OpenAI-compatible function tool into Responses format."""

    if raw_tool.get("type") != "function":
        return None
    function = raw_tool.get("function")
    if not isinstance(function, Mapping):
        return None
    name = clean_str(function.get("name"))
    if name is None:
        return None
    parameters = jsonable(function.get("parameters") or {})
    if not isinstance(parameters, dict):
        parameters = {}
    tool: FunctionToolParam = {
        "type": "function",
        "name": name,
        "parameters": cast(dict[str, object], parameters),
        "strict": bool(function.get("strict", True)),
    }
    description = function.get("description")
    if isinstance(description, str) and description.strip():
        tool["description"] = description.strip()
    return tool


__all__ = ["base_url_for_spec", "create_response_kwargs", "previous_response_id", "responses_input_items"]
