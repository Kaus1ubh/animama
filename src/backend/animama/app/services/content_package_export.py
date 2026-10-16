"""Resolve saved sharing selections and freeze their exact portable archive."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import stat
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from tempfile import TemporaryFile
from typing import Any, BinaryIO, cast
from zipfile import ZIP_STORED, ZipFile, ZipInfo

from pydantic import BaseModel, ConfigDict

from animama.adapters.package_inspection import LocalPackageInspector
from animama.app.contracts.content_package import (
    MAX_MANIFEST_BYTES,
    MAX_PACKAGE_BYTES,
    MAX_PACKAGE_FILES,
    NON_PORTABLE_REFERENCES_CAPABILITY,
    PACKAGE_ENTRY_KINDS,
    PACKAGE_ROOT_KINDS,
    PACKAGE_SCHEMA,
    NonPortableAnimaSlot,
    PackageAvatarPortrait,
    PackageDependency,
    PackageEntry,
    PackageFile,
    PackageLicense,
    PackageManifest,
    PackageNonPortableReference,
    PackageNonPortableUse,
    portable_revision,
)
from animama.app.contracts.portable_anima import PortableAnima
from animama.app.ports.avatar_face_parts import AvatarFacePartOverrideRepository
from animama.app.ports.content_package_staging import PackageInspector, PackageStageLease, PackageStages
from animama.app.ports.user_profile_port import UserProfileRepository
from animama.app.services.anima_package_source_service import AnimaPackageSnapshot, AnimaPackageSourceService
from animama.app.services.avatar_face_parts import effective_face_parts
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import MAX_JSON_BYTES, handler_for_kind
from animama.app.services.content_package_staging import PackageStageService
from animama.app.services.content_portability import is_non_portable
from animama.app.services.local_content_mutations import _finish_owned_work, mutation_digest
from animama.app.services.non_portable_packages import strip_optional_refs, strip_sound_events
from animama.app.services.package_inspection import inspect_package
from animama.app.services.typed_content_service import TypedCatalogItem, TypedContentResolutionContext
from animama.domain.content_catalog import (
    OPTIONAL_OMITTED_KEY,
    SCENE_EMOJI_ITEM_REMOVED,
    CatalogContentEntry,
    CatalogContentFile,
    ContentConflictError,
    ContentIntegrityError,
    ContentKind,
    ContentPathError,
    ContentSource,
)
from animama.domain.content_documents import (
    AppearanceDocumentV1,
    AvatarDocumentV1,
    PoseDocumentV1,
    VoiceDocumentV1,
)

_PRIVATE_FIELDS = frozenset(
    {
        "catalog_item_id",
        "owner_user_id",
        "user_id",
        "host_locator",
        "storage_locator",
        "relative_locator",
        "file_ref",
        "preview_id",
        "runtime_revision",
        "effective_revision",
        "avatar_item_id",
        "source_mount_id",
    }
)


def portable_license(value: dict[str, Any]) -> dict[str, Any]:
    """Retain attribution fields without transporting installation provenance."""
    accepted: dict[str, Any] = {}
    for key in PackageLicense.model_fields:
        child = value.get(key)
        if isinstance(child, bool) or isinstance(child, str) and 0 < len(child) <= 2_048:
            accepted[key] = child
        elif (
            isinstance(child, list)
            and len(child) <= 64
            and all(isinstance(item, str) and len(item) <= 512 for item in child)
        ):
            accepted[key] = child
    return accepted


def portable_json(
    value: Any, references: dict[str, str], *, field: str = "", aliases: frozenset[str] = frozenset()
) -> Any:
    """Rewrite exact content references and strip local provenance from authored JSON."""
    if isinstance(value, list):
        return [portable_json(child, references, field=field, aliases=aliases) for child in value]
    if isinstance(value, dict):
        return {
            key: portable_license(child)
            if key == "provenance" and isinstance(child, dict)
            else portable_json(child, {} if key == "poses" else references, field=key, aliases=aliases)
            for key, child in value.items()
            if key not in _PRIVATE_FIELDS
        }
    if isinstance(value, str) and field in {
        "ref",
        "content_id",
        "default_pool",
        "gestures",
        "cueId",
        "effectId",
        "presetId",
    }:
        if field in {"cueId", "effectId", "presetId"}:
            from animama.app.services.content_package_capabilities import normalized_action_selector

            value = normalized_action_selector(value)
            if value in aliases:
                return value
        return references.get(value, value)
    return value


def _json_bytes(value: Any) -> bytes:
    return (
        json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")) + "\n"
    ).encode()


def _download_filename(label: str) -> str:
    """Keep display names readable in a safe, UTC-stamped ZIP download name."""
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f\x7f]', "-", label.strip())
    name = " ".join(name.split()).strip("- .")[:120]
    while len(name.encode("utf-8")) > 180:
        name = name[:-1]
    name = name.rstrip(". ") or "content"
    if re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?", name):
        name = f"content-{name}"
    timestamp = datetime.now(UTC).strftime("%Y%m%d-%H%M%SZ")
    return f"{name}-{timestamp}.zip"


def _json_stream(value: Any) -> BinaryIO:
    """Encode one bounded authored document without a second in-memory payload."""
    stream = cast(BinaryIO, TemporaryFile(mode="w+b"))
    size = 0
    try:
        encoder = json.JSONEncoder(sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
        for part in encoder.iterencode(value):
            for offset in range(0, len(part), 256 * 1024):
                chunk = part[offset : offset + 256 * 1024].encode()
                size += len(chunk)
                if size > MAX_JSON_BYTES:
                    raise ContentConflictError("package_json_too_large")
                stream.write(chunk)
        if size + 1 > MAX_JSON_BYTES:
            raise ContentConflictError("package_json_too_large")
        stream.write(b"\n")
        stream.seek(0)
        return stream
    except BaseException:
        stream.close()
        raise


def _relative_file(entry: CatalogContentEntry, relative: str) -> str:
    locator, path = PurePosixPath(entry.relative_locator), PurePosixPath(relative)
    if locator.suffix:
        if path.parent != locator.parent:
            raise ContentConflictError("package_file_outside_entry")
        return path.name
    try:
        return path.relative_to(locator).as_posix()
    except ValueError as exc:
        raise ContentConflictError("package_file_outside_entry") from exc


def _shared_files(entry: CatalogContentEntry) -> tuple[CatalogContentFile, ...]:
    """Share usable encoded voice material while retaining the recording locally."""
    return tuple(file for file in entry.files if not (entry.kind is ContentKind.VOICE and file.role == "source_sample"))


@dataclass(frozen=True, slots=True)
class ExportSelectionItem:
    item_id: str
    kind: str
    name: str
    revision: str
    selected: bool


@dataclass(frozen=True, slots=True)
class ExportOmittedItem:
    """A non-portable item left out of the package; the receiver may rebind it."""

    kind: str
    name: str


@dataclass(frozen=True, slots=True)
class ExportSummary:
    """Cheap source facts for selection, before any archive or review cache exists."""

    digest: str
    selected_count: int
    required_count: int
    estimated_size_bytes: int
    items: tuple[ExportSelectionItem, ...]
    anima: PortableAnima | None
    omitted: tuple[ExportOmittedItem, ...] = ()


class ExportReview(BaseModel):
    """Public review metadata for one sealed, owner-scoped immutable archive."""

    model_config = ConfigDict(extra="forbid")
    export_id: str
    digest: str
    filename: str
    size_bytes: int
    package_sha256: str
    expires_at: datetime
    selected_count: int
    required_count: int
    manifest: PackageManifest


@dataclass(frozen=True, slots=True)
class CachedExport:
    path: Path
    review: ExportReview


@dataclass
class DownloadLease:
    """The response owns both verified bytes and the stage lock until its finally block."""

    handle: BinaryIO
    review: ExportReview
    _lease: PackageStageLease

    def close(self, *, reclaimable: bool = False) -> None:
        """Keep retry bytes, but allow quota pressure to reclaim a finished HTTP attempt."""
        try:
            if reclaimable and not self.handle.closed:
                self._lease.set_state("completed")
        finally:
            try:
                self.handle.close()
            finally:
                self._lease.close()


class _ReservedWriter:
    """Apply quota checks to ZIP headers and directory bytes as well as payload chunks."""

    def __init__(self, handle: BinaryIO, lease: PackageStageLease) -> None:
        self._handle, self._lease = handle, lease

    def write(self, payload: bytes) -> int:
        self._lease.ensure_capacity(self._handle.tell() + len(payload))
        return self._handle.write(payload)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._handle, name)


@dataclass(frozen=True, slots=True)
class _NonPortableUse:
    """Catalog-identity form of PackageNonPortableUse, mapped to entry ids on write."""

    anima_slot: NonPortableAnimaSlot
    semantic_key: str | None = None
    config: dict[str, Any] | None = None
    pools: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class _Selection:
    summary: ExportSummary
    entries: tuple[TypedCatalogItem, ...]
    root_ids: tuple[str, ...]
    portraits: dict[str, str | None]
    anima_snapshot: AnimaPackageSnapshot | None = None
    # Portable item id -> non-portable item ids removed from it: an effect's
    # optional accompanying sound.
    stripped: dict[str, frozenset[str]] = field(default_factory=dict)
    non_portable: tuple[tuple[CatalogContentEntry, tuple[_NonPortableUse, ...]], ...] = ()
    # Effective face-part corrections by Avatar item id, written into each portable sidecar.
    face_parts: dict[str, dict[str, Any]] = field(default_factory=dict)


def _portraits(
    avatars: tuple[CatalogContentEntry, ...], visible: dict[str, CatalogContentEntry]
) -> dict[str, str | None]:
    """Resolve exact and Included portrait associations, preserving broken selections."""
    result: dict[str, str | None] = {}
    appearances = [item for item in visible.values() if item.kind is ContentKind.APPEARANCE]
    for avatar in avatars:
        matches = [
            item
            for item in appearances
            if isinstance(item.metadata.get("presentation"), dict)
            and item.metadata["presentation"].get("avatar_item_id") == avatar.id
        ]
        if not matches and avatar.source is ContentSource.INCLUDED:
            matches = [
                item
                for item in appearances
                if item.source is ContentSource.INCLUDED
                and item.metadata.get("avatar_model") == PurePosixPath(avatar.relative_locator).stem
            ]
        if len(matches) > 1:
            raise ContentConflictError("package_portrait_ambiguous")
        result[avatar.id] = matches[0].id if matches else None
    return result


class ContentPackageExportService:
    """Summary uses catalog authority; preparation verifies and seals the captured bytes."""

    def __init__(
        self,
        *,
        content: ContentCatalogService,
        exports_root: Path | None = None,
        anima_sources: AnimaPackageSourceService | None = None,
        stages: PackageStages | None = None,
        inspector: PackageInspector | None = None,
        profiles: UserProfileRepository | None = None,
        face_part_overrides: AvatarFacePartOverrideRepository | None = None,
    ) -> None:
        self._content = content
        self._face_part_overrides = face_part_overrides
        self._catalog = content.mutations.catalog
        self._store = content.mutations.store
        if stages is None and exports_root is None:
            raise ValueError("package stages or a local export root are required")
        if content.owner_id is not None:
            if getattr(stages, "owner_id", None) != content.owner_id:
                raise ValueError("package stages must bind the same content owner")
            if inspector is None:
                raise ValueError("an owner-bound package composition requires an explicit inspector")
        if stages is None:
            assert exports_root is not None
            stages = PackageStageService(exports_root.parent / "imports", exports_root)
        self._stages = stages
        self._inspector = inspector or LocalPackageInspector(store=self._store)
        self._animas = anima_sources
        self._profiles = profiles

    async def _selection(self, *, user_id: str, item_ids: tuple[str, ...], anima_id: str | None) -> _Selection:
        self._content.require_owner(user_id)
        if bool(item_ids) == bool(anima_id) or len(item_ids) != len(set(item_ids)):
            raise ContentConflictError("package_selection_invalid")
        visible = {item.id: item for item in await self._catalog.list_visible(user_id=user_id)}
        context = TypedContentResolutionContext(visible)
        definition, snapshot = None, None
        uses: dict[str, list[_NonPortableUse]] = {}
        if anima_id is not None:
            if self._animas is None:
                raise ContentConflictError("package_anima_unavailable")
            captured = await self._animas.capture(user_id=user_id, anima_id=anima_id)
            definition, snapshot = captured.definition, captured.snapshot
            roots = captured.selected_item_ids
            for omitted in captured.omitted:
                visible.setdefault(omitted.item.id, omitted.item)
                uses.setdefault(omitted.item.id, []).append(
                    _NonPortableUse(
                        anima_slot=omitted.slot,
                        semantic_key=omitted.semantic_key,
                        config=omitted.config,
                        pools=omitted.pools,
                    )
                )
        else:
            roots = item_ids
            if any(item not in visible or visible[item].kind not in PACKAGE_ROOT_KINDS for item in roots):
                raise ContentConflictError("package_root_invalid")
            restricted_roots = [visible[item] for item in roots if is_non_portable(visible[item])]
            if restricted_roots:
                raise ContentConflictError(
                    "package_non_portable", items=tuple(item.display_name for item in restricted_roots)
                )
        entries: dict[str, TypedCatalogItem] = {}
        for root in roots:
            for item in context.resolve(root):
                if item.item.kind not in PACKAGE_ENTRY_KINDS:
                    raise ContentConflictError("package_kind_unsupported")
                entries[item.item.id] = item
        # An Action that still names a removed Included effect would travel
        # with events nothing plays; it is repaired in its creator first.
        outdated = [item.item for item in entries.values() if item.item.missing_dependencies]
        if outdated:
            raise ContentConflictError(
                "package_dependency_missing", items=tuple(item.display_name for item in outdated)
            )
        # A Scene saved with a Twemoji item plays without it here; elsewhere
        # the item would be unavailable, so it is replaced in its creator first.
        with_emoji = [
            item.item
            for item in entries.values()
            if any(diagnostic.code == SCENE_EMOJI_ITEM_REMOVED for diagnostic in item.item.diagnostics)
        ]
        if with_emoji:
            raise ContentConflictError(SCENE_EMOJI_ITEM_REMOVED, items=tuple(item.display_name for item in with_emoji))
        portraits = _portraits(
            tuple(item.item for item in entries.values() if item.item.kind is ContentKind.AVATAR), visible
        )
        for portrait in portraits.values():
            if portrait is not None:
                for item in context.resolve(portrait):
                    entries[item.item.id] = item
        # After portraits, so a non-portable portrait is refused like any other item.
        silent: set[str] = set()
        stripped = self._strip_non_portable(entries, uses, silent)
        face_parts = await self._face_parts(user_id=user_id, entries=tuple(entries.values()))
        total = sum(file.size_bytes for item in entries.values() for file in _shared_files(item.item))
        count = sum(len(_shared_files(item.item)) for item in entries.values())
        count += sum(
            not any(file.role in {"descriptor", "metadata"} for file in item.item.files) for item in entries.values()
        )
        if total > MAX_PACKAGE_BYTES or count > MAX_PACKAGE_FILES:
            raise ContentConflictError("package_size_invalid")
        non_portable = tuple((visible[item_id], tuple(item_uses)) for item_id, item_uses in sorted(uses.items()))
        digest = mutation_digest(
            {
                "schema": PACKAGE_SCHEMA,
                "roots": list(roots),
                "anima": asdict(snapshot) if snapshot else None,
                "sources": {item.item.id: item.item.revision_sha256 for item in entries.values()},
                "portraits": portraits,
                "non_portable": {item.id: item.revision_sha256 for item, _ in non_portable},
                "face_parts": face_parts,
            }
        )
        selected = set(item_ids)
        summary = ExportSummary(
            digest=digest,
            selected_count=len(item_ids),
            required_count=len(entries) - len(item_ids),
            estimated_size_bytes=total,
            items=tuple(
                ExportSelectionItem(
                    item.item.id,
                    item.item.kind.value,
                    item.item.display_name,
                    item.item.revision_sha256 or "",
                    item.item.id in selected,
                )
                for item in entries.values()
            ),
            anima=definition,
            omitted=tuple(
                ExportOmittedItem(item.kind.value, item.display_name)
                for item in (
                    *(item for item, _ in non_portable),
                    *sorted((visible[item_id] for item_id in silent), key=lambda item: item.display_name),
                )
            ),
        )
        return _Selection(
            summary,
            tuple(entries.values()),
            tuple(roots),
            portraits,
            snapshot,
            stripped=stripped,
            non_portable=non_portable,
            face_parts=face_parts,
        )

    @staticmethod
    def _strip_non_portable(
        entries: dict[str, TypedCatalogItem], uses: dict[str, list[_NonPortableUse]], silent: set[str]
    ) -> dict[str, frozenset[str]]:
        """Remove optional non-portable sounds; refuse any other non-portable dependency.

        Mutates ``entries`` and ``silent`` (sounds omitted without a reference).
        Omitted Anima bindings never reach here. A non-portable item reached in
        any other way (as a root, or through another kind) blocks the export and
        is named in the error.
        """

        restricted = {item_id for item_id, item in entries.items() if is_non_portable(item.item)}
        if not restricted:
            return {}
        stripped: dict[str, set[str]] = {}
        allowed: set[str] = set()
        for item_id, typed in entries.items():
            targets = dict(zip(typed.item.dependency_item_ids, typed.item.dependencies, strict=True))
            optional = {edge.ref for edge in typed.document.dependencies if edge.optional}
            for target, ref in targets.items():
                if target not in restricted:
                    continue
                dependency = entries[target]
                if item_id not in restricted and ref in optional and dependency.item.kind is ContentKind.SOUND_EFFECT:
                    stripped.setdefault(item_id, set()).add(target)
                    allowed.add(target)
                    silent.add(target)
                    continue
                raise ContentConflictError("package_non_portable", items=(dependency.item.display_name,))
        blocked = sorted(entries[item_id].item.display_name for item_id in restricted - allowed)
        if blocked:
            raise ContentConflictError("package_non_portable", items=tuple(blocked))
        for item_id in restricted:
            del entries[item_id]
        return {item_id: frozenset(targets) for item_id, targets in stripped.items()}

    async def _face_parts(self, *, user_id: str, entries: tuple[TypedCatalogItem, ...]) -> dict[str, dict[str, Any]]:
        """Resolve each exported Avatar's effective correction for this owner.

        A Local sidecar travels as authored; an Included Avatar has no editable
        sidecar, so the owner's current override is merged into the portable
        document and the imported Local copy keeps it. Stale values are dropped.
        """

        avatars = [item for item in entries if isinstance(item.document, AvatarDocumentV1)]
        included = [item.item.id for item in avatars if item.item.source is ContentSource.INCLUDED]
        overrides = (
            await self._face_part_overrides.list_for_items(owner_user_id=user_id, avatar_item_ids=included)
            if self._face_part_overrides is not None and included
            else {}
        )
        result: dict[str, dict[str, Any]] = {}
        for avatar in avatars:
            assert isinstance(avatar.document, AvatarDocumentV1)
            effective = effective_face_parts(
                item=avatar.item, document=avatar.document, override=overrides.get(avatar.item.id)
            )
            if effective.face_parts is not None:
                result[avatar.item.id] = effective.face_parts
        return result

    async def summarize(
        self, *, user_id: str, item_ids: tuple[str, ...] = (), anima_id: str | None = None
    ) -> ExportSummary:
        return (await self._selection(user_id=user_id, item_ids=item_ids, anima_id=anima_id)).summary

    async def prepare(
        self, *, user_id: str, expected_digest: str, item_ids: tuple[str, ...] = (), anima_id: str | None = None
    ) -> ExportReview:
        """Own capture through cleanup even when its requesting connection disappears."""
        self._content.require_owner(user_id)
        return await _finish_owned_work(
            self._prepare(user_id=user_id, expected_digest=expected_digest, item_ids=item_ids, anima_id=anima_id)
        )

    async def _prepare(
        self, *, user_id: str, expected_digest: str, item_ids: tuple[str, ...], anima_id: str | None
    ) -> ExportReview:
        # Acquire the source fence before the Anima definition lock, matching
        # creation/import publication. Rescans also observe manual file changes
        # and new portrait associations that were not in the prior catalog.
        return await self._content.mutations.reconcile(
            lambda: self._capture_and_prepare(
                user_id=user_id, expected_digest=expected_digest, item_ids=item_ids, anima_id=anima_id
            )
        )

    async def _capture_and_prepare(
        self, *, user_id: str, expected_digest: str, item_ids: tuple[str, ...], anima_id: str | None
    ) -> ExportReview:
        await self._catalog.lock_source(source=ContentSource.INCLUDED)
        await self._content.rescan(user_id=user_id)
        selected = await self._selection(user_id=user_id, item_ids=item_ids, anima_id=anima_id)
        if selected.summary.digest != expected_digest:
            raise ContentConflictError("package_export_source_changed")
        if selected.summary.anima is not None:
            label = selected.summary.anima.display_name
        else:
            # Personalization names only the download; it is never portable content.
            profile = await self._profiles.get_profile(user_id) if self._profiles is not None else None
            label = (profile.display_name if profile is not None else None) or "content"
        filename = _download_filename(label)
        lease = await asyncio.to_thread(
            self._stages.reserve_export, user_id, filename, max(1, selected.summary.estimated_size_bytes)
        )
        record = lease.record
        try:
            manifest = await asyncio.to_thread(self._write_reserved, selected, lease)
            # Inspect exactly the produced bytes through the import boundary.
            async with inspect_package(self._inspector, lease):
                pass
            await asyncio.to_thread(self._verify_sources, selected)
            await self._content.rescan(user_id=user_id)
            if selected.anima_snapshot is not None:
                assert self._animas is not None
                await self._animas.recheck(user_id=user_id, snapshot=selected.anima_snapshot)
            after = await self._selection(user_id=user_id, item_ids=item_ids, anima_id=anima_id)
            if after.summary.digest != selected.summary.digest:
                raise ContentConflictError("package_export_source_changed")
            size, digest = await asyncio.to_thread(lease.seal_archive)
            review = ExportReview(
                export_id=record.stage_id,
                digest=mutation_digest({"schema": PACKAGE_SCHEMA, "sha256": digest}),
                filename=filename,
                size_bytes=size,
                package_sha256=digest,
                expires_at=lease.record.expires_at,
                selected_count=selected.summary.selected_count,
                required_count=selected.summary.required_count,
                manifest=manifest,
            )
            published = await asyncio.to_thread(lease.publish_review, review.model_dump(mode="json"), review.digest)
            review.expires_at = published.expires_at
            return review
        except BaseException as exc:
            await asyncio.to_thread(lease.discard)
            if isinstance(exc, ContentIntegrityError | ContentPathError):
                raise ContentConflictError("package_export_source_changed") from exc
            raise
        finally:
            await asyncio.to_thread(lease.close)

    def _write_reserved(self, selected: _Selection, lease: PackageStageLease) -> PackageManifest:
        with lease.write_archive() as handle:
            return self._write(selected, cast(BinaryIO, _ReservedWriter(handle, lease)))

    async def cached(self, *, user_id: str, export_id: str) -> CachedExport:
        """Compatibility helper for service callers; HTTP must keep a download lease."""
        download = await self.download(user_id=user_id, export_id=export_id)
        try:
            local_path = getattr(download._lease, "archive_path", None)
            if not isinstance(local_path, Path):
                raise ContentConflictError("package_local_path_unavailable")
            return CachedExport(local_path, download.review)
        finally:
            await asyncio.to_thread(download.close)

    async def download(self, *, user_id: str, export_id: str) -> DownloadLease:
        """Open the exact sealed archive while retaining its cleanup exclusion lease."""
        self._content.require_owner(user_id)
        opened: list[DownloadLease] = []

        async def own_open() -> DownloadLease:
            result = await asyncio.to_thread(self._open_download, user_id, export_id)
            opened.append(result)
            return result

        try:
            return await _finish_owned_work(own_open())
        except BaseException:
            # Shielding finishes the open before propagating a disconnect; if no
            # response takes ownership, the completed handle still needs closing.
            for result in opened:
                result.close()
            raise

    def _open_download(self, user_id: str, export_id: str) -> DownloadLease:
        lease: PackageStageLease | None = None
        try:
            lease = self._stages.acquire(user_id, export_id, "export")
            if lease.record.state not in {"reviewed", "completed"} or lease.record.review is None:
                raise ContentConflictError("package_export_unavailable")
            review = ExportReview.model_validate(lease.record.review)
            size, digest = lease.verify_archive()
            if review.size_bytes != size or review.package_sha256 != digest:
                raise ContentConflictError("package_export_changed")
            review.expires_at = lease.record.expires_at
            return DownloadLease(lease.open_archive(), review, lease)
        except BaseException as exc:
            if lease is not None:
                lease.close()
            if isinstance(exc, ContentConflictError):
                code = {
                    "package_stage_expired": "package_export_expired",
                    "package_stage_unavailable": "package_export_unavailable",
                    "package_archive_changed": "package_export_changed",
                }.get(exc.code, exc.code)
                raise ContentConflictError(code) from exc
            if isinstance(exc, OSError | ValueError):
                raise ContentConflictError("package_export_unavailable") from exc
            raise

    @staticmethod
    def _hash(path: Path) -> tuple[int, str]:
        digest, size = hashlib.sha256(), 0
        with path.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_PACKAGE_BYTES:
                    raise ContentConflictError("package_size_invalid")
                digest.update(chunk)
        return size, digest.hexdigest()

    def _verify_sources(self, selected: _Selection) -> None:
        for item in selected.entries:
            for file in item.item.files:
                opened = self._store.open_verified_file(
                    source=file.source,
                    source_mount_id=file.source_mount_id,
                    relative_path=file.relative_path,
                    expected_size_bytes=file.size_bytes,
                    expected_sha256=file.sha256,
                    media_type=file.media_type,
                )
                opened.handle.close()

    def _write(self, selected: _Selection, destination: BinaryIO) -> PackageManifest:
        from animama.app.services.content_package_capabilities import (
            derive_document_capabilities,
            derive_file_capabilities,
        )
        from animama.app.services.portable_anima_service import rewrite_portable_anima

        identities = {item.item.id: f"entry-{index:04d}" for index, item in enumerate(selected.entries, start=1)}
        # Variant admission needs each resolved target's typed definition; their
        # definitions do not change when transport identities are rewritten.
        target_documents = {identities[item.item.id]: item.document for item in selected.entries}
        references = dict(identities)
        for item in selected.entries:
            references[item.item.relative_locator] = identities[item.item.id]
            if item.item.logical_key:
                references[item.item.logical_key] = identities[item.item.id]
        manifest_entries: list[PackageEntry] = []
        capabilities: set[str] = set()
        expanded = 0
        # Stored ZIP members cannot violate the ratio limit for highly repetitive
        # authored JSON/textures. Media is already compressed; streamed writes
        # avoid retaining a second package-sized tree during capture.
        with ZipFile(destination, "x", compression=ZIP_STORED) as archive:
            for index, typed in enumerate(selected.entries):
                entry, document = typed.item, typed.document
                handler = handler_for_kind(entry.kind)
                projection = handler.catalog_projection(document)
                projection["content_id"] = identities[entry.id]
                projection["provenance"] = portable_license(entry.provenance)
                if isinstance(document, PoseDocumentV1):
                    # A static Pose repeats its own descriptor identity. Embedded
                    # clip pose maps remain authored local keys, never graph refs.
                    projection["pose"] = {**document.pose, "id": identities[entry.id], "name": document.name}
                if isinstance(document, AppearanceDocumentV1):
                    projection["avatar_model"], projection["presentation"] = None, {}
                if isinstance(document, VoiceDocumentV1):
                    projection["files"] = [file for file in projection["files"] if file["role"] != "source_sample"]
                removed = selected.stripped.get(entry.id, frozenset())
                removed_refs = {
                    ref
                    for ref, target in zip(entry.dependencies, entry.dependency_item_ids, strict=True)
                    if target in removed
                }
                projection = strip_optional_refs(projection, removed_refs)
                # An Action's clip loses the sound events of every optional
                # sound left behind: stripped here, or omitted by this build.
                omitted = entry.provenance.get(OPTIONAL_OMITTED_KEY)
                silenced = {
                    *(edge.alias for edge in document.dependencies if edge.alias and edge.ref in removed_refs),
                    *(omitted if isinstance(omitted, dict) else ()),
                }
                if isinstance(document, AvatarDocumentV1):
                    projection.pop("face_parts", None)
                    if entry.id in selected.face_parts:
                        projection["face_parts"] = selected.face_parts[entry.id]
                aliases = frozenset(edge.alias for edge in document.dependencies if edge.alias)
                portable = portable_json(projection, references, aliases=aliases)
                portable_document = handler.parse_document(
                    portable,
                    fallback_path=Path(entry.relative_locator),
                    descriptor_backed=not PurePosixPath(entry.relative_locator).suffix,
                ).document
                capabilities.update(derive_document_capabilities(portable_document))
                files = []
                for ordinal, file in enumerate(
                    sorted(_shared_files(entry), key=lambda value: (value.role, value.relative_path)), start=1
                ):
                    relative = _relative_file(entry, file.relative_path)
                    archive_name = f"entries/{index:04d}/{relative}"
                    info = ZipInfo(archive_name, date_time=(1980, 1, 1, 0, 0, 0))
                    info.compress_type, info.external_attr = ZIP_STORED, (stat.S_IFREG | 0o600) << 16
                    opened = self._store.open_verified_file(
                        source=file.source,
                        source_mount_id=file.source_mount_id,
                        relative_path=file.relative_path,
                        expected_size_bytes=file.size_bytes,
                        expected_sha256=file.sha256,
                        media_type=file.media_type,
                    )
                    rewritten: BinaryIO | None = None
                    try:
                        if file.role in {"descriptor", "metadata"}:
                            rewritten = _json_stream(portable)
                        elif relative.lower().endswith(".json"):
                            if file.size_bytes > MAX_JSON_BYTES:
                                raise ContentConflictError("package_json_too_large")
                            rewritten = _json_stream(
                                portable_json(
                                    strip_sound_events(json.loads(opened.handle.read(MAX_JSON_BYTES + 1)), silenced),
                                    references,
                                    aliases=aliases,
                                )
                            )
                        source = rewritten if rewritten is not None else opened.handle
                        capabilities.update(
                            derive_file_capabilities(
                                entry.kind,
                                portable_document,
                                relative,
                                source,
                                role=file.role,
                                documents=target_documents,
                            )
                        )
                        source.seek(0)
                        digest, size = hashlib.sha256(), 0
                        with archive.open(info, "w", force_zip64=True) as target:
                            while chunk := source.read(1024 * 1024):
                                size += len(chunk)
                                expanded += len(chunk)
                                if expanded > MAX_PACKAGE_BYTES:
                                    raise ContentConflictError("package_size_invalid")
                                digest.update(chunk)
                                target.write(chunk)
                        if rewritten is None and (size != file.size_bytes or digest.hexdigest() != file.sha256):
                            raise ContentConflictError("package_export_source_changed")
                    finally:
                        if rewritten is not None:
                            rewritten.close()
                        opened.handle.close()
                    files.append(
                        PackageFile(
                            archive_path=archive_name,
                            relative_path=relative,
                            role=file.role,
                            ordinal=ordinal,
                            media_type=file.media_type,
                            size_bytes=size,
                            sha256=digest.hexdigest(),
                        )
                    )
                if not any(file.role in {"descriptor", "metadata"} for file in entry.files):
                    # Bare models/images have no sidecar in the source Library.
                    # Their portable identity and display name still need an
                    # explicit document; never modify the original media bytes.
                    relative = PurePosixPath(entry.relative_locator).with_suffix(".meta.json").name
                    info = ZipInfo(f"entries/{index:04d}/{relative}", date_time=(1980, 1, 1, 0, 0, 0))
                    info.external_attr = (stat.S_IFREG | 0o600) << 16
                    digest, size = hashlib.sha256(), 0
                    with _json_stream(portable) as source, archive.open(info, "w", force_zip64=True) as target:
                        while chunk := source.read(1024 * 1024):
                            size += len(chunk)
                            expanded += len(chunk)
                            if expanded > MAX_PACKAGE_BYTES:
                                raise ContentConflictError("package_size_invalid")
                            digest.update(chunk)
                            target.write(chunk)
                    files.append(
                        PackageFile(
                            archive_path=info.filename,
                            relative_path=relative,
                            role="metadata",
                            ordinal=len(files) + 1,
                            media_type="application/json",
                            size_bytes=size,
                            sha256=digest.hexdigest(),
                        )
                    )
                manifest_entries.append(
                    PackageEntry(
                        package_entry_id=identities[entry.id],
                        kind=entry.kind,
                        logical_key=identities[entry.id],
                        display_name=document.name,
                        portable_revision_sha256=portable_revision(files),
                        dependencies=[
                            PackageDependency(ref=identities[target], content_type=dependency.kind)
                            for dependency, target in zip(document.dependencies, entry.dependency_item_ids, strict=True)
                            if target not in removed
                        ],
                        files=files,
                        license=PackageLicense.model_validate(portable_license(entry.provenance)),
                    )
                )
            manifest = PackageManifest(
                schema_=PACKAGE_SCHEMA,
                kind="anima" if selected.summary.anima else "content",
                root_entry_ids=[] if selected.summary.anima else [identities[root] for root in selected.root_ids],
                anima=rewrite_portable_anima(selected.summary.anima, identities) if selected.summary.anima else None,
                entries=manifest_entries,
                avatar_portraits=[
                    PackageAvatarPortrait(avatar_entry_id=identities[avatar], appearance_entry_id=identities[portrait])
                    for avatar, portrait in selected.portraits.items()
                    if portrait
                ],
                capabilities=sorted(
                    capabilities | ({NON_PORTABLE_REFERENCES_CAPABILITY} if selected.non_portable else set())
                ),
                non_portable_references=[
                    PackageNonPortableReference(
                        kind=item.kind,
                        logical_key=item.logical_key or item.id,
                        display_name=item.display_name,
                        uses=[
                            PackageNonPortableUse(
                                anima_slot=use.anima_slot,
                                semantic_key=use.semantic_key,
                                config=use.config or {},
                                pools=list(use.pools),
                            )
                            for use in uses
                        ],
                    )
                    for item, uses in selected.non_portable
                ],
            )
            dumped = manifest.model_dump(mode="json", by_alias=True)
            if not dumped["non_portable_references"]:
                del dumped["non_portable_references"]
            payload = _json_bytes(dumped)
            if len(payload) > MAX_MANIFEST_BYTES or expanded + len(payload) > MAX_PACKAGE_BYTES:
                raise ContentConflictError("package_size_invalid")
            info = ZipInfo("package.json", date_time=(1980, 1, 1, 0, 0, 0))
            info.external_attr = (stat.S_IFREG | 0o600) << 16
            archive.writestr(info, payload)
        destination.flush()
        return manifest
