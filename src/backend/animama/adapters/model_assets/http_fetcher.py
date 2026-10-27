"""Stream pinned catalog URLs from the release host with httpx.

The fetcher re-checks every URL against its own host allowlist and the default
https port, follows no redirects and refuses any content encoding, streaming
the raw bytes it will verify. A fresh request requires an exact ``200``. A
resumed request sends ``Range: bytes=N-`` and accepts ``206`` only with the
exact matching ``Content-Range`` (start and total size); a ``200`` restarts the
file from zero, and anything else fails. Only the composition chooses the
allowlist; production uses ``PRODUCTION_ASSET_HOSTS``.
"""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import httpx

from animama.app.ports.model_assets import AssetFetchError, FetchedBody
from animama.domain.model_assets import PRODUCTION_ASSET_HOSTS, AssetFile

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
    async def stream(self, asset_id: str, file: AssetFile, *, start: int = 0) -> AsyncIterator[FetchedBody]:
        url = httpx.URL(file.url)
        if url.scheme != "https" or url.host not in self._allowed_hosts or url.port not in (None, 443):
            raise AssetFetchError("asset_host_not_allowed", f"Asset {asset_id} host is not allowed")
        if not 0 <= start < file.size:
            raise AssetFetchError("asset_download_failed", f"Asset {asset_id} resume offset is out of range")
        # Identity encoding keeps the streamed bytes equal to the pinned file.
        headers = {"accept-encoding": "identity"}
        if start:
            headers["range"] = f"bytes={start}-"
        async with httpx.AsyncClient(
            transport=self._transport,
            timeout=self._timeout,
            follow_redirects=False,
            headers=headers,
        ) as client:
            try:
                async with client.stream("GET", url) as response:
                    body_start = _body_start(asset_id, file, start, response)
                    # Size and digest bind the stored bytes, so never decode a
                    # transfer encoding (a compressed body could expand past the bound).
                    encoding = response.headers.get("content-encoding", "identity").strip().lower()
                    if encoding != "identity":
                        raise AssetFetchError(
                            "asset_download_failed", f"Asset {asset_id} used content encoding {encoding}"
                        )
                    declared = response.headers.get("content-length")
                    if declared is not None and declared.strip() != str(file.size - body_start):
                        raise AssetFetchError("asset_size_invalid", f"Asset {asset_id} declared a different size")
                    yield FetchedBody(body_start, _translate_errors(asset_id, response.aiter_raw()))
            except httpx.HTTPError as error:
                raise AssetFetchError(
                    "asset_download_failed", f"Asset {asset_id} transfer failed: {_describe(error)}"
                ) from error


def _body_start(asset_id: str, file: AssetFile, start: int, response: httpx.Response) -> int:
    """Return where the body starts in the file, or refuse an unusable response."""

    if response.status_code == 200:
        return 0
    if response.status_code == 206 and start:
        expected = f"bytes {start}-{file.size - 1}/{file.size}"
        if response.headers.get("content-range", "").strip() != expected:
            raise AssetFetchError("asset_download_failed", f"Asset {asset_id} returned a mismatched Content-Range")
        return start
    raise AssetFetchError("asset_download_failed", f"Asset {asset_id} returned HTTP {response.status_code}")


async def _translate_errors(asset_id: str, chunks: AsyncIterator[bytes]) -> AsyncIterator[bytes]:
    """Report mid-stream transport failures as ``AssetFetchError``."""

    try:
        async for chunk in chunks:
            yield chunk
    except httpx.HTTPError as error:
        raise AssetFetchError(
            "asset_download_failed", f"Asset {asset_id} transfer was interrupted: {_describe(error)}"
        ) from error


def _describe(error: httpx.HTTPError) -> str:
    """Name the transport failure for logs; some httpx errors carry an empty message."""

    message = str(error)
    return f"{type(error).__name__}: {message}" if message else type(error).__name__
