"""Model connection credential isolation against the real OpenAI SDK.

These tests assert which synthetic upstream key each model connection sends;
they never call local routes, so they are exempt from the route-test rule
against Authorization and Bearer literals.
"""

from __future__ import annotations

from typing import Any

import httpx2
import pytest

from animama.adapters.model_clients import OpenAIChatCompletionsModelClient
from animama.adapters.model_clients.openai_chat_completions import connection_sdk as openai_chat_client_module
from animama.adapters.model_clients.openai_chat_completions.connection_sdk import (
    KEY_FREE_PLACEHOLDER,
    connection_timeout,
)
from animama.app.model_catalog import STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT
from animama.app.model_clients.credentials import static_credential_resolver
from animama.domain import ModelConnection
from tests.test_model_client_registry import (
    DEEPSEEK_BASE_URL,
    _collect,
    _FakeOpenAIClient,
    _messages_with_instructions,
    _owner_connection,
    _sdk_chunk,
    _sdk_usage,
    _spec,
)


def _constructed_client_factory(created_clients: list[Any]) -> type:
    class _ConstructedOpenAIClient(_FakeOpenAIClient):
        def __init__(
            self,
            *,
            api_key: str,
            base_url: str,
            timeout: float | None,
            default_headers: dict[str, Any] | None = None,
        ) -> None:
            super().__init__([_sdk_chunk(content="Hi"), _sdk_chunk(finish_reason="stop", usage=_sdk_usage())])
            self.api_key = api_key
            self.base_url = base_url
            self.timeout = timeout
            self.default_headers = default_headers or {}
            created_clients.append(self)

    return _ConstructedOpenAIClient


@pytest.mark.asyncio
async def test_openai_chat_completions_client_sends_each_connection_only_its_own_key(monkeypatch) -> None:
    created_clients: list[Any] = []
    monkeypatch.setattr(openai_chat_client_module, "AsyncOpenAI", _constructed_client_factory(created_clients))
    client = OpenAIChatCompletionsModelClient(
        credential_resolver=static_credential_resolver(
            {
                "OPENAI_API_KEY": "sk-openai",
                "DEEPSEEK_API_KEY": "sk-deepseek",
                "ANIMAMA_CONNECTION_C1_API_KEY": "sk-custom",
            }
        ),
        client=None,
        timeout=13.0,
    )

    await _collect(client.stream(_spec(base_url="https://api.openai.com/v1", messages=_messages_with_instructions())))
    await _collect(
        client.stream(
            _spec(
                model="deepseek-v4-pro",
                connection=_owner_connection("deepseek", credential_env="DEEPSEEK_API_KEY"),
                request_options={"reasoning_effort": "none"},
                messages=_messages_with_instructions(),
                structured_output_transport=STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT,
            )
        )
    )
    await _collect(
        client.stream(
            _spec(
                model="custom-model",
                connection=_owner_connection(
                    "custom",
                    base_url="https://models.example.test/v1",
                    credential_env="ANIMAMA_CONNECTION_C1_API_KEY",
                ),
                request_options={"reasoning_effort": None},
                messages=_messages_with_instructions(),
            )
        )
    )
    await client.aclose()

    # Cached clients hold no key; each request's view carries only its connection's key.
    assert [(client.api_key, client.base_url, client.timeout) for client in created_clients] == [
        (KEY_FREE_PLACEHOLDER, "https://api.openai.com/v1", connection_timeout(13.0)),
        (KEY_FREE_PLACEHOLDER, DEEPSEEK_BASE_URL, connection_timeout(13.0)),
        (KEY_FREE_PLACEHOLDER, "https://models.example.test/v1", connection_timeout(13.0)),
    ]
    assert [client.with_options_calls[-1]["api_key"] for client in created_clients] == [
        "sk-openai",
        "sk-deepseek",
        "sk-custom",
    ]
    assert "Authorization" not in created_clients[1].default_headers
    assert created_clients[1].with_options_calls[-1]["default_headers"]["Authorization"] == "Bearer sk-deepseek"
    assert [client.close_calls for client in created_clients] == [1, 1, 1]


