"""Install, report, serve and remove pinned model assets.

Installs are single-flight per asset within this process: concurrent requests
share one background download. Each file is streamed to a private staging file,
checked for exact length and SHA-256, and the complete asset (one file or a
whole set) is then atomically activated by the store. A partial set is never
installed.

Interrupted transfers resume: staged bytes survive failures, cancellation of
the process and restarts, are rehashed when the file is reopened, and the
remainder is requested with an HTTP range. A body that breaks mid-stream is
requested again from its staged prefix after a short backoff before the install
fails. An integrity failure discards that file's staged bytes and is never
retried, and an explicit cancel or removal discards all of them.

Progress, failures and use leases are in memory; installed state is read from
the store, so it survives restarts.
"""

from __future__ import annotations

import asyncio
import contextlib
import inspect
import json
import logging
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from importlib.resources import files
from pathlib import Path
from typing import Any, Final, TypeVar

from animama.app.ports.model_assets import AssetFetcher, AssetFetchError, ModelAssetStore, StagedFile
from animama.domain.model_assets import (
    AssetCatalog,
    AssetDescriptor,
    AssetFailureReason,
    AssetFile,
    AssetRemovalVeto,
    AssetState,
    parse_asset_catalog,
)

logger = logging.getLogger(__name__)

PACKAGED_ASSET_CATALOG = "model-assets.v1.json"
# A renderer renews its use lease well within this window (every 10 seconds).
LEASE_TTL_SECONDS: Final = 30.0
# Bounds memory if a client keeps inventing lease IDs; expired leases are pruned first.
MAX_LEASES_PER_ASSET: Final = 32
# Seconds to wait before each resume of a body that broke mid-stream. Once they
# are spent the interruption fails the install; an attempt that grew the staged
# prefix starts the schedule again, so a slow, flaky link keeps making progress.
TRANSFER_RETRY_DELAYS: Final = (1.0, 2.0, 4.0)

T = TypeVar("T")

# A guard may veto removal of an installed asset, synchronously or asynchronously.
RemovalGuard = Callable[[AssetDescriptor], AssetRemovalVeto | None | Awaitable[AssetRemovalVeto | None]]


class UnknownAssetError(LookupError):
    """The ID is not in this release's catalog."""


class AssetBusyError(Exception):
    """The asset is being removed; retry once removal settles."""


class AssetRemovalRefusedError(Exception):
    """A guard refused removal of an installed asset."""

    def __init__(self, veto: AssetRemovalVeto) -> None:
        super().__init__(veto.code)
        self.veto = veto


class AssetInstallRefusedError(Exception):
    """An install cannot start; ``code`` and ``details`` are client-safe."""

    def __init__(self, code: str, details: Mapping[str, Any]) -> None:
        super().__init__(code)
        self.code = code
        self.details = details


class AssetNotInstalledError(Exception):
    """The operation needs an installed asset."""


class AssetLeaseLimitError(Exception):
    """The asset already holds the maximum number of live leases."""


