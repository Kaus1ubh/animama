"""Application web search backends, tool and settings validation (configurable models Plan B, R11)."""

from __future__ import annotations

import json
from collections.abc import Callable

import httpx
import pytest

from animama.adapters.web_search import BRAVE_SEARCH_URL, BraveSearchBackend, SearxngSearchBackend
from animama.app.model_clients.credential_store import (
    RuntimeCredentialStore,
    is_deliverable_credential_env,
    is_process_credential_env,
)
from animama.app.model_clients.credentials import (
    WEB_SEARCH_MANAGED_CREDENTIAL_ENV,
    is_allowed_credential_env,
    is_allowed_web_search_credential_env,
)
from animama.app.services.web_search_settings_service import (
    WebSearchSettingsDraft,
    WebSearchSettingsError,
    validate_web_search_settings,
)
from animama.app.web_search import WebSearchError, WebSearchToolService, persisted_web_search_output
from animama.domain.web_search import WebSearchResult, WebSearchSettings
from animama.server.web_search import web_search_credential_state


def _transport(handler: Callable[[httpx.Request], httpx.Response], seen: list[httpx.Request]) -> httpx.MockTransport:
    def respond(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    return httpx.MockTransport(respond)


@pytest.mark.asyncio
async def test_searxng_normalizes_json_results() -> None:
    seen: list[httpx.Request] = []
    payload = {
        "results": [
            {
                "title": "Picnic <b>tips</b>",
                "url": "https://example.com/a",
                "content": "Bring &amp; share",
                "publishedDate": "2026-09-01",
            },
            {"title": "Not a web page", "url": "javascript:alert(1)", "content": "skip"},
            {"title": "", "url": "https://example.com/b", "content": ""},
        ]
    }
    backend = SearxngSearchBackend(
        base_url="http://127.0.0.1:8888/", transport=_transport(lambda _r: httpx.Response(200, json=payload), seen)
    )

    results = await backend.search("picnic", count=5)

    assert results == [
        WebSearchResult(
            title="Picnic tips", url="https://example.com/a", snippet="Bring & share", published="2026-09-01"
        ),
        WebSearchResult(title="https://example.com/b", url="https://example.com/b", snippet=""),
    ]
    # Exactly one request, to the configured instance only.
    assert [str(request.url) for request in seen] == ["http://127.0.0.1:8888/search?q=picnic&format=json"]
    assert "authorization" not in seen[0].headers


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("response", "category"),
    [
        (httpx.Response(403, text="Forbidden"), "json_format_disabled"),
        (httpx.Response(429), "rate_limited"),
        (httpx.Response(500), "bad_response"),
        (httpx.Response(200, text="<html>not json</html>"), "bad_response"),
        (httpx.Response(200, json={"answers": []}), "bad_response"),
    ],
)
async def test_searxng_failures_have_categories(response: httpx.Response, category: str) -> None:
    backend = SearxngSearchBackend(base_url="http://127.0.0.1:8888", transport=_transport(lambda _r: response, []))

    with pytest.raises(WebSearchError) as raised:
        await backend.search("q", count=5)

    assert raised.value.category == category


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("error", "category"),
    [(httpx.ConnectError("refused"), "unreachable"), (httpx.ReadTimeout("slow"), "timeout")],
)
async def test_searxng_transport_failures_have_categories(error: Exception, category: str) -> None:
    def fail(_request: httpx.Request) -> httpx.Response:
        raise error

    backend = SearxngSearchBackend(base_url="http://127.0.0.1:8888", transport=httpx.MockTransport(fail))

    with pytest.raises(WebSearchError) as raised:
        await backend.search("q", count=5)

    assert raised.value.category == category


