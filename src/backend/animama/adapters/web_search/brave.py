"""Brave Search API web search with the owner's own subscription key."""

from __future__ import annotations

from typing import Any

import httpx

from animama.app.web_search import (
    WEB_SEARCH_ERROR_BAD_RESPONSE,
    WEB_SEARCH_ERROR_CREDENTIAL_MISSING,
    WEB_SEARCH_ERROR_CREDENTIAL_REJECTED,
    WebSearchError,
)
from animama.domain.web_search import WebSearchResult

from .http import get_json, plain_text

BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search"


class BraveSearchBackend:
    """Query the Brave Search API; results are used within the turn only."""

    def __init__(
        self,
        *,
        api_key: str | None,
        timeout_seconds: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        url: str = BRAVE_SEARCH_URL,
    ) -> None:
        self._api_key = (api_key or "").strip()
        self._timeout_seconds = timeout_seconds
        self._transport = transport
        self._url = url

    async def search(self, query: str, *, count: int) -> list[WebSearchResult]:
        if not self._api_key:
            raise WebSearchError("No Brave Search API key is configured", category=WEB_SEARCH_ERROR_CREDENTIAL_MISSING)
        payload = await get_json(
            self._url,
            params={"q": query, "count": max(1, min(count, 20))},
            headers={"Accept": "application/json", "X-Subscription-Token": self._api_key},
            timeout_seconds=self._timeout_seconds,
            transport=self._transport,
            # Brave answers an invalid subscription token with 422.
            status_categories={422: WEB_SEARCH_ERROR_CREDENTIAL_REJECTED},
        )
        web = payload.get("web") if isinstance(payload, dict) else None
        results = web.get("results") if isinstance(web, dict) else None
        if results is None and isinstance(payload, dict) and "web" not in payload:
            # A query with no web results omits the section.
            return []
        if not isinstance(results, list):
            raise WebSearchError("Brave returned no results list", category=WEB_SEARCH_ERROR_BAD_RESPONSE)
        return [result for result in (_result(item) for item in results) if result is not None][:count]


def _result(item: Any) -> WebSearchResult | None:
    if not isinstance(item, dict):
        return None
    url = item.get("url")
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return None
    snippets = [plain_text(item.get("description"))]
    extra = item.get("extra_snippets")
    if isinstance(extra, list):
        snippets.extend(plain_text(snippet) for snippet in extra[:2])
    age = item.get("page_age") or item.get("age")
    return WebSearchResult(
        title=plain_text(item.get("title")) or url,
        url=url,
        snippet=" ".join(snippet for snippet in snippets if snippet),
        published=age if isinstance(age, str) and age else None,
    )


__all__ = ["BRAVE_SEARCH_URL", "BraveSearchBackend"]
