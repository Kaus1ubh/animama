"""Capability probe against a scripted OpenAI-compatible server (spec R3)."""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from typing import Any

import httpx2
import pytest
from openai import AsyncOpenAI

from animama.adapters.model_clients.openai_chat_completions.connection_sdk import connection_timeout
from animama.adapters.model_clients.openai_chat_completions.probe import OpenAICompatibleConnectionProbe
from animama.app.model_clients.credentials import static_credential_resolver
from animama.app.model_clients.probe import ModelConnectionProbeError
from animama.app.model_connection_presets import MODEL_CONNECTION_PRESETS
from animama.domain import ModelConnection


class _Server:
    """Answers like a local model server; each behavior flag breaks one feature."""

    def __init__(
        self,
        *,
        schema: bool = True,
        tools: bool = True,
        tools_with_schema: bool = True,
        unauthorized: bool = False,
    ) -> None:
        self.schema = schema
        self.tools = tools
        self.tools_with_schema = tools_with_schema
        self.unauthorized = unauthorized
        self.requests: list[tuple[str, str, dict[str, Any] | None]] = []

    def __call__(self, request: httpx2.Request) -> httpx2.Response:
        body = json.loads(request.content) if request.content else None
        self.requests.append((request.method, request.url.path, body))
        if self.unauthorized:
            return httpx2.Response(401, json={"error": {"message": "bad key", "code": "invalid_api_key"}})
        path = request.url.path
        if path == "/v1/models":
            return httpx2.Response(200, json={"object": "list", "data": [_model("qwen3:8b"), _model("gemma4:e4b")]})
        if path == "/v1/embeddings":
            return httpx2.Response(
                200,
                json={
                    "object": "list",
                    "model": "nomic-embed",
                    "data": [{"object": "embedding", "index": 0, "embedding": [0.1, 0.2, 0.3]}],
                    "usage": {"prompt_tokens": 1, "total_tokens": 1},
                },
            )
        if path == "/props":
            return httpx2.Response(200, json={"default_generation_settings": {"n_ctx": 8192}})
        if path == "/api/ps":
            return httpx2.Response(200, json={"models": [{"name": "qwen3:8b", "context_length": 4096}]})
        if path.startswith("/api/v0/models/"):
            return httpx2.Response(200, json={"max_context_length": 131072, "loaded_context_length": 16384})
        if path == "/v1/chat/completions":
            return self._chat(body or {})
        return httpx2.Response(404, json={"error": {"message": "not found"}})

    def _chat(self, body: dict[str, Any]) -> httpx2.Response:
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
        response_format = (body.get("response_format") or {}).get("type")
        tools = body.get("tools")
        if tools and response_format and not self.tools_with_schema:
            return httpx2.Response(400, json={"error": {"message": "tools cannot be combined with a grammar"}})
        if tools and self.tools:
            return _completion(body, tool_call=True)
        if response_format == "json_schema" and not self.schema:
            return httpx2.Response(400, json={"error": {"message": "json_schema is not supported"}})
        if response_format in {"json_schema", "json_object"}:
            return _completion(body, content='{"answer": "ok"}')
        return _completion(body, content="ok")


def _model(model_id: str) -> dict[str, Any]:
    return {"id": model_id, "object": "model", "created": 0, "owned_by": "local"}


def _completion(body: dict[str, Any], *, content: str | None = None, tool_call: bool = False) -> httpx2.Response:
    message: dict[str, Any] = {"role": "assistant", "content": content}
    if tool_call:
        message["tool_calls"] = [
            {
                "id": "call-1",
                "type": "function",
                "function": {"name": "record_answer", "arguments": '{"answer": "ok"}'},
            }
        ]
    return httpx2.Response(
        200,
        json={
            "id": "c",
            "object": "chat.completion",
            "created": 1,
            "model": body["model"],
            "choices": [{"index": 0, "message": message, "finish_reason": "stop"}],
        },
    )


@pytest.fixture
def sdk_transport() -> Iterator[Callable[[Callable[[httpx2.Request], httpx2.Response]], None]]:
    """Route every SDK client created during the test through a scripted server."""

    original_init = AsyncOpenAI.__init__
    patch = pytest.MonkeyPatch()

    def install(server: Callable[[httpx2.Request], httpx2.Response]) -> None:
        def _init(self, *args, **kwargs):
            kwargs["http_client"] = httpx2.AsyncClient(transport=httpx2.MockTransport(server))
            original_init(self, *args, **kwargs)

        patch.setattr(AsyncOpenAI, "__init__", _init)

    yield install
    patch.undo()


