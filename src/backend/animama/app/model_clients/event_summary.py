from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from animama.app.util.json_values import json_safe_copy
from animama.logging import get_logger

from .event_sanitizer import sanitize_model_client_stream_event
from .event_types import (
    MCAssistantMessageDoneEvent,
    MCAssistantMessageStartedEvent,
    MCAssistantPhaseEvent,
    MCEvent,
    MCFinishReasonEvent,
    MCFunctionToolCallDoneEvent,
    MCResponseStartedEvent,
    MCTerminalCompletedEvent,
    MCTerminalFailedEvent,
    MCTerminalIncompleteEvent,
    MCToolDoneEvent,
    MCToolProgressEvent,
    MCToolStartedEvent,
    MCUnknownProviderEvent,
    MCUsageEvent,
)
from .types import ModelClientFinal, ModelClientRequest

DEFAULT_STREAM_EVENT_SUMMARY_METADATA_KEY = "stream_event_summary"
DEFAULT_MAX_STREAM_EVENT_SUMMARY_ITEMS = 64

_log = get_logger("app.model_clients.event_summary")


@dataclass(slots=True)
class _ModelClientStreamEventSummary:
    """Compact, safe request-local summary of provider stream observations.

    Intermediate provider events can be numerous and may contain provider-only
    fields. This summary keeps enough information to audit final-signal, usage,
    phase, and tool behavior without storing full raw stream payloads.
    """

    max_items: int = DEFAULT_MAX_STREAM_EVENT_SUMMARY_ITEMS
    event_count: int = 0
    counts_by_kind: dict[str, int] = field(default_factory=dict)
    provider_event_type_counts: dict[str, int] = field(default_factory=dict)
    unknown_provider_event_counts: dict[str, int] = field(default_factory=dict)
    finish_reasons: list[dict[str, Any]] = field(default_factory=list)
    usage_seen: bool = False
    usage_event_index: int | None = None
    terminal_events: list[dict[str, Any]] = field(default_factory=list)
    assistant_phases: list[dict[str, Any]] = field(default_factory=list)
    output_items: list[dict[str, Any]] = field(default_factory=list)
    native_tool_events: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    truncated: bool = False

    def record(self, event: MCEvent) -> None:
        """Fold one normalized provider observation into the request summary."""

        self.event_count += 1
        self._increment(self.counts_by_kind, event.kind)
        self._increment(self.provider_event_type_counts, event.provider_event_type)

        if isinstance(event, MCUnknownProviderEvent):
            self._increment(self.unknown_provider_event_counts, event.provider_event_type)
            self._append_warning("unknown_provider_event")
        if isinstance(event, MCFinishReasonEvent) and event.finish_reason is not None:
            self._append_limited(
                self.finish_reasons,
                _event_summary_entry(
                    event,
                    "finish_reason",
                    "output_index",
                    "provider_event_type",
                ),
            )
        if _event_has_usage(event):
            self.usage_seen = True
            if self.usage_event_index is None:
                self.usage_event_index = self.event_count
        if isinstance(event, MCTerminalCompletedEvent | MCTerminalIncompleteEvent | MCTerminalFailedEvent):
            self._append_limited(
                self.terminal_events,
                _event_summary_entry(
                    event,
                    "kind",
                    "provider_event_type",
                    "response_id",
                    "status",
                    "finish_reason",
                    "incomplete_reason",
                    "provider_error_code",
                ),
            )
        if isinstance(event, MCTerminalIncompleteEvent):
            self._append_warning("terminal_incomplete")
        if isinstance(event, MCTerminalFailedEvent):
            self._append_warning("terminal_failed")
        if isinstance(event, MCAssistantPhaseEvent | MCAssistantMessageStartedEvent | MCAssistantMessageDoneEvent):
            if event.phase is not None:
                self._append_limited(
                    self.assistant_phases,
                    _event_summary_entry(
                        event,
                        "kind",
                        "provider_event_type",
                        "item_id",
                        "output_index",
                        "phase",
                        "status",
                        "item_type",
                    ),
                )
        if isinstance(event, MCAssistantMessageStartedEvent | MCAssistantMessageDoneEvent):
            self._append_limited(
                self.output_items,
                _event_summary_entry(
                    event,
                    "kind",
                    "provider_event_type",
                    "item_id",
                    "output_index",
                    "status",
                    "item_type",
                    "phase",
                    "content_length",
                    "annotation_count",
                ),
            )
        if isinstance(event, MCToolStartedEvent | MCToolProgressEvent | MCToolDoneEvent):
            self._append_limited(
                self.native_tool_events,
                _event_summary_entry(
                    event,
                    "kind",
                    "provider_event_type",
                    "item_id",
                    "output_index",
                    "tool_type",
                    "tool_name",
                    "tool_call_id",
                    "status",
                    "action_type",
                    "path_length",
                    "query_count",
                    "result_count",
                    "source_count",
                ),
            )

    def finalize(
        self,
        *,
        model_request: ModelClientRequest,
        raw_provider_metadata: Mapping[str, Any],
        require_finish_reason_provider_types: frozenset[str],
        require_usage_provider_types: frozenset[str],
    ) -> None:
        """Add warnings for missing stream signals required by this provider."""

        if not self.event_count:
            return
        provider_type = model_request.model_provider.provider_type
        if provider_type in require_finish_reason_provider_types and not self.finish_reasons:
            self._append_warning("missing_finish_reason")
        if raw_provider_metadata.get("usage_missing") is True or (
            provider_type in require_usage_provider_types and not self.usage_seen
        ):
            self._append_warning("missing_usage")

    def as_metadata(self) -> dict[str, Any]:
        if not self.event_count and not self.warnings:
            return {}
        metadata: dict[str, Any] = {
            "event_count": self.event_count,
            "counts_by_kind": dict(sorted(self.counts_by_kind.items())),
            "provider_event_type_counts": dict(sorted(self.provider_event_type_counts.items())),
        }
        if self.unknown_provider_event_counts:
            metadata["unknown_provider_event_counts"] = dict(sorted(self.unknown_provider_event_counts.items()))
        if self.finish_reasons:
            metadata["finish_reasons"] = list(self.finish_reasons)
        metadata["usage_seen"] = self.usage_seen
        if self.usage_event_index is not None:
            metadata["usage_event_index"] = self.usage_event_index
        if self.terminal_events:
            metadata["terminal_events"] = list(self.terminal_events)
        if self.assistant_phases:
            metadata["assistant_phases"] = list(self.assistant_phases)
        if self.output_items:
            metadata["output_items"] = list(self.output_items)
        if self.native_tool_events:
            metadata["native_tool_events"] = list(self.native_tool_events)
        if self.warnings:
            metadata["warnings"] = list(self.warnings)
        if self.truncated:
            metadata["truncated"] = True
        return metadata

    def _increment(self, target: dict[str, int], key: str | None) -> None:
        if not key:
            return
        target[key] = target.get(key, 0) + 1

    def _append_limited(self, target: list[dict[str, Any]], value: dict[str, Any]) -> None:
        if not value:
            return
        if len(target) >= self.max_items:
            self.truncated = True
            return
        target.append(value)

    def _append_warning(self, warning: str) -> None:
        if warning in self.warnings:
            return
        if len(self.warnings) >= self.max_items:
            self.truncated = True
            return
        self.warnings.append(warning)


