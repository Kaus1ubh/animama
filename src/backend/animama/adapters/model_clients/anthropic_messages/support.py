"""Shared constants and SDK client construction for the built-in Anthropic connection."""

from __future__ import annotations

from typing import Any

import httpx2
from anthropic import AsyncAnthropic, DefaultAsyncHttpxClient

from animama.adapters.key_redirects import refuse_cross_origin_redirect_async
from animama.app.model_provider_native_tools import ANTHROPIC_MESSAGES_PROVIDER_TYPE

ANTHROPIC_API_BASE_URL = "https://api.anthropic.com"
"""Anthropic's own API; custom Anthropic base URLs and gateways are out of scope."""

ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE = ANTHROPIC_MESSAGES_PROVIDER_TYPE
ANTHROPIC_API = "messages"
ANTHROPIC_PROVIDER = "anthropic"
MODEL_REFUSED_CODE = "model_refused"
"""The model declined the turn (``stop_reason: refusal``); category ``provider_error`` (D12)."""
ANTHROPIC_STREAM_INCOMPLETE_CODE = "anthropic_stream_incomplete"
ANTHROPIC_CONNECTION_UNSUPPORTED_CODE = "anthropic_connection_unsupported"


def clean_str(value: Any) -> str | None:
    """Return a stripped non-empty string, or ``None``."""

    if not isinstance(value, str):
        return None
    text = value.strip()
    return text or None


def optional_int(value: Any) -> int:
    """Return a non-negative integer token count, treating anything else as zero."""

    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return max(0, int(value))


def anthropic_sdk_client(
    *,
    api_key: str,
    timeout: float | None,
    max_retries: int = 0,
    transport: httpx2.AsyncBaseTransport | None = None,
) -> AsyncAnthropic:
    """Return an SDK client that sends ``api_key`` only to Anthropic's API.

    The key and base URL are always explicit, so the SDK never falls back to
    ``ANTHROPIC_BASE_URL``, ``ANTHROPIC_AUTH_TOKEN``, a stored profile or other
    credential sources in the environment. (The SDK still adds any
    ``ANTHROPIC_CUSTOM_HEADERS`` from the process environment; Animama never sets
    it.) The key travels in ``x-api-key``, which a followed redirect would keep,
    so a redirect to another origin is refused. Retries are off unless the
    caller asks for them. ``transport`` is for tests.
    """

    client_args: dict[str, Any] = {"event_hooks": {"response": [refuse_cross_origin_redirect_async]}}
    # The SDK builds its own keepalive transport and proxy mounts only when
    # none is passed.
    if transport is not None:
        client_args["transport"] = transport
    return AsyncAnthropic(
        api_key=api_key,
        base_url=ANTHROPIC_API_BASE_URL,
        timeout=timeout,
        max_retries=max_retries,
        http_client=DefaultAsyncHttpxClient(**client_args),
    )


__all__ = [
    "ANTHROPIC_API",
    "ANTHROPIC_API_BASE_URL",
    "ANTHROPIC_CONNECTION_UNSUPPORTED_CODE",
    "ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE",
    "ANTHROPIC_PROVIDER",
    "ANTHROPIC_STREAM_INCOMPLETE_CODE",
    "MODEL_REFUSED_CODE",
    "anthropic_sdk_client",
    "clean_str",
    "optional_int",
]
