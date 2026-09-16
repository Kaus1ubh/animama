"""Use cases for scanning, listing, and opening readable local content."""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from animama.app.ports.content_catalog import ContentCatalog
from animama.app.ports.content_store import ContentStore
from animama.app.services.content_access_policy import ContentAccessPolicy
from animama.app.services.local_content_mutations import LocalContentMutations, mutation_digest
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentConflictError,
    ContentNotFoundError,
    ContentPreview,
    ContentPreviewFile,
    ContentScanSummary,
    ContentScope,
    ContentSource,
    ContentStatus,
    VerifiedContentFile,
)


@dataclass(frozen=True, slots=True)
class ContentRescanResult:
    """Authoritative scan counts and the caller-visible catalog."""

    summaries: tuple[ContentScanSummary, ...]
    items: tuple[CatalogContentEntry, ...]


class ContentCatalogService:
    """Coordinate the filesystem and catalog without depending on FastAPI."""

    def __init__(
        self,
        *,
        store: ContentStore,
        catalog: ContentCatalog,
    ) -> None:
        self._store = store
        self._catalog = catalog
        self.mutations = LocalContentMutations(store=store, catalog=catalog)

    async def rescan(
        self, *, user_id: str, include_included: bool = True, creator_claim_locator: str | None = None
    ) -> ContentRescanResult:
        """Recover unfinished mutations before admitting a complete source scan."""

        return await self.mutations.reconcile(
            lambda: self._rescan(
                user_id=user_id, include_included=include_included, creator_claim_locator=creator_claim_locator
            )
        )

    async def _rescan(
        self, *, user_id: str, include_included: bool, creator_claim_locator: str | None
    ) -> ContentRescanResult:
        """Scan registered roots; a bad entry never prevents reconciliation of peers."""

        sources = [ContentSource.LOCAL]
        if include_included:
            sources.insert(0, ContentSource.INCLUDED)
        summaries: list[ContentScanSummary] = []
        included_mount_ids = getattr(self._store, "included_mount_ids", None)
        for source in sources:
            # A coordinated Save holds this fence from file promotion through
            # owner admission. Scan only after that commit, never in its gap.
            await self._catalog.lock_source(source=source)
            scanned = await asyncio.to_thread(self._store.scan, source)
            if source is ContentSource.INCLUDED:
                scope = ContentScope.INCLUDED
                owner_user_id = None
            else:
                scope = ContentScope.OWNER
                owner_user_id = user_id
            reconciled = await self._catalog.reconcile_source(
                source=source,
                entries=scanned,
                new_item_scope=scope,
                new_item_owner_user_id=owner_user_id,
                creator_claim=(creator_claim_locator, user_id)
                if source is ContentSource.LOCAL and creator_claim_locator
                else None,
                **(
                    {"active_included_mount_ids": included_mount_ids}
                    if source is ContentSource.INCLUDED and included_mount_ids is not None
                    else {}
                ),
            )
            summaries.append(
                ContentScanSummary(
                    source=source,
                    scanned=len(scanned),
                    valid=sum(item.status is ContentStatus.VALID for item in reconciled),
                    invalid=sum(item.status is ContentStatus.INVALID for item in reconciled),
                    missing=sum(item.status is ContentStatus.MISSING for item in reconciled),
                )
            )
        visible = await self._catalog.list_visible(user_id=user_id)
        return ContentRescanResult(tuple(summaries), tuple(visible))

    async def list_visible(self, *, user_id: str) -> list[CatalogContentEntry]:
        return await self._catalog.list_visible(user_id=user_id)

    async def delete_item(
        self,
        *,
        item_id: str,
        user_id: str,
        expected_revision: str,
    ) -> None:
        """Delete one exact revision with compensation until catalog commit."""

        await self.mutations.run(
            user_id=user_id,
            operation_id=str(uuid4()),
            request_digest=mutation_digest({"operation": "delete", "item_id": item_id, "revision": expected_revision}),
            result_type=type(None),
            action=lambda: self._delete_item(item_id=item_id, user_id=user_id, expected_revision=expected_revision),
        )

    async def _delete_item(self, *, item_id: str, user_id: str, expected_revision: str) -> None:
        """Delete one exact unbound editable entry and remove its catalog identity."""

        # Hold the parent row lock through deletion so a concurrent FK-backed
        # Avatar/loadout binding cannot appear after the reference check.
        await self._catalog.lock_source(source=ContentSource.LOCAL)
        item = await self._catalog.get_visible_item(item_id=item_id, user_id=user_id, for_update=True)
        if item is None or not ContentAccessPolicy.can_mutate(entry=item, user_id=user_id):
            raise ContentNotFoundError("editable catalog item was not found")
        if item.revision_sha256 != expected_revision:
            raise ContentConflictError(
                "catalog_revision_conflict",
                current_revision=item.revision_sha256,
            )
        if await self._catalog.item_has_runtime_references(item_id=item.id):
            raise ContentConflictError("catalog_item_in_use")
        await asyncio.to_thread(self._store.delete_entry, entry=item)
        await self._catalog.purge_item(item_id=item.id)
        await self.rescan(user_id=user_id, include_included=False)

    async def open_registered_file(self, *, file_ref: str, user_id: str) -> VerifiedContentFile:
        """Authorize the opaque registration before resolving and verifying bytes."""

        registered = await self._catalog.get_visible_file(file_ref=file_ref, user_id=user_id)
        if registered is None:
            raise ContentNotFoundError("registered content file was not found")
        return await asyncio.to_thread(
            self._store.open_verified_file,
            source=registered.source,
            source_mount_id=registered.source_mount_id,
            relative_path=registered.relative_path,
            expected_size_bytes=registered.size_bytes,
            expected_sha256=registered.sha256,
            media_type=registered.media_type,
        )

    async def issue_preview_bundle(
        self,
        *,
        anchor: CatalogContentEntry,
        entries: tuple[CatalogContentEntry, ...],
        user_id: str,
        ttl_seconds: int = 300,
    ) -> ContentPreview:
        """Issue one capability from an already resolved caller-visible union."""

        unique = {entry.id: entry for entry in entries}
        if anchor.id not in unique or any(
            entry.status is not ContentStatus.VALID or entry.revision_sha256 is None for entry in unique.values()
        ):
            raise ContentNotFoundError("previewable content bundle was not found")
        return await self._catalog.create_preview_bundle(
            anchor=anchor,
            entries=tuple(unique[item_id] for item_id in sorted(unique)),
            user_id=user_id,
            expires_at=datetime.now(UTC) + timedelta(seconds=max(1, ttl_seconds)),
        )

    async def open_preview_file(
        self,
        *,
        preview_id: str,
        revision_sha256: str,
        file_ref: str,
        user_id: str,
    ) -> VerifiedContentFile:
        """Open only a file whose exact facts were frozen into this preview."""

        registered: ContentPreviewFile | None = await self._catalog.get_preview_file(
            preview_id=preview_id,
            revision_sha256=revision_sha256,
            file_ref=file_ref,
            user_id=user_id,
            now=datetime.now(UTC),
        )
        if registered is None:
            raise ContentNotFoundError("preview file was not found")
        return await asyncio.to_thread(
            self._store.open_verified_file,
            source=registered.source,
            source_mount_id=registered.source_mount_id,
            relative_path=registered.relative_path,
            expected_size_bytes=registered.size_bytes,
            expected_sha256=registered.sha256,
            media_type=registered.media_type,
        )

    async def mark_scan_required(self, *, source: ContentSource, relative_paths: tuple[str, ...]) -> None:
        await self._catalog.mark_scan_required(source=source, relative_paths=relative_paths)

    async def invalidate_watched_changes(self, *, source: ContentSource, relative_paths: tuple[str, ...]) -> None:
        """Fence external edits without invalidating a just-admitted creator save.

        Host notifications may arrive after Save has committed the same bytes.
        Reuse the bounded scanner under the publication fence to identify those
        redundant notifications. An unreadable/unknown scan still invalidates;
        only the subsequent ordinary reconciliation can admit changed content.
        """

        async def invalidate() -> None:
            await self._catalog.lock_source(source=source)
            if source is not ContentSource.LOCAL:
                # Included is never written by creator saves. Preserve its
                # unconditional license/mount invalidation semantics.
                await self._catalog.mark_scan_required(source=source, relative_paths=relative_paths)
                return
            try:
                scanned = await asyncio.to_thread(self._store.scan, source)
            except Exception:
                # Failure is uncertainty, never permission to keep serving an
                # affected revision. The scheduled rescan reports its failure.
                scanned = None
            await self._catalog.mark_scan_required(source=source, relative_paths=relative_paths, current_scan=scanned)

        try:
            await self.mutations.reconcile(invalidate)
        except Exception:
            # A blocked journal recovery is also unknown filesystem state. Its
            # failed transaction has rolled back; fence affected registrations
            # in a fresh owned transaction without claiming recovery succeeded.
            async with self._catalog.mutation_transaction():
                await self._catalog.lock_source(source=source)
                await self._catalog.mark_scan_required(source=source, relative_paths=relative_paths)


__all__ = ["ContentRescanResult", "ContentCatalogService"]
