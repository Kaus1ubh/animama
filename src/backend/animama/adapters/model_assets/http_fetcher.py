"""Stream pinned catalog URLs from the release host with httpx.

The fetcher re-checks every URL against its own host allowlist and the default
https port, follows no redirects, requires an exact ``200`` response and
refuses any content encoding, streaming the raw bytes it will verify. Only the composition chooses
the allowlist; production uses ``PRODUCTION_ASSET_HOSTS``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

from animama.app.ports.model_assets import AssetFetchError
from animama.domain.model_assets import PRODUCTION_ASSET_HOSTS, AssetDescriptor

DEFAULT_TIMEOUT = httpx.Timeout(connect=15.0, read=60.0, write=30.0, pool=15.0)


class HttpAssetFetcher:
    """Implement ``AssetFetcher`` for https release downloads.

    ``transport`` exists for tests (for example ``httpx.MockTransport``); it
    does not widen the host allowlist.
    """

    def __init__(
        self,
        *,
        allowed_hosts: frozenset[str] = PRODUCTION_ASSET_HOSTS,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: httpx.Timeout = DEFAULT_TIMEOUT,
    ) -> None:
        self._allowed_hosts = allowed_hosts
        self._transport = transport
        self._timeout = timeout

    @asynccontextmanager
    async def stream(self, asset: AssetDescriptor) -> AsyncIterator[AsyncIterator[bytes]]:
        url = httpx.URL(asset.url)
        if url.scheme != "https" or url.host not in self._allowed_hosts or url.port not in (None, 443):
            raise AssetFetchError("asset_host_not_allowed", f"Asset {asset.id} host is not allowed")
        async with httpx.AsyncClient(
            transport=self._transport,
            timeout=self._timeout,
            follow_redirects=False,
            # Identity encoding keeps the streamed bytes equal to the pinned file.
            headers={"accept-encoding": "identity"},
        ) as client:
            try:
                async with client.stream("GET", url) as response:
                    if response.status_code != 200:
                        raise AssetFetchError(
                            "asset_download_failed", f"Asset {asset.id} returned HTTP {response.status_code}"
                        )
                    # Size and digest bind the stored bytes, so never decode a
                    # transfer encoding (a compressed body could expand past the bound).
                    encoding = response.headers.get("content-encoding", "identity").strip().lower()
                    if encoding != "identity":
                        raise AssetFetchError(
                            "asset_download_failed", f"Asset {asset.id} used content encoding {encoding}"
                        )
                    declared = response.headers.get("content-length")
                    if declared is not None and declared.strip() != str(asset.size):
                        raise AssetFetchError("asset_size_invalid", f"Asset {asset.id} declared a different size")
                    yield _translate_errors(asset, response.aiter_raw())
            except httpx.HTTPError as error:
                raise AssetFetchError("asset_download_failed", f"Asset {asset.id} transfer failed: {error}") from error


async def _translate_errors(asset: AssetDescriptor, chunks: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
    """Report mid-stream transport failures as ``AssetFetchError``."""

    try:
        async for chunk in chunks:
            yield chunk
    except httpx.HTTPError as error:
        raise AssetFetchError("asset_download_failed", f"Asset {asset.id} transfer was interrupted") from error
