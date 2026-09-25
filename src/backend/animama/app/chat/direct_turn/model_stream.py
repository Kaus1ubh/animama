from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator, Awaitable, Callable, Mapping
from dataclasses import replace
from typing import Any, cast

from animama.app.model_clients import (
    DirectChatPrompt,
    ModelClientDelta,
    ModelClientError,
    ModelClientFinal,
    ModelClientRequest,
    ModelClientToolCall,
    ModelClientToolResult,
    elapsed_ms,
    model_client_preview_log_context,
    model_client_request_log_context,
)
from animama.app.model_clients.event_summary import ModelClientStreamEventObserver
from animama.app.model_clients.prompt import copy_direct_chat_prompt, prompt_messages
from animama.app.safety.prompts import COMPANION_GUARDRAILS
from animama.domain.chat import ChatMessage
from animama.domain.usage import Usage
from animama.logging import get_logger

from ..memory_tools import DirectChatMemoryToolService, MemoryToolExecutionContext
from .constants import (
    MAX_MEMORY_TOOL_ROUNDS,
    MEMORY_TOOL_LIMIT_FINAL_INSTRUCTION,
    OPENAI_CHAT_COMPLETIONS_PROVIDER,
    OPENAI_RESPONSES_PROVIDER,
)
from .message_builders import (
    assistant_tool_call_prompt_message,
    internal_tool_call_message,
    internal_tool_result_message,
    model_client_tool_call_prompt_item,
    model_client_tool_result_prompt_item,
    tool_result_prompt_message,
)
from .provider_state import (
    compiled_context_history,
    final_with_previous_response_retry_metadata,
    model_request_without_continuation,
    openai_responses_continuation_from_final,
    should_retry_without_previous_response_id,
)
from .response_format import main_structured_response_guidance
from .types import DirectChatTurnRequest, DirectChatTurnStreamError, PreparedDirectChatTurn

_USAGE_REQUIRED_PROVIDER_TYPES = frozenset({OPENAI_CHAT_COMPLETIONS_PROVIDER, OPENAI_RESPONSES_PROVIDER})
_log = get_logger("app.chat.direct_turn.model_stream")
# Observers are app-layer callbacks, not provider APIs. They let the direct
# executor react to model-round boundaries and provider-neutral text deltas
# while this collector continues to own tool loops, retries, usage, and final
# signal validation.
ModelRoundObserver = Callable[[int], Awaitable[None]]
TextDeltaObserver = Callable[[int, str], Awaitable[None]]


