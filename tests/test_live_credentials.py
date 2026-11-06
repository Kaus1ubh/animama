"""Consumers follow the runtime credential store without a restart.

Every consumer must use a replaced key on its next request, report a removed
key as missing immediately, and keep no long-lived copy of an old value.
Requests already running finish on the keys they were admitted with.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any

import httpx
import httpx2
import pytest
from openai import AsyncOpenAI
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from animama.adapters.model_clients import (
    OPENAI_RESPONSES_HTTP_PROVIDER_TYPE,
    OpenAIChatCompletionsModelClient,
    OpenAIResponsesModelClient,
)
from animama.adapters.model_clients.openai_chat_completions.connection_sdk import KEY_FREE_PLACEHOLDER
from animama.adapters.model_clients.openai_chat_completions.embedder import ConnectionEmbedder
from animama.adapters.model_clients.openai_responses import client as responses_module
from animama.app.model_clients import ModelClientProviderError
from animama.app.model_clients.credential_store import RuntimeCredentialStore
from animama.app.model_clients.credentials import StoreModelCredentialResolver
from animama.app.ports.memory_manager_runtime import MemoryManagerRuntimeConfigurationError
from animama.server import elevenlabs_service
from animama.server.runtime_credentials import PinnedCredentialsMiddleware, scrub_credential_environment
from tests.test_model_client_registry import (
    _collect,
    _FakeOpenAIClient,
    _owner_connection,
    _responses_completed_event,
    _spec,
)
from tests.test_openai_sdk_base_url import _memory_manager_runtime

OLD = "sk-OLD-" + "o" * 40
NEW = "sk-NEW-" + "n" * 40


class _RecordingServer:
    """An OpenAI-compatible server that records the key each request carried."""

    def __init__(self) -> None:
        self.authorizations: list[str | None] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.authorizations.append(request.headers.get("authorization"))
        body = json.loads(request.content) if request.content else {}
        if request.url.path.endswith("/embeddings"):
            return httpx2.Response(
                200,
                json={"object": "list", "model": body["model"], "data": [{"index": 0, "embedding": [0.1, 0.2]}]},
            )
        chunk = {
            "id": "c",
            "object": "chat.completion.chunk",
            "created": 1,
            "model": body.get("model", "m"),
            "choices": [{"index": 0, "delta": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
        }
        payload = f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n"
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=payload.encode())


@pytest.fixture
def recording_server(monkeypatch: pytest.MonkeyPatch) -> _RecordingServer:
    """Route every SDK client built during the test to the recording server."""

    server = _RecordingServer()
    original_init = AsyncOpenAI.__init__

    def _init(self: AsyncOpenAI, *args: Any, **kwargs: Any) -> None:
        kwargs["http_client"] = httpx2.AsyncClient(transport=httpx2.MockTransport(server))
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(AsyncOpenAI, "__init__", _init)
    return server


def _chat_client(store: RuntimeCredentialStore) -> OpenAIChatCompletionsModelClient:
    return OpenAIChatCompletionsModelClient(credential_resolver=StoreModelCredentialResolver(store), timeout=5.0)


def _cached_values(client: OpenAIChatCompletionsModelClient) -> str:
    """Everything a cached SDK client could hold that might carry a key."""

    return repr(
        [(sdk.api_key, dict(sdk._custom_headers), sdk.auth_headers) for sdk in client._clients_by_connection.values()]
    )


# The vLLM preset runs on this computer; its key was saved for that origin.
C1_ORIGIN = {"ANIMAMA_CONNECTION_C1_ORIGIN": "http://127.0.0.1:8000"}


async def test_chat_completions_uses_a_replaced_key_on_the_next_request(recording_server: _RecordingServer) -> None:
    store = RuntimeCredentialStore({"ANIMAMA_CONNECTION_C1_API_KEY": OLD, **C1_ORIGIN})
    client = _chat_client(store)
    connection = _owner_connection("vllm", credential_env="ANIMAMA_CONNECTION_C1_API_KEY")

    await _collect(client.stream(_spec(connection=connection, structured_output_transport=None)))
    store.replace({"ANIMAMA_CONNECTION_C1_API_KEY": NEW, **C1_ORIGIN}, generation=1)
    await _collect(client.stream(_spec(connection=connection, structured_output_transport=None)))

    assert recording_server.authorizations == [f"Bearer {OLD}", f"Bearer {NEW}"]
    assert len(client._clients_by_connection) == 1  # The pool is reused
    assert OLD not in _cached_values(client)
    assert NEW not in _cached_values(client)
    await client.aclose()


async def test_chat_completions_reports_a_removed_key_missing_immediately(
    recording_server: _RecordingServer,
) -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": OLD})
    client = _chat_client(store)

    await _collect(client.stream(_spec(base_url="https://api.openai.com/v1", structured_output_transport=None)))
    store.replace({}, generation=1)
    with pytest.raises(ModelClientProviderError) as caught:
        await _collect(client.stream(_spec(base_url="https://api.openai.com/v1", structured_output_transport=None)))

    assert caught.value.code == "missing_api_key"
    assert recording_server.authorizations == [f"Bearer {OLD}"]
    assert OLD not in _cached_values(client)
    await client.aclose()


async def test_chat_completions_never_adopts_the_process_openai_key(
    recording_server: _RecordingServer, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OPENAI_API_KEY", OLD)
    client = _chat_client(RuntimeCredentialStore())

    with pytest.raises(ModelClientProviderError):
        await _collect(client.stream(_spec(base_url="https://api.openai.com/v1", structured_output_transport=None)))

    assert recording_server.authorizations == []


async def test_a_pinned_request_keeps_its_key_across_every_provider_call(recording_server: _RecordingServer) -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": OLD})
    client = _chat_client(store)
    spec = _spec(base_url="https://api.openai.com/v1", structured_output_transport=None)

    with store.pinned():
        await _collect(client.stream(spec))
        store.replace({"OPENAI_API_KEY": NEW}, generation=1)
        await _collect(client.stream(spec))
    await _collect(client.stream(spec))

    assert recording_server.authorizations == [f"Bearer {OLD}", f"Bearer {OLD}", f"Bearer {NEW}"]
    await client.aclose()


async def test_responses_client_resolves_the_key_per_stream(monkeypatch: pytest.MonkeyPatch) -> None:
    built: list[_FakeOpenAIClient] = []

    def factory(**kwargs: Any) -> _FakeOpenAIClient:
        fake = _FakeOpenAIClient([], response_events=[_responses_completed_event()])
        fake.constructed_with = kwargs  # type: ignore[attr-defined]
        built.append(fake)
        return fake

    monkeypatch.setattr(responses_module, "AsyncOpenAI", factory)
    store = RuntimeCredentialStore({"OPENAI_API_KEY": OLD})
    client = OpenAIResponsesModelClient(credential_resolver=StoreModelCredentialResolver(store))
    spec = _spec(provider_type=OPENAI_RESPONSES_HTTP_PROVIDER_TYPE)

    await _collect(client.stream(spec))
    store.replace({"OPENAI_API_KEY": NEW}, generation=1)
    await _collect(client.stream(spec))
    store.replace({}, generation=2)
    with pytest.raises(ModelClientProviderError) as caught:
        await _collect(client.stream(spec))

    assert caught.value.code == "missing_api_key"
    assert len(built) == 1
    assert built[0].constructed_with["api_key"] == KEY_FREE_PLACEHOLDER  # type: ignore[attr-defined]
    assert [call["api_key"] for call in built[0].with_options_calls] == [OLD, NEW]


async def test_embedder_follows_replacement_and_removal(recording_server: _RecordingServer) -> None:
    store = RuntimeCredentialStore({"ANIMAMA_CONNECTION_C1_API_KEY": OLD, **C1_ORIGIN})
    connection = _owner_connection("vllm", credential_env="ANIMAMA_CONNECTION_C1_API_KEY")
    row = _spec(connection=connection).model_provider
    embedder = ConnectionEmbedder(
        row,
        credential_resolver=StoreModelCredentialResolver(store),
        openai_base_url="https://api.openai.com/v1",
        default_timeout_seconds=5.0,
    )

    await embedder.embed_texts(["a"])
    store.replace({"ANIMAMA_CONNECTION_C1_API_KEY": NEW, **C1_ORIGIN}, generation=1)
    await embedder.embed_texts(["a"])
    store.replace({}, generation=2)
    with pytest.raises(ModelClientProviderError):
        await embedder.embed_texts(["a"])

    assert recording_server.authorizations == [f"Bearer {OLD}", f"Bearer {NEW}"]


def test_memory_manager_runs_on_a_replaced_key() -> None:
    runtime = _memory_manager_runtime(None)
    store = RuntimeCredentialStore({"OPENAI_API_KEY": OLD})
    runtime._credentials = StoreModelCredentialResolver(store)

    store.replace({"OPENAI_API_KEY": NEW}, generation=1)
    connection, credential = runtime._require_model()

    assert runtime._client(connection, credential).api_key == NEW


def test_registry_default_resolver_follows_the_process_store(set_runtime_credentials: Any) -> None:
    from animama.app.model_clients.credentials import builtin_openai_connection
    from animama.server.model_clients import build_model_client_registry

    registry = build_model_client_registry()
    chat = registry.get("OpenAIHTTPAgent")
    set_runtime_credentials(OPENAI_API_KEY=NEW)

    assert chat._credentials.resolve(builtin_openai_connection()).api_key == NEW  # type: ignore[union-attr]
    set_runtime_credentials()
    assert chat._credentials.resolve(builtin_openai_connection()).api_key is None  # type: ignore[union-attr]


def test_trace_export_key_follows_the_process_store() -> None:
    from agents.tracing import processors

    from animama.server.runtime_credentials import follow_trace_export_key, runtime_credentials

    follow_trace_export_key()
    exporter = processors.default_exporter()
    runtime_credentials.replace({"OPENAI_API_KEY": NEW}, generation=runtime_credentials.snapshot().generation + 1)
    assert exporter._api_key == NEW
    runtime_credentials.replace({}, generation=runtime_credentials.snapshot().generation + 1)
    assert exporter._api_key == ""
    assert NEW not in repr(vars(exporter))


def test_memory_manager_refuses_a_removed_key() -> None:
    runtime = _memory_manager_runtime(None)
    store = RuntimeCredentialStore({"OPENAI_API_KEY": OLD})
    runtime._credentials = StoreModelCredentialResolver(store)

    _connection, credential = runtime._require_model()
    store.replace({}, generation=1)

    assert credential.api_key == OLD
    with pytest.raises(MemoryManagerRuntimeConfigurationError):
        runtime._require_model()


def test_elevenlabs_client_carries_only_the_current_key(set_runtime_credentials: Any) -> None:
    set_runtime_credentials(ELEVENLABS_API_KEY=OLD)
    first = elevenlabs_service.get_elevenlabs_client()
    set_runtime_credentials(ELEVENLABS_API_KEY=NEW)
    second = elevenlabs_service.get_elevenlabs_client()
    set_runtime_credentials()

    assert first._client_wrapper.get_headers()["xi-api-key"] == OLD
    assert second._client_wrapper.get_headers()["xi-api-key"] == NEW
    shared = elevenlabs_service._elevenlabs_http_client()
    assert OLD not in repr(dict(shared.headers)) and NEW not in repr(dict(shared.headers))
    with pytest.raises(Exception) as caught:
        elevenlabs_service.get_elevenlabs_client()
    assert getattr(caught.value, "status_code", None) == 503


def test_elevenlabs_voice_access_cache_does_not_survive_a_key_change(set_runtime_credentials: Any) -> None:
    from animama.server.runtime_credentials import runtime_credentials

    set_runtime_credentials(ELEVENLABS_API_KEY=OLD)
    elevenlabs_service._store_voice_access_cache_success("voice-1")
    assert elevenlabs_service._get_voice_access_cache_entry("voice-1") is not None

    runtime_credentials.replace({"ELEVENLABS_API_KEY": NEW}, generation=runtime_credentials.snapshot().generation + 1)

    assert elevenlabs_service._get_voice_access_cache_entry("voice-1") is None
    assert elevenlabs_service._ELEVENLABS_VOICE_ACCESS_CACHE == {}


def test_scrub_removes_only_credential_names() -> None:
    environ = {
        "OPENAI_API_KEY": OLD,
        "ELEVENLABS_API_KEY": OLD,
        "HF_TOKEN": OLD,
        "ANIMAMA_CONNECTION_C1_API_KEY": OLD,
        "PATH": "/bin",
        "ANIMAMA_DATABASE_URL": "postgresql://db",
    }

    scrub_credential_environment(environ)

    assert environ == {"PATH": "/bin", "ANIMAMA_DATABASE_URL": "postgresql://db"}


async def test_middleware_pins_each_request_to_the_keys_it_was_admitted_with() -> None:
    store = RuntimeCredentialStore({"OPENAI_API_KEY": OLD})
    admitted = asyncio.Event()
    release = asyncio.Event()

    async def slow(request: Request) -> JSONResponse:
        before = store.current().get("OPENAI_API_KEY")
        admitted.set()
        await release.wait()
        return JSONResponse({"before": before, "after": store.current().get("OPENAI_API_KEY")})

    async def fast(request: Request) -> JSONResponse:
        return JSONResponse({"key": store.current().get("OPENAI_API_KEY")})

    app = PinnedCredentialsMiddleware(Starlette(routes=[Route("/slow", slow), Route("/fast", fast)]), store=store)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        running = asyncio.create_task(client.get("/slow"))
        await admitted.wait()
        store.replace({"OPENAI_API_KEY": NEW}, generation=1)
        fresh = await client.get("/fast")
        release.set()
        slow_response = await running

    assert slow_response.json() == {"before": OLD, "after": OLD}
    assert fresh.json() == {"key": NEW}
