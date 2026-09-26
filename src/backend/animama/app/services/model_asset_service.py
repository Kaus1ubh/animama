"""Install, report, serve and remove pinned model assets.

Installs are single-flight per asset within this process: concurrent requests
share one background download. Bytes are streamed to a private staging file,
checked for exact length and SHA-256, then atomically published by the store.
Progress and failures are in memory; installed state is read from the store,
so it survives restarts.
"""

from __future__ import annotations

import asyncio
import hashlib
import inspect
import json
import logging
from collections.abc import Awaitable, Callable
from importlib.resources import files
from pathlib import Path
from typing import TypeVar

from animama.app.ports.model_assets import AssetFetcher, AssetFetchError, ModelAssetStore, StagedAsset
from animama.domain.model_assets import (
    AssetCatalog,
    AssetDescriptor,
    AssetFailureReason,
    AssetRemovalVeto,
    AssetState,
    parse_asset_catalog,
)

logger = logging.getLogger(__name__)

PACKAGED_ASSET_CATALOG = "model-assets.v1.json"

T = TypeVar("T")

# A guard may veto removal of an installed asset, synchronously or asynchronously.
RemovalGuard = Callable[[AssetDescriptor], AssetRemovalVeto | None | Awaitable[AssetRemovalVeto | None]]


class UnknownAssetError(LookupError):
    """The ID is not in this release's catalog."""


class AssetBusyError(Exception):
    """The asset is being removed; retry once removal settles."""


class AssetRemovalRefusedError(Exception):
    """A registered guard refused removal of an installed asset."""

    def __init__(self, veto: AssetRemovalVeto) -> None:
        super().__init__(veto.code)
        self.veto = veto


class _InstallFailure(Exception):
    def __init__(self, reason: AssetFailureReason) -> None:
        super().__init__(reason)
        self.reason: AssetFailureReason = reason


def load_packaged_asset_catalog() -> AssetCatalog:
    """Load this release's pinned catalog; an invalid catalog fails loudly.

    There is deliberately no environment override: production can only fetch
    what the release packaged. Tests construct their own ``AssetCatalog``.
    """

    payload = files("animama.resources").joinpath(PACKAGED_ASSET_CATALOG).read_bytes()
    return parse_asset_catalog(json.loads(payload))


