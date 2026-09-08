from __future__ import annotations

from typing import Any

from openai.types.chat.chat_completion_chunk import ChatCompletionChunk, Choice, ChoiceDelta

from animama.app.model_clients import (
    MCFinishReasonEvent,
    MCTextDeltaEvent,
    MCUnknownProviderEvent,
    MCUsageEvent,
    ModelClientDelta,
)

from .support import chat_stream_event_delta
from .usage import usage_from_chat_completion_usage

HANDLED_CHOICE_EXTRA_FIELD_NAMES = frozenset({"text"})


def events_from_chat_completion_chunk(
    chunk: ChatCompletionChunk,
    *,
    provider_type: str,
    model: str,
    metadata: dict[str, Any],
    handled_choice_extra_field_names: frozenset[str] = HANDLED_CHOICE_EXTRA_FIELD_NAMES,
) -> tuple[ModelClientDelta, ...]:
    """Normalize one ChatCompletionChunk into provider observability events."""

    events: list[ModelClientDelta] = []
    chunk_details = chunk_identity_details(chunk, metadata)
    if has_unused_choices(chunk):
        events.append(
            chat_stream_event_delta(
                event_cls=MCUnknownProviderEvent,
                provider_type=provider_type,
                model=model,
                provider_event_type="chat.completion.chunk.multi_choice",
                details={
                    **chunk_details,
                    "choice_count": len(chunk.choices),
                    "choice0_used": choice_zero(chunk) is not None,
                    "choice_indexes": choice_indexes(chunk.choices),
                    "choice_finish_reasons": choice_finish_reasons(chunk.choices),
                },
            )
        )
    unknown_fields = unknown_field_names(chunk)
    if unknown_fields:
        events.append(
            chat_stream_event_delta(
                event_cls=MCUnknownProviderEvent,
                provider_type=provider_type,
                model=model,
                provider_event_type="chat.completion.chunk.unknown_fields",
                details={**chunk_details, "unknown_field_names": unknown_fields},
            )
        )
    for choice in chunk.choices:
        events.extend(
            unknown_choice_events(
                chunk_details,
                choice,
                provider_type=provider_type,
                model=model,
                handled_choice_extra_field_names=handled_choice_extra_field_names,
            )
        )
    choice0 = choice_zero(chunk)
    if choice0 is not None:
        events.extend(
            choice_zero_events(
                chunk_details,
                choice0,
                provider_type=provider_type,
                model=model,
            )
        )
    if chunk.usage is not None:
        events.append(
            chat_stream_event_delta(
                event_cls=MCUsageEvent,
                provider_type=provider_type,
                model=model,
                provider_event_type="chat.completion.chunk.usage",
                usage=usage_from_chat_completion_usage(chunk.usage),
                details={**chunk_details, "usage_seen": True},
            )
        )
    return tuple(events)


def choice_zero_events(
    chunk_details: dict[str, Any],
    choice: Choice,
    *,
    provider_type: str,
    model: str,
) -> tuple[ModelClientDelta, ...]:
    """Emit text and finish_reason observations for the canonical choice."""

    events: list[ModelClientDelta] = []
    content = choice_text_delta(choice)
    if isinstance(content, str) and content:
        events.append(
            chat_stream_event_delta(
                event_cls=MCTextDeltaEvent,
                provider_type=provider_type,
                model=model,
                provider_event_type="chat.completion.chunk.content_delta",
                output_index=choice.index,
                text_length=len(content),
                details={**chunk_details, "choice_index": choice.index},
            )
        )
    finish_reason = choice_finish_reason(choice)
    if finish_reason is not None:
        events.append(
            chat_stream_event_delta(
                event_cls=MCFinishReasonEvent,
                provider_type=provider_type,
                model=model,
                provider_event_type="chat.completion.chunk.finish_reason",
                output_index=choice.index,
                finish_reason=finish_reason,
                details={**chunk_details, "choice_index": choice.index, "finish_reason": finish_reason},
            )
        )
    return tuple(events)


def unknown_choice_events(
    chunk_details: dict[str, Any],
    choice: Choice,
    *,
    provider_type: str,
    model: str,
    handled_choice_extra_field_names: frozenset[str] = HANDLED_CHOICE_EXTRA_FIELD_NAMES,
) -> tuple[ModelClientDelta, ...]:
    """Report SDK model_extra fields on choices/deltas we do not explicitly use."""

    choice_unknown = tuple(
        field_name for field_name in unknown_field_names(choice) if field_name not in handled_choice_extra_field_names
    )
    delta_unknown = tuple(
        field_name
        for field_name in unknown_field_names(choice.delta)
        if field_name not in handled_choice_extra_field_names
    )
    if not choice_unknown and not delta_unknown:
        return ()
    return (
        chat_stream_event_delta(
            event_cls=MCUnknownProviderEvent,
            provider_type=provider_type,
            model=model,
            provider_event_type="chat.completion.chunk.choice_unknown_fields",
            output_index=choice.index,
            details={
                **chunk_details,
                "choice_index": choice.index,
                "unknown_field_names": (*choice_unknown, *delta_unknown),
            },
        ),
    )


