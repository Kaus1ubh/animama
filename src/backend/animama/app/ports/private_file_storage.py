"""Filesystem-neutral boundary for private uploads and generated derivatives."""

from __future__ import annotations

from contextlib import AbstractContextManager
from typing import BinaryIO, Protocol


class PrivateFileUnavailableError(Exception):
    """The stored file is missing or no longer matches its recorded size.

    Reading it again cannot succeed. Other read errors may be transient.
    """


class StoredPrivateFile(Protocol):
    """Seekable verified private bytes returned by a storage adapter."""

    stream: BinaryIO
    size_bytes: int
    sha256: str


class PrivateFileStorage(Protocol):
    """Store opaque data locators without exposing host paths to domain code."""

    def put_stream(
        self,
        locator: str,
        content: BinaryIO,
        *,
        content_length: int,
    ) -> bool:
        raise NotImplementedError

    def open_bounded(
        self,
        locator: str,
        *,
        expected_size_bytes: int,
    ) -> AbstractContextManager[StoredPrivateFile]:
        """Open exactly ``expected_size_bytes`` verified bytes.

        Raises :class:`PrivateFileUnavailableError` when the file is missing or
        differs in size.
        """

        raise NotImplementedError

    def head(self, locator: str) -> dict[str, object] | None:
        raise NotImplementedError

    def read(self, locator: str, *, max_bytes: int | None = None) -> bytes | None:
        raise NotImplementedError

    def delete(self, locator: str) -> bool:
        raise NotImplementedError


__all__ = ["PrivateFileStorage", "PrivateFileUnavailableError", "StoredPrivateFile"]
