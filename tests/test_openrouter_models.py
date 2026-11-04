"""OpenRouter's public model list: fetching, bounds, parsing, caching and the route."""

from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from animama.adapters.model_clients.openrouter_models import (
    OPENROUTER_MODELS_URL,
    OpenRouterModel,
    OpenRouterModelCatalog,
    OpenRouterModelListError,
)
from animama.domain.request_principal import RequestPrincipal
from animama.server.config import Settings
from animama.server.deps import get_current_principal
from animama.server.routers import model_configuration
from animama.server.routers.model_configuration import get_openrouter_model_catalog
from tests.local_http_client import local_client

ROUTE = "/v1/model-connection-presets/openrouter/models"


def _upstream_model(model_id: str, **overrides: Any) -> dict[str, Any]:
    model: dict[str, Any] = {
        "id": model_id,
        "canonical_slug": model_id,
        "name": f"Name of {model_id}",
        "created": 1_700_000_000,
        "description": "A model.",
        "context_length": 131072,
        "architecture": {"modality": "text->text", "input_modalities": ["text"], "output_modalities": ["text"]},
        "pricing": {"prompt": "0.000001", "completion": "0.000002"},
        "top_provider": {"context_length": 131072, "max_completion_tokens": 8192, "is_moderated": False},
        "supported_parameters": ["max_tokens", "temperature"],
        "future_field": {"nested": [1, 2, 3]},
    }
    model.update(overrides)
    return model


class _Upstream:
    def __init__(self, response: httpx.Response | None = None, *, delay: float = 0.0) -> None:
        self.response = response or httpx.Response(200, json={"data": [_upstream_model("a/b")]})
        self.delay = delay
        self.requests: list[httpx.Request] = []

    async def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        if self.delay:
            await asyncio.sleep(self.delay)
        return self.response


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


def _catalog(upstream: _Upstream, **kwargs: Any) -> OpenRouterModelCatalog:
    return OpenRouterModelCatalog(transport=httpx.MockTransport(upstream), **kwargs)


@pytest.mark.asyncio
async def test_lists_models_with_capabilities_from_supported_parameters() -> None:
    upstream = _Upstream(
        httpx.Response(
            200,
            json={
                "data": [
                    _upstream_model(
                        "openai/gpt-oss-120b",
                        name="OpenAI: gpt-oss-120b",
                        supported_parameters=["tools", "tool_choice", "structured_outputs", "response_format"],
                    ),
                    _upstream_model("acme/json-mode", supported_parameters=["response_format"]),
                    _upstream_model("acme/plain", name="", context_length=None, top_provider={"context_length": 4096}),
                    _upstream_model("acme/unknown-window", context_length="lots", top_provider=None),
                    _upstream_model("acme/no-params", supported_parameters=None),
                ]
            },
        )
    )

    models = await _catalog(upstream).list_models()

    assert models == (
        OpenRouterModel(
            id="openai/gpt-oss-120b",
            name="OpenAI: gpt-oss-120b",
            context_length=131072,
            supports_tools=True,
            supports_structured_outputs=True,
        ),
        OpenRouterModel(
            id="acme/json-mode",
            name="Name of acme/json-mode",
            context_length=131072,
            supports_tools=False,
            supports_structured_outputs=True,
        ),
        OpenRouterModel(
            id="acme/plain",
            name="acme/plain",
            context_length=4096,
            supports_tools=False,
            supports_structured_outputs=False,
        ),
        OpenRouterModel(
            id="acme/unknown-window",
            name="Name of acme/unknown-window",
            context_length=None,
            supports_tools=False,
            supports_structured_outputs=False,
        ),
        OpenRouterModel(
            id="acme/no-params",
            name="Name of acme/no-params",
            context_length=131072,
            supports_tools=False,
            supports_structured_outputs=False,
        ),
    )


@pytest.mark.asyncio
async def test_requests_only_the_fixed_public_url_without_a_key() -> None:
    upstream = _Upstream()

    await _catalog(upstream).list_models()

    assert [str(request.url) for request in upstream.requests] == [OPENROUTER_MODELS_URL]
    assert upstream.requests[0].method == "GET"
    assert "authorization" not in upstream.requests[0].headers


@pytest.mark.asyncio
async def test_skips_malformed_entries_and_duplicate_ids() -> None:
    upstream = _Upstream(
        httpx.Response(
            200,
            json={
                "data": [
                    "not an object",
                    {"name": "missing id"},
                    {"id": ""},
                    {"id": 42},
                    {"id": "x" * 257},
                    _upstream_model("ok/model", supported_parameters=["tools", 7, None]),
                    _upstream_model("ok/model", name="duplicate"),
                ]
            },
        )
    )

    models = await _catalog(upstream).list_models()

    assert [(model.id, model.name, model.supports_tools) for model in models] == [
        ("ok/model", "Name of ok/model", True)
    ]


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "response",
    [
        httpx.Response(500, json={"error": "upstream"}),
        httpx.Response(302, headers={"location": "https://example.test/models"}),
        httpx.Response(200, content=b"<html>not json</html>"),
        httpx.Response(200, json={"models": []}),
        httpx.Response(200, json=[1, 2, 3]),
    ],
    ids=["server-error", "redirect", "not-json", "no-data-list", "not-an-object"],
)
async def test_unusable_responses_raise_a_list_error(response: httpx.Response) -> None:
    upstream = _Upstream(response)

    with pytest.raises(OpenRouterModelListError):
        await _catalog(upstream).list_models()

    # Redirects are never followed.
    assert len(upstream.requests) == 1


