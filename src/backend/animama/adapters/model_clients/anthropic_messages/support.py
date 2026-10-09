"""Shared construction of Anthropic SDK clients for the built-in Anthropic connection."""

from __future__ import annotations

from anthropic import AsyncAnthropic

ANTHROPIC_API_BASE_URL = "https://api.anthropic.com"
"""Anthropic's own API; custom Anthropic base URLs and gateways are out of scope."""


def anthropic_sdk_client(*, api_key: str, timeout: float | None, max_retries: int = 0) -> AsyncAnthropic:
    """Return an SDK client that sends ``api_key`` only to Anthropic's API.

    The key and base URL are always explicit, so the SDK never falls back to
    ``ANTHROPIC_BASE_URL``, ``ANTHROPIC_AUTH_TOKEN``, a stored profile or other
    credential sources in the environment. (The SDK still adds any
    ``ANTHROPIC_CUSTOM_HEADERS`` from the process environment; Animama never sets
    it.) Retries are off unless the caller asks for them.
    """

    return AsyncAnthropic(
        api_key=api_key,
        base_url=ANTHROPIC_API_BASE_URL,
        timeout=timeout,
        max_retries=max_retries,
    )


__all__ = ["ANTHROPIC_API_BASE_URL", "anthropic_sdk_client"]
