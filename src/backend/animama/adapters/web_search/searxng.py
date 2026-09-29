"""SearXNG JSON search (the instance must enable ``json`` in ``search.formats``)."""

from __future__ import annotations

from typing import Any

import httpx

from animama.app.web_search import WEB_SEARCH_ERROR_BAD_RESPONSE, WEB_SEARCH_ERROR_FORMAT_DISABLED, WebSearchError
from animama.domain.web_search import WebSearchResult

from .http import get_json, plain_text


class SearxngSearchBackend:
    """Query ``{base_url}/search?format=json`` on an owner-configured SearXNG instance."""

    def __init__(
        self,
        *,
        base_url: str,
        timeout_seconds: float | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds
        self._transport = transport

    async def search(self, query: str, *, count: int) -> list[WebSearchResult]:
        payload = await get_json(
            f"{self._base_url}/search",
            params={"q": query, "format": "json"},
            headers={"Accept": "application/json"},
            timeout_seconds=self._timeout_seconds,
            transport=self._transport,
            status_categories={403: WEB_SEARCH_ERROR_FORMAT_DISABLED},
        )
        results = payload.get("results") if isinstance(payload, dict) else None
        if not isinstance(results, list):
            raise WebSearchError("SearXNG returned no results list", category=WEB_SEARCH_ERROR_BAD_RESPONSE)
        return [result for result in (_result(item) for item in results) if result is not None][:count]


def _result(item: Any) -> WebSearchResult | None:
    if not isinstance(item, dict):
        return None
    url = item.get("url")
    if not isinstance(url, str) or not url.startswith(("http://", "https://")):
        return None
    published = item.get("publishedDate")
    return WebSearchResult(
        title=plain_text(item.get("title")) or url,
        url=url,
        snippet=plain_text(item.get("content")),
        published=published if isinstance(published, str) and published else None,
    )


__all__ = ["SearxngSearchBackend"]
