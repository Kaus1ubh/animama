"""The Gemini SDK client sends the owner's key only to Google's Gemini API.

``google-genai`` reads many environment variables: ``GOOGLE_API_KEY`` ahead of
``GEMINI_API_KEY``, base-URL overrides, Vertex switches, replay recording,
default headers and a debug logger that prints request headers. Its
Interactions sub-client also retries on its own. These tests set every such
variable to a decoy and drive the client through an ``httpx`` mock transport,
so no key or network is used.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any

import httpx
import pytest
from google.genai._gaos.lib.compat_errors import GeminiNextGenAPIClientError
from google.genai.errors import APIError

from animama.adapters.voice.gemini_client import (
    GEMINI_API_HOST,
    GEMINI_API_VERSION,
    gemini_sdk_client,
)

REAL_KEY = "owner-gemini-key-for-tests"
SDK_ERRORS = (GeminiNextGenAPIClientError, APIError, httpx.HTTPError)
"""Interactions errors come from a private SDK module, others from ``google.genai.errors``."""
MODEL = "gemini-3.8-flash-lite-tts"


@pytest.fixture
def hostile_environment(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """Set every environment variable the SDK reads to a decoy value."""

    replays = tmp_path / "replays"
    replays.mkdir()
    decoys = {
        "GOOGLE_API_KEY": "decoy-google-api-key",
        "GEMINI_API_KEY": "decoy-gemini-api-key",
        "GOOGLE_GENAI_API_KEY": "decoy-genai-api-key",
        "GOOGLE_GENAI_ACCESS_TOKEN": "decoy-access-token",
        "GOOGLE_GENAI_DEFAULT_HEADERS": json.dumps({"x-decoy-header": "1"}),
        "GOOGLE_GEMINI_BASE_URL": "https://decoy.example.com/",
        "GOOGLE_VERTEX_BASE_URL": "https://decoy-vertex.example.com/",
        "GOOGLE_GENAI_USE_VERTEXAI": "true",
        "GOOGLE_GENAI_USE_ENTERPRISE": "true",
        "GOOGLE_CLOUD_PROJECT": "decoy-project",
        "GOOGLE_CLOUD_LOCATION": "decoy-location",
        "GOOGLE_GENAI_CLIENT_MODE": "record",
        "GOOGLE_GENAI_REPLAYS_DIRECTORY": str(replays),
        "GOOGLE_GENAI_REPLAY_ID": "decoy-replay",
        "GOOGLE_GENAI_DEBUG": "1",
    }
    for name, value in decoys.items():
        monkeypatch.setenv(name, value)
    return replays


class _Recorder:
    """An ``httpx`` mock transport that records requests and answers with one outcome."""

    def __init__(self, *, status: int = 503, connect_error: bool = False) -> None:
        self.requests: list[httpx.Request] = []
        self._status = status
        self._connect_error = connect_error

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self._connect_error:
            raise httpx.ConnectError("connection refused", request=request)
        return httpx.Response(
            self._status,
            json={"error": {"code": self._status, "message": "unavailable", "status": "UNAVAILABLE"}},
        )

    def transport(self) -> httpx.MockTransport:
        return httpx.MockTransport(self.handler)


def _assert_sent_only_to_gemini(request: httpx.Request) -> None:
    assert request.url.scheme == "https"
    assert request.url.host == GEMINI_API_HOST
    assert request.url.path.startswith(f"/{GEMINI_API_VERSION}/")
    assert request.headers.get("x-goog-api-key") == REAL_KEY
    assert "authorization" not in request.headers
    assert "x-decoy-header" not in request.headers
    assert "x-goog-user-project" not in request.headers


@pytest.mark.asyncio
@pytest.mark.parametrize("stream", [False, True])
async def test_interactions_use_the_passed_key_pinned_host_and_one_attempt(
    hostile_environment: Path, stream: bool
) -> None:
    recorder = _Recorder(status=503)
    client: Any = gemini_sdk_client(api_key=REAL_KEY, transport=recorder.transport())

    with pytest.raises(SDK_ERRORS):
        response = await client.aio.interactions.create(model=MODEL, input="Hello", stream=stream)
        if stream:
            async for _event in response:
                pass

    assert len(recorder.requests) == 1
    _assert_sent_only_to_gemini(recorder.requests[0])
    assert recorder.requests[0].url.path == f"/{GEMINI_API_VERSION}/interactions"


@pytest.mark.asyncio
async def test_interactions_do_not_retry_connection_errors(hostile_environment: Path) -> None:
    recorder = _Recorder(connect_error=True)
    client = gemini_sdk_client(api_key=REAL_KEY, transport=recorder.transport())

    with pytest.raises(SDK_ERRORS):
        await client.aio.interactions.create(model=MODEL, input="Hello")

    assert len(recorder.requests) == 1


@pytest.mark.asyncio
async def test_debug_logging_and_replay_recording_never_capture_the_key(
    hostile_environment: Path, caplog: pytest.LogCaptureFixture
) -> None:
    recorder = _Recorder(status=503)
    caplog.set_level(logging.DEBUG)
    client = gemini_sdk_client(api_key=REAL_KEY, transport=recorder.transport())

    with pytest.raises(SDK_ERRORS):
        await client.aio.interactions.create(model=MODEL, input="Hello")

    assert all(REAL_KEY not in record.getMessage() for record in caplog.records)
    assert list(hostile_environment.iterdir()) == []


@pytest.mark.parametrize("api_key", ["", "   "])
def test_blank_key_is_refused_instead_of_falling_back_to_the_environment(
    hostile_environment: Path, api_key: str
) -> None:
    with pytest.raises(ValueError):
        gemini_sdk_client(api_key=api_key)
