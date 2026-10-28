"""Issue exact, renewable runtime snapshots from the readable Content Catalog."""

from __future__ import annotations

import asyncio
import functools
import hashlib
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import uuid4

from sqlalchemy import Select, delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import defer

import animama
from animama.adapters.repositories.sqlalchemy.avatar_face_part_override_repo import (
    SQLAlchemyAvatarFacePartOverrideRepository,
)
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.ports.avatar_face_parts import AvatarFacePartOverride
from animama.app.ports.content_store import ContentStore
from animama.app.services.avatar_face_parts import override_face_parts
from animama.app.services.content_access_policy import ContentAccessPolicy
from animama.app.services.runtime_content_closure import RuntimeContentClosureCompiler
from animama.app.services.typed_runtime_projection import project_typed_runtime_catalog
from animama.domain.anima_loadout import parse_cell_key, parse_idle_slot_key, parse_reaction_slot_key
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
)
from animama.domain.runtime_bundles import JSON_BUNDLE_MAX_MEMBERS, RuntimeBundle, select_runtime_bundles
from animama.domain.runtime_content_descriptor import (
    RuntimeContentDescriptor,
    RuntimeContentMember,
    RuntimeContentRootSelection,
    validate_admitted_item_revisions,
)
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import (
    ORMAnimaLoadout,
    ORMAnimaRuntimeSnapshot,
)
from animama.orm.avatar import ORMAvatar
from animama.orm.content_catalog import (
    ORMAnimaContentBinding,
    ORMContentCatalogFile,
    ORMContentCatalogItem,
)

LEASE = timedelta(hours=24)
# Issuance prepares again when the loadout changes before its commit, this many times in all.
ISSUE_ATTEMPTS = 3
RUNTIME_PROJECTION_VERSION = 5
SNAPSHOT_CLEANUP_BATCH_SIZE = 100
_BUNDLE_ID = re.compile(r"[0-9a-f]{64}")


@dataclass(frozen=True, slots=True)
class _RuntimeSelectionPlan:
    """Catalog roots selected for one exact runtime mount."""

    roots: tuple[RuntimeContentRootSelection, ...]


@dataclass(frozen=True, slots=True)
class RuntimeFileAuthorization:
    """Minimal canonical file facts authorized by one coherent SQL projection."""

    item_id: str
    source: ContentSource
    relative_path: str
    role: str
    media_type: str
    size_bytes: int
    sha256: str
    source_mount_id: str | None = None


@dataclass(frozen=True, slots=True)
class PreparedRuntime:
    """A snapshot ready to commit, compiled or reused, made before any lock or write."""

    anima_id: str
    loadout_revision: int
    admitted_item_revisions: dict[str, str]
    # The admitted items' canonical files, which the commit fences.
    members: tuple[RuntimeContentMember, ...]
    catalog_body: dict[str, Any]
    catalog_digest: str
    effective_revision: str
    bundles: list[RuntimeBundle]
    # What the snapshot was compiled from (``_inputs_digest``); ``None`` after changed files.
    inputs_digest: str | None
    # Files that no longer match the catalog; the commit marks them for Rescan.
    changed_paths: dict[ContentSource, tuple[str, ...]] = field(default_factory=dict)
    # An unexpired snapshot of the same inputs, which the commit renews instead of inserting.
    reused_snapshot_id: str | None = None


class RuntimeSnapshotError(Exception):
    """Stable runtime issuance or lease failure."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _owned_loadout_revision(*, user_id: str, anima_id: str) -> Select[tuple[int]]:
    """The revision of the owner's loadout for an Anima the owner holds."""

    return (
        select(ORMAnimaLoadout.revision)
        .join(ORMAnima, ORMAnima.id == ORMAnimaLoadout.anima_id)
        .where(
            ORMAnimaLoadout.anima_id == anima_id,
            ORMAnimaLoadout.owner_user_id == user_id,
            ORMAnima.user_id == user_id,
        )
    )


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


@functools.cache
def _backend_build() -> str:
    """Identify the running backend code, so a reused snapshot never outlives an upgrade.

    A frozen build keeps its modules inside its executable, so the executable
    identifies it. Otherwise the package's Python sources do, or its compiled modules
    where it ships no sources.
    """

    digest = hashlib.sha256()
    if getattr(sys, "frozen", False):
        executable = Path(sys.executable).stat()
        digest.update(f"{sys.executable}|{executable.st_size}|{executable.st_mtime_ns}".encode())
        return digest.hexdigest()
    package = Path(animama.__file__).parent
    modules = sorted(package.rglob("*.py")) or sorted(package.rglob("*.pyc"))
    for module in modules:
        digest.update(module.relative_to(package).as_posix().encode())
        digest.update(module.read_bytes())
    return digest.hexdigest()


