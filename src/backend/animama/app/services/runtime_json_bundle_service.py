"""Read a bounded optional JSON bundle through the normal snapshot/file authority."""

from __future__ import annotations

import asyncio
import hashlib
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

from animama.app.ports.content_store import ContentStore
from animama.app.services.anima_runtime_service import (
    AnimaRuntimeService,
    RuntimeFileAuthorization,
    RuntimeSnapshotError,
)
from animama.domain.content_catalog import ContentIntegrityError, ContentPathError, ContentSource
from animama.domain.runtime_json_bundle import select_runtime_json_members


class RuntimeJsonBundleService:
    """Transport aggregation only: no new lease, archive, storage identity, or file permission."""

    def __init__(self, runtime: AnimaRuntimeService, store: ContentStore) -> None:
        self.runtime = runtime
        self.store = store

    async def read(self, *, user_id: str, anima_id: str, revision: str) -> dict[str, Any]:
        snapshot = await self.runtime.get_snapshot(user_id=user_id, anima_id=anima_id, revision=revision)
        if snapshot is None:
            raise RuntimeSnapshotError("runtime_file_not_found")
        if snapshot.expires_at <= datetime.now(UTC):
            raise RuntimeSnapshotError("runtime_remount_required")
        members = select_runtime_json_members(snapshot.catalog)
        if not members:
            raise RuntimeSnapshotError("runtime_file_not_found")
        # Recheck the live lease, current catalog pins, and ownership in one SQL
        # statement, rather than repeating the individual-file query for each member.
        authorizations = await self.runtime.authorize_files(
            user_id=user_id,
            anima_id=anima_id,
            revision=revision,
            file_refs=[member["file_ref"] for member in members],
        )
        entries, changed = await asyncio.to_thread(self._read_members, members, authorizations)
        if changed:
            for source, paths in changed.items():
                await self.runtime.catalog.mark_scan_required(source=source, relative_paths=tuple(paths))
            await self.runtime.session.commit()
        return {"version": 1, "revision": revision, "members": entries}

    def _read_members(
        self,
        members: list[dict[str, Any]],
        authorizations: dict[str, RuntimeFileAuthorization | RuntimeSnapshotError],
    ) -> tuple[list[dict[str, str]], dict[ContentSource, list[str]]]:
        """Keep filesystem hashing, bounded reads, and UTF-8 decoding off the event loop."""
        entries: list[dict[str, str]] = []
        changed: dict[ContentSource, list[str]] = defaultdict(list)
        for member in members:
            ref = member["file_ref"]
            authorization = authorizations[ref]
            if isinstance(authorization, RuntimeSnapshotError):
                entries.append({"file_ref": ref, "error": authorization.code})
                continue
            # The snapshot descriptor, not mutable catalog facts alone, remains
            # the exact-byte contract and enforces the selection's size bounds.
            if any(
                getattr(authorization, key) != member[key] for key in ("size_bytes", "sha256", "media_type", "role")
            ):
                entries.append({"file_ref": ref, "error": "runtime_file_changed_remount_required"})
                continue
            try:
                file = self.store.open_verified_file(
                    source=authorization.source,
                    source_mount_id=authorization.source_mount_id,
                    relative_path=authorization.relative_path,
                    expected_size_bytes=member["size_bytes"],
                    expected_sha256=member["sha256"],
                    media_type=member["media_type"],
                )
                with file.handle:
                    raw = file.handle.read(member["size_bytes"] + 1)
                # Check the actual read too, including writes after open_verified_file.
                if len(raw) != member["size_bytes"] or hashlib.sha256(raw).hexdigest() != member["sha256"]:
                    raise ContentIntegrityError("runtime bundle member changed during read")
                entries.append({"file_ref": ref, "text": raw.decode("utf-8", errors="strict")})
            except (ContentIntegrityError, ContentPathError, OSError, UnicodeError):
                entries.append({"file_ref": ref, "error": "runtime_file_changed_remount_required"})
                changed[authorization.source].append(authorization.relative_path)
        return entries, changed
