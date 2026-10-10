"""Anthropic Models API probe: capability mapping, key handling and failures.

A fake Models client returns the SDK's own ``ModelInfo`` shape, so no request
reaches Anthropic.
"""

from __future__ import annotations

from typing import Any, cast

import anthropic
import httpx2
import pytest
from anthropic.types import ModelInfo

from animama.adapters.model_clients.anthropic_messages.probe import (
    AnthropicConnectionProbe,
    anthropic_model_probe_report,
)
from animama.adapters.model_clients.anthropic_messages.support import ANTHROPIC_API_BASE_URL
from animama.app.model_clients.credentials import (
    builtin_anthropic_connection,
    builtin_openai_connection,
    static_credential_resolver,
)
from animama.app.model_clients.probe import ModelConnectionProbeError

SENTINEL_KEY = "sk-ant-SENTINEL-" + "x" * 24


def _supported(value: bool) -> dict[str, bool]:
    return {"supported": value}


def _model_info(
    *,
    model: str = "claude-haiku-5-5",
    capabilities: dict[str, Any] | None = None,
    with_capabilities: bool = True,
    max_input_tokens: int | None = 1_000_000,
    max_tokens: int | None = 128_000,
) -> ModelInfo:
    payload: dict[str, Any] = {
        "id": model,
        "type": "model",
        "display_name": "Claude Haiku 5.5",
        "created_at": "2026-09-01T00:00:00Z",
        "lifecycle": "active",
        "max_input_tokens": max_input_tokens,
        "max_tokens": max_tokens,
    }
    if with_capabilities:
        payload["capabilities"] = _capabilities(**(capabilities or {}))
    return ModelInfo.model_validate(payload)


def _capabilities(
    *,
    efforts: dict[str, bool] | None = None,
    effort_supported: bool = True,
    thinking_disabled: bool = True,
    structured_outputs: bool = True,
    web_search: bool = True,
) -> dict[str, Any]:
    levels = {"low": True, "medium": True, "high": True, "xhigh": True, "max": True, **(efforts or {})}
    return {
        "batch": _supported(True),
        "citations": _supported(True),
        "code_execution": _supported(True),
        "context_management": {"supported": True},
        "effort": {"supported": effort_supported, **{name: _supported(value) for name, value in levels.items()}},
        "image_input": _supported(True),
        "pdf_input": _supported(True),
        "server_tools": {
            "supported": web_search,
            "web_search": _supported(web_search),
            "code_execution": _supported(True),
        },
        "structured_outputs": _supported(structured_outputs),
        "thinking": {
            "supported": True,
            "types": {
                "adaptive": _supported(True),
                "disabled": _supported(thinking_disabled),
                "enabled": _supported(False),
            },
        },
    }


class _FakeModels:
    def __init__(self, *, info: ModelInfo | None = None, error: BaseException | None = None) -> None:
        self.info = info
        self.error = error
        self.retrieved: list[str] = []

    async def retrieve(self, model: str) -> ModelInfo:
        self.retrieved.append(model)
        if self.error is not None:
            raise self.error
        assert self.info is not None
        return self.info

    def list(self, **_kwargs: Any) -> Any:
        error = self.error

        class _Page:
            def __aiter__(self) -> Any:
                return self._items()

            async def _items(self) -> Any:
                if error is not None:
                    raise error
                for model_id in ("claude-sonnet-5-5", "claude-haiku-5-5", "claude-haiku-5-5"):
                    yield _model_info(model=model_id)

        return _Page()


class _FakeClient:
    def __init__(self, models: _FakeModels) -> None:
        self.models = models
        self.closed = False

    async def close(self) -> None:
        self.closed = True


class _ClientFactory:
    def __init__(self, models: _FakeModels) -> None:
        self.models = models
        self.calls: list[dict[str, Any]] = []
        self.clients: list[_FakeClient] = []

    def __call__(self, **kwargs: Any) -> _FakeClient:
        self.calls.append(kwargs)
        client = _FakeClient(self.models)
        self.clients.append(client)
        return client


