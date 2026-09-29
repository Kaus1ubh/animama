"""The ``web_search`` function tool offered to models without hosted search.

Results reach the model in full within the turn. Persisted history keeps only
the query and each result's title and URL: the Brave Search API permits only
transient storage of results, and one rule for both backends keeps replay simple.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import Any

from animama.logging import get_logger

from .port import WebSearchBackend, WebSearchError

WEB_SEARCH_TOOL_NAME = "web_search"
WEB_SEARCH_MAX_RESULTS = 5
_MAX_QUERY_CHARS = 400
_MAX_SNIPPET_CHARS = 600

_log = get_logger("app.web_search.tool")


def web_search_tool_spec() -> dict[str, Any]:
    """Return the OpenAI-compatible function tool definition."""

    return {
        "type": "function",
        "function": {
            "name": WEB_SEARCH_TOOL_NAME,
            "description": (
                "Search the web for current or factual information you do not know. Returns up to "
                f"{WEB_SEARCH_MAX_RESULTS} results with title, URL, snippet and date. Mention sources briefly."
            ),
            "strict": True,
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "description": "A short web search query."}},
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    }


class WebSearchToolService:
    """Execute ``web_search`` calls; failures become tool errors, never turn failures."""

    def __init__(self, backend: WebSearchBackend) -> None:
        self._backend = backend

    async def execute(self, arguments: Mapping[str, Any]) -> str:
        query = arguments.get("query")
        if not isinstance(query, str) or not query.strip():
            return _error("invalid_arguments", "Provide a non-empty query.")
        query = query.strip()[:_MAX_QUERY_CHARS]
        try:
            results = await self._backend.search(query, count=WEB_SEARCH_MAX_RESULTS)
        except WebSearchError as exc:
            _log.warning("Web search failed", category=exc.category)
            return _error(f"web_search_{exc.category}", "Web search is unavailable right now.", category=exc.category)
        return json.dumps(
            {
                "ok": True,
                "query": query,
                "results": [
                    {
                        "title": result.title,
                        "url": result.url,
                        "snippet": result.snippet[:_MAX_SNIPPET_CHARS],
                        **({"published": result.published} if result.published else {}),
                    }
                    for result in results[:WEB_SEARCH_MAX_RESULTS]
                ],
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )


def persisted_web_search_output(output: str) -> str:
    """Reduce a ``web_search`` result to the query and result titles and URLs for durable history."""

    try:
        payload = json.loads(output)
    except json.JSONDecodeError:
        return output
    if not isinstance(payload, dict) or payload.get("ok") is not True:
        return output
    results = payload.get("results")
    return json.dumps(
        {
            "ok": True,
            "query": payload.get("query"),
            "results": [
                {"title": item.get("title"), "url": item.get("url")} for item in results if isinstance(item, dict)
            ]
            if isinstance(results, list)
            else [],
            "note": "Snippets are not kept after the turn.",
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def _error(code: str, message: str, **extra: Any) -> str:
    return json.dumps({"ok": False, "code": code, "message": message, **extra}, separators=(",", ":"))


__all__ = [
    "WEB_SEARCH_MAX_RESULTS",
    "WEB_SEARCH_TOOL_NAME",
    "WebSearchToolService",
    "persisted_web_search_output",
    "web_search_tool_spec",
]
