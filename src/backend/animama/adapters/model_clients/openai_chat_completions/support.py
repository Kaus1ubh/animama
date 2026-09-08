from __future__ import annotations

from dataclasses import fields
from typing import Any

from animama.app.model_clients import MCEventBase, ModelClientDelta, model_client_event_delta
from animama.domain.usage import Usage

OPENAI_HTTP_PROVIDER_TYPE = "OpenAIHTTPAgent"
OPENAI_API = "chat_completions"
DEFAULT_BASE_URL = "https://api.openai.com/v1"


def chat_stream_event_delta(
    *,
    event_cls: type[MCEventBase],
    provider_type: str,
    model: str,
    provider_event_type: str,
    response_id: str | None = None,
    output_index: int | None = None,
    text_length: int | None = None,
    finish_reason: str | None = None,
    tool_type: str | None = None,
    tool_name: str | None = None,
    tool_call_id: str | None = None,
    arguments_fragment_length: int | None = None,
    usage: Usage | None = None,
    details: dict[str, Any] | None = None,
) -> ModelClientDelta:
    event_kwargs = {
        "provider_type": provider_type,
        "api": OPENAI_API,
        "model": model,
        "provider_event_type": provider_event_type,
        "response_id": response_id,
        "output_index": output_index,
        "text_length": text_length,
        "finish_reason": finish_reason,
        "tool_type": tool_type,
        "tool_name": tool_name,
        "tool_call_id": tool_call_id,
        "arguments_fragment_length": arguments_fragment_length,
        "usage": usage,
        "details": details or {},
    }
    init_fields = {event_field.name for event_field in fields(event_cls) if event_field.init}
    return model_client_event_delta(
        event_cls(**{key: value for key, value in event_kwargs.items() if key in init_fields})
    )


__all__ = [
    "DEFAULT_BASE_URL",
    "OPENAI_API",
    "OPENAI_HTTP_PROVIDER_TYPE",
    "chat_stream_event_delta",
]
