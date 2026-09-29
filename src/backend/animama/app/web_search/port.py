"""Search backend port and its provider-neutral failure categories."""

from __future__ import annotations

from typing import Protocol

from animama.domain.web_search import WebSearchResult

WEB_SEARCH_ERROR_UNREACHABLE = "unreachable"
WEB_SEARCH_ERROR_CREDENTIAL_MISSING = "credential_missing"
WEB_SEARCH_ERROR_CREDENTIAL_REJECTED = "credential_rejected"
WEB_SEARCH_ERROR_RATE_LIMITED = "rate_limited"
WEB_SEARCH_ERROR_TIMEOUT = "timeout"
WEB_SEARCH_ERROR_FORMAT_DISABLED = "json_format_disabled"
"""SearXNG answers 403 when its settings do not enable the JSON output format."""
WEB_SEARCH_ERROR_BAD_RESPONSE = "bad_response"


class WebSearchError(RuntimeError):
    """A search failure with a category; the message never includes a key or response body."""

    def __init__(self, message: str, *, category: str) -> None:
        super().__init__(message)
        self.category = category


class WebSearchBackend(Protocol):
    """Run one query against the configured backend."""

    async def search(self, query: str, *, count: int) -> list[WebSearchResult]: ...


__all__ = [
    "WEB_SEARCH_ERROR_BAD_RESPONSE",
    "WEB_SEARCH_ERROR_CREDENTIAL_MISSING",
    "WEB_SEARCH_ERROR_CREDENTIAL_REJECTED",
    "WEB_SEARCH_ERROR_FORMAT_DISABLED",
    "WEB_SEARCH_ERROR_RATE_LIMITED",
    "WEB_SEARCH_ERROR_TIMEOUT",
    "WEB_SEARCH_ERROR_UNREACHABLE",
    "WebSearchBackend",
    "WebSearchError",
]
