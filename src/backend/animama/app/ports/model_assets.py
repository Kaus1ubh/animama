"""Storage and transfer boundaries for pinned downloadable model assets."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager
from pathlib import Path
from typing import Protocol

from animama.domain.model_assets import AssetDescriptor, AssetFailureReason


class AssetFetchError(Exception):
    """A transfer failed before verified bytes were available."""

    def __init__(self, reason: AssetFailureReason, message: str) -> None:
        super().__init__(message)
        self.reason: AssetFailureReason = reason


class StagedAsset(Protocol):
    """A private, not-yet-visible file receiving one asset's bytes."""

    def write(self, chunk: bytes) -> None: ...

    def commit(self) -> None:
        """Flush, fsync and atomically publish the complete verified file."""

    def discard(self) -> None:
        """Remove the staging file; safe to call repeatedly and after commit."""


class ModelAssetStore(Protocol):
    """Writable installation store. Implementations never expose partial files."""

    def discard_staging(self) -> None:
        """Delete leftovers from interrupted installs; call before any install."""

    def is_installed(self, asset: AssetDescriptor) -> bool:
        """Report a present regular file of the pinned size, without rehashing."""

    def stage(self, asset: AssetDescriptor) -> StagedAsset: ...

    def remove(self, asset: AssetDescriptor) -> None: ...

    def content_location(self, asset: AssetDescriptor) -> tuple[Path, str]:
        """Return a trusted root and a safe relative name for serving the file."""


class AssetFetcher(Protocol):
    """Stream a descriptor's pinned URL; raise ``AssetFetchError`` on failure."""

    def stream(self, asset: AssetDescriptor) -> AbstractAsyncContextManager[AsyncIterator[bytes]]: ...
