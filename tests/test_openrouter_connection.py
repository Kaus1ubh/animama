"""OpenRouter preset: defaults, its key name and the attribution headers it sends.

These tests assert which synthetic upstream key and headers a connection sends.
The chat turn runs the route handler directly with an overridden principal and
never sends a credential to a local route, so the module is exempt from the
route-test rule against Authorization and Bearer literals.
"""

from __future__ import annotations

import json
from dataclasses import replace
from typing import Any

import httpx2
import pytest
from openai import AsyncOpenAI
from sqlalchemy import select

from animama.adapters.model_clients import OpenAIChatCompletionsModelClient
from animama.adapters.model_clients.openai_chat_completions.probe import OpenAICompatibleConnectionProbe
from animama.app.model_clients.credential_store import (
    credential_values_from_environment,
    is_allowed_credential_env,
    is_deliverable_credential_env,
)
from animama.app.model_clients.credentials import static_credential_resolver
from animama.app.model_connection_presets import (
    CLOUD_TIMEOUT_SECONDS,
    MODEL_CONNECTION_PRESETS,
    PRESET_OPENROUTER,
)
from animama.domain import ModelConnection
from animama.domain.model_connection import REASONING_MODE_OPENAI_EFFORT
from animama.domain.request_principal import RequestPrincipal
from animama.orm import ORMChat, ORMChatMessage, ORMModelProvider
from animama.orm.anima import ORMAnima
from tests.test_anima_chat_sse import (
    _chat_request,
    _collect_chunks,
    _direct_structured_response,
    _event_data,
    _install_db_route_mocks,
    _seed_anima_identity_file,
    _seed_chat_model_provider,
    _seed_owner_connection,
    _test_request,
    chat_anima_direct_sse,
)
from tests.test_model_client_registry import _owner_connection
from tests.test_model_connection_credentials import _HOSTILE_PROCESS_ENVIRONMENT, _headers_sent_by_real_sdk

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
ATTRIBUTION = {"x-title": "Animama", "http-referer": "https://animama.ai"}


def _openrouter_connection() -> ModelConnection:
    return _owner_connection(PRESET_OPENROUTER, credential_env="OPENROUTER_API_KEY")


def test_openrouter_preset_defaults() -> None:
    preset = MODEL_CONNECTION_PRESETS[PRESET_OPENROUTER]

    assert preset.label == "OpenRouter"
    assert preset.logo_provider == "openrouter"
    assert preset.local is False
    assert preset.expects_key is True
    assert preset.owner_selectable is True
    assert preset.base_url(local_host="127.0.0.1") == OPENROUTER_BASE_URL
    assert preset.suggested_credential_env == "OPENROUTER_API_KEY"
    assert preset.timeout_seconds == CLOUD_TIMEOUT_SECONDS
    assert preset.compatibility.fold_developer_role is True
    assert preset.compatibility.send_openai_extensions is False
    assert preset.compatibility.reasoning_mode == REASONING_MODE_OPENAI_EFFORT
    assert dict(preset.request_headers) == {"X-Title": "Animama", "HTTP-Referer": "https://animama.ai"}


def test_only_the_openrouter_preset_carries_request_headers() -> None:
    assert {preset.id for preset in MODEL_CONNECTION_PRESETS.values() if preset.request_headers} == {PRESET_OPENROUTER}


def test_openrouter_key_name_is_an_allowed_connection_reference() -> None:
    assert is_allowed_credential_env("OPENROUTER_API_KEY")
    assert credential_values_from_environment({"OPENROUTER_API_KEY": " sk-or ", "PATH": "/bin"}) == {
        "OPENROUTER_API_KEY": "sk-or"
    }
    # Desktop delivers connection keys under the managed namespace only.
    assert not is_deliverable_credential_env("OPENROUTER_API_KEY")


