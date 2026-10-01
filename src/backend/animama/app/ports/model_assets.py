"""Storage and transfer boundaries for pinned downloadable model assets."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

from animama.domain.model_assets import AssetCatalog, AssetDescriptor, AssetFailureReason, AssetFile


class AssetFetchError(Exception):
    """A transfer failed before verified bytes were available."""

    def __init__(self, reason: AssetFailureReason, message: str) -> None:
        super().__init__(message)
        self.reason: AssetFailureReason = reason


@dataclass(frozen=True, slots=True)
class FetchedBody:
    """A response body for one asset file.

    ``start`` is the offset of the first streamed byte: the requested resume
    offset, or ``0`` when the server sent the whole file instead.
    """

    start: int
    chunks: AsyncIterator[bytes]


class StagedFile(Protocol):
    """A private, resumable staging file for one asset file.

    Opening it rehashes any bytes already present, so ``size`` and
    ``hexdigest`` always describe the whole staged prefix.
    """

    @property
    def size(self) -> int:
        """Bytes currently staged, including a resumed prefix."""

    def restart(self) -> None:
        """Truncate to zero bytes, for a server that ignored the resume offset."""

    def write(self, chunk: bytes) -> None: ...

    def hexdigest(self) -> str:
        """SHA-256 of every staged byte."""

    def close(self) -> None:
        """Flush, fsync and close, keeping the bytes for verification or resume."""

    def discard(self) -> None:
        """Close and delete the staged bytes; safe to call repeatedly."""


class ModelAssetStore(Protocol):
    """Writable installation store. Implementations never expose partial assets."""

    def prune(self, catalog: AssetCatalog) -> None:
        """Delete data this catalog cannot use; call before any install.

        Removes installed assets whose IDs left the catalog and staging that
        cannot be resumed (unknown IDs, other versions, legacy files). Staged
        files of current catalog versions are kept for resume.
        """

    def free_bytes(self) -> int:
        """Free bytes on the filesystem holding staged and installed assets."""

    def staged_bytes(self, asset: AssetDescriptor) -> int:
        """Bytes already staged toward this asset's current version."""

    def is_installed(self, asset: AssetDescriptor) -> bool:
        """Report every file present as a regular file of its pinned size, without rehashing."""

    def open_staged(self, asset: AssetDescriptor, file: AssetFile) -> StagedFile: ...

    def commit(self, asset: AssetDescriptor) -> None:
        """Atomically activate a completely staged, verified asset version."""

    def discard_staged(self, asset: AssetDescriptor) -> None:
        """Delete every staged byte of this asset."""

    def remove(self, asset: AssetDescriptor) -> None: ...

    def content_location(self, asset: AssetDescriptor) -> tuple[Path, str]:
        """Return a trusted root and a safe relative name for serving a single-file asset."""

    def set_directory(self, asset: AssetDescriptor) -> Path:
        """Return the trusted installed version directory of a set."""


class AssetFetcher(Protocol):
    """Stream one pinned file, optionally from a byte offset; raise ``AssetFetchError`` on failure."""

    def stream(self, asset_id: str, file: AssetFile, *, start: int = 0) -> AbstractAsyncContextManager[FetchedBody]: ...