class DirectTurnModelStreamCollector:
    """Consume provider-neutral model streams until one assistant final is ready.

    The collector is the app-layer boundary that knows how to interpret
    `ModelClientDelta` values, aggregate usage across memory tool rounds, retry
    stale Responses cursors, and return any internal tool transcript messages for
    persistence. It does not know about HTTP/SSE formatting.
    """

    def __init__(
        self,
        *,
        stream: Callable[[ModelClientRequest], AsyncIterator[ModelClientDelta]],
        memory_tool_service: DirectChatMemoryToolService | None,
        load_chat_context: Callable[[str], Awaitable[Any]],
        build_prompt: Callable[..., DirectChatPrompt],
    ) -> None:
        self._stream = stream
        self._memory_tool_service = memory_tool_service
        self._load_chat_context = load_chat_context
        self._build_prompt = build_prompt

    async def collect(
        self,
        prepared: PreparedDirectChatTurn,
        *,
        on_model_round_start: ModelRoundObserver | None = None,
        on_text_delta: TextDeltaObserver | None = None,
    ) -> tuple[ModelClientFinal | None, list[ChatMessage]]:
        """Run the initial model request plus any memory tool follow-up rounds.

        A round is one request to the selected model provider. Tool-call finals
        do not complete the user-visible turn; they produce internal tool work
        and then another model round with appended tool results.
        """

        started_at = time.monotonic()
        model_request = prepared.model_request
        internal_messages: list[ChatMessage] = []
        usage_total = Usage()
        usage_seen = False
        tool_result_cache = _tool_result_cache_from_prompt(model_request.prompt)
        _log.info(
            "Direct chat model stream collection started",
            **_direct_turn_log_context(prepared, model_request),
            memory_tools_available=self._memory_tool_service is not None,
            max_tool_rounds=MAX_MEMORY_TOOL_ROUNDS,
        )

        for round_index in range(MAX_MEMORY_TOOL_ROUNDS + 1):
            # Each round must consume the provider stream until the adapter emits
            # `final` or raises. Chat Completions reaches that point after a
            # finish_reason chunk; Responses reaches it after response.completed.
            _log.info(
                "Direct chat model round started",
                **_direct_turn_log_context(prepared, model_request),
                round_index=round_index,
            )
            if on_model_round_start is not None:
                await on_model_round_start(round_index)
            final = await self._collect_model_final(
                prepared,
                model_request,
                round_index=round_index,
                on_text_delta=on_text_delta,
            )
            if final is None:
                _log.warning(
                    "Direct chat model round ended without final",
                    **_direct_turn_log_context(prepared, model_request),
                    round_index=round_index,
                    elapsed_ms=elapsed_ms(started_at),
                )
                return None, internal_messages
            usage_total.add(final.usage)
            usage_seen = True
            tool_calls = tuple(final.tool_calls)
            _log.info(
                "Direct chat model round final received",
                **_direct_turn_log_context(prepared, model_request),
                round_index=round_index,
                final_text_length=len(final.text),
                tool_call_count=len(tool_calls),
                input_tokens=final.usage.input_tokens,
                output_tokens=final.usage.output_tokens,
                total_tokens=final.usage.total_tokens,
            )
            if not tool_calls:
                # No tool calls means the final model text is ready for parsing.
                # If earlier rounds called tools, usage is folded into this final.
                if round_index == 0:
                    _log.info(
                        "Direct chat model stream collection completed",
                        **_direct_turn_log_context(prepared, model_request),
                        round_count=round_index + 1,
                        elapsed_ms=elapsed_ms(started_at),
                    )
                    return final, internal_messages
                _log.info(
                    "Direct chat model stream collection completed",
                    **_direct_turn_log_context(prepared, model_request),
                    round_count=round_index + 1,
                    elapsed_ms=elapsed_ms(started_at),
                    aggregated_usage=True,
                )
                return _final_with_usage(final, usage_total if usage_seen else final.usage), internal_messages

            if round_index >= MAX_MEMORY_TOOL_ROUNDS:
                # Ask the model for a final answer without tools instead of
                # silently truncating a loop. If it still asks for tools, surface
                # a provider-like error to the caller.
                _log.warning(
                    "Direct chat memory tool round limit reached; requesting forced final",
                    **_direct_turn_log_context(prepared, model_request),
                    round_index=round_index,
                    tool_call_count=len(tool_calls),
                    max_tool_rounds=MAX_MEMORY_TOOL_ROUNDS,
                )
                forced_round_index = round_index + 1
                limit_results = tuple(
                    ModelClientToolResult(
                        call_id=tool_call.id,
                        tool_type=tool_call.tool_type,
                        status="failed",
                        output=_tool_error_json(
                            "memory_tool_round_limit",
                            "Tool call was not executed because the memory tool round limit was reached",
                        ),
                    )
                    for tool_call in tool_calls
                )
                limit_messages = _tool_exchange_prompt_items(
                    model_request=model_request,
                    tool_calls=tool_calls,
                    tool_results=limit_results,
                )
                internal_messages.extend(
                    _internal_tool_exchange_messages(
                        prepared=prepared,
                        model_request=model_request,
                        tool_calls=tool_calls,
                        tool_results=limit_results,
                    )
                )
                limit_request = _model_request_with_appended_messages(
                    model_request,
                    limit_messages,
                    previous_final=final,
                )
                if on_model_round_start is not None:
                    await on_model_round_start(forced_round_index)
                forced_final = await self._collect_model_final(
                    prepared,
                    _model_request_forced_final_without_tools(limit_request),
                    round_index=forced_round_index,
                    on_text_delta=on_text_delta,
                )
                if forced_final is None:
                    return None, internal_messages
                usage_total.add(forced_final.usage)
                usage_seen = True
                if not forced_final.tool_calls:
                    _log.info(
                        "Direct chat model stream collection completed",
                        **_direct_turn_log_context(prepared, model_request),
                        round_count=round_index + 2,
                        elapsed_ms=elapsed_ms(started_at),
                        aggregated_usage=True,
                        forced_final=True,
                    )
                    return _final_with_usage(
                        forced_final,
                        usage_total if usage_seen else forced_final.usage,
                    ), internal_messages
                raise DirectChatTurnStreamError(
                    request=prepared.request,
                    error=ModelClientError(
                        "Memory tool round limit reached",
                        code="memory_tool_round_limit",
                        raw_metadata={"max_tool_rounds": MAX_MEMORY_TOOL_ROUNDS},
                    ),
                )
            if self._memory_tool_service is None:
                raise DirectChatTurnStreamError(
                    request=prepared.request,
                    error=ModelClientError(
                        "Memory tool service is not configured",
                        code="memory_tool_service_missing",
                    ),
                )

            available_tools = _available_tool_names(model_request)
            _log.info(
                "Direct chat memory tool calls requested",
                **_direct_turn_log_context(prepared, model_request),
                round_index=round_index,
                tool_call_count=len(tool_calls),
                tool_names=[tool_call.name for tool_call in tool_calls],
            )
            tool_results: list[ModelClientToolResult] = []
            for tool_call in tool_calls:
                tool_started_at = time.monotonic()
                _log.info(
                    "Direct chat memory tool call started",
                    **_direct_turn_log_context(prepared, model_request),
                    round_index=round_index,
                    tool_name=tool_call.name,
                    tool_call_id=tool_call.id,
                    **model_client_preview_log_context(tool_arguments_preview=tool_call.arguments),
                )
                tool_result = await self._execute_or_reuse_memory_tool_call(
                    tool_call,
                    request=prepared.request,
                    model_request=model_request,
                    available_tools=available_tools,
                    result_cache=tool_result_cache,
                )
                _log.info(
                    "Direct chat memory tool call completed",
                    **_direct_turn_log_context(prepared, model_request),
                    round_index=round_index,
                    tool_name=tool_call.name,
                    tool_call_id=tool_call.id,
                    result_length=len(tool_result.output),
                    elapsed_ms=elapsed_ms(tool_started_at),
                    **model_client_preview_log_context(tool_result_preview=tool_result.output),
                )
                tool_results.append(tool_result)
            result_tuple = tuple(tool_results)
            tool_prompt_messages = _tool_exchange_prompt_items(
                model_request=model_request,
                tool_calls=tool_calls,
                tool_results=result_tuple,
            )
            internal_messages.extend(
                _internal_tool_exchange_messages(
                    prepared=prepared,
                    model_request=model_request,
                    tool_calls=tool_calls,
                    tool_results=result_tuple,
                )
            )
            # The next model request includes the assistant tool-call item plus
            # tool outputs. Responses providers may carry this via
            # previous_response_id; Chat Completions gets explicit messages.
            model_request = _model_request_with_appended_messages(
                model_request,
                tool_prompt_messages,
                previous_final=final,
            )

        return None, internal_messages

    async def _collect_model_final(
        self,
        prepared: PreparedDirectChatTurn,
        model_request: ModelClientRequest,
        *,
        round_index: int,
        on_text_delta: TextDeltaObserver | None = None,
        allow_previous_response_retry: bool = True,
    ) -> ModelClientFinal | None:
        """Consume one provider stream and return its final assistant result."""

        started_at = time.monotonic()
        parts: list[str] = []
        raw_metadata: dict[str, Any] = {}
        delta_count = 0
        event_delta_count = 0
        text_delta_count = 0
        first_delta_logged = False
        stream_events = ModelClientStreamEventObserver(
            require_finish_reason_provider_types=(OPENAI_CHAT_COMPLETIONS_PROVIDER,),
            require_usage_provider_types=_USAGE_REQUIRED_PROVIDER_TYPES,
        )
        _log.info(
            "Direct chat model client stream collection started",
            **_direct_turn_log_context(prepared, model_request),
            allow_previous_response_retry=allow_previous_response_retry,
        )
        try:
            async for delta in self._stream(model_request):
                delta_count += 1
                if not first_delta_logged:
                    first_delta_logged = True
                    _log.info(
                        "Direct chat model client first delta received",
                        **_direct_turn_log_context(prepared, model_request),
                        delta_kind=delta.kind,
                        elapsed_ms=elapsed_ms(started_at),
                    )
                if delta.kind == "text_delta" and isinstance(delta.text, str):
                    # Text deltas are a fallback accumulator. Normal adapters
                    # should still emit a `final` with authoritative text/usage.
                    text_delta_count += 1
                    parts.append(delta.text)
                    raw_metadata.update(dict(delta.raw_metadata))
                    if on_text_delta is not None:
                        await on_text_delta(round_index, delta.text)
                elif delta.kind == "event" and delta.stream_event is not None:
                    # Intermediate provider events are logged and summarized,
                    # but not exposed as public chat:sse frames.
                    event_delta_count += 1
                    stream_events.record(delta.stream_event)
                elif delta.kind == "final" and delta.final is not None:
                    # This is the only successful end-of-stream signal accepted
                    # by direct chat. The adapter decides what provider signal is
                    # strong enough to produce this final.
                    final = stream_events.final_with_summary(delta.final, model_request=model_request)
                    _log.info(
                        "Direct chat model client final delta received",
                        **_direct_turn_log_context(prepared, model_request),
                        delta_count=delta_count,
                        event_delta_count=event_delta_count,
                        text_delta_count=text_delta_count,
                        final_text_length=len(final.text),
                        tool_call_count=len(final.tool_calls),
                        elapsed_ms=elapsed_ms(started_at),
                        **model_client_preview_log_context(final_text_preview=final.text),
                    )
                    return final
                elif delta.kind == "error":
                    _log.warning(
                        "Direct chat model client error delta received",
                        **_direct_turn_log_context(prepared, model_request),
                        code=delta.raw_metadata.get("code") if isinstance(delta.raw_metadata, Mapping) else None,
                        elapsed_ms=elapsed_ms(started_at),
                    )
                    raise ModelClientError(
                        delta.error or "Model client stream failed",
                        code="model_client_error",
                        raw_metadata=delta.raw_metadata,
                    )
        except asyncio.CancelledError:
            raise
        except ModelClientError as exc:
            if should_retry_without_previous_response_id(
                exc,
                model_request,
                partial_text_seen=bool(parts),
                allow_previous_response_retry=allow_previous_response_retry,
            ):
                # A Responses previous_response_id can go stale if provider-side
                # state expires. Retry once with explicit chat history, but only
                # before any public text has been seen.
                _log.warning(
                    "Direct chat model client retrying without previous_response_id",
                    **_direct_turn_log_context(prepared, model_request),
                    code=exc.code,
                    elapsed_ms=elapsed_ms(started_at),
                )
                retry_final = await self._collect_model_final(
                    prepared,
                    await self._retry_model_request_without_previous_response_id(prepared, model_request),
                    round_index=round_index,
                    on_text_delta=on_text_delta,
                    allow_previous_response_retry=False,
                )
                if retry_final is not None:
                    return final_with_previous_response_retry_metadata(
                        retry_final,
                        model_request=model_request,
                        error=exc,
                    )
                return None
            raise DirectChatTurnStreamError(request=prepared.request, error=exc) from exc
        if parts:
            # Kept for non-conforming adapters that yielded text but no final.
            # Observability marks this as missing-final so callers can alert.
            _log.warning(
                "Direct chat model client stream ended after text without final",
                **_direct_turn_log_context(prepared, model_request),
                delta_count=delta_count,
                event_delta_count=event_delta_count,
                text_delta_count=text_delta_count,
                elapsed_ms=elapsed_ms(started_at),
            )
            return stream_events.final_with_summary(
                ModelClientFinal(
                    text="".join(parts),
                    usage=Usage(),
                    raw_provider_metadata={**raw_metadata, "final_missing": True},
                ),
                model_request=model_request,
            )
        _log.warning(
            "Direct chat model client stream ended without output",
            **_direct_turn_log_context(prepared, model_request),
            delta_count=delta_count,
            event_delta_count=event_delta_count,
            text_delta_count=text_delta_count,
            elapsed_ms=elapsed_ms(started_at),
        )
        return None

    async def _execute_memory_tool_call(
        self,
        tool_call: ModelClientToolCall,
        *,
        request: DirectChatTurnRequest,
        model_request: ModelClientRequest,
        available_tools: set[str],
    ) -> str:
        """Run one model-requested direct memory tool and return provider text output."""

        # Tools are exposed only when the request has a service.
        assert self._memory_tool_service is not None
        if tool_call.name not in available_tools:
            return _tool_error_json(
                "unsupported_tool",
                f"Tool {tool_call.name!r} was not available for this turn",
            )
        try:
            parsed = json.loads(tool_call.arguments or "{}")
        except json.JSONDecodeError as exc:
            return _tool_error_json(
                "invalid_arguments",
                "Tool arguments must be a JSON object",
                error=f"{exc.msg} at position {exc.pos}",
            )
        if not isinstance(parsed, Mapping):
            return _tool_error_json("invalid_arguments", "Tool arguments must be a JSON object")

        context = MemoryToolExecutionContext(
            user_id=request.user_id,
            anima_id=request.anima_id,
            chat_id=request.chat_id,
            run_id=request.run_id,
            provider_type=model_request.model_provider.provider_type,
            model_provider_id=model_request.model_provider.id,
            model=model_request.model_provider.model,
            native_memory_patch_enabled=model_request.provider_options.memory_apply_patch_enabled,
        )
        if tool_call.tool_type == "apply_patch":
            if tool_call.name != "apply_patch":
                return _tool_error_json(
                    "unsupported_tool",
                    f"Unsupported native memory tool {tool_call.name!r}",
                )
            return await self._memory_tool_service.execute_native_patch(
                operation=parsed,
                context=context,
                tool_call_id=tool_call.id,
            )
        if tool_call.tool_type != "function":
            return _tool_error_json(
                "unsupported_tool_type",
                f"Unsupported memory tool type {tool_call.tool_type!r}",
            )
        return await self._memory_tool_service.execute(
            tool_name=tool_call.name,
            arguments=parsed,
            context=context,
            tool_call_id=tool_call.id,
        )

    async def _execute_or_reuse_memory_tool_call(
        self,
        tool_call: ModelClientToolCall,
        *,
        request: DirectChatTurnRequest,
        model_request: ModelClientRequest,
        available_tools: set[str],
        result_cache: dict[str, tuple[ModelClientToolCall, ModelClientToolResult]],
    ) -> ModelClientToolResult:
        """Execute a tool call once, reusing an identical prior call result."""

        existing = result_cache.get(tool_call.id)
        if existing is not None:
            prior_call, prior_result = existing
            if _same_tool_call(prior_call, tool_call):
                return prior_result
            return ModelClientToolResult(
                call_id=tool_call.id,
                tool_type=tool_call.tool_type,
                status="failed",
                output=_tool_error_json(
                    "tool_call_id_reused",
                    "Tool call id was reused with different arguments; the call was not executed",
                ),
            )
        output = await self._execute_memory_tool_call(
            tool_call,
            request=request,
            model_request=model_request,
            available_tools=available_tools,
        )
        result = ModelClientToolResult(
            call_id=tool_call.id,
            tool_type=tool_call.tool_type,
            status="completed" if _tool_output_ok(output) else "failed",
            output=output,
        )
        result_cache[tool_call.id] = (tool_call, result)
        return result

    async def _retry_model_request_without_previous_response_id(
        self,
        prepared: PreparedDirectChatTurn,
        model_request: ModelClientRequest,
    ) -> ModelClientRequest:
        """Rebuild a Responses request without the provider continuation cursor."""

        if prepared.context_loaded:
            return model_request_without_continuation(model_request)

        chat_context = await self._load_chat_context(prepared.request.chat_id)
        response_format = cast(dict[str, Any], prepared.model_request.prompt.response_format)
        prompt = self._build_prompt(
            request=prepared.request,
            model_provider=model_request.model_provider,
            memory_context=prepared.memory_context,
            memory_tool_specs=prepared.memory_tool_specs,
            visible_history=compiled_context_history(chat_context),
            response_format=response_format,
            response_format_guidance=main_structured_response_guidance(
                model_request.model_provider,
                prepared.output_type,
            ),
            memory_tools_active=(
                bool(prepared.memory_tool_specs) or model_request.provider_options.memory_apply_patch_enabled
            ),
            native_memory_patch_enabled=model_request.provider_options.memory_apply_patch_enabled,
        )
        extra_messages = prompt_messages(model_request.prompt)[len(prepared.model_request.prompt.messages) :]
        if extra_messages:
            prompt = _prompt_with_appended_messages(prompt, extra_messages)
        return ModelClientRequest(
            model_provider=model_request.model_provider,
            prompt=prompt,
            provider_options=model_request.provider_options,
            continuation=None,
        )


