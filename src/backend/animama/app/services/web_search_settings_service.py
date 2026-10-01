"""Owner configuration of the installation's application web search backend.

Local composition only: the SearXNG URL is owner-supplied and may point at a
loopback or LAN host, like model connection base URLs. Keys stay outside the
database; the settings store only an environment variable name.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass

from animama.app.model_clients.credentials import (
    WEB_SEARCH_MANAGED_CREDENTIAL_ENV,
    is_allowed_web_search_credential_env,
)
from animama.app.ports.uow_port import UnitOfWork
from animama.app.ports.web_search_settings_port import WebSearchSettingsRepository
from animama.app.services.model_configuration_service import (
    CREDENTIAL_MODE_ENV,
    CREDENTIAL_MODE_MANAGED,
    CREDENTIAL_MODE_NONE,
    ModelConfigurationError,
    normalize_base_url,
)
from animama.app.web_search import WebSearchBackend, WebSearchError
from animama.domain.web_search import (
    WEB_SEARCH_BACKEND_BRAVE,
    WEB_SEARCH_BACKEND_SEARXNG,
    WEB_SEARCH_BACKENDS,
    WebSearchSettings,
)

_TEST_QUERY = "Animama web search test"
_MIN_TIMEOUT_SECONDS = 1.0
_MAX_TIMEOUT_SECONDS = 120.0


class WebSearchSettingsError(ValueError):
    """An invalid web search setting, with a stable code for the API."""

    def __init__(self, message: str, *, code: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True, slots=True)
class WebSearchSettingsDraft:
    backend: str
    base_url: str | None = None
    credential_mode: str = CREDENTIAL_MODE_NONE
    credential_env: str | None = None
    timeout_seconds: float | None = None


@dataclass(frozen=True, slots=True)
class WebSearchTestResult:
    ok: bool
    category: str | None = None
    result_count: int = 0


class WebSearchSettingsService:
    """Read, validate, save, clear and test the web search backend."""

    def __init__(
        self,
        *,
        settings: WebSearchSettingsRepository,
        uow: UnitOfWork,
        backend_factory: Callable[[WebSearchSettings], WebSearchBackend],
    ) -> None:
        self._settings = settings
        self._uow = uow
        self._backend_factory = backend_factory

    async def get(self) -> WebSearchSettings | None:
        return await self._settings.get()

    async def update(self, draft: WebSearchSettingsDraft) -> WebSearchSettings:
        settings = validate_web_search_settings(draft)
        saved = await self._settings.save(settings)
        await self._uow.commit()
        return saved

    async def clear(self) -> None:
        await self._settings.clear()
        await self._uow.commit()

    async def test(self, draft: WebSearchSettingsDraft | None = None) -> WebSearchTestResult:
        """Run one query against the draft, or the saved backend when no draft is given."""

        settings = validate_web_search_settings(draft) if draft is not None else await self._settings.get()
        if settings is None:
            raise WebSearchSettingsError("Web search is not configured", code="web_search_not_configured")
        try:
            results = await self._backend_factory(settings).search(_TEST_QUERY, count=3)
        except WebSearchError as exc:
            return WebSearchTestResult(ok=False, category=exc.category)
        return WebSearchTestResult(ok=True, result_count=len(results))


def validate_web_search_settings(draft: WebSearchSettingsDraft) -> WebSearchSettings:
    """Return normalized settings or raise ``WebSearchSettingsError``."""

    backend = draft.backend.strip().lower()
    if backend not in WEB_SEARCH_BACKENDS:
        raise WebSearchSettingsError(f"Unknown web search backend: {draft.backend!r}", code="invalid_backend")
    base_url: str | None = None
    if backend == WEB_SEARCH_BACKEND_SEARXNG:
        try:
            base_url = normalize_base_url(draft.base_url)
        except ModelConfigurationError as exc:
            raise WebSearchSettingsError(str(exc), code=exc.code) from exc
    credential_env = _credential_env(draft)
    if backend == WEB_SEARCH_BACKEND_BRAVE and credential_env is None:
        raise WebSearchSettingsError("Brave Search needs an API key", code="credential_required")
    if backend == WEB_SEARCH_BACKEND_SEARXNG and credential_env is not None:
        # A key is never sent to an owner-supplied SearXNG URL, which may be plain http on a LAN.
        raise WebSearchSettingsError("SearXNG takes no API key", code="credential_not_supported")
    timeout = draft.timeout_seconds
    if timeout is not None and not _MIN_TIMEOUT_SECONDS <= timeout <= _MAX_TIMEOUT_SECONDS:
        raise WebSearchSettingsError("The timeout must be between 1 and 120 seconds", code="invalid_timeout")
    return WebSearchSettings(backend=backend, base_url=base_url, credential_env=credential_env, timeout_seconds=timeout)


def _credential_env(draft: WebSearchSettingsDraft) -> str | None:
    mode = draft.credential_mode
    if mode == CREDENTIAL_MODE_NONE:
        return None
    if mode == CREDENTIAL_MODE_MANAGED:
        return WEB_SEARCH_MANAGED_CREDENTIAL_ENV
    if mode == CREDENTIAL_MODE_ENV:
        name = (draft.credential_env or "").strip()
        if not is_allowed_web_search_credential_env(name):
            raise WebSearchSettingsError(
                f"Use {WEB_SEARCH_MANAGED_CREDENTIAL_ENV} or BRAVE_SEARCH_API_KEY for the web search key",
                code="invalid_credential_env",
            )
        return name
    raise WebSearchSettingsError(f"Unknown credential mode: {mode!r}", code="invalid_credential_mode")


__all__ = [
    "WebSearchSettingsDraft",
    "WebSearchSettingsError",
    "WebSearchSettingsService",
    "WebSearchTestResult",
    "validate_web_search_settings",
]
