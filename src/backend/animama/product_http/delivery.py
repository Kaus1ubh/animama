"""Verified-byte responses shared by the compositions' delivery policies (ADR 0021)."""

from __future__ import annotations

import asyncio
import gzip
import hashlib
from collections.abc import Awaitable, Callable, Iterator
from dataclasses import dataclass
from urllib.parse import quote

from fastapi import HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from starlette.types import Receive, Scope, Send

from animama.app.services.content_package_export import DownloadLease
from animama.domain.content_catalog import VerifiedContentFile
from animama.logging import get_logger

_log = get_logger("product_http.delivery")

STORED_BYTES_CONTENT_SECURITY_POLICY = "sandbox; default-src 'none'"
"""Stored bytes never run as a document in the app's origin, whatever their type.

Browsers ignore it when the bytes load as an image, media, model or fetch.
"""


def negotiate_json_encoding(request: Request, *, refusal_code: str) -> str:
    """Choose ``gzip`` or ``identity`` for one JSON response; explicit exclusions override wildcards.

    Raises a 406 carrying ``refusal_code`` when the client accepts neither.
    """

    qualities: dict[str, float] = {}
    for member in ",".join(request.headers.getlist("accept-encoding")).lower().split(","):
        coding, *parameters = member.strip().split(";")
        if not coding:
            continue
        quality = 1.0
        for parameter in parameters:
            name, _, value = parameter.strip().partition("=")
            if name == "q":
                try:
                    quality = float(value)
                except ValueError:
                    quality = 0.0
                if not 0 <= quality <= 1:
                    quality = 0.0
        qualities[coding.strip()] = min(qualities.get(coding.strip(), 1.0), quality)
    gzip_quality = qualities.get("gzip", qualities.get("*", 0.0))
    if gzip_quality > 0 and gzip_quality >= qualities.get("identity", 0.0):
        return "gzip"
    if qualities.get("identity", 0.0 if qualities.get("*") == 0 else 1.0) > 0:
        return "identity"
    raise HTTPException(status_code=406, detail={"code": refusal_code})


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
    headers = {
        "Cache-Control": cache_control,
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": STORED_BYTES_CONTENT_SECURITY_POLICY,
    }
    if if_none_match == etag:
        file.handle.close()
        return Response(status_code=304, headers=headers)
    headers["Content-Length"] = str(file.size_bytes)
    return StreamingResponse(stream_verified_file(file), media_type=file.media_type, headers=headers)


@dataclass(frozen=True, slots=True)
class DeferredJsonBody:
    """JSON whose validator is known before its bytes are built.

    ``validator`` is a hex digest that changes whenever the content ``build``
    serializes changes. A client that already holds it then costs a 304 without the
    body being built, compressed or hashed.
    """

    validator: str
    build: Callable[[], Awaitable[bytes]]


async def encoded_json_response(
    body: bytes | DeferredJsonBody,
    *,
    encoding: str,
    headers: dict[str, str],
    if_none_match: str | None = None,
    cacheable: bool = True,
) -> Response:
    """Encode bounded JSON with wire validators; callers establish authorization first.

    ``encoding`` is the negotiated ``gzip`` or ``identity``. A cacheable body is
    private and revalidated by ETag; any other is never stored. A deferred body's
    ETag comes from its validator, so a matching ``If-None-Match`` is answered
    before the body is built; any other body's ETag is the digest of its encoded bytes.
    """
    if encoding == "gzip":
        headers["content-encoding"] = "gzip"
    vary = [value.strip() for value in headers.get("vary", "").split(",") if value.strip()]
    if not any(value.lower() in {"accept-encoding", "*"} for value in vary):
        vary.append("Accept-Encoding")
    headers.update(
        {
            "vary": ", ".join(vary),
            "cache-control": "private, no-cache" if cacheable else "no-store",
            "x-content-type-options": "nosniff",
        }
    )
    etag = None
    if isinstance(body, DeferredJsonBody):
        # Each content coding is its own representation, so it has its own strong
        # validator (RFC 9110 8.8.3).
        etag = f'"{body.validator}-{encoding}"'
        if cacheable and if_none_match == etag:
            return Response(status_code=304, headers={**headers, "etag": etag})
        body = await body.build()
    if encoding == "gzip":
        body = await asyncio.to_thread(gzip.compress, body, compresslevel=6, mtime=0)
    if cacheable:
        headers["etag"] = etag or f'"{hashlib.sha256(body).hexdigest()}"'
        if if_none_match == headers["etag"]:
            return Response(status_code=304, headers=headers)
    headers["content-length"] = str(len(body))
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
                    try:
                        self._release()
                    except Exception as exc:
                        # The archive is complete in memory: deliver it, and leave the
                        # stage unreclaimed rather than truncating a verified download.
                        _log.warning("Package download lease release failed", error_type=type(exc).__name__)
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
                "Content-Security-Policy": STORED_BYTES_CONTENT_SECURITY_POLICY,
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


__all__ = [
    "STORED_BYTES_CONTENT_SECURITY_POLICY",
    "DeferredJsonBody",
    "PackageDownloadResponse",
    "encoded_json_response",
    "stream_verified_file",
    "verified_file_response",
]
