"""Cancelled requests retain the Local lock until file workers and receipts settle."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any, cast

import pytest

from animama.adapters.content_store import FilesystemContentStore
from animama.app.ports.content_catalog import ContentCatalog
from animama.app.services.local_content_mutations import LocalContentMutations
from animama.domain.content_catalog import ContentKind
from tests.content_package_helpers import vrma


class ThreadGate:
    """Pause actual filesystem work without blocking the request's event loop."""

    def __init__(self) -> None:
        self.loop = asyncio.get_running_loop()
        self.entered = asyncio.Event()
        self.release = threading.Event()
        self.active = threading.Event()
        self.finished = threading.Event()

    def run(self, action: Callable[[], None]) -> None:
        self.active.set()
        self.loop.call_soon_threadsafe(self.entered.set)
        try:
            if not self.release.wait(timeout=5):
                raise TimeoutError("Test did not release the filesystem worker")
            action()
        finally:
            self.active.clear()
            self.finished.set()


class TransactionCatalog:
    """Model transaction ownership while observing a real filesystem worker."""

    def __init__(self, worker: ThreadGate) -> None:
        self.worker = worker
        self.lock = asyncio.Lock()
        self.receipts: dict[tuple[str, str], dict[str, Any]] = {}
        self.released_during_worker = False
        self.completed_transactions = 0

    @asynccontextmanager
    async def mutation_transaction(self) -> AsyncIterator[None]:
        async with self.lock:
            before = deepcopy(self.receipts)
            try:
                yield
            except BaseException:
                self.receipts = before
                raise
            finally:
                self.released_during_worker |= self.worker.active.is_set()
                self.completed_transactions += 1

    async def get_mutation_receipt(self, *, user_id: str, operation_id: str) -> dict[str, Any] | None:
        return deepcopy(self.receipts.get((user_id, operation_id)))

    async def record_mutation_receipt(
        self, *, user_id: str, operation_id: str, request_digest: str, result: dict[str, Any]
    ) -> None:
        assert self.lock.locked(), "Success must be recorded under the Local transaction lock"
        self.receipts[user_id, operation_id] = deepcopy({"request_digest": request_digest, "result": result})


def store_at(root: Path) -> FilesystemContentStore:
    for name in ("included", "local", "operations"):
        (root / name).mkdir(exist_ok=True)
    return FilesystemContentStore(
        included_root=root / "included", local_root=root / "local", operations_root=root / "operations"
    )


def save(store: FilesystemContentStore, label: str) -> None:
    store.save_standalone(
        kind=ContentKind.GESTURE,
        relative_locator="gestures/wave.vrma",
        payload=vrma(label),
        operation_id=f"save-{label}",
    )


async def assert_request_still_owns_worker(request: asyncio.Task[Any], catalog: TransactionCatalog) -> None:
    """Allow cancellation delivery, then observe that the request cannot finish yet."""

    with pytest.raises(asyncio.TimeoutError):
        await asyncio.wait_for(asyncio.shield(request), timeout=0.025)
    assert catalog.lock.locked()
    assert catalog.completed_transactions == 0
    assert not catalog.released_during_worker


async def test_double_cancel_during_promotion_finishes_files_and_receipt_before_releasing_lock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = store_at(tmp_path)
    save(store, "before")
    worker = ThreadGate()
    catalog = TransactionCatalog(worker)
    mutations = LocalContentMutations(store=store, catalog=cast(ContentCatalog, catalog))
    replace = store._replace_local

    def paused_replace(staged: Path, destination: Path) -> None:
        replace(staged, destination)
        worker.run(lambda: None)

    monkeypatch.setattr(store, "_replace_local", paused_replace)

    async def publish() -> str:
        await asyncio.to_thread(save, store, "after")
        return "original success"

    request = asyncio.create_task(
        mutations.run(
            user_id="owner",
            operation_id="publish-wave",
            request_digest="a" * 64,
            result_type=str,
            action=publish,
        )
    )
    try:
        await asyncio.wait_for(worker.entered.wait(), timeout=2)
        assert (tmp_path / "local/gestures/wave.vrma").read_bytes() == vrma("after")
        request.cancel("request disconnected")
        await asyncio.sleep(0)
        request.cancel("shutdown followed disconnect")
        await assert_request_still_owns_worker(request, catalog)
        worker.release.set()
        with pytest.raises(asyncio.CancelledError) as cancelled:
            await request
        assert cancelled.value.args == ("request disconnected",)
    finally:
        worker.release.set()
        await asyncio.gather(request, return_exceptions=True)

    assert worker.finished.is_set()
    assert not catalog.lock.locked()
    assert not catalog.released_during_worker
    assert (tmp_path / "local/gestures/wave.vrma").read_bytes() == vrma("after")
    assert catalog.receipts["owner", "publish-wave"]["result"] == {"value": "original success"}
    assert store.pending_mutations() == ()


async def test_cancel_during_rescan_recovery_keeps_lock_until_original_bytes_are_restored(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    crashed = store_at(tmp_path)
    save(crashed, "before")
    crashed.begin_mutation(user_id="owner", operation_id="interrupted-save", request_digest="b" * 64)
    save(crashed, "after")
    store = store_at(tmp_path)
    worker = ThreadGate()
    catalog = TransactionCatalog(worker)
    mutations = LocalContentMutations(store=store, catalog=cast(ContentCatalog, catalog))
    recover = store.recover_mutations

    def paused_recovery(*, committed_journal_ids: set[str]) -> None:
        worker.run(lambda: recover(committed_journal_ids=committed_journal_ids))

    monkeypatch.setattr(store, "recover_mutations", paused_recovery)
    scanned_bytes: list[bytes] = []

    async def scan() -> None:
        scanned_bytes.append(await asyncio.to_thread((tmp_path / "local/gestures/wave.vrma").read_bytes))

    request = asyncio.create_task(mutations.reconcile(scan))
    try:
        await asyncio.wait_for(worker.entered.wait(), timeout=2)
        request.cancel("rescan caller disconnected")
        await assert_request_still_owns_worker(request, catalog)
        assert not scanned_bytes
        worker.release.set()
        with pytest.raises(asyncio.CancelledError) as cancelled:
            await request
        assert cancelled.value.args == ("rescan caller disconnected",)
    finally:
        worker.release.set()
        await asyncio.gather(request, return_exceptions=True)

    assert worker.finished.is_set()
    assert not catalog.lock.locked()
    assert not catalog.released_during_worker
    assert scanned_bytes == [vrma("before")]
    assert (tmp_path / "local/gestures/wave.vrma").read_bytes() == vrma("before")
    assert store.pending_mutations() == ()