@pytest.mark.asyncio
async def test_openrouter_chat_request_carries_its_key_and_attribution_headers() -> None:
    headers = await _headers_sent_by_real_sdk(
        _openrouter_connection(),
        environ={
            **_HOSTILE_PROCESS_ENVIRONMENT,
            # A process header of the same name must not replace or duplicate ours.
            "OPENAI_CUSTOM_HEADERS": "x-title: Other\nX-Org-Secret: s3cret",
        },
        resolver_environ={"OPENROUTER_API_KEY": "sk-or-owner"},
    )

    assert headers.get_list("authorization") == ["Bearer sk-or-owner"]
    for name, value in ATTRIBUTION.items():
        assert headers.get_list(name) == [value]
    assert "openai-organization" not in headers
    assert "x-org-secret" not in headers


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "connection",
    [
        _owner_connection("huggingface", credential_env="HF_TOKEN"),
        _owner_connection("custom", base_url=OPENROUTER_BASE_URL, credential_env="OPENROUTER_API_KEY"),
        _owner_connection("ollama"),
    ],
    ids=["huggingface", "custom-at-openrouter-url", "ollama"],
)
async def test_other_connections_never_send_attribution_headers(connection: ModelConnection) -> None:
    headers = await _headers_sent_by_real_sdk(
        connection,
        environ={},
        resolver_environ={"HF_TOKEN": "hf-owner", "OPENROUTER_API_KEY": "sk-or"},
    )

    assert not set(ATTRIBUTION) & {name.lower() for name in headers}


def test_changing_a_connection_preset_rebuilds_its_cached_client() -> None:
    resolver = static_credential_resolver({"OPENROUTER_API_KEY": "sk-or"})
    client = OpenAIChatCompletionsModelClient(credential_resolver=resolver, timeout=5.0)
    openrouter = _openrouter_connection()
    custom = replace(openrouter, preset="custom")
    credential = resolver.resolve(openrouter)

    attributed = client._client_for_connection(openrouter, timeout=None, credential=credential)
    plain = client._client_for_connection(custom, timeout=None, credential=credential)

    assert attributed._custom_headers.get("X-Title") == "Animama"
    assert "X-Title" not in plain._custom_headers


class _OpenRouterServer:
    """Answers like OpenRouter's Chat Completions API and records each request."""

    def __init__(self) -> None:
        self.requests: list[httpx2.Request] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        self.requests.append(request)
        path = request.url.path
        if path == "/api/v1/models":
            return httpx2.Response(
                200,
                json={"data": [{"id": "openai/gpt-oss-120b", "object": "model", "created": 0, "owned_by": "x"}]},
            )
        if path == "/api/v1/chat/completions":
            body = json.loads(request.content)
            if body.get("stream"):
                chunk = {
                    "id": "c",
                    "object": "chat.completion.chunk",
                    "created": 1,
                    "model": body["model"],
                    "choices": [{"index": 0, "delta": {"content": "ok"}, "finish_reason": "stop"}],
                }
                content = f"data: {json.dumps(chunk)}\n\ndata: [DONE]\n\n"
                return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=content.encode())
            return httpx2.Response(400, json={"error": {"message": "unsupported in this stub"}})
        return httpx2.Response(404, json={"error": {"message": "not found"}})


@pytest.fixture
def openrouter_server(monkeypatch: pytest.MonkeyPatch) -> _OpenRouterServer:
    server = _OpenRouterServer()
    original_init = AsyncOpenAI.__init__

    def _init(self, *args: Any, **kwargs: Any) -> None:
        kwargs["http_client"] = httpx2.AsyncClient(transport=httpx2.MockTransport(server))
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(AsyncOpenAI, "__init__", _init)
    return server


def _probe() -> OpenAICompatibleConnectionProbe:
    return OpenAICompatibleConnectionProbe(
        credential_resolver=static_credential_resolver({"OPENROUTER_API_KEY": "sk-or-owner"}),
    )


def _assert_attributed(request: httpx2.Request) -> None:
    assert request.headers.get_list("authorization") == ["Bearer sk-or-owner"]
    for name, value in ATTRIBUTION.items():
        assert request.headers.get_list(name) == [value]


@pytest.mark.asyncio
async def test_openrouter_model_listing_sends_attribution_headers(openrouter_server: _OpenRouterServer) -> None:
    models = await _probe().list_models(_openrouter_connection())

    assert models == ["openai/gpt-oss-120b"]
    assert [str(request.url) for request in openrouter_server.requests] == [f"{OPENROUTER_BASE_URL}/models"]
    _assert_attributed(openrouter_server.requests[0])


@pytest.mark.asyncio
async def test_openrouter_probe_sends_attribution_headers_on_every_request(
    openrouter_server: _OpenRouterServer,
) -> None:
    report = await _probe().probe_chat_model(_openrouter_connection(), model="openai/gpt-oss-120b")

    assert report.supports_streaming is True
    assert len(openrouter_server.requests) >= 2
    for request in openrouter_server.requests:
        assert str(request.url) == f"{OPENROUTER_BASE_URL}/chat/completions"
        _assert_attributed(request)