class ModelClientStreamEventObserver:
    """Record, log, and attach sanitized provider stream-event summaries.

    Direct chat uses this as its observability boundary: provider adapters emit
    typed MC events, the collector records them here, and the final assistant
    message receives only the compact summary metadata.
    """

    def __init__(
        self,
        *,
        metadata_key: str = DEFAULT_STREAM_EVENT_SUMMARY_METADATA_KEY,
        max_items: int = DEFAULT_MAX_STREAM_EVENT_SUMMARY_ITEMS,
        require_finish_reason_provider_types: Iterable[str] = (),
        require_usage_provider_types: Iterable[str] = (),
    ) -> None:
        self._metadata_key = metadata_key
        self._summary = _ModelClientStreamEventSummary(max_items=max_items)
        self._require_finish_reason_provider_types = frozenset(require_finish_reason_provider_types)
        self._require_usage_provider_types = frozenset(require_usage_provider_types)

    def record(self, event: MCEvent) -> None:
        """Log a provider event and remember it for final metadata."""

        self._summary.record(event)
        log_method = _stream_event_log_method(event)
        log_method(
            "model client stream event",
            model_client_stream_event=sanitize_model_client_stream_event(event),
            provider_type=event.provider_type,
            api=event.api,
            model=event.model,
            provider_event_type=event.provider_event_type,
            event_kind=event.kind,
        )

    def final_with_summary(self, final: ModelClientFinal, *, model_request: ModelClientRequest) -> ModelClientFinal:
        """Attach stream summary metadata to the model final if events were seen."""

        raw_provider_metadata = dict(final.raw_provider_metadata)
        self._summary.finalize(
            model_request=model_request,
            raw_provider_metadata=raw_provider_metadata,
            require_finish_reason_provider_types=self._require_finish_reason_provider_types,
            require_usage_provider_types=self._require_usage_provider_types,
        )
        stream_event_metadata = self._summary.as_metadata()
        if not stream_event_metadata:
            return final
        raw_provider_metadata[self._metadata_key] = stream_event_metadata
        _log.info(
            "model client stream summary",
            model_client_stream_event_summary=stream_event_metadata,
            provider_type=model_request.model_provider.provider_type,
            model=model_request.model_provider.model,
        )
        if stream_event_metadata.get("warnings"):
            _log.warning(
                "model client stream summary warning",
                model_client_stream_event_summary=stream_event_metadata,
                provider_type=model_request.model_provider.provider_type,
                model=model_request.model_provider.model,
            )
        return ModelClientFinal(
            text=final.text,
            usage=final.usage,
            raw_provider_metadata=raw_provider_metadata,
            structured_payload=final.structured_payload,
            tool_calls=final.tool_calls,
            input_moderation=final.input_moderation,
            continuation=final.continuation,
        )


