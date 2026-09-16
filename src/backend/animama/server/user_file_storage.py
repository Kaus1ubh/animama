"""Containment-safe private-file storage rooted exclusively beneath ``data/``."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import BinaryIO

from animama.adapters.content_store.private_file_store import (
    FilesystemPrivateFileStorage,
    PrivateFileNotFoundError,
    PrivateFilePathError,
    PrivateFileReadError,
    PrivateFileSizeMismatchError,
)
from animama.server.config import settings
from animama.server.local_runtime import initialize_local_runtime

USER_FILE_OBJECT_SEGMENT = "files"
USER_FILE_OBJECT_NAME = "original"
USERS_OBJECT_PREFIX = "user-files"
OBJECT_STREAM_CHUNK_BYTES = 1024 * 1024
OBJECT_STREAM_MEMORY_BYTES = 1024 * 1024


class StoredFileNotFoundError(Exception):
    """The requested private file disappeared before it could be read."""


class StoredFileReadError(Exception):
    """Private local storage could not provide a complete readable body."""


class StoredFileSizeMismatchError(Exception):
    """A stored file's byte count differs from the trusted expected size."""

    def __init__(self, *, expected_size_bytes: int, actual_size_bytes: int) -> None:
        super().__init__(f"Stored file size mismatch: expected {expected_size_bytes}, received {actual_size_bytes}")
        self.expected_size_bytes = expected_size_bytes
        self.actual_size_bytes = actual_size_bytes


@dataclass(slots=True)
class BoundedFileStream:
    """Seekable, disk-spooled private bytes plus computed integrity facts."""

    stream: BinaryIO
    size_bytes: int
    sha256: str


def _storage() -> FilesystemPrivateFileStorage:
    return FilesystemPrivateFileStorage(initialize_local_runtime(settings))


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None
    trimmed = value.strip()
    return trimmed or None


def _normalize_posix_key(value: str | None) -> str | None:
    normalized = _normalize_text(value)
    if normalized is None or "\\" in normalized or "\x00" in normalized:
        return None
    relative = PurePosixPath(normalized.strip("/"))
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        return None
    return relative.as_posix()


def build_user_file_storage_prefix(user_id: str) -> str:
    return f"{USERS_OBJECT_PREFIX}/{user_id}/"


def build_user_file_storage_locator(*, user_id: str, file_id: str, extension: str) -> str:
    del extension
    return f"{build_user_file_storage_prefix(user_id)}{file_id}/{USER_FILE_OBJECT_NAME}"


def is_user_file_storage_locator(storage_locator: str | None, user_id: str) -> bool:
    normalized = _normalize_posix_key(storage_locator)
    return normalized is not None and normalized.startswith(build_user_file_storage_prefix(user_id))


def _content_upload_id(storage_locator: str) -> str | None:
    parts = PurePosixPath(storage_locator).parts
    if "staged" not in parts:
        return None
    name = PurePosixPath(storage_locator).name
    return name.rsplit(".", 1)[0] if name else None


def private_upload_url(
    storage_locator: str | None,
    *,
    content_type: str,
    expires_in: int | None = None,
) -> str | None:
    """Return the authenticated FastAPI upload endpoint for a private locator."""

    del content_type, expires_in
    normalized = _normalize_posix_key(storage_locator)
    if normalized is None:
        return None
    parts = PurePosixPath(normalized).parts
    if len(parts) == 4 and parts[0] == "user-files" and parts[3] == USER_FILE_OBJECT_NAME:
        return f"/v1/files/{parts[2]}/content"
    upload_id = _content_upload_id(normalized)
    return f"/v1/content-uploads/{upload_id}/content" if upload_id else None


def private_file_metadata(storage_locator: str | None) -> dict[str, object] | None:
    normalized = _normalize_posix_key(storage_locator)
    return _storage().head(normalized) if normalized is not None else None


def read_private_file_bytes(storage_locator: str | None, *, max_bytes: int | None = None) -> bytes | None:
    normalized = _normalize_posix_key(storage_locator)
    if normalized is None:
        return None
    try:
        return _storage().read(normalized, max_bytes=max_bytes)
    except PrivateFileReadError:
        return None


@contextmanager
def open_bounded_private_file(
    storage_locator: str | None,
    *,
    expected_size_bytes: int,
) -> Iterator[BoundedFileStream]:
    normalized = _normalize_posix_key(storage_locator)
    if normalized is None:
        raise StoredFileNotFoundError
    try:
        with _storage().open_bounded(normalized, expected_size_bytes=expected_size_bytes) as stored:
            yield BoundedFileStream(stored.stream, stored.size_bytes, stored.sha256)
    except PrivateFileSizeMismatchError as exc:
        raise StoredFileSizeMismatchError(
            expected_size_bytes=exc.expected_size_bytes,
            actual_size_bytes=exc.actual_size_bytes,
        ) from exc
    except PrivateFileNotFoundError as exc:
        raise StoredFileNotFoundError from exc
    except PrivateFileReadError as exc:
        raise StoredFileReadError from exc
    except PrivateFilePathError as exc:
        raise StoredFileReadError from exc


def delete_private_file(storage_locator: str | None) -> bool:
    normalized = _normalize_posix_key(storage_locator)
    return _storage().delete(normalized) if normalized is not None else False


def write_private_file_bytes(
    storage_locator: str | None,
    payload: bytes,
    *,
    content_type: str,
) -> bool:
    from io import BytesIO

    del content_type
    return write_private_file_stream(
        storage_locator,
        BytesIO(payload),
        content_type="application/octet-stream",
        content_length=len(payload),
    )


def write_private_file_stream(
    storage_locator: str | None,
    content: BinaryIO,
    *,
    content_type: str,
    content_length: int,
) -> bool:
    del content_type
    normalized = _normalize_posix_key(storage_locator)
    if normalized is None:
        return False
    return _storage().put_stream(normalized, content, content_length=content_length)


def private_upload_expires_at(*, expires_in: int | None = None) -> datetime:
    ttl = max(1, int(expires_in or settings.private_upload_url_ttl_seconds))
    return datetime.now(UTC) + timedelta(seconds=ttl)


__all__ = [
    "BoundedFileStream",
    "OBJECT_STREAM_CHUNK_BYTES",
    "OBJECT_STREAM_MEMORY_BYTES",
    "StoredFileNotFoundError",
    "StoredFileReadError",
    "StoredFileSizeMismatchError",
    "USER_FILE_OBJECT_NAME",
    "USER_FILE_OBJECT_SEGMENT",
    "USERS_OBJECT_PREFIX",
    "build_user_file_storage_locator",
    "build_user_file_storage_prefix",
    "delete_private_file",
    "private_upload_url",
    "read_private_file_bytes",
    "private_file_metadata",
    "is_user_file_storage_locator",
    "open_bounded_private_file",
    "write_private_file_bytes",
    "write_private_file_stream",
    "private_upload_expires_at",
]