def _inputs_digest(
    *,
    build: str,
    loadout_revision: int,
    selections: tuple[RuntimeContentRootSelection, ...],
    by_id: dict[str, CatalogContentEntry],
    overrides: dict[str, AvatarFacePartOverride],
) -> str:
    """Digest everything a compile and projection of these selections read.

    That is the code, the loadout revision, each root selection and its context,
    every catalog entry reachable from the roots (whether admitted or not) or its
    absence, and the owner's Included Avatar face-part overrides. An entry's
    ``scanned_at`` is left out: a rescan that changes nothing keeps the digest.
    Dataclass reprs of the catalog's own values are equal exactly when the values are.
    """

    entries: dict[str, str | None] = {}
    pending = [selection.catalog_item_id for selection in selections]
    while pending:
        item_id = pending.pop()
        if item_id in entries:
            continue
        item = by_id.get(item_id)
        entries[item_id] = None if item is None else repr(replace(item, scanned_at=None))
        if item is not None:
            pending.extend(item.dependency_item_ids)
    return _sha(
        {
            "build": build,
            "projection_version": RUNTIME_PROJECTION_VERSION,
            "loadout_revision": loadout_revision,
            "selections": [
                [selection.slot_key, selection.catalog_item_id, selection.kind.value, selection.context]
                for selection in selections
            ],
            "entries": sorted(entries.items()),
            "face_part_overrides": sorted((item_id, repr(value)) for item_id, value in overrides.items()),
        }
    )


def _admitted_members(pins: dict[str, str], by_id: dict[str, CatalogContentEntry]) -> tuple[RuntimeContentMember, ...]:
    """The canonical files of the admitted items, as their compile listed them."""

    return tuple(
        RuntimeContentMember(
            file_ref=file.file_ref,
            item_id=item_id,
            source=file.source,
            relative_path=file.relative_path,
            role=file.role,
            media_type=file.media_type,
            size_bytes=file.size_bytes,
            sha256=file.sha256,
        )
        for item_id in pins
        for file in by_id[item_id].files
    )


def _stored_bundles(bundles: list[RuntimeBundle]) -> dict[str, Any]:
    """The snapshot's ``bundles`` column: each bundle's format and members by its ID."""

    return {bundle.id: {"format": bundle.format, "members": list(bundle.members)} for bundle in bundles}


def _runtime_response(
    catalog_body: dict[str, Any],
    *,
    bundles: list[RuntimeBundle],
    anima_id: str,
    effective_revision: str,
    lease_expires_at: datetime,
) -> dict[str, Any]:
    """Overlay issuance-time URLs and lease data without mutating identity state."""

    def overlay(value: Any) -> Any:
        if isinstance(value, list):
            return [overlay(item) for item in value]
        if not isinstance(value, dict):
            return value
        result = {key: overlay(child) for key, child in value.items()}
        file_ref = result.get("file_ref")
        if isinstance(file_ref, str) and isinstance(result.get("sha256"), str):
            result["url"] = f"/v1/animas/{anima_id}/runtime/revisions/{effective_revision}/files/{file_ref}"
        logical_refs = result.pop("_logical_resource_refs", None)
        if isinstance(logical_refs, dict):
            result["logical_resource_urls"] = {
                name: (f"/v1/animas/{anima_id}/runtime/revisions/{effective_revision}/files/{ref}")
                for name, ref in logical_refs.items()
                if isinstance(name, str) and isinstance(ref, str)
            }
        return result

    return {
        **overlay(catalog_body),
        "bundles": [
            {
                "id": bundle.id,
                "format": bundle.format,
                "url": f"/v1/animas/{anima_id}/runtime/revisions/{effective_revision}/bundles/{bundle.id}",
                "file_refs": bundle.file_refs,
                "total_bytes": bundle.total_bytes,
            }
            for bundle in bundles
        ],
        "effective_revision": effective_revision,
        "lease_expires_at": lease_expires_at.isoformat(),
    }


