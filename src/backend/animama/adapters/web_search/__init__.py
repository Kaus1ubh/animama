"""HTTP clients for application web search backends."""

from .brave import BRAVE_SEARCH_URL, BraveSearchBackend
from .searxng import SearxngSearchBackend

__all__ = ["BRAVE_SEARCH_URL", "BraveSearchBackend", "SearxngSearchBackend"]
