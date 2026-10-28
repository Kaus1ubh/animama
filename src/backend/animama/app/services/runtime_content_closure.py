"""Compile exact readable-content closures at the Anima mount boundary."""

from __future__ import annotations

import asyncio
import hashlib
import json
from dataclasses import asdict, dataclass, field
from typing import Any

from animama.app.ports.content_catalog import ContentCatalog
from animama.app.ports.content_store import ContentStore
from animama.app.services.content_kind_registry import RETIRED_CONTENT_KINDS
from animama.app.services.idle_playback import read_gesture_idle_playback
from animama.app.services.runtime_budget_policy import (
    MAX_RUNTIME_BYTES,
    MAX_RUNTIME_CONFIG_BYTES,
    MAX_RUNTIME_ENTRIES,
)
from animama.app.services.typed_content_service import TypedContentService
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentIntegrityError,
    ContentNotFoundError,
    ContentPathError,
    ContentSource,
    ContentStatus,
)
from animama.domain.content_documents import ContentDocumentError, GestureDocumentV1
from animama.domain.runtime_content_descriptor import (
    RuntimeContentDescriptor,
    RuntimeContentDiagnostic,
    RuntimeContentEntry,
    RuntimeContentMember,
    RuntimeContentRoot,
    RuntimeContentRootSelection,
    validate_admitted_item_revisions,
)


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _digest(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _root_id(selection: RuntimeContentRootSelection) -> str:
    value = f"{selection.slot_key}|{selection.catalog_item_id}|{selection.kind.value}"
    return f"rr1-{hashlib.sha256(value.encode()).hexdigest()[:32]}"


def _effective_metadata(item: CatalogContentEntry) -> dict[str, Any]:
    """Expose creator specs without losing ordinary descriptor metadata."""

    metadata = dict(item.metadata)
    bridge = metadata.get("metadata")
    if isinstance(bridge, dict) and isinstance(bridge.get("spec"), dict):
        return {**metadata, **dict(bridge["spec"])}
    return metadata


_VerificationKey = tuple[str, str | None, str, int, str]


def _verification_key(file: CatalogContentFile) -> _VerificationKey:
    return (file.source.value, file.source_mount_id, file.relative_path, file.size_bytes, file.sha256)


@dataclass(frozen=True, slots=True)
class _CandidateRoot:
    selection: RuntimeContentRootSelection
    entry_ids: tuple[str, ...]
    members: tuple[RuntimeContentMember, ...]
    idle_playback: dict[str, dict[str, Any]] = field(default_factory=dict)


class RuntimeContentClosureCompiler:
    """Resolve, verify, budget, and flatten independently selected roots."""

    def __init__(self, *, catalog: ContentCatalog, store: ContentStore) -> None:
        self._catalog = catalog
        self._store = store

    async def compile(
        self,
        *,
        user_id: str,
        loadout_revision: int,
        selections: tuple[RuntimeContentRootSelection, ...],
        visible_items: list[CatalogContentEntry] | None = None,
        mark_scan_required: bool = True,
    ) -> RuntimeContentDescriptor:
        """Compile the selections, marking files that changed since their last scan for Rescan unless told not to."""

        descriptor, changed = await self.compile_with_changes(
            user_id=user_id, loadout_revision=loadout_revision, selections=selections, visible_items=visible_items
        )
        if mark_scan_required:
            for source, paths in changed.items():
                await self._catalog.mark_scan_required(source=source, relative_paths=paths)
        return descriptor

    async def compile_with_changes(
        self,
        *,
        user_id: str,
        loadout_revision: int,
        selections: tuple[RuntimeContentRootSelection, ...],
        visible_items: list[CatalogContentEntry] | None = None,
    ) -> tuple[RuntimeContentDescriptor, dict[ContentSource, tuple[str, ...]]]:
        """Compile without writing; also return the files that changed since their last scan.

        The caller decides when to mark those paths for Rescan.
        """

        items = visible_items if visible_items is not None else await self._catalog.list_visible(user_id=user_id)
        by_id = {item.id: item for item in items}
        diagnostics: list[RuntimeContentDiagnostic] = []
        candidates: list[_CandidateRoot] = []
        changed_paths: dict[ContentSource, set[str]] = {}

        # Resolve every root's closure first, keeping each root's place in selection order.
        outcomes = [self._resolve(selection, by_id) for selection in selections]
        # One worker-thread call opens and hashes the union of their files.
        files = {
            _verification_key(file): file
            for outcome in outcomes
            if isinstance(outcome, list)
            for item in outcome
            for file in item.files
        }
        verified = await asyncio.to_thread(self._verify, list(files.values())) if files else {}

        for selection, outcome in zip(selections, outcomes, strict=True):
            if isinstance(outcome, RuntimeContentDiagnostic):
                diagnostics.append(outcome)
                continue
            root_id = _root_id(selection)
            root = by_id[selection.catalog_item_id]
            ordered = outcome
            members: dict[str, RuntimeContentMember] = {}
            changed_item: CatalogContentEntry | None = None
            for item in ordered:
                for file in item.files:
                    if not verified[_verification_key(file)]:
                        # Only a root's first changed file is reported for Rescan.
                        changed_paths.setdefault(file.source, set()).add(file.relative_path)
                        changed_item = item
                        break
                    file_ref = file.file_ref
                    members.setdefault(
                        file_ref,
                        RuntimeContentMember(
                            file_ref=file_ref,
                            item_id=item.id,
                            source=file.source,
                            relative_path=file.relative_path,
                            role=file.role,
                            media_type=file.media_type,
                            size_bytes=file.size_bytes,
                            sha256=file.sha256,
                        ),
                    )
                if changed_item is not None:
                    break
            if changed_item is not None:
                diagnostics.append(
                    RuntimeContentDiagnostic(
                        root_id=root_id,
                        slot_key=selection.slot_key,
                        code="runtime_source_changed",
                        message="Content changed after its last scan and requires Rescan.",
                        item_id=changed_item.id,
                    )
                )
                continue
            idle_playback: dict[str, dict[str, Any]] = {}
            if selection.slot_key.startswith("idle:"):
                # An Idle pool member plays only with finite facts read from its exact motion bytes.
                try:
                    gesture = TypedContentService.parse(root).document
                    if not isinstance(gesture, GestureDocumentV1):
                        raise ContentDocumentError("idle_gesture_required", "Idle pools require Gesture content")
                    # The motion file is a member of this verified closure.
                    facts = await read_gesture_idle_playback(
                        document=gesture, item=root, dependency_items=by_id, store=self._store, verified=True
                    )
                    idle_playback = {root.id: asdict(facts)}
                except (
                    ContentDocumentError,
                    ContentNotFoundError,
                    ContentIntegrityError,
                    ContentPathError,
                    OSError,
                ) as exc:
                    diagnostics.append(
                        RuntimeContentDiagnostic(
                            root_id=root_id,
                            slot_key=selection.slot_key,
                            code=exc.code if isinstance(exc, ContentDocumentError) else "idle_motion_unavailable",
                            message="This idle Gesture needs available motion with finite playback.",
                            item_id=root.id,
                        )
                    )
                    continue
            candidates.append(
                _CandidateRoot(
                    selection=selection,
                    entry_ids=tuple(item.id for item in ordered),
                    members=tuple(members.values()),
                    idle_playback=idle_playback,
                )
            )

        admitted_roots: list[RuntimeContentRoot] = []
        admitted_entries: dict[str, CatalogContentEntry] = {}
        admitted_members: dict[str, RuntimeContentMember] = {}
        config_bytes = 0
        for candidate in candidates:
            candidate_entries = {item_id: by_id[item_id] for item_id in candidate.entry_ids}
            new_entries = [item for item_id, item in candidate_entries.items() if item_id not in admitted_entries]
            new_members = [member for member in candidate.members if member.file_ref not in admitted_members]
            next_entry_count = len(admitted_entries) + len(new_entries)
            next_total_bytes = sum(member.size_bytes for member in admitted_members.values()) + sum(
                member.size_bytes for member in new_members
            )
            next_config_bytes = config_bytes + sum(
                len(_canonical(_effective_metadata(item)).encode()) for item in new_entries
            )
            budget_code = None
            if next_entry_count > MAX_RUNTIME_ENTRIES:
                budget_code = "runtime_entry_budget"
            elif next_total_bytes > MAX_RUNTIME_BYTES:
                budget_code = "runtime_byte_budget"
            elif next_config_bytes > MAX_RUNTIME_CONFIG_BYTES:
                budget_code = "runtime_config_budget"
            if budget_code:
                diagnostics.append(
                    RuntimeContentDiagnostic(
                        root_id=_root_id(candidate.selection),
                        slot_key=candidate.selection.slot_key,
                        code=budget_code,
                        message="This content root was omitted because the runtime memory budget was reached.",
                        item_id=candidate.selection.catalog_item_id,
                    )
                )
                continue

            admitted_entries.update(candidate_entries)
            admitted_members.update((member.file_ref, member) for member in candidate.members)
            config_bytes = next_config_bytes
            root_item = by_id[candidate.selection.catalog_item_id]
            admitted_roots.append(
                RuntimeContentRoot(
                    root_id=_root_id(candidate.selection),
                    slot_key=candidate.selection.slot_key,
                    item_id=root_item.id,
                    kind=root_item.kind,
                    revision_sha256=root_item.revision_sha256 or "",
                    entry_ids=candidate.entry_ids,
                    member_refs=tuple(member.file_ref for member in candidate.members),
                    context=dict(candidate.selection.context),
                    idle_playback=candidate.idle_playback,
                )
            )

        entries = tuple(
            RuntimeContentEntry(
                item_id=item.id,
                kind=item.kind,
                display_name=item.display_name,
                revision_sha256=item.revision_sha256 or "",
                logical_key=item.logical_key,
                member_refs=tuple(member.file_ref for member in admitted_members.values() if member.item_id == item.id),
                metadata=_effective_metadata(item),
            )
            for item in sorted(admitted_entries.values(), key=lambda value: value.id)
        )
        ordered_members = tuple(
            sorted(
                admitted_members.values(),
                key=lambda value: (value.item_id, value.relative_path, value.file_ref),
            )
        )
        admitted_item_revisions = validate_admitted_item_revisions(
            {entry.item_id: entry.revision_sha256 for entry in entries}
        )
        identity = {
            "schema_version": 2,
            "loadout_revision": loadout_revision,
            "admitted_item_revisions": admitted_item_revisions,
            "roots": [
                {
                    "root_id": root.root_id,
                    "slot_key": root.slot_key,
                    "item_id": root.item_id,
                    "revision": root.revision_sha256,
                    "entries": root.entry_ids,
                    "members": root.member_refs,
                }
                for root in admitted_roots
            ],
            "entries": [
                {"item_id": entry.item_id, "revision": entry.revision_sha256, "members": entry.member_refs}
                for entry in entries
            ],
            "members": [
                {
                    "file_ref": member.file_ref,
                    "size": member.size_bytes,
                    "sha256": member.sha256,
                    "role": member.role,
                }
                for member in ordered_members
            ],
            "diagnostics": [
                {"root_id": item.root_id, "code": item.code, "item_id": item.item_id} for item in diagnostics
            ],
        }
        descriptor = RuntimeContentDescriptor(
            loadout_revision=loadout_revision,
            roots=tuple(admitted_roots),
            entries=entries,
            members=ordered_members,
            diagnostics=tuple(diagnostics),
            admitted_item_revisions=admitted_item_revisions,
            total_bytes=sum(member.size_bytes for member in ordered_members),
            revision=f"rcd2-{_digest(identity)}",
        )
        return descriptor, {source: tuple(sorted(paths)) for source, paths in changed_paths.items()}

    @staticmethod
    def _resolve(
        selection: RuntimeContentRootSelection, by_id: dict[str, CatalogContentEntry]
    ) -> list[CatalogContentEntry] | RuntimeContentDiagnostic:
        """The root's valid dependency closure, dependencies first, or why it is unavailable."""

        root_id = _root_id(selection)
        root = by_id.get(selection.catalog_item_id)
        if root is None or root.kind is not selection.kind:
            return RuntimeContentDiagnostic(
                root_id=root_id,
                slot_key=selection.slot_key,
                code="catalog_root_unavailable",
                message="The selected content item is no longer available.",
                item_id=selection.catalog_item_id,
            )
        if root.status is not ContentStatus.VALID or root.revision_sha256 is None:
            return RuntimeContentDiagnostic(
                root_id=root_id,
                slot_key=selection.slot_key,
                code=f"catalog_root_{root.status.value}",
                message="The selected content item is not currently valid.",
                item_id=root.id,
            )

        ordered: list[CatalogContentEntry] = []
        visiting: set[str] = set()
        visited: set[str] = set()
        unavailable: CatalogContentEntry | None = None

        def visit(item: CatalogContentEntry) -> bool:
            nonlocal unavailable
            if item.id in visited:
                return True
            if item.id in visiting:
                unavailable = item
                return False
            if (
                item.kind in RETIRED_CONTENT_KINDS
                or item.status is not ContentStatus.VALID
                or item.revision_sha256 is None
            ):
                unavailable = item
                return False
            visiting.add(item.id)
            for dependency_id in item.dependency_item_ids:
                dependency = by_id.get(dependency_id)
                if dependency is None or not visit(dependency):
                    unavailable = dependency or item
                    visiting.remove(item.id)
                    return False
            visiting.remove(item.id)
            visited.add(item.id)
            ordered.append(item)
            return True

        if not visit(root):
            return RuntimeContentDiagnostic(
                root_id=root_id,
                slot_key=selection.slot_key,
                code="runtime_dependency_unavailable",
                message="A required content dependency is unavailable.",
                item_id=unavailable.id if unavailable else root.id,
            )
        return ordered

    def _verify(self, files: list[CatalogContentFile]) -> dict[_VerificationKey, bool]:
        """Open and hash each registered file; runs in one worker thread per compile."""

        results: dict[_VerificationKey, bool] = {}
        for file in files:
            try:
                opened = self._store.open_verified_file(
                    source=file.source,
                    source_mount_id=file.source_mount_id,
                    relative_path=file.relative_path,
                    expected_size_bytes=file.size_bytes,
                    expected_sha256=file.sha256,
                    media_type=file.media_type,
                )
            except (ContentIntegrityError, ContentPathError, OSError):
                results[_verification_key(file)] = False
                continue
            opened.handle.close()
            results[_verification_key(file)] = True
        return results


__all__ = ["RuntimeContentClosureCompiler"]
