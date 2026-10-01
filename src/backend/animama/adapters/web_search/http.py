"""Shared HTTP handling for search backends: timeouts and error categories."""

from __future__ import annotations

import html
import re
from typing import Any

import httpx

from animama.app.web_search import (
    WEB_SEARCH_ERROR_BAD_RESPONSE,
    WEB_SEARCH_ERROR_CREDENTIAL_REJECTED,
    WEB_SEARCH_ERROR_RATE_LIMITED,
    WEB_SEARCH_ERROR_TIMEOUT,
    WEB_SEARCH_ERROR_UNREACHABLE,
    WebSearchError,
)

DEFAULT_TIMEOUT_SECONDS = 15.0
_TAG = re.compile(r"<[^>]+>")


def timeout(seconds: float | None) -> httpx.Timeout:
    total = seconds if seconds and seconds > 0 else DEFAULT_TIMEOUT_SECONDS
    return httpx.Timeout(total, connect=min(total, 10.0))


async def get_json(
    url: str,
    *,
    params: dict[str, Any],
    headers: dict[str, str],
    timeout_seconds: float | None,
    transport: httpx.AsyncBaseTransport | None,
    status_categories: dict[int, str] | None = None,
) -> Any:
    """GET a JSON document, mapping failures to categories without echoing the body."""

    try:
        async with httpx.AsyncClient(timeout=timeout(timeout_seconds), transport=transport) as client:
            response = await client.get(url, params=params, headers=headers)
    except httpx.TimeoutException as exc:
        raise WebSearchError("The search backend timed out", category=WEB_SEARCH_ERROR_TIMEOUT) from exc
    except (httpx.HTTPError, httpx.InvalidURL) as exc:
        # InvalidURL (a malformed configured URL) is not an HTTPError.
        raise WebSearchError("The search backend is unreachable", category=WEB_SEARCH_ERROR_UNREACHABLE) from exc
    if response.status_code >= 400:
        categories = {401: WEB_SEARCH_ERROR_CREDENTIAL_REJECTED, 403: WEB_SEARCH_ERROR_CREDENTIAL_REJECTED}
        categories[429] = WEB_SEARCH_ERROR_RATE_LIMITED
        categories.update(status_categories or {})
        category = categories.get(response.status_code, WEB_SEARCH_ERROR_BAD_RESPONSE)
        raise WebSearchError(f"The search backend answered HTTP {response.status_code}", category=category)
    try:
        return response.json()
    except ValueError as exc:
        raise WebSearchError("The search backend did not return JSON", category=WEB_SEARCH_ERROR_BAD_RESPONSE) from exc


def plain_text(value: Any) -> str:
    """Return result text without markup (Brave marks matches with <strong>)."""

    return html.unescape(_TAG.sub("", value)).strip() if isinstance(value, str) else ""


__all__ = ["DEFAULT_TIMEOUT_SECONDS", "get_json", "plain_text", "timeout"]
