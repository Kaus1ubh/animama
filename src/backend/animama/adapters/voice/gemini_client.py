"""SDK client construction for Gemini text-to-speech.

``google-genai`` resolves much of its configuration from the environment: the
key (``GOOGLE_API_KEY`` ahead of ``GEMINI_API_KEY`` when none is passed), the
base URL (``GOOGLE_GEMINI_BASE_URL``), Vertex mode, replay recording and, in
its Interactions sub-client, credentials and default headers. That sub-client
also retries on its own and, under ``GOOGLE_GENAI_DEBUG``, logs request
headers, including the key. The builder below fixes every one of these, so the
owner's key goes only to Google's Gemini API, once per call. Voice requests use
the Interactions API, whose audio output exists only on ``v1beta``
(docs/plans/gemini-tts).
"""

from __future__ import annotations

from typing import Any

import httpx
from google import genai
from google.genai.client import DebugConfig
from google.genai.types import HttpOptions

GEMINI_API_HOST = "generativelanguage.googleapis.com"
GEMINI_API_BASE_URL = f"https://{GEMINI_API_HOST}/"
"""Google's Gemini Developer API; Vertex AI and custom gateways are out of scope."""
GEMINI_API_VERSION = "v1beta"
"""Interactions text-to-speech is available only on ``v1beta``."""


class _SilentLogger:
    """Replaces the Interactions debug logger, which prints request headers."""

    def debug(self, msg: str, *args: Any, **kwargs: Any) -> None:
        return None


def gemini_sdk_client(
    *,
    api_key: str,
    timeout_ms: int | None = None,
    httpx_async_client: httpx.AsyncClient | None = None,
) -> genai.Client:
    """Return a client that sends ``api_key`` only to the Gemini API, with no retries.

    ``httpx_async_client`` exists for tests that supply a mock transport.
    """

    key = api_key.strip()
    if not key:
        # An empty key would make the SDK fall back to GOOGLE_API_KEY.
        raise ValueError("A Gemini API key is required")
    client = genai.Client(
        vertexai=False,
        api_key=key,
        debug_config=DebugConfig(client_mode=None, replays_directory=None, replay_id=None),
        http_options=HttpOptions(
            base_url=GEMINI_API_BASE_URL,
            api_version=GEMINI_API_VERSION,
            timeout=timeout_ms,
            httpx_async_client=httpx_async_client,
        ),
    )
    _quiet_interactions(client)
    return client


def _quiet_interactions(client: genai.Client) -> None:
    """Turn off the Interactions sub-client's own retries and header logging.

    The parent client makes one attempt when ``retry_options`` is unset, but the
    sub-client then defaults to three retries, and any ``attempts`` value still
    leaves it one retry (connection errors included). Both resources share one
    configuration object, which the sub-client reads on every call.
    """

    from google.genai._gaos.utils.retries import RetryConfig

    configuration = client.aio.interactions.sdk_configuration
    configuration.retry_config = RetryConfig("none", None, False)
    configuration.debug_logger = _SilentLogger()


__all__ = [
    "GEMINI_API_BASE_URL",
    "GEMINI_API_HOST",
    "GEMINI_API_VERSION",
    "gemini_sdk_client",
]