def _probe(factory: _ClientFactory, values: dict[str, str] | None = None) -> AnthropicConnectionProbe:
    return AnthropicConnectionProbe(
        credential_resolver=static_credential_resolver(
            {"ANTHROPIC_API_KEY": SENTINEL_KEY} if values is None else values
        ),
        client_factory=factory,
    )


def _status_error(cls: type[anthropic.APIStatusError], status: int) -> anthropic.APIStatusError:
    request = httpx2.Request("GET", f"{ANTHROPIC_API_BASE_URL}/v1/models/claude-x")
    response = httpx2.Response(status, request=request, json={"error": {"message": f"echo {SENTINEL_KEY}"}})
    return cls(f"echo {SENTINEL_KEY}", response=response, body=None)


def test_models_api_capabilities_map_into_the_probe_report() -> None:
    report = anthropic_model_probe_report("claude-haiku-5-5", _model_info())

    assert [(step.name, step.ok) for step in report.steps] == [("available", True)]
    assert report.supports_streaming is True
    assert report.supports_tools is True
    assert report.structured_output_transport == "json_schema"
    assert report.tools_with_structured_output is True
    assert report.context_window_tokens == 1_000_000
    assert report.max_output_tokens == 128_000
    assert report.supported_reasoning_efforts == ("none", "low", "medium", "high", "xhigh", "max")
    assert report.native_tool_support == ("web_search",)


def test_none_is_offered_only_when_thinking_can_be_disabled() -> None:
    report = anthropic_model_probe_report(
        "claude-x",
        _model_info(capabilities={"thinking_disabled": False, "efforts": {"xhigh": False, "max": False}}),
    )

    assert report.supported_reasoning_efforts == ("low", "medium", "high")


def test_models_without_effort_structured_outputs_or_web_search_report_them_absent() -> None:
    report = anthropic_model_probe_report(
        "claude-x",
        _model_info(capabilities={"effort_supported": False, "structured_outputs": False, "web_search": False}),
    )

    assert report.supported_reasoning_efforts is None
    assert report.structured_output_transport is None
    assert report.tools_with_structured_output is False
    assert report.native_tool_support is None


def test_a_model_without_reported_capabilities_keeps_only_its_limits() -> None:
    report = anthropic_model_probe_report("claude-x", _model_info(with_capabilities=False, max_tokens=None))

    assert report.context_window_tokens == 1_000_000
    assert report.max_output_tokens is None
    assert report.structured_output_transport is None
    assert report.supported_reasoning_efforts is None
    assert report.native_tool_support is None


@pytest.mark.asyncio
async def test_the_probe_retrieves_the_model_with_only_the_anthropic_key() -> None:
    factory = _ClientFactory(_FakeModels(info=_model_info()))

    report = await _probe(factory, {"ANTHROPIC_API_KEY": SENTINEL_KEY, "OPENAI_API_KEY": "sk-openai"}).probe_chat_model(
        builtin_anthropic_connection(), model="claude-haiku-5-5"
    )

    assert report.max_output_tokens == 128_000
    assert factory.models.retrieved == ["claude-haiku-5-5"]
    assert [call["api_key"] for call in factory.calls] == [SENTINEL_KEY]
    assert all(client.closed for client in factory.clients)


@pytest.mark.asyncio
async def test_a_missing_key_is_a_configuration_error_before_any_request() -> None:
    factory = _ClientFactory(_FakeModels(info=_model_info()))

    with pytest.raises(ModelConnectionProbeError) as caught:
        await _probe(factory, {"OPENAI_API_KEY": "sk-openai"}).probe_chat_model(
            builtin_anthropic_connection(), model="claude-haiku-5-5"
        )

    assert caught.value.category == "credential_missing"
    assert factory.calls == []


@pytest.mark.asyncio
async def test_the_probe_serves_only_the_anthropic_connection() -> None:
    factory = _ClientFactory(_FakeModels(info=_model_info()))

    with pytest.raises(ModelConnectionProbeError):
        await _probe(factory).probe_chat_model(builtin_openai_connection(), model="gpt-6-luna")
    with pytest.raises(ModelConnectionProbeError):
        await _probe(factory).probe_embedding_model(builtin_anthropic_connection(), model="voyage")

    assert factory.calls == []