@pytest.mark.asyncio
async def test_unreachable_upstream_raises_a_list_error() -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    catalog = OpenRouterModelCatalog(transport=httpx.MockTransport(refuse))

    with pytest.raises(OpenRouterModelListError):
        await catalog.list_models()


@pytest.mark.asyncio
async def test_oversized_responses_are_refused() -> None:
    body = json.dumps({"data": [_upstream_model(f"m/{index}") for index in range(50)]}).encode()
    upstream = _Upstream(httpx.Response(200, content=body))

    with pytest.raises(OpenRouterModelListError, match="too large"):
        await _catalog(upstream, max_bytes=len(body) - 1).list_models()
    assert len(await _catalog(upstream, max_bytes=len(body)).list_models()) == 50


@pytest.mark.asyncio
async def test_slow_upstream_times_out() -> None:
    upstream = _Upstream(delay=1.0)

    with pytest.raises(OpenRouterModelListError, match="timed out"):
        await _catalog(upstream, timeout_seconds=0.05).list_models()


@pytest.mark.asyncio
async def test_successful_lists_are_cached_briefly_and_failures_are_not() -> None:
    clock = _Clock()
    upstream = _Upstream(httpx.Response(503))
    catalog = _catalog(upstream, cache_ttl_seconds=600.0, clock=clock)

    with pytest.raises(OpenRouterModelListError):
        await catalog.list_models()
    upstream.response = httpx.Response(200, json={"data": [_upstream_model("a/b")]})
    first = await catalog.list_models()
    clock.now += 599.0
    cached = await catalog.list_models()
    assert len(upstream.requests) == 2
    assert cached == first

    upstream.response = httpx.Response(200, json={"data": [_upstream_model("c/d")]})
    clock.now += 2.0
    refreshed = await catalog.list_models()

    assert len(upstream.requests) == 3
    assert [model.id for model in refreshed] == ["c/d"]


@pytest.mark.asyncio
async def test_concurrent_requests_share_one_upstream_fetch() -> None:
    upstream = _Upstream(delay=0.05)
    catalog = _catalog(upstream)

    results = await asyncio.gather(*(catalog.list_models() for _ in range(5)))

    assert len(upstream.requests) == 1
    assert all(result == results[0] for result in results)


class _FakeCatalog:
    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls = 0

    async def list_models(self) -> tuple[OpenRouterModel, ...]:
        self.calls += 1
        if self.fail:
            raise OpenRouterModelListError("OpenRouter answered HTTP 503")
        return (
            OpenRouterModel(
                id="openai/gpt-oss-120b",
                name="OpenAI: gpt-oss-120b",
                context_length=131072,
                supports_tools=True,
                supports_structured_outputs=False,
            ),
        )


def _app(tmp_path, catalog: _FakeCatalog | None = None) -> FastAPI:
    app = FastAPI()
    app.state.runtime_settings = Settings(
        animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data"
    )
    app.state.local_runtime_paths = SimpleNamespace(included_sources=(), operations_root=tmp_path / "operations")
    app.include_router(model_configuration.router)

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id="owner-1")

    app.dependency_overrides[get_current_principal] = principal
    if catalog is not None:
        app.dependency_overrides[get_openrouter_model_catalog] = lambda: catalog
    return app


@pytest.mark.asyncio
async def test_route_returns_the_model_list(tmp_path) -> None:
    catalog = _FakeCatalog()
    async with local_client(_app(tmp_path, catalog)) as client:
        response = await client.get(ROUTE)

    assert response.status_code == 200
    assert response.json() == {
        "models": [
            {
                "id": "openai/gpt-oss-120b",
                "name": "OpenAI: gpt-oss-120b",
                "context_length": 131072,
                "supports_tools": True,
                "supports_structured_outputs": False,
            }
        ]
    }


@pytest.mark.asyncio
async def test_route_maps_upstream_failures_to_bad_gateway(tmp_path) -> None:
    async with local_client(_app(tmp_path, _FakeCatalog(fail=True))) as client:
        response = await client.get(ROUTE)

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "openrouter_models_unavailable"


@pytest.mark.asyncio
async def test_route_keeps_one_catalog_per_application(tmp_path) -> None:
    app = _app(tmp_path)
    request = SimpleNamespace(app=app)

    first = get_openrouter_model_catalog(request)  # type: ignore[arg-type]

    assert isinstance(first, OpenRouterModelCatalog)
    assert get_openrouter_model_catalog(request) is first  # type: ignore[arg-type]
