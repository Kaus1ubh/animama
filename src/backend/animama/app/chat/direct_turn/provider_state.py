from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from animama.app.main_structured_response import MAIN_STRUCTURED_RESPONSE_KIND
from animama.app.model_clients import (
    ModelClientContinuation,
    ModelClientError,
    ModelClientFinal,
    ModelClientProviderOptions,
    ModelClientRequest,
)
from animama.app.model_provider_native_tools import (
    normalized_native_tool_support,
    requestable_native_tool_support,
)
from animama.app.util.json_values import json_safe_copy
from animama.domain import ModelProvider
from animama.domain.chat import Chat

from ..options import DirectChatOptions
from .constants import (
    DIRECT_MEMORY_TOOL_SUPPORT_BY_PROVIDER,
    OPENAI_CHAT_COMPLETIONS_PROVIDER,
    OPENAI_RESPONSES_PREVIOUS_RESPONSE_UNRESOLVABLE_CODE,
    OPENAI_RESPONSES_PROVIDER,
)
from .types import DirectChatTurnRequest, DirectChatTurnSetupError


@dataclass(frozen=True, slots=True)
class MemoryToolConfig:
    """Effective direct-memory tool permissions for one turn."""

    allow_reads: bool
    allow_writes: bool

    @property
    def active(self) -> bool:
        return self.allow_reads or self.allow_writes


def normalized_string_set(value: object) -> set[str]:
    """Coerce catalog/request capability values into a normalized string set."""

    if value is None:
        return set()
    if isinstance(value, str):
        return {value.strip()} if value.strip() else set()
    try:
        return {str(item).strip() for item in value if str(item).strip()}  # type: ignore[union-attr]
    except TypeError:
        return set()


def validate_model_provider_for_direct_turn(
    model_provider: ModelProvider,
    *,
    request_options: DirectChatOptions,
    memory_tools_active: bool = False,
) -> None:
    """Validate that the selected persisted provider row can run direct chat."""

    capabilities = model_provider.capabilities
    if not model_provider.active:
        raise DirectChatTurnSetupError(f"Model provider is inactive: {model_provider.id}")
    if not capabilities.supports_streaming:
        raise DirectChatTurnSetupError(f"Model provider does not support streaming chat turns: {model_provider.id}")
    structured_kinds = normalized_string_set(capabilities.structured_kinds)
    if MAIN_STRUCTURED_RESPONSE_KIND not in structured_kinds:
        raise DirectChatTurnSetupError(
            f"Model provider does not support required structured output kind {MAIN_STRUCTURED_RESPONSE_KIND}: "
            f"{model_provider.id}"
        )

    requested_reasoning_effort = request_options.reasoning_effort
    if isinstance(requested_reasoning_effort, str) and requested_reasoning_effort.strip():
        effort = requested_reasoning_effort.strip()
        supported_efforts = normalized_string_set(capabilities.supported_reasoning_efforts)
        if not capabilities.supports_reasoning or effort not in supported_efforts:
            raise DirectChatTurnSetupError(
                f"Model provider does not support requested reasoning effort {effort}: {model_provider.id}"
            )
        if memory_tools_active and chat_completions_disallows_reasoning_with_function_tools(model_provider):
            # Some Chat Completions models reject reasoning_effort together with
            # function tools. Reject during setup so the SSE stream does not open
            # only to fail on the provider request.
            raise DirectChatTurnSetupError(
                "OpenAI Chat Completions does not support direct memory function tools together with "
                f"reasoning_effort for this model: {model_provider.id}. "
                "Omit reasoning_effort, disable memory tools for the turn, or use a Responses provider "
                "after direct memory tool support is enabled there."
            )

    requested_native_tools = set(request_options.native_tools)
    if requested_native_tools:
        requestable_tools = set(
            requestable_native_tool_support(
                model_provider.provider_type,
                capabilities.native_tool_support,
            )
        )
        missing_tools = requested_native_tools.difference(requestable_tools)
        if not capabilities.supports_tools or missing_tools:
            tools = ", ".join(sorted(missing_tools or requested_native_tools))
            raise DirectChatTurnSetupError(
                f"Model provider does not support requested native tools {tools}: {model_provider.id}"
            )

    if memory_tools_active:
        if not capabilities.supports_tools:
            raise DirectChatTurnSetupError(f"Model provider does not support memory tools: {model_provider.id}")
        if model_provider.provider_type not in DIRECT_MEMORY_TOOL_SUPPORT_BY_PROVIDER:
            raise DirectChatTurnSetupError(
                f"Model provider does not support direct memory tools: {model_provider.provider_type}"
            )