@pytest.mark.asyncio
async def test_chat_sse_openrouter_turn_streams_through_chat_completions_with_attribution(
    monkeypatch,
    async_session,
    async_session_factory,
) -> None:
    """A stubbed OpenRouter server answers one real Chat Completions turn end to end."""

    anima_id = "anima-db-openrouter"
    chat_id = "chat-db-openrouter"
    model_provider_id = "owner:openrouter-gpt-oss"
    async_session.add(ORMAnima(id=anima_id, user_id="user-1"))
    await async_session.commit()
    await _seed_anima_identity_file(async_session, anima_id=anima_id)
    await _seed_owner_connection(
        async_session,
        "conn-openrouter",
        preset="openrouter",
        base_url="https://openrouter.ai/api/v1",
        name="OpenRouter",
        credential_env="OPENROUTER_API_KEY",
    )
    await _seed_chat_model_provider(
        async_session,
        model_provider_id,
        provider_type="OpenAIHTTPAgent",
        model="openai/gpt-oss-120b",
        provider_label="OpenRouter",
        connection_id="conn-openrouter",
        source="owner",
        supports_reasoning=False,
        supported_reasoning_efforts=[],
        native_tool_support=[],
    )
    row = await async_session.get(ORMModelProvider, model_provider_id)
    assert row is not None
    row.structured_output_transport = "json_schema"
    await async_session.commit()

    speech = _direct_structured_response(speech="hello from openrouter")
    upstream: list[httpx2.Request] = []

    def openrouter(request: httpx2.Request) -> httpx2.Response:
        upstream.append(request)
        body = json.loads(request.content)
        chunks = [
            {"index": 0, "delta": {"role": "assistant", "content": speech}, "finish_reason": None},
            {"index": 0, "delta": {}, "finish_reason": "stop"},
        ]
        frames = [
            {"id": "gen-1", "object": "chat.completion.chunk", "created": 1, "model": body["model"], "choices": [c]}
            for c in chunks
        ]
        frames.append(
            {
                "id": "gen-1",
                "object": "chat.completion.chunk",
                "created": 1,
                "model": body["model"],
                "choices": [],
                "usage": {"prompt_tokens": 12, "completion_tokens": 7, "total_tokens": 19},
            }
        )
        content = "".join(f"data: {json.dumps(frame)}\n\n" for frame in frames) + "data: [DONE]\n\n"
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=content.encode())

    original_init = AsyncOpenAI.__init__

    def _init(self, *args, **kwargs):
        kwargs["http_client"] = httpx2.AsyncClient(transport=httpx2.MockTransport(openrouter))
        original_init(self, *args, **kwargs)

    monkeypatch.setattr(AsyncOpenAI, "__init__", _init)
    model_client = OpenAIChatCompletionsModelClient(
        credential_resolver=static_credential_resolver({"OPENROUTER_API_KEY": "sk-or-owner"}),
        client=None,
    )
    _install_db_route_mocks(monkeypatch, async_session_factory, model_client=model_client)  # type: ignore[arg-type]

    response = await chat_anima_direct_sse(
        anima_id,
        _chat_request(
            message="hello", run_id="run-db-openrouter", chat_id=chat_id, model_provider_id=model_provider_id
        ),
        request=_test_request(),
        user=RequestPrincipal(id="user-1"),
    )
    chunks = await _collect_chunks(response)
    await model_client.aclose()

    assert _event_data(chunks, "run.completed")["chat_id"] == chat_id
    assert len(upstream) == 1
    request = upstream[0]
    assert str(request.url) == "https://openrouter.ai/api/v1/chat/completions"
    assert request.headers.get_list("authorization") == ["Bearer sk-or-owner"]
    assert request.headers.get_list("x-title") == ["Animama"]
    assert request.headers.get_list("http-referer") == ["https://animama.ai"]
    payload = json.loads(request.content)
    assert payload["model"] == "openai/gpt-oss-120b"
    assert payload["stream"] is True
    assert payload["response_format"]["type"] == "json_schema"
    assert "prompt_cache_key" not in payload
    assert "developer" not in {message["role"] for message in payload["messages"]}
    assistant = (
        await async_session.execute(
            select(ORMChatMessage).where(ORMChatMessage.chat_id == chat_id, ORMChatMessage.role == "assistant")
        )
    ).scalar_one()
    assert "hello from openrouter" in (assistant.content or "")
    assert assistant.model == "openai/gpt-oss-120b"
    chat = await async_session.get(ORMChat, chat_id)
    assert chat is not None
    assert chat.api_standard == "chat_completions"
    assert chat.last_model_provider_id == model_provider_id
