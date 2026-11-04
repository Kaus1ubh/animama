"""No request that carries a key follows a redirect to another origin with it.

Every client here runs against a mock transport with synthetic keys; nothing
reaches a provider.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any

import anthropic
import httpx
import httpx2
import pytest
from elevenlabs.client import ElevenLabs
from openai import AsyncOpenAI, DefaultAsyncHttpxClient

from animama.adapters.key_redirects import (
    CrossOriginRedirectError,
    refuse_cross_origin_redirect,
    refuse_cross_origin_redirect_async,
)
from animama.adapters.model_clients.anthropic_messages.support import anthropic_sdk_client
from animama.adapters.model_clients.openai_chat_completions.connection_sdk import sdk_client_for_connection
from animama.adapters.voice.gemini_client import gemini_sdk_client
from animama.adapters.web_search import BraveSearchBackend
from animama.app.model_clients.credentials import CREDENTIAL_CONFIGURED, ModelCredential, builtin_openai_connection
from animama.app.web_search import WebSearchError
from animama.domain import ModelConnection
from animama.server import elevenlabs_service

KEY = "sk-redirect-test-key"
ELSEWHERE = "https://elsewhere.example.test/collect"


class _Server:
    """Answer the first request with a redirect and later ones with ``final``."""

    def __init__(self, location: str, *, final: dict[str, Any] | None = None) -> None:
        self.location = location
        self.final = final or {}
        self.requests: list[Any] = []

    def __call__(self, request: Any) -> Any:
        self.requests.append(request)
        library = httpx2 if isinstance(request, httpx2.Request) else httpx
        if len(self.requests) == 1:
            return library.Response(302, headers={"location": self.location})
        return library.Response(200, json=self.final)


@pytest.mark.parametrize(
    ("location", "followed"),
    [
        ("/next", True),
        ("https://API.example.test:443/next", True),
        (ELSEWHERE, False),
        ("https://api.example.test:8443/next", False),
        ("http://api.example.test/next", False),
    ],
)
async def test_the_hook_follows_only_redirects_within_the_origin(location: str, followed: bool) -> None:
    sync_server, async_server = _Server(location), _Server(location)
    sync_client = httpx.Client(
        transport=httpx.MockTransport(sync_server),
        follow_redirects=True,
        event_hooks={"response": [refuse_cross_origin_redirect]},
    )
    async_client = httpx2.AsyncClient(
        transport=httpx2.MockTransport(async_server),
        follow_redirects=True,
        event_hooks={"response": [refuse_cross_origin_redirect_async]},
    )

    if followed:
        assert sync_client.get("https://api.example.test/start", headers={"x-api-key": KEY}).status_code == 200
        assert (await async_client.get("https://api.example.test/start")).status_code == 200
    else:
        with pytest.raises(CrossOriginRedirectError) as caught:
            sync_client.get("https://api.example.test/start", headers={"x-api-key": KEY})
        with pytest.raises(CrossOriginRedirectError):
            await async_client.get("https://api.example.test/start")
        assert "elsewhere" not in str(caught.value)

    expected = 2 if followed else 1
    assert (len(sync_server.requests), len(async_server.requests)) == (expected, expected)


def test_elevenlabs_refuses_a_redirect_to_another_origin() -> None:
    server = _Server(ELSEWHERE)
    pool = elevenlabs_service._new_elevenlabs_http_client(httpx.MockTransport(server))  # noqa: SLF001
    client = ElevenLabs(api_key=KEY, httpx_client=pool)

    with pytest.raises(CrossOriginRedirectError):
        client.voices.get("voice-1")

    assert [request.url.host for request in server.requests] == ["api.elevenlabs.io"]
    # The shared pool is built the same way.
    shared = elevenlabs_service._elevenlabs_http_client()  # noqa: SLF001
    assert shared.event_hooks["response"] == [refuse_cross_origin_redirect]


async def test_anthropic_refuses_a_redirect_to_another_origin() -> None:
    server = _Server(ELSEWHERE)
    client = anthropic_sdk_client(api_key=KEY, timeout=5.0, transport=httpx2.MockTransport(server))

    with pytest.raises(anthropic.APIConnectionError) as caught:
        await client.models.list()

    assert isinstance(caught.value.__cause__, CrossOriginRedirectError)
    assert [request.url.host for request in server.requests] == ["api.anthropic.com"]


def test_the_anthropic_client_keeps_the_sdks_own_connection_settings() -> None:
    # Given no test transport, the SDK still builds its keepalive transport.
    ours = anthropic_sdk_client(api_key=KEY, timeout=5.0)
    default = anthropic.AsyncAnthropic(api_key=KEY)

    def socket_options(client: anthropic.AsyncAnthropic) -> Any:
        return client._client._transport._pool._socket_options  # type: ignore[attr-defined]  # noqa: SLF001

    assert socket_options(default)
    assert socket_options(ours) == socket_options(default)
    assert ours._client.event_hooks["response"] == [refuse_cross_origin_redirect_async]  # noqa: SLF001


async def test_gemini_refuses_a_redirect_to_another_origin() -> None:
    server = _Server(ELSEWHERE)
    client: Any = gemini_sdk_client(api_key=KEY, transport=httpx.MockTransport(server))

    with pytest.raises(Exception) as caught:
        await client.aio.interactions.create(model="gemini-3.8-flash-lite-tts", input="Hello")

    chain = [caught.value, caught.value.__cause__, caught.value.__context__]
    assert any(isinstance(error, CrossOriginRedirectError) for error in chain)
    assert [request.url.host for request in server.requests] == ["generativelanguage.googleapis.com"]


async def test_brave_search_follows_no_redirect() -> None:
    server = _Server(ELSEWHERE, final={"web": {"results": []}})
    backend = BraveSearchBackend(api_key=KEY, transport=httpx.MockTransport(server))

    with pytest.raises(WebSearchError):
        await backend.search("animama", count=3)

    assert len(server.requests) == 1


@pytest.fixture
def openai_default_pool() -> Iterator[Callable[[_Server], None]]:
    """Route SDK clients through the SDK's own default pool, which follows redirects."""

    original_init = AsyncOpenAI.__init__
    patch = pytest.MonkeyPatch()

    def install(server: _Server) -> None:
        def _init(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
            kwargs["http_client"] = DefaultAsyncHttpxClient(transport=httpx2.MockTransport(server))
            original_init(self, *args, **kwargs)

        patch.setattr(AsyncOpenAI, "__init__", _init)

    yield install
    patch.undo()


@pytest.mark.parametrize(
    "connection",
    [
        builtin_openai_connection(),
        ModelConnection(
            id="c_lab",
            name="Lab",
            preset="custom",
            source="owner",
            base_url="https://lab.example.test/v1",
            credential_env="ANIMAMA_CONNECTION_LAB_API_KEY",
        ),
    ],
    ids=["builtin-openai", "owner-connection"],
)
async def test_openai_sdk_clients_drop_the_key_on_a_redirect_to_another_origin(
    openai_default_pool: Callable[[_Server], None], connection: ModelConnection
) -> None:
    # These clients send the key only in Authorization, which the SDK's HTTP
    # library removes when a redirect leaves the origin, so they need no hook.
    server = _Server(ELSEWHERE, final={"object": "list", "data": []})
    openai_default_pool(server)
    base_url = connection.base_url or "https://api.openai.com/v1"
    client = sdk_client_for_connection(
        connection, credential=ModelCredential(CREDENTIAL_CONFIGURED, KEY), base_url=base_url, timeout=5.0
    )

    await client.models.list()

    first, redirected = server.requests
    assert first.headers["authorization"] == f"Bearer {KEY}"
    assert redirected.url.host == "elsewhere.example.test"
    assert "authorization" not in redirected.headers
    assert all(KEY not in value for value in redirected.headers.values())