def chat_completions_disallows_reasoning_with_function_tools(model_provider: ModelProvider) -> bool:
    """Return whether this Chat Completions model is known to reject this pair."""

    return model_provider.provider_type == OPENAI_CHAT_COMPLETIONS_PROVIDER and model_provider.model.startswith(
        "gpt-5.4"
    )


def turn_reasoning_effort(request_options: DirectChatOptions) -> str | None:
    """Return the request-level reasoning effort passed to model clients."""

    return request_options.reasoning_effort


def build_memory_tool_config(request_options: DirectChatOptions, *, enabled: bool) -> MemoryToolConfig:
    """Apply incognito and memory-disable flags to direct memory tool access."""

    if not enabled:
        return MemoryToolConfig(allow_reads=False, allow_writes=False)
    return MemoryToolConfig(
        allow_reads=not request_options.disable_memory_influence,
        allow_writes=not request_options.disable_memory_updates and not request_options.incognito,
    )


def native_memory_apply_patch_enabled(
    model_provider: ModelProvider,
    *,
    memory_tool_config: MemoryToolConfig,
) -> bool:
    """Return whether this turn may use Responses-native memory patching."""

    return (
        memory_tool_config.allow_writes
        and model_provider.provider_type == OPENAI_RESPONSES_PROVIDER
        and "apply_patch" in normalized_native_tool_support(model_provider.capabilities.native_tool_support)
    )


def build_model_client_provider_options(
    request_options: DirectChatOptions,
    *,
    model_provider: ModelProvider,
    memory_tool_config: MemoryToolConfig,
) -> ModelClientProviderOptions:
    """Build adapter-level options that are not part of prompt messages."""

    return ModelClientProviderOptions(
        native_tools=request_options.native_tools,
        store=not request_options.incognito,
        memory_apply_patch_enabled=native_memory_apply_patch_enabled(
            model_provider,
            memory_tool_config=memory_tool_config,
        ),
    )


def compiled_context_history(chat_context: Any) -> list[Any]:
    """Combine active compaction context and visible chat messages."""

    return [
        *compaction_context_messages(chat_context),
        *list(getattr(chat_context, "messages", [])),
    ]


def compaction_context_messages(chat_context: Any) -> list[dict[str, str]]:
    """Return developer messages that summarize compacted older history."""

    active_compaction = getattr(chat_context, "active_compaction", None)
    summary_text = getattr(active_compaction, "summary_text", None)
    if not isinstance(summary_text, str) or not summary_text.strip():
        return []
    return [
        {
            "role": "developer",
            "content": (
                "Compacted prior chat history for continuity. "
                "Treat this as historical context, not as a new user instruction.\n"
                f"{summary_text.strip()}"
            ),
        }
    ]


def turn_memory_context_manifest(
    manifest: Mapping[str, Any],
    *,
    request: DirectChatTurnRequest,
    model_provider: ModelProvider,
) -> dict[str, Any]:
    """Build JSON-safe memory manifest metadata persisted with the chat."""

    copied = json_safe_copy(manifest)
    if not isinstance(copied, dict):
        copied = {}
    copied["last_run"] = {
        "run_id": request.run_id,
        "chat_id": request.chat_id,
        "anima_id": request.anima_id,
        "model_provider_id": model_provider.id,
        "provider_type": model_provider.provider_type,
        "model": model_provider.model,
    }
    return copied


