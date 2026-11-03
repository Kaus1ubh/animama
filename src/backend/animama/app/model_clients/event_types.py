"""Provider-neutral ``MC*`` observation events emitted by model-client streams. They carry
lifecycle, tool and usage facts, never assistant text.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Literal

from animama.domain.usage import Usage

from .frozen import frozen_mapping


@dataclass(frozen=True, slots=True)
class MCEventBase:
    """Base provider-neutral observation from an upstream model-client stream.

    ``details`` is an adapter-authored safe summary, not a raw provider payload.
    It must not contain raw user text, assistant text, tool arguments, tool
    outputs, request bodies, response bodies, URLs, bearer tokens, or secrets.
    """

    provider_type: str
    api: str
    model: str
    provider_event_type: str
    response_id: str | None = None
    item_id: str | None = None
    output_index: int | None = None
    content_index: int | None = None
    details: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))

    def __post_init__(self) -> None:
        for field_name in ("provider_type", "api", "model", "provider_event_type"):
            object.__setattr__(self, field_name, str(getattr(self, field_name) or "").strip())
        for field_name in (
            "response_id",
            "item_id",
            "phase",
            "finish_reason",
            "tool_type",
            "tool_name",
            "tool_call_id",
            "status",
            "incomplete_reason",
            "provider_error_code",
            "provider_error_param",
            "action_type",
            "item_type",
        ):
            if not hasattr(self, field_name):
                continue
            value = getattr(self, field_name)
            object.__setattr__(self, field_name, None if value is None else str(value).strip() or None)
        for field_name in (
            "output_index",
            "content_index",
            "text_length",
            "content_length",
            "annotation_count",
            "arguments_fragment_length",
            "arguments_length",
            "query_count",
            "result_count",
            "source_count",
            "path_length",
            "sequence_number",
        ):
            if not hasattr(self, field_name):
                continue
            value = getattr(self, field_name)
            normalized = value if isinstance(value, int) and not isinstance(value, bool) else None
            object.__setattr__(self, field_name, normalized)
        field_name = "logprobs_present"
        if hasattr(self, field_name):
            value = getattr(self, field_name)
            object.__setattr__(self, field_name, value if isinstance(value, bool) else None)
        object.__setattr__(self, "details", frozen_mapping(self.details))


@dataclass(frozen=True, slots=True)
class MCResponseStartedEvent(MCEventBase):
    """A provider response entered its initial streamed lifecycle state."""

    kind: Literal["response_started"] = field(default="response_started", init=False)
    status: str | None = None


@dataclass(frozen=True, slots=True)
class MCResponseProgressEvent(MCEventBase):
    """A provider response or output item emitted non-terminal progress."""

    kind: Literal["response_progress"] = field(default="response_progress", init=False)
    status: str | None = None
    item_type: str | None = None


@dataclass(frozen=True, slots=True)
class MCTextDeltaEvent(MCEventBase):
    """A streamed assistant text delta was observed without storing the text."""

    kind: Literal["text_delta"] = field(default="text_delta", init=False)
    text_length: int | None = None
    logprobs_present: bool | None = None


@dataclass(frozen=True, slots=True)
class MCTextDoneEvent(MCEventBase):
    """A provider reported the end of one text content part."""

    kind: Literal["text_done"] = field(default="text_done", init=False)
    text_length: int | None = None
    logprobs_present: bool | None = None


@dataclass(frozen=True, slots=True)
class MCFinishReasonEvent(MCEventBase):
    """A Chat Completions choice emitted a finish reason before stream close."""

    kind: Literal["finish_reason"] = field(default="finish_reason", init=False)
    finish_reason: str | None = None


@dataclass(frozen=True, slots=True)
class MCAssistantPhaseEvent(MCEventBase):
    """A Responses assistant message carried a phase such as commentary or final_answer."""

    kind: Literal["assistant_phase"] = field(default="assistant_phase", init=False)
    phase: str | None = None
    status: str | None = None
    item_type: str | None = None


@dataclass(frozen=True, slots=True)
class MCAssistantMessageStartedEvent(MCEventBase):
    """A streamed assistant message output item started."""

    kind: Literal["assistant_message_started"] = field(default="assistant_message_started", init=False)
    phase: str | None = None
    status: str | None = None
    item_type: str | None = None


@dataclass(frozen=True, slots=True)
class MCAssistantMessageDoneEvent(MCEventBase):
    """A streamed assistant message output item completed."""

    kind: Literal["assistant_message_done"] = field(default="assistant_message_done", init=False)
    phase: str | None = None
    status: str | None = None
    item_type: str | None = None
    content_length: int | None = None
    annotation_count: int | None = None


@dataclass(frozen=True, slots=True)
class MCFunctionToolCallDeltaEvent(MCEventBase):
    """A streamed custom function tool-call argument fragment was observed."""

    kind: Literal["function_tool_call_delta"] = field(default="function_tool_call_delta", init=False)
    tool_type: str | None = None
    tool_name: str | None = None
    tool_call_id: str | None = None
    arguments_fragment_length: int | None = None
    status: str | None = None


@dataclass(frozen=True, slots=True)
class MCFunctionToolCallDoneEvent(MCEventBase):
    """A custom function tool-call item completed."""

    kind: Literal["function_tool_call_done"] = field(default="function_tool_call_done", init=False)
    tool_type: str | None = None
    tool_name: str | None = None
    tool_call_id: str | None = None
    arguments_length: int | None = None
    status: str | None = None


@dataclass(frozen=True, slots=True)
class MCToolStartedEvent(MCEventBase):
    """A native hosted provider tool call started."""

    kind: Literal["tool_started"] = field(default="tool_started", init=False)
    tool_type: str | None = None
    tool_name: str | None = None
    tool_call_id: str | None = None
    status: str | None = None
    action_type: str | None = None
    path_length: int | None = None


@dataclass(frozen=True, slots=True)
class MCToolProgressEvent(MCEventBase):
    """A native hosted provider tool call emitted progress."""

    kind: Literal["tool_progress"] = field(default="tool_progress", init=False)
    tool_type: str | None = None
    tool_name: str | None = None
    tool_call_id: str | None = None
    status: str | None = None
    action_type: str | None = None
    path_length: int | None = None


@dataclass(frozen=True, slots=True)
class MCToolDoneEvent(MCEventBase):
    """A native hosted provider tool call completed."""

    kind: Literal["tool_done"] = field(default="tool_done", init=False)
    tool_type: str | None = None
    tool_name: str | None = None
    tool_call_id: str | None = None
    status: str | None = None
    action_type: str | None = None
    query_count: int | None = None
    result_count: int | None = None
    source_count: int | None = None
    path_length: int | None = None


@dataclass(frozen=True, slots=True)
class MCUsageEvent(MCEventBase):
    """A provider emitted usage accounting before or at terminal completion."""

    kind: Literal["usage"] = field(default="usage", init=False)
    usage: Usage | None = None


@dataclass(frozen=True, slots=True)
class MCTerminalCompletedEvent(MCEventBase):
    """A provider stream emitted a successful terminal event."""

    kind: Literal["terminal_completed"] = field(default="terminal_completed", init=False)
    status: str | None = None
    finish_reason: str | None = None
    usage: Usage | None = None


@dataclass(frozen=True, slots=True)
class MCTerminalIncompleteEvent(MCEventBase):
    """A provider stream emitted or implied an incomplete terminal state."""

    kind: Literal["terminal_incomplete"] = field(default="terminal_incomplete", init=False)
    status: str | None = None
    incomplete_reason: str | None = None


@dataclass(frozen=True, slots=True)
class MCTerminalFailedEvent(MCEventBase):
    """A provider stream emitted a failed terminal state."""

    kind: Literal["terminal_failed"] = field(default="terminal_failed", init=False)
    status: str | None = None
    provider_error_code: str | None = None
    provider_error_param: str | None = None


@dataclass(frozen=True, slots=True)
class MCUnknownProviderEvent(MCEventBase):
    """A provider event was observed but has no product-level mapping yet."""

    kind: Literal["unknown_provider_event"] = field(default="unknown_provider_event", init=False)
    status: str | None = None


MCEvent = (
    MCResponseStartedEvent
    | MCResponseProgressEvent
    | MCTextDeltaEvent
    | MCTextDoneEvent
    | MCFinishReasonEvent
    | MCAssistantPhaseEvent
    | MCAssistantMessageStartedEvent
    | MCAssistantMessageDoneEvent
    | MCFunctionToolCallDeltaEvent
    | MCFunctionToolCallDoneEvent
    | MCToolStartedEvent
    | MCToolProgressEvent
    | MCToolDoneEvent
    | MCUsageEvent
    | MCTerminalCompletedEvent
    | MCTerminalIncompleteEvent
    | MCTerminalFailedEvent
    | MCUnknownProviderEvent
)


def sanitize_model_client_stream_event(event: MCEvent) -> dict[str, Any]:
    """Compatibility wrapper for the event sanitizer module."""

    from .event_sanitizer import sanitize_model_client_stream_event as _sanitize_model_client_stream_event

    return _sanitize_model_client_stream_event(event)


__all__ = [
    "MCAssistantMessageDoneEvent",
    "MCAssistantMessageStartedEvent",
    "MCAssistantPhaseEvent",
    "MCFinishReasonEvent",
    "MCFunctionToolCallDeltaEvent",
    "MCFunctionToolCallDoneEvent",
    "MCEvent",
    "MCEventBase",
    "MCResponseProgressEvent",
    "MCResponseStartedEvent",
    "MCTerminalCompletedEvent",
    "MCTerminalFailedEvent",
    "MCTerminalIncompleteEvent",
    "MCTextDeltaEvent",
    "MCTextDoneEvent",
    "MCToolDoneEvent",
    "MCToolProgressEvent",
    "MCToolStartedEvent",
    "MCUnknownProviderEvent",
    "MCUsageEvent",
    "sanitize_model_client_stream_event",
]
