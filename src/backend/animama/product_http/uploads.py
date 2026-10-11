"""Bounded reads of multipart uploads for the shared product routes (ADR 0021)."""

from __future__ import annotations

from fastapi import HTTPException, UploadFile, status


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


__all__ = ["read_audio_upload"]
