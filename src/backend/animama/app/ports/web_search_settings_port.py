from __future__ import annotations

from typing import Protocol

from animama.domain.web_search import WebSearchSettings


class WebSearchSettingsRepository(Protocol):
    """Persistence for the installation's single web search backend."""

    async def get(self) -> WebSearchSettings | None:
        raise NotImplementedError

    async def save(self, settings: WebSearchSettings) -> WebSearchSettings:
        raise NotImplementedError

    async def clear(self) -> None:
        raise NotImplementedError


__all__ = ["WebSearchSettingsRepository"]
