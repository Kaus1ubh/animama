from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from animama.app.model_catalog import (
    DEEPSEEK_BASE_URL,
    DEEPSEEK_REASONING_EFFORTS,
    HUGGINGFACE_ROUTER_BASE_URL,
    STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT,
)
from animama.app.model_clients import ModelClientProviderError, ModelClientRequest
from animama.app.model_clients.prompt import prompt_messages
from animama.domain import ModelProvider

from .._common import jsonable


def create_chat_completion_kwargs(spec: ModelClientRequest, *, timeout: float | None) -> dict[str, Any]:
    """Translate a provider-neutral request into Chat Completions SDK kwargs."""

    endpoint = _endpoint_family_for_provider(spec.model_provider)
    payload: dict[str, Any] = {
        "model": spec.model_provider.model,
        "stream": True,
    }
    if endpoint.include_stream_options:
        payload["stream_options"] = jsonable(spec.prompt.stream_options or {"include_usage": True})
    payload["messages"] = _messages_for_spec(spec, endpoint=endpoint)
    response_format = _response_format_for_spec(spec)
    if response_format is not None:
        payload["response_format"] = response_format

    reasoning_effort = _reasoning_effort_for_spec(spec, endpoint=endpoint)
    if reasoning_effort is not None:
        payload["reasoning_effort"] = reasoning_effort
    if endpoint.family == "deepseek":
        payload["extra_body"] = {"thinking": _deepseek_thinking_config(spec, reasoning_effort=reasoning_effort)}
    if spec.prompt.prompt_cache_key and endpoint.include_prompt_cache_key:
        payload["prompt_cache_key"] = spec.prompt.prompt_cache_key
    if spec.prompt.tools:
        payload["tools"] = _tools_for_spec(spec, endpoint=endpoint)
        if spec.prompt.parallel_tool_calls is not None and endpoint.include_parallel_tool_calls:
            payload["parallel_tool_calls"] = bool(spec.prompt.parallel_tool_calls)
    if spec.prompt.tool_choice is not None:
        payload["tool_choice"] = jsonable(spec.prompt.tool_choice)
    if timeout is not None:
        payload["timeout"] = timeout
    return payload


def base_url_for_spec(spec: ModelClientRequest, default_base_url: str) -> str:
    """Resolve a per-provider base URL override for OpenAI-compatible servers."""

    base_url = spec.model_provider.provider_base_url or default_base_url
    return base_url.rstrip("/")


def is_deepseek_model_provider(model_provider: ModelProvider) -> bool:
    """Return whether this OpenAI-compatible provider row targets DeepSeek."""

    if _openai_compatible_provider(model_provider) == "deepseek":
        return True
    base_url = model_provider.provider_base_url
    if isinstance(base_url, str) and _normalize_base_url(base_url) == _normalize_base_url(DEEPSEEK_BASE_URL):
        return True
    return model_provider.model.startswith("deepseek-v4-")


def is_huggingface_model_provider(model_provider: ModelProvider) -> bool:
    """Return whether this OpenAI-compatible provider row targets Hugging Face."""

    if _openai_compatible_provider(model_provider) == "huggingface":
        return True
    base_url = model_provider.provider_base_url
    return isinstance(base_url, str) and _normalize_base_url(base_url) == _normalize_base_url(
        HUGGINGFACE_ROUTER_BASE_URL
    )


def _openai_compatible_provider(model_provider: ModelProvider) -> str | None:
    metadata = model_provider.metadata
    provider = metadata.get("openai_compatible_provider") if isinstance(metadata, Mapping) else None
    if isinstance(provider, str) and provider.strip():
        return provider.strip().lower()
    return None


def _normalize_base_url(value: str) -> str:
    return value.strip().rstrip("/")


class _EndpointFamily:
    def __init__(
        self,
        family: str,
        *,
        include_stream_options: bool = True,
        include_prompt_cache_key: bool = True,
        include_parallel_tool_calls: bool = True,
        include_reasoning_effort: bool = True,
        strip_function_strict: bool = False,
    ) -> None:
        self.family = family
        self.include_stream_options = include_stream_options
        self.include_prompt_cache_key = include_prompt_cache_key
        self.include_parallel_tool_calls = include_parallel_tool_calls
        self.include_reasoning_effort = include_reasoning_effort
        self.strip_function_strict = strip_function_strict


def _endpoint_family_for_provider(model_provider: ModelProvider) -> _EndpointFamily:
    if is_deepseek_model_provider(model_provider):
        return _EndpointFamily(
            "deepseek",
            include_prompt_cache_key=False,
            include_parallel_tool_calls=False,
        )
    if is_huggingface_model_provider(model_provider):
        return _EndpointFamily(
            "huggingface",
            include_stream_options=False,
            include_prompt_cache_key=False,
            include_parallel_tool_calls=False,
            include_reasoning_effort=False,
            strip_function_strict=True,
        )
    return _EndpointFamily("openai")


def _messages_for_spec(spec: ModelClientRequest, *, endpoint: _EndpointFamily) -> list[dict[str, Any]]:
    messages = prompt_messages(spec.prompt)
    if _supports_developer_role(spec, endpoint=endpoint):
        return messages
    return _messages_with_developer_role_folded_into_system(messages)


def _supports_developer_role(spec: ModelClientRequest, *, endpoint: _EndpointFamily) -> bool:
    if endpoint.family in {"deepseek", "huggingface"}:
        return False
    return bool(spec.model_provider.capabilities.supports_developer_role)


def _tools_for_spec(spec: ModelClientRequest, *, endpoint: _EndpointFamily) -> Any:
    tools = jsonable(spec.prompt.tools)
    if endpoint.strip_function_strict:
        return _tools_without_function_strict(tools)
    return tools


def _tools_without_function_strict(tools: Any) -> Any:
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


def _reasoning_effort_for_spec(spec: ModelClientRequest, *, endpoint: _EndpointFamily) -> str | None:
    raw_effort = spec.prompt.reasoning_effort
    effort = raw_effort.strip() if isinstance(raw_effort, str) and raw_effort.strip() else None
    if not endpoint.include_reasoning_effort:
        return None
    if endpoint.family != "deepseek":
        return effort
    return _deepseek_reasoning_effort(spec.model_provider, effort)


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


__all__ = [
    "base_url_for_spec",
    "create_chat_completion_kwargs",
    "is_deepseek_model_provider",
    "is_huggingface_model_provider",
]
