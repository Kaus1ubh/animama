"""Bounded reads of request bodies and multipart uploads for product routes (ADR 0021)."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from pathlib import Path
from tempfile import SpooledTemporaryFile
from typing import BinaryIO, cast

from fastapi import HTTPException, Request, UploadFile, status


class UploadEnvelopeError(Exception):
    """A request body violated its declared upload envelope; ``code`` names how."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(slots=True)
class SpooledUpload:
    """Seekable spooled request body with server-computed integrity facts."""

    stream: BinaryIO
    size_bytes: int
    sha256: str

    def close(self) -> None:
        self.stream.close()


async def spool_bounded_request(
    request: Request,
    *,
    expected_size_bytes: int,
    max_size_bytes: int,
    staging_directory: Path | None = None,
) -> SpooledUpload:
    """Stream a request body to a bounded disk-backed spool without buffering it in RAM."""

    if expected_size_bytes < 1 or expected_size_bytes > max_size_bytes:
        raise UploadEnvelopeError("upload_size_invalid")
    declared = request.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) != expected_size_bytes:
                raise UploadEnvelopeError("upload_size_mismatch")
        except ValueError as exc:
            raise UploadEnvelopeError("upload_size_invalid") from exc
    if staging_directory is not None:
        staging_directory.mkdir(parents=True, exist_ok=True)
    stream = SpooledTemporaryFile(
        max_size=1024 * 1024,
        mode="w+b",
        dir=str(staging_directory) if staging_directory is not None else None,
    )
    digest = hashlib.sha256()
    received = 0
    try:
        async for chunk in request.stream():
            received += len(chunk)
            if received > expected_size_bytes or received > max_size_bytes:
                raise UploadEnvelopeError("upload_too_large")
            digest.update(chunk)
            stream.write(chunk)
        if received != expected_size_bytes:
            raise UploadEnvelopeError("upload_size_mismatch")
        stream.seek(0)
        # The standard-library binary spool implements BinaryIO, though its
        # generic typeshed class does not inherit that nominal typing alias.
        return SpooledUpload(stream=cast(BinaryIO, stream), size_bytes=received, sha256=digest.hexdigest())
    except Exception:
        stream.close()
        raise


async def read_audio_upload(upload: UploadFile, *, max_bytes: int) -> tuple[str, bytes, str]:
    """Read one uploaded audio sample as ``(filename, bytes, content type)``, refusing empty or oversized ones."""

    filename = (upload.filename or "audio-sample").strip() or "audio-sample"
    content_type = (upload.content_type or "application/octet-stream").strip() or "application/octet-stream"
    data = await upload.read()
    await upload.close()
    if not data:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uploaded audio file is empty")
    if len(data) > max_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Uploaded audio exceeds the {max_bytes} byte limit",
        )
    return filename, data, content_type


__all__ = ["SpooledUpload", "UploadEnvelopeError", "read_audio_upload", "spool_bounded_request"]