def _direct_turn_log_context(
    prepared: PreparedDirectChatTurn,
    model_request: ModelClientRequest,
) -> dict[str, Any]:
    """Return safe request/model identifiers for direct-turn lifecycle logs."""

    context = model_client_request_log_context(model_request)
    context.update(
        {
            "anima_id": prepared.request.anima_id,
            "chat_id": prepared.request.chat_id,
            "run_id": prepared.request.run_id,
        }
    )
    return context


def _final_with_usage(final: ModelClientFinal, usage: Usage) -> ModelClientFinal:
    """Return the final model result with usage aggregated across tool rounds."""

    return ModelClientFinal(
        text=final.text,
        usage=usage,
        raw_provider_metadata={
            **dict(final.raw_provider_metadata),
            "tool_loop_usage_aggregated": True,
        },
        structured_payload=final.structured_payload,
        tool_calls=final.tool_calls,
    )


def _prompt_tool_names(prompt: DirectChatPrompt) -> set[str]:
    """Extract direct function-tool names available in the current prompt."""

    names: set[str] = set()
    for tool in getattr(prompt, "tools", ()):
        if not isinstance(tool, Mapping) or tool.get("type") != "function":
            continue
        function = tool.get("function")
        if not isinstance(function, Mapping):
            continue
        name = function.get("name")
        if isinstance(name, str) and name.strip():
            names.add(name.strip())
    return names


