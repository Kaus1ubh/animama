"""OpenAI SDK clients scoped to one model connection.

Shared by the Chat Completions model client and the connection probe so both
reach a connection the same way: its base URL, its timeout and only its own
credential, never the process OpenAI settings.
"""

from __future__ import annotations

import os
from typing import Any

import httpx
from openai import AsyncOpenAI, Omit

from animama.app.model_clients import ModelClientProviderError
from animama.app.model_clients.credentials import ModelCredential, connection_for_model_provider
from animama.domain import ModelProvider
from animama.domain.model_connection import ModelConnection

# Non-OpenAI endpoints must not receive the process OpenAI organization or
# project ids.
_NON_OPENAI_OMITTED_HEADERS: dict[str, Any] = {
    "OpenAI-Organization": Omit(),
    "OpenAI-Project": Omit(),
}
_KEYLESS_PLACEHOLDER = "not-required"


def connection_for_request(model_provider: ModelProvider) -> ModelConnection:
    """Return the row's connection, or a model-client error when it is missing."""

    try:
        return connection_for_model_provider(model_provider)
    except ValueError as exc:
        raise ModelClientProviderError(
            str(exc),
            code="connection_unavailable",
            raw_metadata={"connection_id": model_provider.connection_id, "model": model_provider.model},
        ) from exc


def connection_base_url(connection: ModelConnection, *, openai_base_url: str) -> str:
    """Return the connection's base URL; the built-in one uses ``openai_base_url``."""

    if connection.is_builtin_openai:
        return (connection.base_url or openai_base_url).rstrip("/")
    if not connection.base_url:
        raise ModelClientProviderError(
            f"{connection.name} has no base URL",
            code="connection_base_url_missing",
            raw_metadata={"connection_id": connection.id, "connection_name": connection.name},
        )
    return connection.base_url.rstrip("/")


def sdk_client_for_connection(
    connection: ModelConnection,
    *,
    credential: ModelCredential,
    base_url: str,
    timeout: float | httpx.Timeout | None,
) -> AsyncOpenAI:
    """Build an SDK client that cannot fall back to process OpenAI settings.

    ``AsyncOpenAI`` reads ``OPENAI_API_KEY``, ``OPENAI_ORG_ID``,
    ``OPENAI_PROJECT_ID`` and ``OPENAI_CUSTOM_HEADERS`` from the environment.
    For owner connections every such header is omitted and ``Authorization``
    is set from the connection's own key. Keyless connections pass a
    placeholder key and omit ``Authorization`` per request
    (:func:`keyless_request_headers`), the only omission the SDK accepts.
    """

    if connection.is_builtin_openai:
        return AsyncOpenAI(api_key=credential.api_key, base_url=base_url, timeout=timeout)
    headers: dict[str, Any] = {name: Omit() for name in _environment_custom_header_names()}
    headers.update(_NON_OPENAI_OMITTED_HEADERS)
    if credential.api_key:
        headers["Authorization"] = f"Bearer {credential.api_key}"
    return AsyncOpenAI(
        api_key=credential.api_key or _KEYLESS_PLACEHOLDER,
        base_url=base_url,
        timeout=timeout,
        default_headers=headers,
    )


def keyless_request_headers(connection: ModelConnection, credential: ModelCredential) -> dict[str, Any] | None:
    """Return per-request headers that drop Authorization for keyless connections."""

    if connection.is_builtin_openai or credential.api_key:
        return None
    return {"Authorization": Omit()}


def _environment_custom_header_names() -> list[str]:
    """Return header names the SDK would add from ``OPENAI_CUSTOM_HEADERS``."""

    raw = os.environ.get("OPENAI_CUSTOM_HEADERS") or ""
    return [line[: line.find(":")].strip() for line in raw.split("\n") if ":" in line]


__all__ = [
    "connection_base_url",
    "connection_for_request",
    "keyless_request_headers",
    "sdk_client_for_connection",
]
