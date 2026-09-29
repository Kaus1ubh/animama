"""Application web search wiring for the server compositions.

Whether the owner may configure web search is a composition input: only the
local composition sets ``application_web_search_enabled``. Any other
composition offers no application search tool and mounts no settings routes.
"""

from __future__ import annotations

import os
from collections.abc import Mapping
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.web_search_settings_repo import SQLAlchemyWebSearchSettingsRepository
from animama.adapters.web_search import BraveSearchBackend, SearxngSearchBackend
from animama.app.model_clients.credentials import (
    CREDENTIAL_CONFIGURED,
    CREDENTIAL_MISSING,
    CREDENTIAL_NOT_REQUIRED,
    is_allowed_web_search_credential_env,
)
from animama.app.web_search import WebSearchBackend, WebSearchToolService
from animama.domain.web_search import WEB_SEARCH_BACKEND_BRAVE, WebSearchSettings


def composition_web_search_enabled(app: Any) -> bool:
    """Return whether this composition lets the owner configure application web search."""

    return getattr(app.state, "application_web_search_enabled", False) is True


def web_search_api_key(settings: WebSearchSettings, environ: Mapping[str, str] | None = None) -> str | None:
    """Return the key from the variable the settings name, if that name is allowed and set."""

    name = (settings.credential_env or "").strip()
    if not name or not is_allowed_web_search_credential_env(name):
        return None
    value = ((environ if environ is not None else os.environ).get(name) or "").strip()
    return value or None


def build_web_search_backend(settings: WebSearchSettings, environ: Mapping[str, str] | None = None) -> WebSearchBackend:
    """Build the HTTP client for the configured backend; queries go only to it."""

    if settings.backend == WEB_SEARCH_BACKEND_BRAVE:
        return BraveSearchBackend(
            api_key=web_search_api_key(settings, environ), timeout_seconds=settings.timeout_seconds
        )
    return SearxngSearchBackend(base_url=settings.base_url or "", timeout_seconds=settings.timeout_seconds)


def web_search_credential_state(settings: WebSearchSettings, environ: Mapping[str, str] | None = None) -> str:
    """Return ``configured``, ``missing`` or ``not_required`` for the backend's key."""

    if settings.credential_env is None:
        return CREDENTIAL_NOT_REQUIRED
    return CREDENTIAL_CONFIGURED if web_search_api_key(settings, environ) else CREDENTIAL_MISSING


async def turn_web_search_tool(session: AsyncSession, *, enabled: bool) -> WebSearchToolService | None:
    """Return the search tool for a chat turn, or ``None`` when search is off or not configured."""

    if not enabled:
        return None
    settings = await SQLAlchemyWebSearchSettingsRepository(session).get()
    return WebSearchToolService(build_web_search_backend(settings)) if settings is not None else None


__all__ = [
    "build_web_search_backend",
    "composition_web_search_enabled",
    "turn_web_search_tool",
    "web_search_api_key",
    "web_search_credential_state",
]