def _available_tool_names(model_request: ModelClientRequest) -> set[str]:
    """Return function and internal native tools available for one request."""

    names = _prompt_tool_names(model_request.prompt)
    if model_request.provider_options.memory_apply_patch_enabled:
        names.add("apply_patch")
    return names


def _tool_exchange_prompt_items(
    *,
    model_request: ModelClientRequest,
    tool_calls: tuple[ModelClientToolCall, ...],
    tool_results: tuple[ModelClientToolResult, ...],
) -> list[dict[str, Any]]:
    """Build ordered prompt items for one provider-neutral tool exchange."""

    if model_request.model_provider.provider_type == OPENAI_RESPONSES_PROVIDER:
        return [
            *(model_client_tool_call_prompt_item(tool_call) for tool_call in tool_calls),
            *(model_client_tool_result_prompt_item(tool_result) for tool_result in tool_results),
        ]
    call_message = assistant_tool_call_prompt_message(tool_calls)
    result_messages = [
        tool_result_prompt_message(tool_call, tool_result.output)
        for tool_call, tool_result in zip(tool_calls, tool_results, strict=True)
    ]
    return [call_message, *result_messages]


def _internal_tool_exchange_messages(
    *,
    prepared: PreparedDirectChatTurn,
    model_request: ModelClientRequest,
    tool_calls: tuple[ModelClientToolCall, ...],
    tool_results: tuple[ModelClientToolResult, ...],
) -> list[ChatMessage]:
    """Build hidden audit rows that can reconstruct a future explicit replay."""

    messages: list[ChatMessage] = []
    if model_request.model_provider.provider_type == OPENAI_RESPONSES_PROVIDER:
        for tool_call in tool_calls:
            messages.append(
                internal_tool_call_message(
                    request=prepared.request,
                    model_provider=model_request.model_provider,
                    tool_calls=(tool_call,),
                    raw_provider_message=model_client_tool_call_prompt_item(tool_call),
                )
            )
    else:
        messages.append(
            internal_tool_call_message(
                request=prepared.request,
                model_provider=model_request.model_provider,
                tool_calls=tool_calls,
                raw_provider_message=assistant_tool_call_prompt_message(tool_calls),
            )
        )
    for tool_call, tool_result in zip(tool_calls, tool_results, strict=True):
        raw_result = (
            model_client_tool_result_prompt_item(tool_result)
            if model_request.model_provider.provider_type == OPENAI_RESPONSES_PROVIDER
            else tool_result_prompt_message(tool_call, tool_result.output)
        )
        messages.append(
            internal_tool_result_message(
                request=prepared.request,
                model_provider=model_request.model_provider,
                tool_call=tool_call,
                tool_result=tool_result,
                raw_provider_message=raw_result,
            )
        )
    return messages


