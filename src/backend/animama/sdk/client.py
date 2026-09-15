from __future__ import annotations

from typing import Any

import httpx


class AnimaClient:
    """Minimal async HTTP client for calls admitted by the local HTTP boundary."""

    def __init__(
        self,
        base_url: str,
        *,
        client: httpx.AsyncClient | None = None,
        timeout: float = 10.0,
    ) -> None:
        self._owned_client = client is None
        self._client = client or httpx.AsyncClient(base_url=base_url.rstrip("/"), timeout=timeout)

    @classmethod
    def from_http(cls, base_url: str) -> AnimaClient:
        return cls(base_url)

    async def get_anima(self, anima_id: str) -> dict[str, Any]:
        response = await self._request("GET", f"/v1/animas/{anima_id}")
        return response.json()

    async def _request(self, method: str, url: str, **kwargs: Any) -> httpx.Response:
        response = await self._client.request(method, url, **kwargs)
        response.raise_for_status()
        return response

    async def aclose(self) -> None:
        if self._owned_client:
            await self._client.aclose()
