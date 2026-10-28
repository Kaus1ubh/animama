"""Issue exact, renewable runtime snapshots from the readable Content Catalog."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import PurePosixPath
from typing import Any
from uuid import uuid4

from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.avatar_face_part_override_repo import (
    SQLAlchemyAvatarFacePartOverrideRepository,
)
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
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
RUNTIME_PROJECTION_VERSION = 5
SNAPSHOT_CLEANUP_BATCH_SIZE = 100


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


class RuntimeSnapshotError(Exception):
    """Stable runtime issuance or lease failure."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _sha(value: Any) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


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
        """Compile, fence, and atomically issue one item-pinned runtime snapshot."""

        if self.store is None:
            raise RuntimeSnapshotError("runtime_content_store_unavailable")

        now = datetime.now(UTC)
        loadout = (
            await self.session.execute(
                select(ORMAnimaLoadout)
                .join(ORMAnima, ORMAnima.id == ORMAnimaLoadout.anima_id)
                .where(
                    ORMAnimaLoadout.anima_id == anima_id,
                    ORMAnimaLoadout.owner_user_id == user_id,
                    ORMAnima.user_id == user_id,
                )
                .with_for_update(read=True, of=ORMAnimaLoadout)
            )
        ).scalar_one_or_none()
        if loadout is None:
            raise RuntimeSnapshotError("anima_not_found")

        visible = await self.catalog.list_visible(user_id=user_id)
        selection_plan = await self._selections(anima_id=anima_id, visible=visible)
        descriptor = await RuntimeContentClosureCompiler(
            catalog=self.catalog,
            store=self.store,
        ).compile(
            user_id=user_id,
            loadout_revision=loadout.revision,
            selections=selection_plan.roots,
            visible_items=visible,
        )
        admitted_item_revisions = validate_admitted_item_revisions(descriptor.admitted_item_revisions)
        catalog_body = self._project_catalog(
            loadout_revision=loadout.revision,
            descriptor=descriptor,
            visible=visible,
        )
        await self._apply_included_avatar_face_parts(user_id=user_id, catalog_body=catalog_body)
        identity_body = {
            "projection_version": RUNTIME_PROJECTION_VERSION,
            "loadout_revision": loadout.revision,
            "admitted_item_revisions": admitted_item_revisions,
            "root_contexts": [{"root_id": root.root_id, "context": root.context} for root in descriptor.roots],
            "catalog": catalog_body,
        }
        catalog_digest = _sha(identity_body)
        effective_revision = f"tr{RUNTIME_PROJECTION_VERSION}-{catalog_digest}"
        expires_at = now + LEASE
        bundles = select_runtime_bundles(catalog_body)

        await self._recheck_admission(
            user_id=user_id,
            descriptor=descriptor,
        )
        snapshot_id = str(uuid4())
        result = await self.session.execute(
            insert(ORMAnimaRuntimeSnapshot)
            .values(
                id=snapshot_id,
                owner_user_id=user_id,
                anima_id=anima_id,
                loadout_revision=loadout.revision,
                effective_revision=effective_revision,
                catalog_digest=catalog_digest,
                admitted_item_revisions=admitted_item_revisions,
                catalog=catalog_body,
                bundles=_stored_bundles(bundles),
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
        winner_id = result.scalar_one_or_none()
        if winner_id:
            await self.cleanup_expired(now=now)
            await self.session.commit()
            return _runtime_response(
                catalog_body,
                bundles=bundles,
                anima_id=anima_id,
                effective_revision=effective_revision,
                lease_expires_at=expires_at,
            )

        winner = await self.get_snapshot(
            user_id=user_id,
            anima_id=anima_id,
            revision=effective_revision,
        )
        if winner is None:
            raise RuntimeSnapshotError("snapshot_conflict")
        if (
            winner.catalog_digest != catalog_digest
            or dict(winner.admitted_item_revisions) != admitted_item_revisions
            or dict(winner.catalog) != catalog_body
        ):
            raise RuntimeSnapshotError("snapshot_conflict")
        renewed = await self.session.execute(
            update(ORMAnimaRuntimeSnapshot)
            .where(ORMAnimaRuntimeSnapshot.id == winner.id)
            .values(expires_at=expires_at, updated_at=now)
            .returning(ORMAnimaRuntimeSnapshot.expires_at)
        )
        renewed_expires_at = renewed.scalar_one_or_none()
        if renewed_expires_at is None:
            raise RuntimeSnapshotError("snapshot_conflict")
        await self.cleanup_expired(now=now)
        await self.session.commit()
        return _runtime_response(
            dict(winner.catalog),
            bundles=bundles,
            anima_id=anima_id,
            effective_revision=effective_revision,
            lease_expires_at=renewed_expires_at,
        )

    async def _recheck_admission(
        self,
        *,
        user_id: str,
        descriptor: RuntimeContentDescriptor,
    ) -> None:
        """Fence compiled pins and the complete canonical file union in one query."""

        pins = descriptor.admitted_item_revisions
        if not pins:
            if descriptor.members:
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
            for member in descriptor.members
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

    async def _apply_included_avatar_face_parts(self, *, user_id: str, catalog_body: dict[str, Any]) -> None:
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
        item_id = str(source.get("item_id"))
        override = (
            await SQLAlchemyAvatarFacePartOverrideRepository(self.session).list_for_items(
                owner_user_id=user_id, avatar_item_ids=[item_id]
            )
        ).get(item_id)
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
                select(ORMAnimaRuntimeSnapshot).where(
                    ORMAnimaRuntimeSnapshot.owner_user_id == user_id,
                    ORMAnimaRuntimeSnapshot.anima_id == anima_id,
                    ORMAnimaRuntimeSnapshot.effective_revision == revision,
                )
            )
        ).scalar_one_or_none()

    async def get_bundle(self, *, user_id: str, anima_id: str, revision: str, bundle_id: str) -> RuntimeBundle:
        """One issued bundle's members from a live snapshot, without loading its catalog."""

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
    "AnimaRuntimeService",
    "RuntimeFileAuthorization",
    "RuntimeSnapshotError",
]