async def _run_blocking(function: Callable[..., T], *args: object) -> T:
    """Run file IO in a thread, and on cancellation wait for it before unwinding.

    A thread cannot be interrupted. Waiting ensures cleanup never races a write
    or rename that is still in progress on the same staging file.
    """

    future = asyncio.ensure_future(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(future)
    except asyncio.CancelledError:
        await asyncio.wait({future})
        raise


class ModelAssetService:
    """Own the install lifecycle for one catalog and one installation store."""

    def __init__(self, catalog: AssetCatalog, store: ModelAssetStore, fetcher: AssetFetcher) -> None:
        self._catalog = catalog
        self._store = store
        self._fetcher = fetcher
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._progress: dict[str, int] = {}
        self._failures: dict[str, AssetFailureReason] = {}
        self._guards: list[RemovalGuard] = []
        # Assets whose removal (cancel, guards, delete) is in progress.
        self._removing: set[str] = set()
        # No install can be running yet, so every staging file is a leftover.
        store.discard_staging()

    @property
    def catalog(self) -> AssetCatalog:
        return self._catalog

    def register_removal_guard(self, guard: RemovalGuard) -> None:
        """Let a consumer veto removal, for example while an asset is in use."""

        self._guards.append(guard)

    def _descriptor(self, asset_id: str) -> AssetDescriptor:
        descriptor = self._catalog.get(asset_id)
        if descriptor is None:
            raise UnknownAssetError(asset_id)
        return descriptor

    def state(self, asset_id: str) -> AssetState:
        """Report one asset's state; raises ``UnknownAssetError``."""

        return self._state(self._descriptor(asset_id))

    def states(self) -> list[AssetState]:
        return [self._state(asset) for asset in self._catalog.assets]

    def free_bytes(self) -> int | None:
        """Report free space for the store, or ``None`` if it cannot be measured."""

        try:
            return self._store.free_bytes()
        except OSError as error:
            # Listed often while a download is shown, so no traceback per call.
            logger.warning("Model asset store free space could not be measured: %s", error)
            return None

    def _state(self, asset: AssetDescriptor) -> AssetState:
        if asset.id in self._tasks:
            return AssetState(
                asset,
                "downloading",
                bytes_downloaded=self._progress.get(asset.id, 0),
                total_bytes=asset.size,
            )
        if self._store.is_installed(asset):
            return AssetState(asset, "installed")
        reason = self._failures.get(asset.id)
        if reason is not None:
            return AssetState(asset, "failed", reason=reason)
        return AssetState(asset, "not_installed")

    def install(self, asset_id: str) -> AssetState:
        """Start (or join) the asset's download and return its current state.

        Idempotent: an installed asset stays installed and an in-flight
        download is shared rather than restarted. Raises ``AssetBusyError``
        while the asset is being removed, so a new download never races the
        deletion of its directory. Without ``required_free_bytes`` of free
        space nothing is fetched, and the state reports
        ``asset_insufficient_space`` (``asset_store_failed`` if free space
        cannot be measured).
        """

        asset = self._descriptor(asset_id)
        if asset.id in self._removing:
            raise AssetBusyError(asset.id)
        if asset.id in self._tasks or self._store.is_installed(asset):
            return self._state(asset)
        free = self.free_bytes()
        if free is None:
            self._failures[asset.id] = "asset_store_failed"
            return self._state(asset)
        if free < asset.required_free_bytes:
            self._failures[asset.id] = "asset_insufficient_space"
            return self._state(asset)
        self._failures.pop(asset.id, None)
        self._progress[asset.id] = 0
        # No await separates the check above from registration, so a second
        # caller in this event loop always observes this task.
        self._tasks[asset.id] = asyncio.create_task(self._download(asset), name=f"model-asset:{asset.id}")
        return self._state(asset)

    async def wait(self, asset_id: str) -> AssetState:
        """Wait for any in-flight install, then report the settled state."""

        asset = self._descriptor(asset_id)
        task = self._tasks.get(asset.id)
        if task is not None:
            await asyncio.wait({task})
        return self._state(asset)

    async def remove(self, asset_id: str) -> AssetState:
        """Cancel an in-flight install, or remove an installed asset.

        Removal of an installed asset first asks every guard; the first veto
        raises ``AssetRemovalRefusedError`` and leaves the asset installed.
        Installs and other removals of the same asset raise ``AssetBusyError``
        until this call settles. A filesystem error is reported as a failed
        state with ``asset_store_failed``.
        """

        asset = self._descriptor(asset_id)
        if asset.id in self._removing:
            raise AssetBusyError(asset.id)
        self._removing.add(asset.id)
        try:
            task = self._tasks.get(asset.id)
            if task is not None:
                task.cancel()
                await asyncio.wait({task})
            self._failures.pop(asset.id, None)
            if self._store.is_installed(asset):
                for guard in self._guards:
                    veto = guard(asset)
                    if inspect.isawaitable(veto):
                        veto = await veto
                    if veto is not None:
                        raise AssetRemovalRefusedError(veto)
                try:
                    await _run_blocking(self._store.remove, asset)
                except OSError:
                    logger.exception("Model asset %s could not be removed", asset.id)
                    self._failures[asset.id] = "asset_store_failed"
                    return AssetState(asset, "failed", reason="asset_store_failed")
            return self._state(asset)
        finally:
            self._removing.discard(asset.id)

    def installed_location(self, asset_id: str) -> tuple[AssetDescriptor, Path, str] | None:
        """Return the descriptor and servable location of an installed asset."""

        asset = self._descriptor(asset_id)
        if asset.id in self._tasks or not self._store.is_installed(asset):
            return None
        root, name = self._store.content_location(asset)
        return asset, root, name

    async def aclose(self) -> None:
        """Cancel in-flight downloads; their staging files are discarded."""

        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.wait(tasks)

    async def _download(self, asset: AssetDescriptor) -> None:
        staged: StagedAsset | None = None
        try:
            staged = await _run_blocking(self._store.stage, asset)
            digest = hashlib.sha256()
            received = 0
            async with self._fetcher.stream(asset) as chunks:
                async for chunk in chunks:
                    received += len(chunk)
                    # Abort as soon as the stream exceeds the pinned length.
                    if received > asset.size:
                        raise _InstallFailure("asset_size_invalid")
                    digest.update(chunk)
                    await _run_blocking(staged.write, chunk)
                    self._progress[asset.id] = received
            if received != asset.size:
                raise _InstallFailure("asset_size_invalid")
            if digest.hexdigest() != asset.sha256:
                raise _InstallFailure("asset_hash_invalid")
            await _run_blocking(staged.commit)
        except _InstallFailure as failure:
            self._failures[asset.id] = failure.reason
        except AssetFetchError as error:
            logger.warning("Model asset %s download failed: %s", asset.id, error)
            self._failures[asset.id] = error.reason
        except OSError:
            logger.exception("Model asset %s could not be stored", asset.id)
            self._failures[asset.id] = "asset_store_failed"
        except Exception:
            # A background task has no caller to raise to; record a failure.
            logger.exception("Model asset %s install failed unexpectedly", asset.id)
            self._failures[asset.id] = "asset_download_failed"
        finally:
            if staged is not None:
                staged.discard()
            self._tasks.pop(asset.id, None)
            self._progress.pop(asset.id, None)


__all__ = [
    "AssetBusyError",
    "AssetRemovalRefusedError",
    "ModelAssetService",
    "RemovalGuard",
    "UnknownAssetError",
    "load_packaged_asset_catalog",
]
