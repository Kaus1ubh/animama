"""Own Local publication, durable replay, and filesystem compensation.

The catalog transaction is the completion authority. Filesystem journals remain
recoverable until that transaction commits; startup resolves them using the same
receipts rather than guessing from whichever files happened to survive.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import Awaitable, Callable, Coroutine
from contextvars import ContextVar
from typing import Any, BinaryIO, TypeVar

from pydantic import TypeAdapter

from animama.app.ports.content_catalog import ContentCatalog
from animama.app.ports.content_store import LocalContentStore
from animama.domain.content_catalog import ContentConflictError

T = TypeVar("T")
_OPERATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")


async def _finish_owned_work(operation: Coroutine[Any, Any, T]) -> T:
    """Keep session/lock/file lifetimes intact despite repeated cancellation."""

    task = asyncio.create_task(operation)
    cancellation: asyncio.CancelledError | None = None
    while True:
        try:
            result = await asyncio.shield(task)
            break
        except asyncio.CancelledError as exc:
            if task.cancelled():
                raise
            if cancellation is None:
                cancellation = exc
            # Continue shielding: awaiting the task directly here would let a
            # second cancellation abandon a still-running filesystem thread.
        except BaseException as exc:
            if cancellation is not None:
                raise cancellation from exc
            raise
    if cancellation is not None:
        raise cancellation
    return result


def mutation_digest(command: dict[str, object], streams: tuple[BinaryIO, ...] = ()) -> str:
    """Bind retries to the complete command and bytes while retaining positions."""

    digests: list[str] = []
    for stream in streams:
        position = stream.tell()
        try:
            stream.seek(0)
            digest = hashlib.sha256()
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
            digests.append(digest.hexdigest())
        finally:
            stream.seek(position)
    encoded = json.dumps({"command": command, "streams": digests}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(encoded.encode()).hexdigest()


class LocalContentMutations:
    """One owner for the catalog/store pair and their publication lifetime."""

    def __init__(self, *, store: LocalContentStore, catalog: ContentCatalog) -> None:
        self.store = store
        self.catalog = catalog
        self._active: ContextVar[bool] = ContextVar("local_content_mutation_active", default=False)

    def has_pending(self, *, user_id: str, operation_id: str) -> bool:
        """Keep filesystem journal identities behind the publication boundary."""
        return any(
            item.user_id == user_id and item.operation_id == operation_id for item in self.store.pending_mutations()
        )

    async def _recover(self) -> None:
        """Resolve journals only while holding the Local source transaction lock."""

        pending = await asyncio.to_thread(self.store.pending_mutations)
        committed: set[str] = set()
        for journal in pending:
            receipt = await self.catalog.get_mutation_receipt(
                user_id=journal.user_id, operation_id=journal.operation_id
            )
            if receipt is not None:
                if receipt["request_digest"] != journal.request_digest:
                    raise ContentConflictError("operation_id_reused")
                committed.add(journal.journal_id)
        await asyncio.to_thread(self.store.recover_mutations, committed_journal_ids=committed)

    async def reconcile(self, action: Callable[[], Awaitable[T]]) -> T:
        """Recover before scanning; nested mutation scans share its transaction."""

        if self._active.get():
            return await action()
        return await _finish_owned_work(self._reconcile(action))

    async def _reconcile(self, action: Callable[[], Awaitable[T]]) -> T:
        async with self.catalog.mutation_transaction():
            await self._recover()
            token = self._active.set(True)
            try:
                return await action()
            finally:
                self._active.reset(token)

    async def run(
        self,
        *,
        user_id: str,
        operation_id: str,
        request_digest: str,
        result_type: type[T],
        action: Callable[[], Awaitable[T]],
    ) -> T:
        """Finish publication even if the requesting connection is cancelled."""

        owner_id = getattr(self.store, "owner_id", None)
        if owner_id is not None and user_id != owner_id:
            from animama.domain.content_catalog import ContentNotFoundError

            raise ContentNotFoundError("content owner was not found")
        return await _finish_owned_work(
            self._run(
                user_id=user_id,
                operation_id=operation_id,
                request_digest=request_digest,
                result_type=result_type,
                action=action,
            )
        )

    async def _run(
        self,
        *,
        user_id: str,
        operation_id: str,
        request_digest: str,
        result_type: type[T],
        action: Callable[[], Awaitable[T]],
    ) -> T:
        """Return original success or publish once, compensating uncommitted work.

        Result snapshots are private owner-scoped receipts; they are deliberately
        independent of live catalog rows so later edits/deletion cannot replay a
        write. No caller finalizes a journal or commits a partial catalog result.
        """

        if not _OPERATION_ID.fullmatch(operation_id):
            raise ContentConflictError("invalid_operation_id")
        adapter = TypeAdapter(result_type)
        journal_id: str | None = None
        result: T
        try:
            async with self.catalog.mutation_transaction():
                receipt = await self.catalog.get_mutation_receipt(user_id=user_id, operation_id=operation_id)
                if receipt is not None:
                    if receipt["request_digest"] != request_digest:
                        raise ContentConflictError("operation_id_reused")
                    return adapter.validate_python(receipt["result"]["value"])
                await self._recover()
                journal_id = await asyncio.to_thread(
                    self.store.begin_mutation,
                    user_id=user_id,
                    operation_id=operation_id,
                    request_digest=request_digest,
                )
                token = self._active.set(True)
                try:
                    result = await action()
                    await self.catalog.record_mutation_receipt(
                        user_id=user_id,
                        operation_id=operation_id,
                        request_digest=request_digest,
                        result={"value": adapter.dump_python(result, mode="json")},
                    )
                finally:
                    self._active.reset(token)
        except BaseException as exc:
            if journal_id is not None:
                # Reacquire the source lock after rollback. A failed commit can
                # have succeeded remotely, so consult its durable outcome first.
                async with self.catalog.mutation_transaction():
                    receipt = await self.catalog.get_mutation_receipt(user_id=user_id, operation_id=operation_id)
                    await asyncio.to_thread(
                        self.store.finalize_mutation,
                        journal_id=journal_id,
                        commit=receipt is not None,
                        expected_request_digest=request_digest,
                    )
                    if receipt is not None and receipt["request_digest"] != request_digest:
                        # A queued retry can recover our failed journal and
                        # publish a different command before we reacquire.
                        raise ContentConflictError("operation_id_reused") from exc
                    if receipt is not None:
                        return adapter.validate_python(receipt["result"]["value"])
            raise
        # A crash here is resolved by _recover using the committed receipt.
        async with self.catalog.mutation_transaction():
            await asyncio.to_thread(
                self.store.finalize_mutation,
                journal_id=journal_id,
                commit=True,
                expected_request_digest=request_digest,
            )
        return result