@pytest.mark.parametrize(
    ("error", "category"),
    [
        (_status_error(anthropic.NotFoundError, 404), "model_not_found"),
        (_status_error(anthropic.AuthenticationError, 401), "credential_rejected"),
        (_status_error(anthropic.PermissionDeniedError, 403), "credential_rejected"),
        (_status_error(anthropic.RateLimitError, 429), "rate_limited"),
        (_status_error(anthropic.InternalServerError, 500), "server_error"),
        (anthropic.APITimeoutError(request=httpx2.Request("GET", ANTHROPIC_API_BASE_URL)), "timeout"),
        (anthropic.APIConnectionError(request=httpx2.Request("GET", ANTHROPIC_API_BASE_URL)), "unreachable"),
    ],
)
@pytest.mark.asyncio
async def test_models_api_failures_become_a_failed_step_without_upstream_text(
    error: BaseException, category: str
) -> None:
    factory = _ClientFactory(_FakeModels(error=error))

    report = await _probe(factory).probe_chat_model(builtin_anthropic_connection(), model="claude-x")

    (step,) = report.steps
    assert (step.name, step.ok, step.category) == ("available", False, category)
    assert SENTINEL_KEY not in str(report)
    assert report.supports_streaming is None
    assert report.context_window_tokens is None


@pytest.mark.asyncio
async def test_model_listing_returns_sorted_unique_ids_and_reports_failures() -> None:
    listed = await _probe(_ClientFactory(_FakeModels())).list_models(builtin_anthropic_connection())
    failing = _ClientFactory(_FakeModels(error=_status_error(anthropic.AuthenticationError, 401)))

    with pytest.raises(ModelConnectionProbeError) as caught:
        await _probe(failing).list_models(builtin_anthropic_connection())

    assert listed == ["claude-haiku-5-5", "claude-sonnet-5-5"]
    assert caught.value.category == "credential_rejected"
    assert SENTINEL_KEY not in str(caught.value)


def test_the_default_client_is_pinned_to_the_anthropic_api(monkeypatch: pytest.MonkeyPatch) -> None:
    from animama.adapters.model_clients.anthropic_messages.support import anthropic_sdk_client

    # Custom Anthropic base URLs and gateways are out of scope; the SDK's
    # environment fallback must never redirect the key.
    monkeypatch.setenv("ANTHROPIC_BASE_URL", "https://gateway.example")
    client = anthropic_sdk_client(api_key=SENTINEL_KEY, timeout=5.0)

    assert str(client.base_url).rstrip("/") == ANTHROPIC_API_BASE_URL
    assert client.max_retries == 0


def test_saved_probe_results_keep_the_models_api_limits_efforts_and_tools() -> None:
    from animama.app.services.model_configuration_service import probe_result_summary

    summary = probe_result_summary(
        {
            "model": "claude-sonnet-5-5",
            "context_window_tokens": 1_000_000,
            "max_output_tokens": 64_000,
            "supported_reasoning_efforts": ["none", "low", 3],
            "native_tool_support": ["web_search"],
            "notes": [f"echo {SENTINEL_KEY}"],
            "steps": [{"name": "available", "ok": True, "detail": f"echo {SENTINEL_KEY}"}],
        }
    )

    assert summary == {
        "model": "claude-sonnet-5-5",
        "context_window_tokens": 1_000_000,
        "max_output_tokens": 64_000,
        "supported_reasoning_efforts": ["none", "low"],
        "native_tool_support": ["web_search"],
        "steps": [{"name": "available", "ok": True, "category": None}],
    }
    assert SENTINEL_KEY not in str(summary)


@pytest.mark.asyncio
async def test_a_reply_that_is_not_a_model_shape_becomes_a_failed_step() -> None:
    factory = _ClientFactory(_FakeModels(info=cast(ModelInfo, object())))

    report = await _probe(factory).probe_chat_model(builtin_anthropic_connection(), model="claude-x")

    (step,) = report.steps
    assert (step.name, step.ok, step.category) == ("available", False, "unexpected_response")