def _tool_result_cache_from_prompt(
    prompt: DirectChatPrompt,
) -> dict[str, tuple[ModelClientToolCall, ModelClientToolResult]]:
    """Recover completed native exchanges from persisted provider-neutral history."""

    calls: dict[str, ModelClientToolCall] = {}
    results: dict[str, tuple[ModelClientToolCall, ModelClientToolResult]] = {}
    for item in prompt_messages(prompt):
        item_type = item.get("type")
        call_id = item.get("call_id")
        if item_type == "model_client_tool_call" and isinstance(call_id, str):
            calls[call_id] = ModelClientToolCall(
                id=call_id,
                name=str(item.get("name") or ""),
                arguments=str(item.get("arguments") or ""),
                tool_type=str(item.get("tool_type") or "function"),
            )
        elif item_type == "model_client_tool_result" and isinstance(call_id, str) and call_id in calls:
            result = ModelClientToolResult(
                call_id=call_id,
                tool_type=str(item.get("tool_type") or calls[call_id].tool_type),
                status=str(item.get("status") or "failed"),
                output=str(item.get("output") or ""),
            )
            results[call_id] = (calls[call_id], result)
    return results


def _same_tool_call(left: ModelClientToolCall, right: ModelClientToolCall) -> bool:
    return (
        left.id == right.id
        and left.name == right.name
        and left.arguments == right.arguments
        and left.tool_type == right.tool_type
    )