@pytest.mark.asyncio
async def test_openai_chat_completions_client_never_sends_the_openai_key_to_a_keyless_connection(
    monkeypatch,
) -> None:
    from openai import Omit

    created_clients: list[Any] = []
    monkeypatch.setattr(openai_chat_client_module, "AsyncOpenAI", _constructed_client_factory(created_clients))
    monkeypatch.setenv("OPENAI_API_KEY", "sk-process-openai")
    client = OpenAIChatCompletionsModelClient(api_key="sk-openai", client=None)
    connection = _owner_connection("ollama")
    connection.timeout_seconds = 300.0

    await _collect(client.stream(_spec(model="qwen3:8b", connection=connection, request_options={})))

    constructed = created_clients[0]
    assert constructed.api_key not in {"sk-openai", "sk-process-openai"}
    assert constructed.base_url == "http://127.0.0.1:11434/v1"
    assert constructed.timeout == connection_timeout(300.0)
    assert isinstance(constructed.create_calls[0]["extra_headers"]["Authorization"], Omit)
    assert isinstance(constructed.default_headers["OpenAI-Organization"], Omit)


_HOSTILE_PROCESS_ENVIRONMENT = {
    "OPENAI_API_KEY": "sk-process-openai",
    "OPENAI_ORG_ID": "org-process",
    "OPENAI_PROJECT_ID": "proj-process",
    "OPENAI_CUSTOM_HEADERS": "Authorization: Bearer sk-process-gateway\nX-Org-Secret: s3cret",
}


async def _headers_sent_by_real_sdk(
    connection: ModelConnection,
    *,
    environ: dict[str, str],
    resolver_environ: dict[str, str] | None = None,
) -> httpx2.Headers:
    from openai import AsyncOpenAI

    seen_headers: list[httpx2.Headers] = []

    def _handler(request: httpx2.Request) -> httpx2.Response:
        seen_headers.append(request.headers)
        body = (
            'data: {"id":"c","object":"chat.completion.chunk","created":1,"model":"m",'
            '"choices":[{"index":0,"delta":{"content":"Hi"},"finish_reason":"stop"}]}\n\n'
            "data: [DONE]\n\n"
        )
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, content=body.encode())

    original_init = AsyncOpenAI.__init__

    def _init_with_transport(self, *args, **kwargs):
        kwargs["http_client"] = httpx2.AsyncClient(transport=httpx2.MockTransport(_handler))
        original_init(self, *args, **kwargs)

    with pytest.MonkeyPatch.context() as patch:
        patch.setattr(AsyncOpenAI, "__init__", _init_with_transport)
        for name, value in environ.items():
            patch.setenv(name, value)
        client = OpenAIChatCompletionsModelClient(
            credential_resolver=static_credential_resolver({"OPENAI_API_KEY": "sk-openai", **(resolver_environ or {})}),
            client=None,
        )
        await _collect(client.stream(_spec(model="qwen3:8b", connection=connection)))
        await client.aclose()

    assert len(seen_headers) == 1
    return seen_headers[0]


@pytest.mark.asyncio
async def test_keyless_connection_request_carries_no_process_openai_headers() -> None:
    headers = await _headers_sent_by_real_sdk(_owner_connection("ollama"), environ=_HOSTILE_PROCESS_ENVIRONMENT)

    assert "authorization" not in headers
    assert "openai-organization" not in headers
    assert "openai-project" not in headers
    assert "x-org-secret" not in headers


@pytest.mark.asyncio
async def test_keyed_connection_request_carries_only_its_own_key() -> None:
    connection = _owner_connection(
        "custom",
        base_url="https://models.example.test/v1",
        credential_env="ANIMAMA_CONNECTION_C1_API_KEY",
    )

    headers = await _headers_sent_by_real_sdk(
        connection,
        environ=_HOSTILE_PROCESS_ENVIRONMENT,
        resolver_environ={"ANIMAMA_CONNECTION_C1_API_KEY": "sk-owner"},
    )

    assert headers.get_list("authorization") == ["Bearer sk-owner"]
    assert "openai-organization" not in headers
    assert "x-org-secret" not in headers