@dataclass(frozen=True, slots=True)
class InstalledAssetSet:
    """A servable installed set: its trusted version directory and pinned files."""

    root: Path
    version: str
    files: tuple[AssetFile, ...]


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
    """Own the install lifecycle for one catalog and one installation store.

    Two removal guards are built in: a live use lease refuses removal with
    ``model_asset_in_use``, and an installed or downloading dependent refuses
    removal of its requirement with ``model_asset_required_by``. ``clock`` is a
    monotonic time source and ``sleep`` waits out a transfer retry delay; both
    are replaceable in tests.
    """

    def __init__(
        self,
        catalog: AssetCatalog,
        store: ModelAssetStore,
        fetcher: AssetFetcher,
        *,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], Awaitable[None]] = asyncio.sleep,
    ) -> None:
        self._catalog = catalog
        self._store = store
        self._fetcher = fetcher
        self._clock = clock
        self._sleep = sleep
        self._tasks: dict[str, asyncio.Task[None]] = {}
        self._progress: dict[str, int] = {}
        self._verified: dict[str, int] = {}
        self._failures: dict[str, AssetFailureReason] = {}
        self._leases: dict[str, dict[str, float]] = {}
        self._guards: list[RemovalGuard] = [self._lease_guard, self._dependency_guard]
        # Assets whose removal (cancel, guards, delete) is in progress.
        self._removing: set[str] = set()
        # No install can be running yet. Keep resumable staging; drop the rest,
        # including stored data for IDs this release no longer catalogs.
        store.prune(catalog)

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
                files_verified=self._verified.get(asset.id, 0),
            )
        if self._store.is_installed(asset):
            return AssetState(asset, "installed", files_verified=len(asset.files))
        reason = self._failures.get(asset.id)
        if reason is not None:
            return AssetState(asset, "failed", reason=reason)
        return AssetState(asset, "not_installed")

    def _installed(self, asset: AssetDescriptor) -> bool:
        return asset.id not in self._tasks and self._store.is_installed(asset)

    def install(self, asset_id: str) -> AssetState:
        """Start (or join) the asset's download and return its current state.

        Idempotent: an installed asset stays installed and an in-flight
        download is shared rather than restarted. Raises ``AssetBusyError``
        while the asset is being removed, so a new download never races the
        deletion of its directory, and ``AssetInstallRefusedError``
        (``model_asset_requires``) until every required asset is installed.
        Without enough free space for the remaining bytes plus headroom
        nothing is fetched, and the state reports ``asset_insufficient_space``
        (``asset_store_failed`` if free space cannot be measured).
        """

        asset = self._descriptor(asset_id)
        if asset.id in self._removing:
            raise AssetBusyError(asset.id)
        if asset.id in self._tasks or self._store.is_installed(asset):
            return self._state(asset)
        # A requirement being removed counts as missing: its deletion may
        # already have passed the dependency guard.
        missing = [
            required
            for required in asset.requires
            if required in self._removing or not self._installed(self._descriptor(required))
        ]
        if missing:
            raise AssetInstallRefusedError("model_asset_requires", {"requires": missing})
        free = self.free_bytes()
        try:
            staged = self._store.staged_bytes(asset)
        except OSError:
            staged = 0
        if free is None:
            self._failures[asset.id] = "asset_store_failed"
            return self._state(asset)
        if free < asset.free_bytes_needed(staged):
            self._failures[asset.id] = "asset_insufficient_space"
            return self._state(asset)
        self._failures.pop(asset.id, None)
        self._progress[asset.id] = staged
        self._verified[asset.id] = 0
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

        Cancelling discards every staged byte. Removal of an installed asset
        first asks every guard; the first veto raises
        ``AssetRemovalRefusedError`` and leaves the asset installed. Installs
        and other removals of the same asset raise ``AssetBusyError`` until
        this call settles. A filesystem error is reported as a failed state
        with ``asset_store_failed``.
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
                if self._store.is_installed(asset):
                    await _run_blocking(self._store.remove, asset)
                await _run_blocking(self._store.discard_staged, asset)
            except OSError:
                logger.exception("Model asset %s could not be removed", asset.id)
                self._failures[asset.id] = "asset_store_failed"
                return AssetState(asset, "failed", reason="asset_store_failed")
            return self._state(asset)
        finally:
            self._removing.discard(asset.id)

    # Use leases

    def acquire_lease(self, asset_id: str, lease_id: str) -> float:
        """Acquire or renew a use lease on an installed asset; return its TTL in seconds.

        While any lease is live, removal is refused with ``model_asset_in_use``.
        Raises ``AssetBusyError`` during removal, ``AssetNotInstalledError``
        when the asset is not installed and ``AssetLeaseLimitError`` when a new
        lease would exceed ``MAX_LEASES_PER_ASSET``.
        """

        asset = self._descriptor(asset_id)
        if asset.id in self._removing:
            raise AssetBusyError(asset.id)
        if not self._installed(asset):
            raise AssetNotInstalledError(asset.id)
        leases = self._live_leases(asset.id)
        if lease_id not in leases and len(leases) >= MAX_LEASES_PER_ASSET:
            raise AssetLeaseLimitError(asset.id)
        leases[lease_id] = self._clock() + LEASE_TTL_SECONDS
        self._leases[asset.id] = leases
        return LEASE_TTL_SECONDS

    def release_lease(self, asset_id: str, lease_id: str) -> None:
        """Release a lease; releasing an unknown or expired lease is a no-op."""

        asset = self._descriptor(asset_id)
        leases = self._live_leases(asset.id)
        leases.pop(lease_id, None)
        if leases:
            self._leases[asset.id] = leases
        else:
            self._leases.pop(asset.id, None)

    def _live_leases(self, asset_id: str) -> dict[str, float]:
        now = self._clock()
        return {lease: expiry for lease, expiry in self._leases.get(asset_id, {}).items() if expiry > now}

    def _lease_guard(self, asset: AssetDescriptor) -> AssetRemovalVeto | None:
        if self._live_leases(asset.id):
            return AssetRemovalVeto("model_asset_in_use")
        return None

    def _dependency_guard(self, asset: AssetDescriptor) -> AssetRemovalVeto | None:
        dependents = [
            dependent.id
            for dependent in self._catalog.required_by(asset.id)
            if dependent.id in self._tasks or self._store.is_installed(dependent)
        ]
        if dependents:
            return AssetRemovalVeto("model_asset_required_by", {"required_by": dependents})
        return None

    # Serving

    def installed_location(self, asset_id: str) -> tuple[AssetDescriptor, Path, str] | None:
        """Return the descriptor and servable location of an installed single-file asset."""

        asset = self._descriptor(asset_id)
        if asset.is_set or not self._installed(asset):
            return None
        root, name = self._store.content_location(asset)
        return asset, root, name

    def installed_set(self, asset_id: str) -> InstalledAssetSet | None:
        """Return the servable directory, version and files of an installed set."""

        asset = self._descriptor(asset_id)
        if not asset.is_set or not self._installed(asset):
            return None
        return InstalledAssetSet(self._store.set_directory(asset), asset.version, asset.files)

    def installed_version(self, asset_id: str) -> str | None:
        """Return the installed version (manifest or file digest), or ``None``."""

        asset = self._descriptor(asset_id)
        return asset.version if self._installed(asset) else None

    async def aclose(self) -> None:
        """Cancel in-flight downloads; their staged bytes are kept for resume."""

        tasks = list(self._tasks.values())
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.wait(tasks)

    # Download

    async def _download(self, asset: AssetDescriptor) -> None:
        try:
            completed = 0
            for index, file in enumerate(asset.files):
                await self._download_file(asset, file, completed)
                completed += file.size
                self._verified[asset.id] = index + 1
            await _run_blocking(self._store.commit, asset)
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
            self._tasks.pop(asset.id, None)
            self._progress.pop(asset.id, None)
            self._verified.pop(asset.id, None)

    async def _download_file(self, asset: AssetDescriptor, file: AssetFile, completed: int) -> None:
        """Stage and verify one file, resuming from any staged prefix.

        ``completed`` is the size of the set's files already verified, so
        progress reports the whole asset.
        """

        staged: StagedFile = await _run_blocking(self._store.open_staged, asset, file)
        try:
            self._progress[asset.id] = completed + staged.size
            await self._stream_remainder(asset, file, staged, completed)
            if staged.size != file.size:
                raise _InstallFailure("asset_size_invalid")
            if staged.hexdigest() != file.sha256:
                raise _InstallFailure("asset_hash_invalid")
            await _run_blocking(staged.close)
        except _InstallFailure:
            # Corrupt or oversized bytes can never resume; the next attempt starts over.
            staged.discard()
            raise
        except BaseException:
            # Transfer failures and cancellation keep a staged prefix for resume.
            with contextlib.suppress(OSError):
                if staged.size:
                    staged.close()
                else:
                    staged.discard()
            raise

    async def _stream_remainder(
        self, asset: AssetDescriptor, file: AssetFile, staged: StagedFile, completed: int
    ) -> None:
        """Fetch the bytes after the staged prefix, resuming a body that breaks mid-stream.

        Each interruption waits for the next ``TRANSFER_RETRY_DELAYS`` entry and
        requests the remainder again. The last interruption, and any failure
        before a response body was accepted, propagates. The staged file stays
        open across attempts, so a resume does not rehash the prefix.
        """

        retries = 0
        while staged.size < file.size:
            prefix = staged.size
            interruption = await self._stream_once(asset, file, staged, completed)
            if interruption is None:
                return
            if staged.size > prefix:
                retries = 0
            if retries == len(TRANSFER_RETRY_DELAYS):
                raise interruption
            delay = TRANSFER_RETRY_DELAYS[retries]
            retries += 1
            logger.warning(
                "Model asset %s file %s stopped at %d of %d bytes; resuming in %g s: %s",
                asset.id,
                file.path,
                staged.size,
                file.size,
                delay,
                interruption,
            )
            # Cancel and removal interrupt this wait like any other download step.
            await self._sleep(delay)

    async def _stream_once(
        self, asset: AssetDescriptor, file: AssetFile, staged: StagedFile, completed: int
    ) -> AssetFetchError | None:
        """Append one response body to ``staged`` from its current size.

        Returns the fetch error when the body breaks after the response was
        accepted, leaving the received bytes staged. Refused responses and
        bodies longer than the pinned size raise.
        """

        async with self._fetcher.stream(asset.id, file, start=staged.size) as body:
            if body.start != staged.size:
                # The server sent the whole file instead of the remainder.
                await _run_blocking(staged.restart)
            try:
                async for chunk in body.chunks:
                    # Abort as soon as the stream exceeds the pinned length.
                    if staged.size + len(chunk) > file.size:
                        raise _InstallFailure("asset_size_invalid")
                    await _run_blocking(staged.write, chunk)
                    self._progress[asset.id] = completed + staged.size
            except AssetFetchError as error:
                return error
        return None


__all__ = [
    "LEASE_TTL_SECONDS",
    "TRANSFER_RETRY_DELAYS",
    "AssetBusyError",
    "AssetInstallRefusedError",
    "AssetLeaseLimitError",
    "AssetNotInstalledError",
    "AssetRemovalRefusedError",
    "InstalledAssetSet",
    "ModelAssetService",
    "RemovalGuard",
    "UnknownAssetError",
    "load_packaged_asset_catalog",
]