class AnimaRuntimeService:
    """Compile a loadout into an exact SQL closure and durable lease.

    The composition owns the supplied session and transaction. Multi-owner
    compositions must isolate catalog, binding and snapshot joins together;
    passing a private byte store alone does not authorize their SQL projections.
    """

    def __init__(self, session: AsyncSession, *, store: ContentStore | None = None) -> None:
        self.session = session
        self.catalog = SQLAlchemyContentCatalog(session)
        self.store = store

    async def issue(self, *, user_id: str, anima_id: str) -> dict[str, Any]:
        """Prepare and commit one item-pinned runtime snapshot on this session.

        A composition with separate read and write sessions calls ``prepare`` and
        ``commit`` itself, so its write session is open only for the commit.
        """

        for _attempt in range(ISSUE_ATTEMPTS):
            prepared = await self.prepare(user_id=user_id, anima_id=anima_id)
            issued = await self.commit(prepared, user_id=user_id)
            if issued is not None:
                return issued
            # Release the stale commit's loadout lock before preparing again.
            await self.session.rollback()
        raise RuntimeSnapshotError("snapshot_conflict")

    async def prepare(self, *, user_id: str, anima_id: str) -> PreparedRuntime:
        """Compile and project the owner's current loadout, taking no lock and writing nothing.

        An unexpired snapshot compiled from the same inputs is reused instead, without
        compiling, reading content bytes or projecting. ``commit`` fences either result
        against the loadout and catalog as they are then.
        """

        if self.store is None:
            raise RuntimeSnapshotError("runtime_content_store_unavailable")
        # Read the revision before the bindings: an unchanged revision at commit
        # proves the bindings read here are that revision's.
        loadout_revision = await self.session.scalar(_owned_loadout_revision(user_id=user_id, anima_id=anima_id))
        if loadout_revision is None:
            raise RuntimeSnapshotError("anima_not_found")

        visible = await self.catalog.list_visible(user_id=user_id)
        by_id = {item.id: item for item in visible}
        selection_plan = await self._selections(anima_id=anima_id, visible=visible)
        overrides = await self._included_avatar_overrides(user_id=user_id, selections=selection_plan.roots, by_id=by_id)
        inputs_digest = _inputs_digest(
            build=await asyncio.to_thread(_backend_build),
            loadout_revision=loadout_revision,
            selections=selection_plan.roots,
            by_id=by_id,
            overrides=overrides,
        )
        reused = await self._reusable_snapshot(user_id=user_id, anima_id=anima_id, inputs_digest=inputs_digest)
        if reused is not None:
            pins = dict(reused.admitted_item_revisions)
            return PreparedRuntime(
                anima_id=anima_id,
                loadout_revision=loadout_revision,
                admitted_item_revisions=pins,
                members=_admitted_members(pins, by_id),
                catalog_body=dict(reused.catalog),
                catalog_digest=reused.catalog_digest,
                effective_revision=reused.effective_revision,
                bundles=select_runtime_bundles(reused.catalog),
                inputs_digest=inputs_digest,
                reused_snapshot_id=reused.id,
            )

        descriptor, changed_paths = await RuntimeContentClosureCompiler(
            catalog=self.catalog,
            store=self.store,
        ).compile_with_changes(
            user_id=user_id,
            loadout_revision=loadout_revision,
            selections=selection_plan.roots,
            visible_items=visible,
        )
        admitted_item_revisions = validate_admitted_item_revisions(descriptor.admitted_item_revisions)
        catalog_body = self._project_catalog(
            loadout_revision=loadout_revision,
            descriptor=descriptor,
            visible=visible,
        )
        self._apply_included_avatar_face_parts(catalog_body=catalog_body, overrides=overrides)
        identity_body = {
            "projection_version": RUNTIME_PROJECTION_VERSION,
            "loadout_revision": loadout_revision,
            "admitted_item_revisions": admitted_item_revisions,
            "root_contexts": [{"root_id": root.root_id, "context": root.context} for root in descriptor.roots],
            "catalog": catalog_body,
        }
        catalog_digest = _sha(identity_body)
        return PreparedRuntime(
            anima_id=anima_id,
            loadout_revision=loadout_revision,
            admitted_item_revisions=admitted_item_revisions,
            members=descriptor.members,
            catalog_body=catalog_body,
            catalog_digest=catalog_digest,
            effective_revision=f"tr{RUNTIME_PROJECTION_VERSION}-{catalog_digest}",
            bundles=select_runtime_bundles(catalog_body),
            # Files found changed will be marked for Rescan, so these inputs are already stale.
            inputs_digest=None if changed_paths else inputs_digest,
            changed_paths=changed_paths,
        )

    async def _reusable_snapshot(self, *, user_id: str, anima_id: str, inputs_digest: str) -> Row[Any] | None:
        """The owner's unexpired snapshot of this Anima compiled from the same inputs."""

        return (
            await self.session.execute(
                select(
                    ORMAnimaRuntimeSnapshot.id,
                    ORMAnimaRuntimeSnapshot.effective_revision,
                    ORMAnimaRuntimeSnapshot.catalog_digest,
                    ORMAnimaRuntimeSnapshot.admitted_item_revisions,
                    ORMAnimaRuntimeSnapshot.catalog,
                )
                .where(
                    ORMAnimaRuntimeSnapshot.owner_user_id == user_id,
                    ORMAnimaRuntimeSnapshot.anima_id == anima_id,
                    ORMAnimaRuntimeSnapshot.inputs_digest == inputs_digest,
                    ORMAnimaRuntimeSnapshot.expires_at > datetime.now(UTC),
                )
                .order_by(ORMAnimaRuntimeSnapshot.expires_at.desc())
                .limit(1)
            )
        ).one_or_none()

    async def commit(self, prepared: PreparedRuntime, *, user_id: str) -> dict[str, Any] | None:
        """Fence and write a prepared snapshot in one short transaction, then commit.

        Locks the loadout row first and returns ``None``, writing nothing, when the
        loadout changed after preparation or a reused snapshot expired meanwhile, so
        the caller prepares again. Otherwise it marks the files preparation found
        changed for Rescan, rechecks every pin and file, inserts the snapshot or renews
        the reused or identical one, and commits.
        """

        now = datetime.now(UTC)
        anima_id = prepared.anima_id
        loadout_revision = await self.session.scalar(
            _owned_loadout_revision(user_id=user_id, anima_id=anima_id).with_for_update(read=True, of=ORMAnimaLoadout)
        )
        if loadout_revision is None:
            raise RuntimeSnapshotError("anima_not_found")
        if loadout_revision != prepared.loadout_revision:
            return None
        for source, paths in prepared.changed_paths.items():
            await self.catalog.mark_scan_required(source=source, relative_paths=paths)
        await self._recheck_admission(user_id=user_id, pins=prepared.admitted_item_revisions, members=prepared.members)

        admitted_item_revisions = prepared.admitted_item_revisions
        effective_revision = prepared.effective_revision
        expires_at = now + LEASE
        if prepared.reused_snapshot_id is not None:
            renewed_expires_at = await self.session.scalar(
                update(ORMAnimaRuntimeSnapshot)
                .where(
                    ORMAnimaRuntimeSnapshot.id == prepared.reused_snapshot_id,
                    ORMAnimaRuntimeSnapshot.owner_user_id == user_id,
                    ORMAnimaRuntimeSnapshot.anima_id == anima_id,
                    ORMAnimaRuntimeSnapshot.expires_at > now,
                )
                .values(expires_at=expires_at, updated_at=now)
                .returning(ORMAnimaRuntimeSnapshot.expires_at)
            )
            if renewed_expires_at is None:
                return None
            await self.cleanup_expired(now=now)
            await self.session.commit()
            return _runtime_response(
                prepared.catalog_body,
                bundles=prepared.bundles,
                anima_id=anima_id,
                effective_revision=effective_revision,
                lease_expires_at=renewed_expires_at,
            )
        result = await self.session.execute(
            insert(ORMAnimaRuntimeSnapshot)
            .values(
                id=str(uuid4()),
                owner_user_id=user_id,
                anima_id=anima_id,
                loadout_revision=loadout_revision,
                effective_revision=effective_revision,
                catalog_digest=prepared.catalog_digest,
                admitted_item_revisions=admitted_item_revisions,
                catalog=prepared.catalog_body,
                bundles=_stored_bundles(prepared.bundles),
                inputs_digest=prepared.inputs_digest,
                expires_at=expires_at,
                created_at=now,
                updated_at=now,
            )
            .on_conflict_do_nothing(
                index_elements=[
                    ORMAnimaRuntimeSnapshot.owner_user_id,
                    ORMAnimaRuntimeSnapshot.anima_id,
                    ORMAnimaRuntimeSnapshot.effective_revision,
                ]
            )
            .returning(ORMAnimaRuntimeSnapshot.id)
        )
        if result.scalar_one_or_none() is None:
            # The same revision is already issued. Its digest covers the whole
            # catalog body, so comparing digests and pins proves it is identical.
            winner = (
                await self.session.execute(
                    select(
                        ORMAnimaRuntimeSnapshot.id,
                        ORMAnimaRuntimeSnapshot.catalog_digest,
                        ORMAnimaRuntimeSnapshot.admitted_item_revisions,
                    ).where(
                        ORMAnimaRuntimeSnapshot.owner_user_id == user_id,
                        ORMAnimaRuntimeSnapshot.anima_id == anima_id,
                        ORMAnimaRuntimeSnapshot.effective_revision == effective_revision,
                    )
                )
            ).one_or_none()
            if (
                winner is None
                or winner.catalog_digest != prepared.catalog_digest
                or dict(winner.admitted_item_revisions) != admitted_item_revisions
            ):
                raise RuntimeSnapshotError("snapshot_conflict")
            renewed = await self.session.execute(
                update(ORMAnimaRuntimeSnapshot)
                .where(ORMAnimaRuntimeSnapshot.id == winner.id)
                # Later issues of these inputs reuse it.
                .values(
                    expires_at=expires_at,
                    updated_at=now,
                    bundles=_stored_bundles(prepared.bundles),
                    inputs_digest=prepared.inputs_digest,
                )
                .returning(ORMAnimaRuntimeSnapshot.expires_at)
            )
            renewed_expires_at = renewed.scalar_one_or_none()
            if renewed_expires_at is None:
                raise RuntimeSnapshotError("snapshot_conflict")
            expires_at = renewed_expires_at
        await self.cleanup_expired(now=now)
        await self.session.commit()
        return _runtime_response(
            prepared.catalog_body,
            bundles=prepared.bundles,
            anima_id=anima_id,
            effective_revision=effective_revision,
            lease_expires_at=expires_at,
        )

    async def _recheck_admission(
        self,
        *,
        user_id: str,
        pins: dict[str, str],
        members: tuple[RuntimeContentMember, ...],
    ) -> None:
        """Fence compiled pins and the complete canonical file union in one query."""

        if not pins:
            if members:
                raise RuntimeSnapshotError("runtime_remount_required")
            return
        rows = (
            await self.session.execute(
                select(
                    ORMContentCatalogItem.id,
                    ORMContentCatalogItem.source,
                    ORMContentCatalogItem.scope,
                    ORMContentCatalogItem.owner_user_id,
                    ORMContentCatalogItem.status,
                    ORMContentCatalogItem.revision_sha256,
                    ORMContentCatalogFile.file_ref,
                    ORMContentCatalogFile.relative_path,
                    ORMContentCatalogFile.role,
                    ORMContentCatalogFile.media_type,
                    ORMContentCatalogFile.size_bytes,
                    ORMContentCatalogFile.sha256,
                )
                .select_from(ORMContentCatalogItem)
                .join(
                    ORMContentCatalogFile,
                    ORMContentCatalogFile.item_id == ORMContentCatalogItem.id,
                )
                .where(ORMContentCatalogItem.id.in_(tuple(pins)))
                .order_by(
                    ORMContentCatalogItem.id,
                    ORMContentCatalogFile.ordinal,
                    ORMContentCatalogFile.file_ref,
                )
                .with_for_update(
                    read=True,
                    of=[ORMContentCatalogItem.id, ORMContentCatalogFile.file_ref],
                )
            )
        ).all()
        item_facts: dict[str, tuple[str, str | None, str, str | None]] = {}
        actual_files: set[tuple[Any, ...]] = set()
        for row in rows:
            item_id = str(row[0])
            item_facts[item_id] = (str(row[1]), row[3], str(row[4]), row[5])
            try:
                scope = ContentScope(str(row[2]))
            except ValueError as exc:
                raise RuntimeSnapshotError("runtime_remount_required") from exc
            if not ContentAccessPolicy.can_read(
                scope=scope,
                owner_user_id=row[3],
                user_id=user_id,
            ):
                raise RuntimeSnapshotError("runtime_remount_required")
            if row[6] is not None:
                actual_files.add(
                    (
                        str(row[6]),
                        item_id,
                        str(row[1]),
                        str(row[7]),
                        str(row[8]),
                        str(row[9]),
                        int(row[10]),
                        str(row[11]),
                    )
                )
        if set(item_facts) != set(pins):
            raise RuntimeSnapshotError("runtime_remount_required")
        if any(
            status != ContentStatus.VALID.value or revision != pins[item_id]
            for item_id, (_, _, status, revision) in item_facts.items()
        ):
            raise RuntimeSnapshotError("runtime_remount_required")
        expected_files = {
            (
                member.file_ref,
                member.item_id,
                member.source.value,
                member.relative_path,
                member.role,
                member.media_type,
                member.size_bytes,
                member.sha256,
            )
            for member in members
        }
        if actual_files != expected_files:
            raise RuntimeSnapshotError("runtime_remount_required")

    async def _selections(
        self,
        *,
        anima_id: str,
        visible: list[CatalogContentEntry],
    ) -> _RuntimeSelectionPlan:
        """Resolve the loadout's catalog bindings; its Gesture rows are its only Gestures."""

        by_locator = {item.relative_locator: item for item in visible}
        by_id = {item.id: item for item in visible}

        selections: list[RuntimeContentRootSelection] = []
        occupied: set[str] = set()

        def add(
            slot_key: str,
            item: CatalogContentEntry | None,
            kind: ContentKind,
            context: dict[str, Any],
            *,
            missing_identity: str,
        ) -> None:
            if slot_key in occupied:
                return
            occupied.add(slot_key)
            selections.append(
                RuntimeContentRootSelection(
                    slot_key=slot_key,
                    catalog_item_id=item.id if item else f"unresolved:{_sha(missing_identity)[:32]}",
                    kind=kind,
                    context=context,
                )
            )

        bindings = list(
            (
                await self.session.execute(
                    select(ORMAnimaContentBinding)
                    .where(ORMAnimaContentBinding.anima_id == anima_id)
                    .order_by(ORMAnimaContentBinding.slot_key)
                )
            ).scalars()
        )
        # Each distinct Idle Gesture or pooled Reaction is one root carrying every
        # cell it belongs to, so one unavailable or over-budget member drops alone.
        idle_cells: dict[str, list[str]] = defaultdict(list)
        reaction_cells: dict[str, list[str]] = defaultdict(list)
        for binding in bindings:
            idle_slot = parse_idle_slot_key(binding.slot_key)
            if idle_slot is not None:
                idle_cells[binding.catalog_item_id].append(idle_slot[0])
                continue
            kind = ContentKind(binding.kind)
            if kind is ContentKind.REACTION:
                reaction_slot = parse_reaction_slot_key(binding.slot_key)
                if reaction_slot is not None:
                    reaction_cells[binding.catalog_item_id].append(reaction_slot[0])
                continue
            if kind in {
                ContentKind.POSE,
                ContentKind.POSE_CLIP,
                ContentKind.MUSIC_TRACK,
                ContentKind.PARTICLE_EFFECT,
                ContentKind.AVATAR_EFFECT,
                ContentKind.SCENE_EFFECT,
                ContentKind.SOUND_EFFECT,
                ContentKind.ANIMA,
            }:
                # Support entries are admitted only through an Action closure;
                # persisted peer bindings cannot bypass that closure validation.
                continue
            config = dict(binding.config)
            add(
                binding.slot_key,
                by_id.get(binding.catalog_item_id),
                kind,
                {
                    "binding_id": binding.id,
                    "config": config,
                    **config,
                    "origin": "catalog",
                },
                missing_identity=binding.catalog_item_id,
            )

        for item_id, cells in sorted(idle_cells.items()):
            add(
                f"idle:{item_id}",
                by_id.get(item_id),
                ContentKind.GESTURE,
                {"binding_id": f"idle:{item_id}", "idle_cells": sorted(cells), "origin": "idle"},
                missing_identity=item_id,
            )

        # Budget order among Reactions: lowest cell first (intensity, then
        # emotion), so the Reactions omitted over budget are predictable.
        reaction_order: dict[str, tuple[int, str]] = {}
        for item_id, cells in reaction_cells.items():
            parsed_cells = [parsed for cell in cells if (parsed := parse_cell_key(cell)) is not None]
            reaction_order[f"reaction:{item_id}"] = min((intensity, emotion) for emotion, intensity in parsed_cells)
            add(
                f"reaction:{item_id}",
                by_id.get(item_id),
                ContentKind.REACTION,
                {"binding_id": f"reaction:{item_id}", "reaction_cells": sorted(cells), "origin": "catalog"},
                missing_identity=item_id,
            )

        if "avatar" not in occupied:
            anima = await self.session.get(ORMAnima, anima_id)
            avatar_row = await self.session.get(ORMAvatar, anima.avatar_id) if anima and anima.avatar_id else None
            avatar_item = by_locator.get(f"avatars/{PurePosixPath(avatar_row.file_path).name}") if avatar_row else None
            add(
                "avatar",
                avatar_item,
                ContentKind.AVATAR,
                {
                    "avatar_id": anima.avatar_id if anima else None,
                    "binding_id": "starter:avatar",
                    "origin": "starter",
                },
                missing_identity=f"avatar:{anima.avatar_id if anima else 'missing'}",
            )

        priority = {
            ContentKind.AVATAR: 0,
            ContentKind.GESTURE: 2,
            ContentKind.REACTION: 4,
            ContentKind.PARTICLE_EFFECT: 5,
            ContentKind.AVATAR_EFFECT: 5,
            ContentKind.SCENE_EFFECT: 5,
            ContentKind.SOUND_EFFECT: 5,
            ContentKind.APPEARANCE: 7,
            ContentKind.VOICE: 8,
            ContentKind.ANIMA: 9,
        }
        # Idle roots keep their budget precedence ahead of AI-callable Gestures.
        selections.sort(
            key=lambda value: (
                1 if value.slot_key.startswith("idle:") else priority[value.kind],
                reaction_order.get(value.slot_key, (0, "")),
                value.slot_key,
            )
        )
        return _RuntimeSelectionPlan(roots=tuple(selections))

    @staticmethod
    def _project_catalog(
        *,
        loadout_revision: int,
        descriptor: RuntimeContentDescriptor,
        visible: list[CatalogContentEntry],
    ) -> dict[str, Any]:
        """Delegate all product branches to the closed typed-handler registry."""

        return project_typed_runtime_catalog(
            loadout_revision=loadout_revision,
            descriptor=descriptor,
            visible=visible,
        )

    async def _included_avatar_overrides(
        self,
        *,
        user_id: str,
        selections: tuple[RuntimeContentRootSelection, ...],
        by_id: dict[str, CatalogContentEntry],
    ) -> dict[str, AvatarFacePartOverride]:
        """The owner's face-part overrides of the Included Avatars these selections name."""

        avatar_ids = [
            selection.catalog_item_id
            for selection in selections
            if selection.kind is ContentKind.AVATAR
            and (item := by_id.get(selection.catalog_item_id)) is not None
            and item.source is ContentSource.INCLUDED
        ]
        if not avatar_ids:
            return {}
        return await SQLAlchemyAvatarFacePartOverrideRepository(self.session).list_for_items(
            owner_user_id=user_id, avatar_item_ids=avatar_ids
        )

    @staticmethod
    def _apply_included_avatar_face_parts(
        *, catalog_body: dict[str, Any], overrides: dict[str, AvatarFacePartOverride]
    ) -> None:
        """Project the owner's current Included Avatar override into the snapshot body.

        The projection already carries a Local sidecar correction. The override
        becomes part of the effective revision, so saving one remounts the Avatar.
        """

        avatar = catalog_body.get("avatar")
        source = avatar.get("source") if isinstance(avatar, dict) else None
        if not isinstance(avatar, dict) or not isinstance(source, dict):
            return
        if source.get("source") != ContentSource.INCLUDED.value:
            return
        override = overrides.get(str(source.get("item_id")))
        if override is None:
            return
        face_parts = override_face_parts(
            revision_sha256=avatar.get("revision"),
            files=avatar.get("files", []),
            override_revision_sha256=override.avatar_revision_sha256,
            override_parts=override.parts,
        )
        if face_parts is not None:
            avatar["face_parts"] = face_parts

    async def get_snapshot(
        self,
        *,
        user_id: str,
        anima_id: str,
        revision: str,
    ) -> ORMAnimaRuntimeSnapshot | None:
        return (
            await self.session.execute(
                select(ORMAnimaRuntimeSnapshot)
                # Callers read the catalog and lease; bundle reads use get_bundle.
                .options(defer(ORMAnimaRuntimeSnapshot.bundles, raiseload=True))
                .where(
                    ORMAnimaRuntimeSnapshot.owner_user_id == user_id,
                    ORMAnimaRuntimeSnapshot.anima_id == anima_id,
                    ORMAnimaRuntimeSnapshot.effective_revision == revision,
                )
            )
        ).scalar_one_or_none()

    async def get_bundle(self, *, user_id: str, anima_id: str, revision: str, bundle_id: str) -> RuntimeBundle:
        """One issued bundle's members from a live snapshot, without loading its catalog."""

        if not _BUNDLE_ID.fullmatch(bundle_id):
            # Issued IDs are SHA-256 hex digests; anything else names no bundle.
            raise RuntimeSnapshotError("runtime_file_not_found")
        row = (
            await self.session.execute(
                select(ORMAnimaRuntimeSnapshot.expires_at, ORMAnimaRuntimeSnapshot.bundles[bundle_id]).where(
                    ORMAnimaRuntimeSnapshot.owner_user_id == user_id,
                    ORMAnimaRuntimeSnapshot.anima_id == anima_id,
                    ORMAnimaRuntimeSnapshot.effective_revision == revision,
                )
            )
        ).one_or_none()
        if row is None:
            raise RuntimeSnapshotError("runtime_file_not_found")
        expires_at, stored = row
        if expires_at <= datetime.now(UTC):
            raise RuntimeSnapshotError("runtime_remount_required")
        if not isinstance(stored, dict):
            raise RuntimeSnapshotError("runtime_file_not_found")
        return RuntimeBundle(id=bundle_id, format=stored["format"], members=tuple(stored["members"]))

    async def renew(self, *, user_id: str, anima_id: str, revision: str) -> datetime:
        """Atomically extend one still-live lease without touching its pins/body."""

        now = datetime.now(UTC)
        expires_at = now + LEASE
        result = await self.session.execute(
            update(ORMAnimaRuntimeSnapshot)
            .where(
                ORMAnimaRuntimeSnapshot.owner_user_id == user_id,
                ORMAnimaRuntimeSnapshot.anima_id == anima_id,
                ORMAnimaRuntimeSnapshot.effective_revision == revision,
                ORMAnimaRuntimeSnapshot.expires_at > now,
            )
            .values(expires_at=expires_at, updated_at=now)
            .returning(ORMAnimaRuntimeSnapshot.expires_at)
        )
        renewed_expires_at = result.scalar_one_or_none()
        await self.cleanup_expired(now=now)
        await self.session.commit()
        if renewed_expires_at is None:
            raise RuntimeSnapshotError("runtime_remount_required")
        return renewed_expires_at

    async def authorize_file(
        self,
        *,
        user_id: str,
        anima_id: str,
        revision: str,
        file_ref: str,
    ) -> RuntimeFileAuthorization:
        """Authorize one canonical file using the same checks as bundle delivery."""
        result = (
            await self.authorize_files(user_id=user_id, anima_id=anima_id, revision=revision, file_refs=[file_ref])
        )[file_ref]
        if isinstance(result, RuntimeSnapshotError):
            raise result
        return result

    async def authorize_files(
        self, *, user_id: str, anima_id: str, revision: str, file_refs: list[str]
    ) -> dict[str, RuntimeFileAuthorization | RuntimeSnapshotError]:
        """One coherent SQL view for bounded server-selected files; isolate member failures."""
        if not 1 <= len(file_refs) <= JSON_BUNDLE_MAX_MEMBERS:
            raise ValueError("runtime authorization batch is out of bounds")

        pinned_revision = func.jsonb_extract_path_text(
            ORMAnimaRuntimeSnapshot.admitted_item_revisions,
            ORMContentCatalogItem.id,
        ).label("pinned_revision")
        rows = (
            await self.session.execute(
                select(
                    ORMAnimaRuntimeSnapshot.expires_at,
                    pinned_revision,
                    ORMContentCatalogFile.item_id,
                    ORMContentCatalogFile.relative_path,
                    ORMContentCatalogFile.role,
                    ORMContentCatalogFile.media_type,
                    ORMContentCatalogFile.size_bytes,
                    ORMContentCatalogFile.sha256,
                    ORMContentCatalogItem.source,
                    ORMContentCatalogItem.scope,
                    ORMContentCatalogItem.owner_user_id,
                    ORMContentCatalogItem.status,
                    ORMContentCatalogItem.revision_sha256,
                    ORMContentCatalogItem.source_mount_id,
                    ORMContentCatalogFile.file_ref,
                )
                .select_from(ORMAnimaRuntimeSnapshot)
                .outerjoin(
                    ORMContentCatalogFile,
                    ORMContentCatalogFile.file_ref.in_(file_refs),
                )
                .outerjoin(
                    ORMContentCatalogItem,
                    ORMContentCatalogItem.id == ORMContentCatalogFile.item_id,
                )
                .where(
                    ORMAnimaRuntimeSnapshot.owner_user_id == user_id,
                    ORMAnimaRuntimeSnapshot.anima_id == anima_id,
                    ORMAnimaRuntimeSnapshot.effective_revision == revision,
                )
            )
        ).all()
        if not rows:
            raise RuntimeSnapshotError("runtime_file_not_found")
        if rows[0][0] <= datetime.now(UTC):
            raise RuntimeSnapshotError("runtime_remount_required")
        results: dict[str, RuntimeFileAuthorization | RuntimeSnapshotError] = {
            ref: RuntimeSnapshotError("runtime_file_not_found") for ref in file_refs
        }
        for row in rows:
            if row[14] is None:
                continue
            try:
                results[row[14]] = self._authorize_row(row, user_id=user_id)
            except RuntimeSnapshotError as exc:
                results[row[14]] = exc
        return results

    @staticmethod
    def _authorize_row(row: Any, *, user_id: str) -> RuntimeFileAuthorization:
        """Check a file's current ownership and revision against its issued item pin."""
        if row[1] is None or row[2] is None:
            raise RuntimeSnapshotError("runtime_file_not_found")
        try:
            scope = ContentScope(str(row[9]))
        except ValueError as exc:
            raise RuntimeSnapshotError("runtime_file_not_found") from exc
        if not ContentAccessPolicy.can_read(
            scope=scope,
            owner_user_id=row[10],
            user_id=user_id,
        ):
            raise RuntimeSnapshotError("runtime_file_not_found")
        if row[11] != ContentStatus.VALID.value or row[12] != row[1]:
            raise RuntimeSnapshotError("runtime_file_changed_remount_required")
        return RuntimeFileAuthorization(
            item_id=str(row[2]),
            source=ContentSource(str(row[8])),
            relative_path=str(row[3]),
            role=str(row[4]),
            media_type=str(row[5]),
            size_bytes=int(row[6]),
            sha256=str(row[7]),
            source_mount_id=row[13],
        )

    async def cleanup_expired(
        self,
        *,
        now: datetime | None = None,
        batch_size: int = SNAPSHOT_CLEANUP_BATCH_SIZE,
    ) -> int:
        """Delete one bounded, skip-locked batch of disposable expired snapshots."""

        if batch_size < 1 or batch_size > SNAPSHOT_CLEANUP_BATCH_SIZE:
            raise ValueError("runtime cleanup batch size is out of bounds")
        cutoff = now or datetime.now(UTC)
        snapshot_ids = list(
            (
                await self.session.execute(
                    select(ORMAnimaRuntimeSnapshot.id)
                    .where(ORMAnimaRuntimeSnapshot.expires_at <= cutoff)
                    .order_by(ORMAnimaRuntimeSnapshot.expires_at, ORMAnimaRuntimeSnapshot.id)
                    .limit(batch_size)
                    .with_for_update(skip_locked=True)
                )
            ).scalars()
        )
        if snapshot_ids:
            await self.session.execute(
                delete(ORMAnimaRuntimeSnapshot).where(ORMAnimaRuntimeSnapshot.id.in_(snapshot_ids))
            )
        return len(snapshot_ids)


__all__ = [
    "ISSUE_ATTEMPTS",
    "AnimaRuntimeService",
    "PreparedRuntime",
    "RuntimeFileAuthorization",
    "RuntimeSnapshotError",
]
