"""Verified-byte responses shared by the compositions' delivery policies (ADR 0021)."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Response
from fastapi.responses import StreamingResponse

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


__all__ = ["stream_verified_file", "verified_file_response"]