def _connection(preset: str, *, credential_env: str | None = None) -> ModelConnection:
    defaults = MODEL_CONNECTION_PRESETS[preset]
    return ModelConnection(
        id=f"conn-{preset}",
        name=defaults.label,
        preset=preset,
        base_url=defaults.base_url(local_host="127.0.0.1") or "https://models.example.test/v1",
        credential_env=credential_env,
        compatibility=defaults.compatibility,
    )


def _probe(server: _Server, environ: dict[str, str] | None = None) -> OpenAICompatibleConnectionProbe:
    return OpenAICompatibleConnectionProbe(
        credential_resolver=static_credential_resolver({"OPENAI_API_KEY": "sk-openai", **(environ or {})}),
        http_transport=httpx2.MockTransport(server),
    )


@pytest.mark.parametrize(("preset", "window"), [("llamacpp", 8192), ("ollama", 4096), ("lmstudio", 16384)])
async def test_probe_reports_full_support_and_the_served_context_window(sdk_transport, preset, window):
    server = _Server()
    sdk_transport(server)

    report = await _probe(server).probe_chat_model(_connection(preset), model="qwen3:8b")

    assert [step.name for step in report.steps] == [
        "streaming",
        "structured_output",
        "tool_calls",
        "tools_with_structured_output",
    ]
    assert all(step.ok for step in report.steps)
    assert report.supports_streaming is True
    assert report.structured_output_transport == "json_schema"
    assert report.supports_tools is True
    assert report.tools_with_structured_output is True
    assert report.context_window_tokens == window


async def test_probe_falls_back_to_json_mode_and_reports_missing_tools(sdk_transport):
    server = _Server(schema=False, tools=False)
    sdk_transport(server)

    report = await _probe(server).probe_chat_model(_connection("vllm"), model="small")

    steps = {step.name: step for step in report.steps}
    assert steps["structured_output"].ok is False
    assert steps["structured_output"].category == "bad_request"
    assert steps["json_mode"].ok is True
    assert steps["tool_calls"].ok is False
    assert report.structured_output_transport == "json_object"
    assert report.supports_tools is False
    assert report.tools_with_structured_output is None
    assert report.context_window_tokens is None


async def test_probe_detects_servers_that_cannot_combine_tools_and_a_schema(sdk_transport):
    server = _Server(tools_with_schema=False)
    sdk_transport(server)

    report = await _probe(server).probe_chat_model(_connection("llamacpp"), model="qwen3:8b")

    assert report.supports_tools is True
    assert report.tools_with_structured_output is False


async def test_probe_stops_after_a_rejected_key(sdk_transport):
    server = _Server(unauthorized=True)
    sdk_transport(server)
    connection = _connection("custom", credential_env="ANIMAMA_CONNECTION_C1_API_KEY")

    report = await _probe(
        server,
        {"ANIMAMA_CONNECTION_C1_API_KEY": "sk-owner", "ANIMAMA_CONNECTION_C1_ORIGIN": "https://models.example.test"},
    ).probe_chat_model(connection, model="qwen3:8b")

    assert [(step.name, step.ok, step.category) for step in report.steps] == [
        ("streaming", False, "credential_rejected")
    ]
    assert len(server.requests) == 1


async def test_probe_requires_the_referenced_key_before_any_request(sdk_transport):
    server = _Server()
    sdk_transport(server)

    with pytest.raises(ModelConnectionProbeError) as exc_info:
        await _probe(server).probe_chat_model(
            _connection("deepseek", credential_env="DEEPSEEK_API_KEY"), model="deepseek-chat"
        )

    assert exc_info.value.category == "credential_missing"
    assert server.requests == []


@pytest.mark.parametrize(
    "keys",
    [
        {"ANIMAMA_CONNECTION_C1_API_KEY": "sk-owner"},
        {"ANIMAMA_CONNECTION_C1_API_KEY": "sk-owner", "ANIMAMA_CONNECTION_C1_ORIGIN": "https://elsewhere.example.test"},
    ],
    ids=["no-origin", "another-origin"],
)
async def test_probe_sends_nothing_with_a_key_saved_for_another_address(sdk_transport, keys):
    server = _Server()
    sdk_transport(server)
    connection = ModelConnection(
        id="c1",
        name="Lab",
        preset="custom",
        base_url="https://models.example.test/v1",
        credential_env="ANIMAMA_CONNECTION_C1_API_KEY",
    )

    with pytest.raises(ModelConnectionProbeError) as exc_info:
        await _probe(server, keys).probe_chat_model(connection, model="qwen3:8b")

    assert exc_info.value.category == "credential_missing"
    assert server.requests == []


async def test_unreachable_servers_fail_with_a_category():
    probe = OpenAICompatibleConnectionProbe(
        credential_resolver=static_credential_resolver(),
        default_timeout=2.0,
    )
    connection = ModelConnection(id="conn-down", name="Down", preset="ollama", base_url="http://127.0.0.1:9/v1")

    report = await probe.probe_chat_model(connection, model="qwen3:8b")
    with pytest.raises(ModelConnectionProbeError) as exc_info:
        await probe.list_models(connection)

    assert report.steps[0].category == "unreachable"
    assert exc_info.value.category == "unreachable"