def _event_has_usage(event: MCEvent) -> bool:
    return isinstance(event, MCUsageEvent | MCTerminalCompletedEvent) and getattr(event, "usage", None) is not None


def _is_warning_stream_event(event: MCEvent) -> bool:
    return isinstance(event, MCUnknownProviderEvent | MCTerminalIncompleteEvent | MCTerminalFailedEvent)


def _stream_event_log_method(event: MCEvent) -> Any:
    if _is_warning_stream_event(event):
        return _log.warning
    if _is_info_stream_event(event):
        return _log.info
    return _log.debug


def _is_info_stream_event(event: MCEvent) -> bool:
    if isinstance(
        event,
        MCResponseStartedEvent
        | MCFinishReasonEvent
        | MCAssistantPhaseEvent
        | MCAssistantMessageStartedEvent
        | MCAssistantMessageDoneEvent
        | MCFunctionToolCallDoneEvent
        | MCToolStartedEvent
        | MCToolDoneEvent
        | MCUsageEvent
        | MCTerminalCompletedEvent,
    ):
        return True
    return event.provider_event_type in {"response.queued", "response.in_progress"}


def _event_summary_entry(event: MCEvent, *field_names: str) -> dict[str, Any]:
    entry: dict[str, Any] = {}
    for field_name in field_names:
        value = event.kind if field_name == "kind" else getattr(event, field_name, None)
        if value is None:
            continue
        entry[field_name] = json_safe_copy(value)
    return entry


__all__ = [
    "DEFAULT_STREAM_EVENT_SUMMARY_METADATA_KEY",
    "ModelClientStreamEventObserver",
]
