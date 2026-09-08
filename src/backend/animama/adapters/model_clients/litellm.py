from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Mapping
from importlib import import_module
from typing import Any

from animama.app.model_catalog import STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT
from animama.app.model_clients import (
    ModelClientDelta,
    ModelClientFinal,
    ModelClientProviderError,
    ModelClientRequest,
    ModelClientToolCall,
)
from animama.app.model_clients.prompt import prompt_last_user_message, prompt_messages

from ._common import coerce_text, get_value, jsonable, usage_from_payload

LITELLM_PROVIDER_TYPE = "LiteLLMAgent"


class LiteLLMModelClient:
    """Provider-neutral model client backed by LiteLLM's async completion SDK."""

    def __init__(self, *, litellm_module: Any | None = None, timeout: float | None = 60.0) -> None:
        self._litellm = litellm_module
        self._timeout = timeout

    async def stream(self, spec: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        if _uses_final_completion(spec):
            final = await self.complete(spec)
            if final.text:
                yield ModelClientDelta(kind="text_delta", text=final.text, raw_metadata=final.raw_provider_metadata)
            yield ModelClientDelta(kind="final", final=final)
            yield ModelClientDelta(kind="done")
            return

        parts: list[str] = []
        usage = None
        metadata: dict[str, Any] = {"provider": LITELLM_PROVIDER_TYPE, "model": spec.model_provider.model}
        tool_call_parts: dict[int, dict[str, Any]] = {}
        try:
            response = await self._module().acompletion(**_stream_kwargs(spec, timeout=self._timeout))
            async for chunk in response:
                chunk_usage = get_value(chunk, "usage")
                if chunk_usage is not None:
                    usage = usage_from_payload(chunk_usage)
                _merge_tool_call_deltas(tool_call_parts, chunk)
                text = _chunk_text(chunk)
                if text:
                    parts.append(text)
                    yield ModelClientDelta(kind="text_delta", text=text, raw_metadata=metadata)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise ModelClientProviderError(
                "LiteLLM request failed",
                code="provider_request_failed",
                raw_metadata=_exception_metadata(exc),
            ) from exc

        yield ModelClientDelta(
            kind="final",
            final=ModelClientFinal(
                text="".join(parts),
                usage=usage or usage_from_payload(None),
                raw_provider_metadata=metadata,
                tool_calls=_tool_calls_from_parts(tool_call_parts),
            ),
        )
        yield ModelClientDelta(kind="done")

    async def complete(self, spec: ModelClientRequest) -> ModelClientFinal:
        metadata: dict[str, Any] = {"provider": LITELLM_PROVIDER_TYPE, "model": spec.model_provider.model}
        try:
            response = await self._module().acompletion(**_completion_kwargs(spec, timeout=self._timeout))
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            raise ModelClientProviderError(
                "LiteLLM request failed",
                code="provider_request_failed",
                raw_metadata=_exception_metadata(exc),
            ) from exc

        return ModelClientFinal(
            text=_response_text(response) or "",
            usage=usage_from_payload(get_value(response, "usage")),
            raw_provider_metadata=metadata,
            tool_calls=_response_tool_calls(response),
        )

    async def aclose(self) -> None:
        return None

    def _module(self) -> Any:
        if self._litellm is None:
            self._litellm = import_module("litellm")
        return self._litellm


def _stream_kwargs(spec: ModelClientRequest, *, timeout: float | None) -> dict[str, Any]:
    kwargs = _base_kwargs(spec, timeout=timeout)
    kwargs["stream"] = True
    kwargs["stream_options"] = jsonable(spec.prompt.stream_options or {"include_usage": True})
    return kwargs


def _completion_kwargs(spec: ModelClientRequest, *, timeout: float | None) -> dict[str, Any]:
    return _base_kwargs(spec, timeout=timeout)


def _base_kwargs(spec: ModelClientRequest, *, timeout: float | None) -> dict[str, Any]:
    kwargs: dict[str, Any] = {
        "model": spec.model_provider.model,
        "messages": _litellm_messages(spec),
        "drop_params": True,
    }
    if not kwargs["messages"]:
        kwargs["messages"] = [{"role": "user", "content": prompt_last_user_message(spec.prompt, fallback="")}]
    response_format = _response_format(spec)
    if response_format is not None:
        kwargs["response_format"] = response_format
    reasoning_effort = spec.prompt.reasoning_effort
    if isinstance(reasoning_effort, str) and reasoning_effort.strip():
        kwargs["reasoning_effort"] = reasoning_effort.strip()
    if spec.prompt.prompt_cache_key:
        kwargs["prompt_cache_key"] = spec.prompt.prompt_cache_key
    if spec.prompt.tools:
        kwargs["tools"] = _litellm_tools(spec)
        if spec.prompt.parallel_tool_calls is not None:
            kwargs["parallel_tool_calls"] = bool(spec.prompt.parallel_tool_calls)
    if spec.prompt.tool_choice is not None:
        kwargs["tool_choice"] = jsonable(spec.prompt.tool_choice)
    if timeout is not None:
        kwargs["timeout"] = timeout
    return kwargs


def _litellm_messages(spec: ModelClientRequest) -> list[dict[str, Any]]:
    """Return the most portable OpenAI-style message list for LiteLLM backends."""

    instructions: list[str] = []
    conversation: list[dict[str, Any]] = []
    for message in prompt_messages(spec.prompt):
        role = str(message.get("role") or "").strip().lower()
        if role in {"system", "developer"}:
            content = coerce_text(message.get("content"))
            if content:
                instructions.append(content)
            continue
        conversation.append(message)
    if not instructions:
        return conversation
    return [{"role": "system", "content": "\n\n".join(instructions)}, *conversation]


def _litellm_tools(spec: ModelClientRequest) -> list[dict[str, Any]]:
    tools = jsonable(spec.prompt.tools)
    if not isinstance(tools, list):
        return []
    portable_tools: list[dict[str, Any]] = []
    for tool in tools:
        if not isinstance(tool, dict):
            continue
        copied = dict(tool)
        function = copied.get("function")
        if copied.get("type") == "function" and isinstance(function, dict):
            portable_function = dict(function)
            portable_function.pop("strict", None)
            copied["function"] = portable_function
        portable_tools.append(copied)
    return portable_tools


def _response_format(spec: ModelClientRequest) -> dict[str, Any] | None:
    response_format = spec.prompt.response_format
    if not isinstance(response_format, Mapping):
        return None
    if spec.model_provider.capabilities.structured_output_transport == STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT:
        return {"type": "json_object"}
    raw = jsonable(response_format)
    return raw if isinstance(raw, dict) else None


def _uses_final_completion(spec: ModelClientRequest) -> bool:
    return (
        isinstance(spec.prompt.response_format, Mapping)
        and spec.model_provider.capabilities.structured_output_transport == STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT
    )


def _chunk_text(chunk: Any) -> str | None:
    choices = get_value(chunk, "choices", []) or []
    choice = choices[0] if choices else None
    delta = get_value(choice, "delta", {})
    return coerce_text(get_value(delta, "content"))


def _merge_tool_call_deltas(tool_call_parts: dict[int, dict[str, Any]], chunk: Any) -> None:
    choices = get_value(chunk, "choices", []) or []
    for choice in choices:
        delta = get_value(choice, "delta", {})
        raw_tool_calls = get_value(delta, "tool_calls")
        if not isinstance(raw_tool_calls, list):
            continue
        for fallback_index, raw_tool_call in enumerate(raw_tool_calls):
            raw_index = get_value(raw_tool_call, "index", fallback_index)
            index = raw_index if isinstance(raw_index, int) else fallback_index
            current = tool_call_parts.setdefault(index, {"id": "", "name": "", "arguments": []})
            call_id = get_value(raw_tool_call, "id")
            if isinstance(call_id, str) and call_id:
                current["id"] = call_id
            function = get_value(raw_tool_call, "function", {})
            name = get_value(function, "name")
            if isinstance(name, str) and name:
                current["name"] = name
            arguments = get_value(function, "arguments")
            if isinstance(arguments, str) and arguments:
                current["arguments"].append(arguments)


def _tool_calls_from_parts(tool_call_parts: dict[int, dict[str, Any]]) -> tuple[ModelClientToolCall, ...]:
    calls: list[ModelClientToolCall] = []
    for index in sorted(tool_call_parts):
        part = tool_call_parts[index]
        name = str(part.get("name") or "").strip()
        if not name:
            continue
        calls.append(
            ModelClientToolCall(
                id=str(part.get("id") or f"toolcall-{index}").strip(),
                name=name,
                arguments="".join(part.get("arguments") or []),
            )
        )
    return tuple(calls)


def _response_tool_calls(response: Any) -> tuple[ModelClientToolCall, ...]:
    choices = get_value(response, "choices", []) or []
    choice = choices[0] if choices else None
    message = get_value(choice, "message", {})
    raw_tool_calls = get_value(message, "tool_calls")
    if not isinstance(raw_tool_calls, list):
        return ()
    parts: dict[int, dict[str, Any]] = {}
    for index, raw_tool_call in enumerate(raw_tool_calls):
        current = parts.setdefault(index, {"id": "", "name": "", "arguments": []})
        call_id = get_value(raw_tool_call, "id")
        if isinstance(call_id, str) and call_id:
            current["id"] = call_id
        function = get_value(raw_tool_call, "function", {})
        name = get_value(function, "name")
        if isinstance(name, str) and name:
            current["name"] = name
        arguments = get_value(function, "arguments")
        if isinstance(arguments, str):
            current["arguments"].append(arguments)
    return _tool_calls_from_parts(parts)


def _response_text(response: Any) -> str | None:
    choices = get_value(response, "choices", []) or []
    choice = choices[0] if choices else None
    message = get_value(choice, "message", {})
    return coerce_text(get_value(message, "content"))


def _exception_metadata(exc: Exception) -> dict[str, Any]:
    metadata: dict[str, Any] = {"exc_type": exc.__class__.__name__}
    message = str(exc)
    if message:
        metadata["message"] = message[:1000]
    for attr in ("status_code", "llm_provider", "model"):
        value = getattr(exc, attr, None)
        if isinstance(value, str | int) and value != "":
            metadata[attr] = value
    response = getattr(exc, "response", None)
    if response is not None:
        try:
            metadata["body"] = response.json()
        except Exception:
            text = getattr(response, "text", None)
            if isinstance(text, str) and text:
                metadata["body"] = text[:1000]
    return metadata


__all__ = ["LITELLM_PROVIDER_TYPE", "LiteLLMModelClient"]