def _tool_output_ok(output: str) -> bool:
    try:
        parsed = json.loads(output)
    except json.JSONDecodeError:
        return False
    return isinstance(parsed, Mapping) and parsed.get("ok") is True


def _model_request_with_appended_messages(
    model_request: ModelClientRequest,
    messages: list[dict[str, Any]],
    *,
    previous_final: ModelClientFinal | None = None,
) -> ModelClientRequest:
    """Append tool exchange messages and advance provider continuation state."""

    prompt = model_request.prompt
    return ModelClientRequest(
        model_provider=model_request.model_provider,
        prompt=copy_direct_chat_prompt(prompt, messages=(*prompt_messages(prompt), *messages)),
        provider_options=model_request.provider_options,
        continuation=openai_responses_continuation_from_final(model_request, previous_final),
    )


def _prompt_with_appended_messages(
    prompt: DirectChatPrompt,
    messages: list[dict[str, Any]],
) -> DirectChatPrompt:
    """Copy a prompt with additional OpenAI-compatible chat messages."""

    return copy_direct_chat_prompt(prompt, messages=(*prompt_messages(prompt), *messages))


def _model_request_forced_final_without_tools(
    model_request: ModelClientRequest,
    *,
    previous_final: ModelClientFinal | None = None,
) -> ModelClientRequest:
    """Build a follow-up request that asks for a final answer without tools."""

    prompt = model_request.prompt
    # Restate the Companion Guardrails after the limit instruction so they remain the
    # final instruction text on every request (ADR 0008).
    final_instruction = {
        "role": "developer",
        "content": f"{MEMORY_TOOL_LIMIT_FINAL_INSTRUCTION}\n\n{COMPANION_GUARDRAILS.strip()}",
    }
    return ModelClientRequest(
        model_provider=model_request.model_provider,
        prompt=copy_direct_chat_prompt(
            prompt,
            messages=(*prompt_messages(prompt), final_instruction),
            tools=(),
            tool_choice=None,
            parallel_tool_calls=None,
        ),
        provider_options=replace(
            model_request.provider_options,
            memory_apply_patch_enabled=False,
        ),
        continuation=(
            openai_responses_continuation_from_final(model_request, previous_final)
            if previous_final is not None
            else model_request.continuation
        ),
    )


def _tool_error_json(code: str, message: str, **extra: Any) -> str:
    """Format direct memory tool failures as compact JSON tool output."""

    return json.dumps(
        {
            "ok": False,
            "code": code,
            "message": message,
            **extra,
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )


__all__ = ["DirectTurnModelStreamCollector"]
