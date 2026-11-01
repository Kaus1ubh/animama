"""OpenAI SDK clients scoped to one model connection.

Shared by the Chat Completions model client and the connection probe so both
reach a connection the same way: its base URL, its timeout and only its own
credential, never the process OpenAI settings.
"""

from __future__ import annotations

import os
from typing import Any

import httpx2
from openai import AsyncOpenAI, Omit

from animama.app.model_clients import ModelClientProviderError
from animama.app.model_clients.credentials import ModelCredential, connection_for_model_provider
from animama.app.model_connection_presets import model_connection_preset
from animama.domain import ModelProvider
from animama.domain.model_connection import ModelConnection

# Non-OpenAI endpoints must not receive the process OpenAI organization or
# project ids.
_NON_OPENAI_OMITTED_HEADERS: dict[str, Any] = {
    "OpenAI-Organization": Omit(),
    "OpenAI-Project": Omit(),
}
KEY_FREE_PLACEHOLDER = "not-required"
"""API key a key-free SDK client carries so it never adopts `OPENAI_API_KEY`."""
CONNECT_TIMEOUT_SECONDS = 10.0
"""Longest wait to open a connection; local presets allow minutes for replies only."""


def connection_timeout(seconds: float | None) -> httpx2.Timeout | None:
    """Timeout for requests to a connection: ``seconds`` overall, but at most
    ``CONNECT_TIMEOUT_SECONDS`` to connect, so a stopped server fails quickly
    even when a loading model may take minutes to answer."""

    if seconds is None:
        return None
    return httpx2.Timeout(seconds, connect=min(seconds, CONNECT_TIMEOUT_SECONDS))


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


def base_client_for_connection(
    connection: ModelConnection,
    *,
    base_url: str,
    timeout: float | httpx2.Timeout | None,
) -> AsyncOpenAI:
    """Build a long-lived SDK client for a connection that holds no key.

    Cached clients are built here so a changed or removed key can never outlive
    its request: :func:`keyed_client` adds the key to a per-request view that
    shares this client's connection pool.

    ``AsyncOpenAI`` reads ``OPENAI_API_KEY``, ``OPENAI_ORG_ID``,
    ``OPENAI_PROJECT_ID`` and ``OPENAI_CUSTOM_HEADERS`` from the environment.
    A placeholder key keeps it from adopting the process key, and for owner
    connections every organization, project and custom header is omitted.
    Owner connections then add their preset's fixed request headers (such as
    OpenRouter's attribution), which every request through the client carries.
    """

    if connection.is_builtin_openai:
        return AsyncOpenAI(api_key=KEY_FREE_PLACEHOLDER, base_url=base_url, timeout=timeout)
    headers: dict[str, Any] = {name: Omit() for name in _environment_custom_header_names()}
    headers.update(_NON_OPENAI_OMITTED_HEADERS)
    # An omitted process header that shares a preset header's name (in any
    # case) is dropped before sending, so only the preset value goes out.
    headers.update(model_connection_preset(connection.preset).request_headers)
    return AsyncOpenAI(api_key=KEY_FREE_PLACEHOLDER, base_url=base_url, timeout=timeout, default_headers=headers)


def keyed_client(base: AsyncOpenAI, connection: ModelConnection, *, credential: ModelCredential) -> AsyncOpenAI:
    """Return a view of ``base`` that sends only this connection's key.

    The view shares the base client's HTTP pool and lives only as long as the
    request holding it. Keyless connections use the base client and drop
    ``Authorization`` per request (:func:`keyless_request_headers`), the only
    omission the SDK accepts.
    """

    if not credential.api_key:
        return base
    if connection.is_builtin_openai:
        return base.with_options(api_key=credential.api_key)
    return base.with_options(
        api_key=credential.api_key, default_headers={"Authorization": f"Bearer {credential.api_key}"}
    )


def sdk_client_for_connection(
    connection: ModelConnection,
    *,
    credential: ModelCredential,
    base_url: str,
    timeout: float | httpx2.Timeout | None,
) -> AsyncOpenAI:
    """Build a single-use SDK client that cannot fall back to process OpenAI settings."""

    return keyed_client(
        base_client_for_connection(connection, base_url=base_url, timeout=timeout),
        connection,
        credential=credential,
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
    "CONNECT_TIMEOUT_SECONDS",
    "KEY_FREE_PLACEHOLDER",
    "connection_base_url",
    "connection_timeout",
    "connection_for_request",
    "base_client_for_connection",
    "keyed_client",
    "keyless_request_headers",
    "sdk_client_for_connection",
]