@pytest.mark.asyncio
async def test_brave_sends_the_subscription_key_and_normalizes_results() -> None:
    seen: list[httpx.Request] = []
    payload = {
        "web": {
            "results": [
                {
                    "title": "Weather <strong>today</strong>",
                    "url": "https://weather.example/today",
                    "description": "Sunny, <strong>22°C</strong>.",
                    "extra_snippets": ["Light wind.", "UV index 5.", "ignored"],
                    "page_age": "2026-09-28T08:00:00",
                }
            ]
        }
    }
    backend = BraveSearchBackend(
        api_key="brave-test-key", transport=_transport(lambda _r: httpx.Response(200, json=payload), seen)
    )

    results = await backend.search("weather", count=5)

    assert results == [
        WebSearchResult(
            title="Weather today",
            url="https://weather.example/today",
            snippet="Sunny, 22°C. Light wind. UV index 5.",
            published="2026-09-28T08:00:00",
        )
    ]
    assert len(seen) == 1
    request = seen[0]
    assert request.url.host == "api.search.brave.com"
    assert str(request.url).startswith(BRAVE_SEARCH_URL)
    assert request.url.params["q"] == "weather" and request.url.params["count"] == "5"
    assert request.headers["x-subscription-token"] == "brave-test-key"


@pytest.mark.asyncio
async def test_brave_without_a_key_fails_before_any_request() -> None:
    seen: list[httpx.Request] = []
    backend = BraveSearchBackend(api_key=None, transport=_transport(lambda _r: httpx.Response(200, json={}), seen))

    with pytest.raises(WebSearchError) as raised:
        await backend.search("q", count=5)

    assert raised.value.category == "credential_missing"
    assert seen == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("status", "category"), [(401, "credential_rejected"), (422, "credential_rejected"), (429, "rate_limited")]
)
async def test_brave_failures_have_categories_without_the_body(status: int, category: str) -> None:
    backend = BraveSearchBackend(
        api_key="brave-test-key",
        transport=_transport(lambda _r: httpx.Response(status, text="secret upstream detail"), []),
    )

    with pytest.raises(WebSearchError) as raised:
        await backend.search("q", count=5)

    assert raised.value.category == category
    assert "secret upstream detail" not in str(raised.value)


@pytest.mark.asyncio
async def test_brave_without_web_results_returns_nothing() -> None:
    backend = BraveSearchBackend(
        api_key="k", transport=_transport(lambda _r: httpx.Response(200, json={"query": {"original": "q"}}), [])
    )

    assert await backend.search("q", count=5) == []


class _Backend:
    def __init__(self, results: list[WebSearchResult] | None = None, error: WebSearchError | None = None) -> None:
        self.results = results or []
        self.error = error
        self.queries: list[tuple[str, int]] = []

    async def search(self, query: str, *, count: int) -> list[WebSearchResult]:
        self.queries.append((query, count))
        if self.error is not None:
            raise self.error
        return self.results


@pytest.mark.asyncio
async def test_tool_returns_results_and_caps_them() -> None:
    backend = _Backend([WebSearchResult(title=f"T{i}", url=f"https://e.com/{i}", snippet="s" * 900) for i in range(8)])

    output = json.loads(await WebSearchToolService(backend).execute({"query": "  news  "}))

    assert backend.queries == [("news", 5)]
    assert output["ok"] is True and output["query"] == "news"
    assert len(output["results"]) == 5
    assert len(output["results"][0]["snippet"]) == 600


@pytest.mark.asyncio
async def test_tool_failures_are_tool_errors() -> None:
    blank = json.loads(await WebSearchToolService(_Backend()).execute({"query": " "}))
    failed = json.loads(
        await WebSearchToolService(_Backend(error=WebSearchError("x", category="unreachable"))).execute({"query": "q"})
    )

    assert blank["ok"] is False and blank["code"] == "invalid_arguments"
    assert failed == {
        "ok": False,
        "code": "web_search_unreachable",
        "message": "Web search is unavailable right now.",
        "category": "unreachable",
    }


def test_persisted_output_keeps_the_query_titles_and_urls_only() -> None:
    output = json.dumps(
        {
            "ok": True,
            "query": "q",
            "results": [{"title": "T", "url": "https://e.com", "snippet": "S", "published": "d"}],
        }
    )

    persisted = json.loads(persisted_web_search_output(output))

    assert persisted["results"] == [{"title": "T", "url": "https://e.com"}]
    assert "S" not in json.dumps(persisted["results"])
    assert persisted_web_search_output('{"ok":false,"code":"x"}') == '{"ok":false,"code":"x"}'


