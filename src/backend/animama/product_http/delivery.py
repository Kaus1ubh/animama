"""Verified-byte responses shared by the compositions' delivery policies (ADR 0021)."""

from __future__ import annotations

import asyncio
import gzip
import hashlib
from collections.abc import Iterator
from urllib.parse import quote

from fastapi import Response
from fastapi.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from animama.app.services.content_package_export import DownloadLease
from animama.domain.content_catalog import VerifiedContentFile


def stream_verified_file(file: VerifiedContentFile) -> Iterator[bytes]:
    """Stream the verified handle in 1 MiB chunks, closing it when the body ends."""

    try:
        while chunk := file.handle.read(1024 * 1024):
            yield chunk
    finally:
        file.handle.close()


def verified_file_response(file: VerifiedContentFile, *, if_none_match: str | None, cache_control: str) -> Response:
    """Answer with the file's bytes, or 304 when the client's ETag matches its digest."""

    etag = f'"{file.sha256}"'
    headers = {"Cache-Control": cache_control, "ETag": etag, "X-Content-Type-Options": "nosniff"}
    if if_none_match == etag:
        file.handle.close()
        return Response(status_code=304, headers=headers)
    headers["Content-Length"] = str(file.size_bytes)
    return StreamingResponse(stream_verified_file(file), media_type=file.media_type, headers=headers)


async def encoded_json_response(
    body: bytes,
    *,
    encoding: str,
    headers: dict[str, str],
    if_none_match: str | None = None,
    cacheable: bool = True,
) -> Response:
    """Encode bounded JSON with wire validators; callers establish authorization first.

    ``encoding`` is the negotiated ``gzip`` or ``identity``. A cacheable body is
    private and revalidated by ETag; any other is never stored.
    """
    if encoding == "gzip":
        body = await asyncio.to_thread(gzip.compress, body, compresslevel=6, mtime=0)
        headers["content-encoding"] = "gzip"
    vary = [value.strip() for value in headers.get("vary", "").split(",") if value.strip()]
    if not any(value.lower() in {"accept-encoding", "*"} for value in vary):
        vary.append("Accept-Encoding")
    headers.update(
        {
            "vary": ", ".join(vary),
            "cache-control": "private, no-cache" if cacheable else "no-store",
            "etag": f'"{hashlib.sha256(body).hexdigest()}"',
            "content-length": str(len(body)),
        }
    )
    headers["x-content-type-options"] = "nosniff"
    if cacheable and if_none_match == headers["etag"]:
        headers.pop("content-length")
        return Response(status_code=304, headers=headers)
    if not cacheable:
        headers.pop("etag")
    return Response(body, media_type="application/json", headers=headers)


class PackageDownloadResponse(StreamingResponse):
    """Stream a sealed package archive, then release its stage lease.

    The worker thread that reads the last chunk releases the lease before the client
    receives that chunk, so a client may discard the export as soon as it has every
    byte. The response also releases the lease if startup or delivery fails.
    """

    def __init__(self, download: DownloadLease) -> None:
        self._download = download
        self._released = False

        def chunks() -> Iterator[bytes]:
            chunk = download.handle.read(1024 * 1024)
            while chunk:
                following = download.handle.read(1024 * 1024)
                if not following:
                    self._release()
                yield chunk
                chunk = following

        review = download.review
        super().__init__(
            chunks(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename*=utf-8''{quote(review.filename, safe='')}",
                "Content-Length": str(review.size_bytes),
                "X-Content-SHA256": review.package_sha256,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    def _release(self) -> None:
        # Completion or cancellation ends the response lease, not proof of a
        # successful user save. Preserve retry bytes until quota needs them.
        if not self._released:
            self._released = True
            self._download.close(reclaimable=True)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            self._release()


__all__ = ["PackageDownloadResponse", "encoded_json_response", "stream_verified_file", "verified_file_response"]
