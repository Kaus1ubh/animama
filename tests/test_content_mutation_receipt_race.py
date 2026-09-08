"""Commit failure must not adopt a different queued command's success or journal."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from copy import deepcopy
from pathlib import Path
from typing import Any, cast

import pytest

from animama.adapters.content_store import FilesystemContentStore
from animama.app.ports.content_catalog import ContentCatalog
from animama.app.services.local_content_mutations import LocalContentMutations
from animama.domain.content_catalog import ContentConflictError, ContentKind
from tests.content_package_helpers import vrma


class SharedCatalog:
    """Expose one committed receipt table and a fair Local transaction lock."""

    def __init__(self) -> None:
        self.lock = asyncio.Lock()
        self.receipts: dict[tuple[str, str], dict[str, Any]] = {}


class RacingCatalog:
    """Inject a failed commit and pause the queued request before journal cleanup."""

    def __init__(self, shared: SharedCatalog, *, fail_first_commit: bool) -> None:
        self.shared = shared
        self.fail_first_commit = fail_first_commit
        self.attempts = 0
        self.waiting_for_source = asyncio.Event()
        self.waiting_for_cleanup = asyncio.Event()
        self.allow_cleanup = asyncio.Event()

    @asynccontextmanager
    async def mutation_transaction(self) -> AsyncIterator[None]:
        self.attempts += 1
        attempt = self.attempts
        if not self.fail_first_commit and attempt == 2:
            self.waiting_for_cleanup.set()
            await self.allow_cleanup.wait()
        self.waiting_for_source.set()
        async with self.shared.lock:
            before = deepcopy(self.shared.receipts)
            try:
                yield
                if self.fail_first_commit and attempt == 1:
                    raise ConnectionError("Commit outcome was unavailable to the first request")
            except BaseException:
                self.shared.receipts = before
                raise

    async def get_mutation_receipt(self, *, user_id: str, operation_id: str) -> dict[str, Any] | None:
        return deepcopy(self.shared.receipts.get((user_id, operation_id)))

    async def record_mutation_receipt(
        self, *, user_id: str, operation_id: str, request_digest: str, result: dict[str, Any]
    ) -> None:
        assert self.shared.lock.locked()
        self.shared.receipts[user_id, operation_id] = deepcopy({"request_digest": request_digest, "result": result})


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


@pytest.mark.parametrize("same_command", [False, True], ids=["changed-command", "same-command"])
async def test_commit_failure_rechecks_queued_success_identity_before_adopting_result_or_cleaning_journal(
    tmp_path: Path, same_command: bool
) -> None:
    shared = SharedCatalog()
    first_catalog = RacingCatalog(shared, fail_first_commit=True)
    queued_catalog = RacingCatalog(shared, fail_first_commit=False)
    first_store, queued_store = store_at(tmp_path), store_at(tmp_path)
    first = LocalContentMutations(store=first_store, catalog=cast(ContentCatalog, first_catalog))
    queued = LocalContentMutations(store=queued_store, catalog=cast(ContentCatalog, queued_catalog))
    save(first_store, "before")
    destination = tmp_path / "local/gestures/wave.vrma"
    first_published = asyncio.Event()
    allow_first_commit = asyncio.Event()
    queued_label = "first" if same_command else "different"
    queued_digest = "a" * 64 if same_command else "b" * 64

    async def first_action() -> str:
        await asyncio.to_thread(save, first_store, "first")
        first_published.set()
        await allow_first_commit.wait()
        return "first uncommitted response"

    async def queued_action() -> str:
        # The second request must recover the failed first publication before
        # publishing, even though both commands use the same owner/operation ID.
        assert destination.read_bytes() == vrma("before")
        await asyncio.to_thread(save, queued_store, queued_label)
        return "queued committed response"

    first_request = asyncio.create_task(
        first.run(user_id="owner", operation_id="save", request_digest="a" * 64, result_type=str, action=first_action)
    )
    queued_request: asyncio.Task[str] | None = None
    try:
        await asyncio.wait_for(first_published.wait(), timeout=2)
        queued_request = asyncio.create_task(
            queued.run(
                user_id="owner",
                operation_id="save",
                request_digest=queued_digest,
                result_type=str,
                action=queued_action,
            )
        )
        await asyncio.wait_for(queued_catalog.waiting_for_source.wait(), timeout=2)
        allow_first_commit.set()
        await asyncio.wait_for(queued_catalog.waiting_for_cleanup.wait(), timeout=2)

        if same_command:
            assert await asyncio.wait_for(first_request, timeout=2) == "queued committed response"
        else:
            with pytest.raises(ContentConflictError, match="operation_id_reused"):
                await asyncio.wait_for(first_request, timeout=2)
            # The new request has committed but still owns its pending cleanup.
            # A mismatched first request must leave its new journal untouched.
            pending = queued_store.pending_mutations()
            assert len(pending) == 1
            assert pending[0].request_digest == queued_digest

        assert destination.read_bytes() == vrma(queued_label)
        queued_catalog.allow_cleanup.set()
        assert await asyncio.wait_for(queued_request, timeout=2) == "queued committed response"
        assert queued_store.pending_mutations() == ()
        assert shared.receipts["owner", "save"] == {
            "request_digest": queued_digest,
            "result": {"value": "queued committed response"},
        }

        async def next_action() -> str:
            await asyncio.to_thread(save, first_store, "next")
            return "next success"

        # A service instance remains usable after losing the operation-ID race;
        # its old in-memory journal must not poison later independent requests.
        assert (
            await first.run(
                user_id="owner",
                operation_id="next-save",
                request_digest="c" * 64,
                result_type=str,
                action=next_action,
            )
            == "next success"
        )
        assert destination.read_bytes() == vrma("next")
        assert first_store.pending_mutations() == ()
    finally:
        allow_first_commit.set()
        queued_catalog.allow_cleanup.set()
        await asyncio.gather(first_request, *([queued_request] if queued_request else []), return_exceptions=True)