@pytest.mark.parametrize(
    ("draft", "code"),
    [
        (WebSearchSettingsDraft(backend="google"), "invalid_backend"),
        (WebSearchSettingsDraft(backend="searxng"), "invalid_base_url"),
        (WebSearchSettingsDraft(backend="searxng", base_url="ftp://host"), "invalid_base_url"),
        (WebSearchSettingsDraft(backend="brave"), "credential_required"),
        (
            WebSearchSettingsDraft(backend="brave", credential_mode="env", credential_env="DATABASE_URL"),
            "invalid_credential_env",
        ),
        (
            WebSearchSettingsDraft(backend="brave", credential_mode="managed", timeout_seconds=500),
            "invalid_timeout",
        ),
        (
            WebSearchSettingsDraft(backend="searxng", base_url="http://127.0.0.1:8888", credential_mode="managed"),
            "credential_not_supported",
        ),
    ],
)
def test_invalid_settings_are_rejected(draft: WebSearchSettingsDraft, code: str) -> None:
    with pytest.raises(WebSearchSettingsError) as raised:
        validate_web_search_settings(draft)

    assert raised.value.code == code


def test_valid_settings_are_normalized() -> None:
    searxng = validate_web_search_settings(WebSearchSettingsDraft(backend="SearXNG", base_url="http://127.0.0.1:8888/"))
    brave = validate_web_search_settings(WebSearchSettingsDraft(backend="brave", credential_mode="managed"))
    brave_env = validate_web_search_settings(
        WebSearchSettingsDraft(backend="brave", credential_mode="env", credential_env="BRAVE_SEARCH_API_KEY")
    )

    assert (searxng.backend, searxng.base_url, searxng.credential_env) == ("searxng", "http://127.0.0.1:8888", None)
    assert (brave.base_url, brave.credential_env) == (None, WEB_SEARCH_MANAGED_CREDENTIAL_ENV)
    assert brave_env.credential_env == "BRAVE_SEARCH_API_KEY"


def test_the_search_key_is_readable_only_by_web_search() -> None:
    assert is_allowed_web_search_credential_env(WEB_SEARCH_MANAGED_CREDENTIAL_ENV)
    assert is_allowed_web_search_credential_env("BRAVE_SEARCH_API_KEY")
    assert not is_allowed_web_search_credential_env("OPENAI_API_KEY")
    # A model connection must not send the search key to its endpoint.
    assert not is_allowed_credential_env(WEB_SEARCH_MANAGED_CREDENTIAL_ENV)


def test_search_keys_load_into_the_runtime_store_and_apply_live() -> None:
    # Startup loads both names; the desktop delivers the managed one without a restart.
    assert is_process_credential_env(WEB_SEARCH_MANAGED_CREDENTIAL_ENV)
    assert is_process_credential_env("BRAVE_SEARCH_API_KEY")
    assert is_deliverable_credential_env(WEB_SEARCH_MANAGED_CREDENTIAL_ENV)
    assert not is_deliverable_credential_env("BRAVE_SEARCH_API_KEY")

    settings = WebSearchSettings(backend="brave", credential_env=WEB_SEARCH_MANAGED_CREDENTIAL_ENV)
    store = RuntimeCredentialStore()
    assert web_search_credential_state(settings, store) == "missing"
    store.replace({WEB_SEARCH_MANAGED_CREDENTIAL_ENV: "fake-brave-key"}, generation=1)
    assert web_search_credential_state(settings, store) == "configured"


@pytest.mark.asyncio
async def test_a_malformed_configured_url_is_a_categorized_failure() -> None:
    backend = SearxngSearchBackend(base_url="http://host/pa\x7fth")

    output = json.loads(await WebSearchToolService(backend).execute({"query": "q"}))

    assert output["ok"] is False and output["category"] == "unreachable"
