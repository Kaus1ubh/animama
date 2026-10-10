"""Composition-owned atomic publication and catalog projection boundaries.

An account composition binds every adapter to the same server-resolved owner.
The mutation coordinator owns the transaction, staged byte visibility, durable
receipt and recovery. A refresh publishes validated projections, not a host scan.
The local composition retains its filesystem journal/scanner implementations.
"""

from collections.abc import Awaitable, Callable
from typing import Protocol, TypeVar

from animama.app.ports.content_catalog import ContentCatalog
from animama.app.ports.content_store import ContentStore
from animama.domain.content_catalog import ContentScanSummary

T = TypeVar("T")


class ContentMutations(Protocol):
    """A receipt is authoritative even after temporary bytes or results disappear.

    Implementations must serialize conflicting writes, join nested work, finish
    owned work before propagating cancellation, and settle unknown commit results
    from the durable receipt. A changed digest must never reuse an operation ID.
    """

    @property
    def store(self) -> ContentStore: ...

    @property
    def catalog(self) -> ContentCatalog: ...

    async def reconcile(self, action: Callable[[], Awaitable[T]]) -> T: ...

    async def run(
        self,
        *,
        user_id: str,
        operation_id: str,
        request_digest: str,
        result_type: type[T],
        action: Callable[[], Awaitable[T]],
    ) -> T: ...

    def has_pending(self, *, user_id: str, operation_id: str) -> bool:
        """Identify unresolved publication without exposing storage journals."""
        ...


class ContentPublication(Protocol):
    """Admit verified projections in the mutation coordinator's transaction.

    Account adapters must scope locator lookup, locks, receipts, deletion and
    byte access to owner_id; Included remains immutable and shared. Refresh must
    never reconcile another owner's entries as missing or expose pending bytes.
    Included projections must come from a scan that resolved optional edges
    (``resolve_optional_dependencies``) over every mounted Included source.
    """

    owner_id: str

    async def refresh(
        self,
        *,
        user_id: str,
        include_included: bool,
        creator_claim_locator: str | None,
        planned_item_ids: dict[str, str] | None,
    ) -> tuple[ContentScanSummary, ...]: ...
