"""Application web search for models without hosted search (configurable models Plan B, R11)."""

from .port import (
    WEB_SEARCH_ERROR_BAD_RESPONSE,
    WEB_SEARCH_ERROR_CREDENTIAL_MISSING,
    WEB_SEARCH_ERROR_CREDENTIAL_REJECTED,
    WEB_SEARCH_ERROR_FORMAT_DISABLED,
    WEB_SEARCH_ERROR_RATE_LIMITED,
    WEB_SEARCH_ERROR_TIMEOUT,
    WEB_SEARCH_ERROR_UNREACHABLE,
    WebSearchBackend,
    WebSearchError,
)
from .tool import (
    WEB_SEARCH_MAX_RESULTS,
    WEB_SEARCH_TOOL_NAME,
    WebSearchToolService,
    persisted_web_search_output,
    web_search_tool_spec,
)

__all__ = [
    "WEB_SEARCH_ERROR_BAD_RESPONSE",
    "WEB_SEARCH_ERROR_CREDENTIAL_MISSING",
    "WEB_SEARCH_ERROR_CREDENTIAL_REJECTED",
    "WEB_SEARCH_ERROR_FORMAT_DISABLED",
    "WEB_SEARCH_ERROR_RATE_LIMITED",
    "WEB_SEARCH_ERROR_TIMEOUT",
    "WEB_SEARCH_ERROR_UNREACHABLE",
    "WEB_SEARCH_MAX_RESULTS",
    "WEB_SEARCH_TOOL_NAME",
    "WebSearchBackend",
    "WebSearchError",
    "WebSearchToolService",
    "persisted_web_search_output",
    "web_search_tool_spec",
]