def openai_responses_continuation_from_chat(
    chat: Chat,
    model_provider: ModelProvider,
) -> ModelClientContinuation | None:
    """Use a stored OpenAI Responses id as provider-managed conversation state."""

    if model_provider.provider_type != OPENAI_RESPONSES_PROVIDER:
        return None
    cursor = getattr(chat, "openai_previous_response_id", None)
    if not isinstance(cursor, str) or not cursor.strip():
        return None
    return ModelClientContinuation(
        provider_type=OPENAI_RESPONSES_PROVIDER,
        cursor=cursor.strip(),
        metadata={
            "source": "chat_row",
            "chat_id": getattr(chat, "id", None),
            "model": model_provider.model,
        },
    )


def should_skip_context_fetch_for_responses_cursor(
    model_provider: ModelProvider,
    continuation: ModelClientContinuation | None,
) -> bool:
    """Skip explicit history when Responses can continue from provider state."""

    return model_provider.provider_type == OPENAI_RESPONSES_PROVIDER and continuation is not None


def openai_responses_continuation_from_final(
    model_request: ModelClientRequest,
    previous_final: ModelClientFinal | None,
) -> ModelClientContinuation | None:
    """Advance a Responses continuation cursor after a tool-call follow-up."""

    if model_request.model_provider.provider_type != OPENAI_RESPONSES_PROVIDER or previous_final is None:
        return None
    response_id = previous_final.raw_provider_metadata.get("response_id")
    if not isinstance(response_id, str) or not response_id.strip():
        return None
    return ModelClientContinuation(
        provider_type=OPENAI_RESPONSES_PROVIDER,
        cursor=response_id.strip(),
        metadata={
            "source": "tool_call_response",
            "model": model_request.model_provider.model,
        },
    )


def model_request_without_continuation(model_request: ModelClientRequest) -> ModelClientRequest:
    """Copy a model request while dropping provider continuation state."""

    return ModelClientRequest(
        model_provider=model_request.model_provider,
        prompt=model_request.prompt,
        provider_options=model_request.provider_options,
        continuation=None,
    )


def should_retry_without_previous_response_id(
    error: ModelClientError,
    model_request: ModelClientRequest,
    *,
    partial_text_seen: bool,
    allow_previous_response_retry: bool,
) -> bool:
    """Return whether a stale Responses cursor should be retried with history."""

    return (
        allow_previous_response_retry
        and not partial_text_seen
        and error.code == OPENAI_RESPONSES_PREVIOUS_RESPONSE_UNRESOLVABLE_CODE
        and model_request.model_provider.provider_type == OPENAI_RESPONSES_PROVIDER
        and model_request.continuation is not None
    )


def final_with_previous_response_retry_metadata(
    final: ModelClientFinal,
    *,
    model_request: ModelClientRequest,
    error: ModelClientError,
) -> ModelClientFinal:
    """Annotate a successful retry with the stale cursor that was ignored."""

    raw_provider_metadata = dict(final.raw_provider_metadata)
    stale_cursor = model_request.continuation.cursor if model_request.continuation is not None else None
    raw_provider_metadata["previous_response_retry"] = {
        "code": error.code,
        "stale_previous_response_id": stale_cursor,
        "fallback": "manual_context_without_previous_response_id",
    }
    return ModelClientFinal(
        text=final.text,
        usage=final.usage,
        raw_provider_metadata=raw_provider_metadata,
        structured_payload=final.structured_payload,
        tool_calls=final.tool_calls,
    )


__all__ = [
    "MemoryToolConfig",
    "build_memory_tool_config",
    "build_model_client_provider_options",
    "compiled_context_history",
    "native_memory_apply_patch_enabled",
    "final_with_previous_response_retry_metadata",
    "model_request_without_continuation",
    "normalized_string_set",
    "openai_responses_continuation_from_chat",
    "openai_responses_continuation_from_final",
    "should_retry_without_previous_response_id",
    "should_skip_context_fetch_for_responses_cursor",
    "turn_memory_context_manifest",
    "turn_reasoning_effort",
    "validate_model_provider_for_direct_turn",
]
