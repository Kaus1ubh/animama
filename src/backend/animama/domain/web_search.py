"""Application web search: the installation's search backend and its results."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

WEB_SEARCH_BACKEND_SEARXNG = "searxng"
WEB_SEARCH_BACKEND_BRAVE = "brave"
WEB_SEARCH_BACKENDS = frozenset({WEB_SEARCH_BACKEND_SEARXNG, WEB_SEARCH_BACKEND_BRAVE})


@dataclass(frozen=True, slots=True)
class WebSearchSettings:
    """The installation's search backend; never holds a key value.

    SearXNG uses ``base_url`` (and usually no key). Brave uses its fixed API
    endpoint and the key in the environment variable ``credential_env`` names.
    """

    backend: str
    base_url: str | None = None
    credential_env: str | None = None
    timeout_seconds: float | None = None
    updated_at: datetime | None = None


@dataclass(frozen=True, slots=True)
class WebSearchResult:
    """One normalized search result."""

    title: str
    url: str
    snippet: str
    published: str | None = None


__all__ = [
    "WEB_SEARCH_BACKENDS",
    "WEB_SEARCH_BACKEND_BRAVE",
    "WEB_SEARCH_BACKEND_SEARXNG",
    "WebSearchResult",
    "WebSearchSettings",
]