async def test_a_base_url_the_sdk_rejects_fails_with_a_category():
    probe = OpenAICompatibleConnectionProbe(credential_resolver=static_credential_resolver())
    connection = ModelConnection(id="conn-bad", name="Bad", preset="ollama", base_url="http://[::1/v1")

    with pytest.raises(ModelConnectionProbeError) as exc_info:
        await probe.list_models(connection)

    assert exc_info.value.category == "invalid_base_url"


async def test_models_and_embeddings_are_listed_and_measured(sdk_transport):
    server = _Server()
    sdk_transport(server)
    probe = _probe(server)

    models = await probe.list_models(_connection("ollama"))
    embedding = await probe.probe_embedding_model(_connection("ollama"), model="nomic-embed")

    assert models == ["gemma4:e4b", "qwen3:8b"]
    assert embedding.embedding_dimensions == 3
    assert embedding.steps[0].ok is True


class _StalledStream(httpx2.AsyncByteStream):
    """Sends response headers, then times out while the body is read."""

    async def __aiter__(self):
        raise httpx2.ReadTimeout("stalled")
        yield b""  # pragma: no cover


async def test_a_stream_that_stalls_reports_a_timeout_step(sdk_transport):
    def stalled(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, headers={"content-type": "text/event-stream"}, stream=_StalledStream())

    server = _Server()
    sdk_transport(stalled)

    report = await _probe(server).probe_chat_model(_connection("ollama"), model="qwen3:8b")

    assert [(step.name, step.ok, step.category) for step in report.steps] == [("streaming", False, "timeout")]
    assert report.supports_streaming is None


async def test_non_openai_replies_report_an_unexpected_response(sdk_transport):
    def html(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(200, headers={"content-type": "text/html"}, text="<html>Model UI</html>")

    server = _Server()
    sdk_transport(html)
    probe = _probe(server)

    embedding = await probe.probe_embedding_model(_connection("custom"), model="embed")
    with pytest.raises(ModelConnectionProbeError) as exc_info:
        await probe.list_models(_connection("custom"))

    assert embedding.steps[0].category == "unexpected_response"
    assert exc_info.value.category == "unexpected_response"


async def test_a_wrong_base_path_is_reported_as_unreachable(sdk_transport):
    def missing(request: httpx2.Request) -> httpx2.Response:
        return httpx2.Response(404, json={"error": {"message": "not found"}})

    server = _Server()
    sdk_transport(missing)

    with pytest.raises(ModelConnectionProbeError) as exc_info:
        await _probe(server).list_models(_connection("ollama"))

    assert exc_info.value.category == "unreachable"


async def test_context_lookups_send_only_the_connection_key(sdk_transport, monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-process-openai")
    server = _Server()
    sdk_transport(server)
    seen: list[httpx2.Headers] = []

    def lookup(request: httpx2.Request) -> httpx2.Response:
        seen.append(request.headers)
        return server(request)

    probe = OpenAICompatibleConnectionProbe(
        credential_resolver=static_credential_resolver({"OPENAI_API_KEY": "sk-openai"}),
        http_transport=httpx2.MockTransport(lookup),
    )

    await probe.probe_chat_model(_connection("llamacpp"), model="qwen3:8b")

    assert seen and all("authorization" not in headers for headers in seen)


def test_connection_timeouts_cap_connecting_but_not_replies():
    local = connection_timeout(300.0)
    short = connection_timeout(5.0)

    assert local is not None and (local.connect, local.read) == (10.0, 300.0)
    assert short is not None and short.connect == 5.0
    assert connection_timeout(None) is None


def test_saved_probe_results_keep_findings_but_never_server_text() -> None:
    from animama.app.services.model_configuration_service import probe_result_summary

    report = {
        "model": "qwen3:8b",
        "supports_tools": True,
        "context_window_tokens": 16384,
        "notes": ["The server said: key sk-live-secret is invalid"],
        "steps": [
            {"name": "streaming", "ok": True, "category": None, "detail": None},
            {"name": "tool_calls", "ok": False, "category": "bad_request", "detail": "echoed key abc-SECRET"},
        ],
    }

    summary = probe_result_summary(report)

    assert summary == {
        "model": "qwen3:8b",
        "supports_tools": True,
        "context_window_tokens": 16384,
        "steps": [
            {"name": "streaming", "ok": True, "category": None},
            {"name": "tool_calls", "ok": False, "category": "bad_request"},
        ],
    }
    assert "SECRET" not in str(summary) and "sk-live" not in str(summary)
    assert probe_result_summary(None) is None