def content_deltas_from_choice_zero(choice: Choice | None) -> list[str]:
    """Return public text fragments from choice index 0."""

    if choice is None:
        return []
    content = choice_text_delta(choice)
    if content is None:
        return []
    return [content]


def choice_text_delta(choice: Choice) -> str | None:
    content = choice_delta_text(choice.delta)
    if content is not None:
        return content
    return choice_extra_text(choice)


def choice_delta_text(delta: ChoiceDelta) -> str | None:
    """Return non-empty content from a Chat Completions choice delta."""

    content = delta.content
    if isinstance(content, str) and content:
        return content
    return None


def choice_extra_text(choice: Choice) -> str | None:
    """Return non-empty provider-compatible choice text outside `delta`."""

    extra = getattr(choice, "model_extra", None)
    if not isinstance(extra, dict):
        return None
    text = extra.get("text")
    if isinstance(text, str) and text:
        return text
    return None


def merge_chunk_metadata(metadata: dict[str, Any], chunk: ChatCompletionChunk) -> None:
    """Merge stable chunk identity and finish fields into final metadata."""

    metadata["id"] = chunk.id
    metadata["object"] = chunk.object
    metadata["created"] = chunk.created
    metadata["model"] = chunk.model
    if chunk.system_fingerprint is not None:
        metadata["system_fingerprint"] = chunk.system_fingerprint
    if chunk.service_tier is not None:
        metadata["service_tier"] = chunk.service_tier
    choice0 = choice_zero(chunk)
    if choice0 is not None:
        finish_reason = choice_finish_reason(choice0)
        if finish_reason is not None:
            metadata["finish_reason"] = finish_reason
    if has_unused_choices(chunk):
        metadata["choice_finish_reasons"] = choice_finish_reasons(chunk.choices)


def chunk_identity_details(chunk: ChatCompletionChunk, metadata: dict[str, Any]) -> dict[str, Any]:
    """Build compact chunk identity details for stream event logging."""

    result: dict[str, Any] = {
        "id": chunk.id,
        "object": chunk.object,
        "created": chunk.created,
        "model": chunk.model,
    }
    system_fingerprint = chunk.system_fingerprint or metadata.get("system_fingerprint")
    if system_fingerprint is not None:
        result["system_fingerprint"] = system_fingerprint
    service_tier = chunk.service_tier or metadata.get("service_tier")
    if service_tier is not None:
        result["service_tier"] = service_tier
    return result


def choice_zero(chunk: ChatCompletionChunk) -> Choice | None:
    """Return the canonical choice used for public assistant output."""

    for choice in chunk.choices:
        if choice.index == 0:
            return choice
    return None


def has_unused_choices(chunk: ChatCompletionChunk) -> bool:
    """Return whether the chunk includes choices direct chat will not stream."""

    if not chunk.choices:
        return False
    return len(chunk.choices) > 1 or choice_zero(chunk) is None


def choice_finish_reason(choice: Choice) -> str | None:
    """Return a non-empty finish_reason from a Chat Completions choice."""

    finish_reason = choice.finish_reason
    if isinstance(finish_reason, str) and finish_reason:
        return finish_reason
    return None


def choice_indexes(choices: list[Choice]) -> tuple[int, ...]:
    return tuple(choice.index for choice in choices)


def choice_finish_reasons(choices: list[Choice]) -> tuple[str, ...]:
    reasons: list[str] = []
    for choice in choices:
        reason = choice_finish_reason(choice)
        if reason is not None:
            reasons.append(f"{choice.index}:{reason}")
    return tuple(reasons)


def unknown_field_names(value: object) -> tuple[str, ...]:
    """Return OpenAI SDK model_extra keys not represented by typed fields."""

    extra = getattr(value, "model_extra", None)
    if not isinstance(extra, dict):
        return ()
    return tuple(sorted(str(key) for key in extra if str(key).strip()))


__all__ = [
    "choice_zero",
    "chunk_identity_details",
    "content_deltas_from_choice_zero",
    "events_from_chat_completion_chunk",
    "merge_chunk_metadata",
]
