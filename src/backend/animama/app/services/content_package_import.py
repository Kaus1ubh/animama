"""Review and atomically install one complete, independently copied portable package."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import unicodedata
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from functools import partial
from pathlib import PurePosixPath
from typing import Any, BinaryIO
from uuid import uuid4

from animama.adapters.package_inspection import LocalPackageInspector
from animama.app.contracts.content_package import PackageManifest
from animama.app.contracts.content_package_import import (
    ImportedPackageItem,
    LegacyImportedPackageItem,
    LegacyPackageImportResult,
    PackageImportResult,
    PackageOperationStatus,
    PlannedImportItem,
    PlannedNonPortableItem,
    ReviewedImportItem,
    ReviewedImportPlan,
    ReviewedNonPortableItem,
    ReviewedPackageImport,
)
from animama.app.contracts.portable_anima import PortableAnima, PortableGestureSelection
from animama.app.ports.anima_aggregate_port import AnimaAggregateUnitOfWork
from animama.app.ports.content_package_staging import PackageInspector, PackageStageLease, PackageStages
from animama.app.ports.content_publication import ContentMutations
from animama.app.services.anima_aggregate_materializer import AnimaAggregateMaterializer
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import (
    MAX_JSON_BYTES,
    definition_for_kind,
    descriptor_filename,
    handler_for_kind,
)
from animama.app.services.content_names import folding_drops_characters, name_hash
from animama.app.services.content_package_archive import InspectedPackage, InspectedPackageEntry
from animama.app.services.content_package_export import _json_stream, portable_json
from animama.app.services.content_portability import is_non_portable
from animama.app.services.local_content_mutations import _finish_owned_work, mutation_digest
from animama.app.services.non_portable_packages import restore_idle_refs
from animama.app.services.package_inspection import inspect_package
from animama.app.services.portable_anima_service import resolve_portable_anima, validate_package_anima_runtime
from animama.app.services.typed_content_service import TypedContentService
from animama.domain.anima_definition import ANIMA_IDENTITY_MAX_BYTES, normalize_identity
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentConflictError,
    ContentKind,
    ContentSource,
    ContentStatus,
    PreparedPackageEntry,
    PreparedPackageFile,
)


def import_request_digest(review_digest: str) -> str:
    """The submitted immutable review identifies retries without opening stage bytes."""
    return mutation_digest({"command": "import_package_v3", "review_digest": review_digest})


def _plan_digest(plan: ReviewedImportPlan) -> str:
    value = json.dumps(plan.model_dump(mode="json"), sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(value.encode()).hexdigest()


def _name_key(name: str) -> str:
    return unicodedata.normalize("NFC", name).casefold()


def _numbered_name(name: str, number: int, limit: int = 120) -> str:
    suffix = f"-{number}" if number > 1 else ""
    return name[: limit - len(suffix)].rstrip() + suffix


def _path_name(name: str) -> str:
    """Names are display text; ASCII filenames do not constrain valid Unicode names.

    Names in other scripts keep a name hash so different names get different paths.
    """
    segment = re.sub(r"[^A-Za-z0-9_-]+", "-", unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode())
    segment = segment.strip("-.").lower()[:100]
    if folding_drops_characters(name):
        segment = f"{(segment or 'content')[:92]}-{name_hash(name)}"
    segment = segment or "content"
    if re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?", segment):
        segment = f"content-{segment}"
    return segment


def _rewritten_member(
    source: InspectedPackageEntry, relative_path: str, references: dict[str, str], aliases: frozenset[str]
) -> BinaryIO:
    """Reopen and rewrite one bounded JSON member, never a whole package in RAM."""
    with source.open_file(relative_path) as handle:
        payload = handle.read(MAX_JSON_BYTES + 1)
    if len(payload) > MAX_JSON_BYTES:
        raise ContentConflictError("package_json_too_large")
    return _json_stream(portable_json(json.loads(payload), references, aliases=aliases))


class ContentPackageImportService:
    """The stage owns reviewed bytes; one publication owns bytes, catalog and receipt.

    The optional Anima unit of work must use the catalog's database session. It
    never commits independently and is required for Avatar registration as well
    as complete Anima imports.
    """

    def __init__(
        self,
        *,
        mutations: ContentMutations,
        content: ContentCatalogService,
        stages: PackageStages,
        inspector: PackageInspector | None = None,
        allow_anima_import: bool = True,
        uow: AnimaAggregateUnitOfWork | None = None,
        default_model_provider_id: str | None = None,
        max_identity_bytes: int = ANIMA_IDENTITY_MAX_BYTES,
    ) -> None:
        if mutations is not content.mutations:
            raise ValueError("package imports must use the content publication authority")
        if content.owner_id is not None:
            if getattr(stages, "owner_id", None) != content.owner_id:
                raise ValueError("package stages must bind the same content owner")
            if inspector is None:
                raise ValueError("an owner-bound package composition requires an explicit inspector")
        self._mutations, self._content, self._stages = mutations, content, stages
        self._catalog, self._store = mutations.catalog, mutations.store
        self._uow, self._default_model = uow, default_model_provider_id
        self._max_identity_bytes = min(max_identity_bytes, ANIMA_IDENTITY_MAX_BYTES)
        self._inspector = inspector or LocalPackageInspector(store=self._store)
        self._allow_anima_import = allow_anima_import

    def _admit_manifest(self, manifest: PackageManifest) -> None:
        """The composition may forbid creation while retaining content packages."""
        if not self._allow_anima_import and manifest.anima is not None:
            raise ContentConflictError("package_anima_import_unavailable")

    @asynccontextmanager
    async def _import_stage(self, *, user_id: str, stage_id: str) -> AsyncIterator[PackageStageLease]:
        """Release denied import bytes after inspection, retaining unresolved publication."""
        with self._stages.acquire(user_id, stage_id) as lease:
            try:
                yield lease
            except ContentConflictError as exc:
                if self._allow_anima_import or exc.code != "package_anima_import_unavailable":
                    raise
                record = lease.record
                if record.operation_id is not None and self._mutations.has_pending(
                    user_id=user_id, operation_id=record.operation_id
                ):
                    # Policy changes must not erase bytes needed to resolve an
                    # earlier publication's unknown durable outcome.
                    lease.set_state("recovery_needed")
                else:
                    if record.state in {"committing", "recovery_needed"}:
                        # A crash before publication may leave a protected marker
                        # without any publication work to recover.
                        lease.set_state("failed")
                    await asyncio.to_thread(lease.discard)
                raise

    async def review(self, *, user_id: str, stage_id: str) -> ReviewedPackageImport:
        """Validate all archive bytes and freeze a complete proposal without installing."""
        self._content.require_owner(user_id)
        return await _finish_owned_work(self._review(user_id=user_id, stage_id=stage_id))

    async def _review(self, *, user_id: str, stage_id: str) -> ReviewedPackageImport:
        async with self._import_stage(user_id=user_id, stage_id=stage_id) as lease:
            record = lease.record
            if record.review is not None:
                self._admit_manifest(ReviewedImportPlan.model_validate(record.review["plan"]).manifest)
                await asyncio.to_thread(lease.verify_archive)
                assert record.review_digest is not None
                renewed = lease.renew_review(record.review_digest)
                return ReviewedPackageImport.model_validate(record.review["public"]).model_copy(
                    update={"expires_at": renewed.expires_at}
                )
            if record.operation_id is None:
                raise ContentConflictError("package_import_operation_missing")
            if await self._catalog.get_mutation_receipt(user_id=user_id, operation_id=record.operation_id):
                raise ContentConflictError("operation_id_reused")
            size, digest = await asyncio.to_thread(lease.seal_archive)
            async with inspect_package(self._inspector, lease) as inspected:
                self._admit_manifest(inspected.manifest)

                async def plan_current() -> ReviewedImportPlan:
                    await self._content.rescan(user_id=user_id)
                    return await self._plan(user_id=user_id, lease=lease, inspected=inspected, size=size, digest=digest)

                plan = await self._mutations.reconcile(plan_current)
            review_digest = _plan_digest(plan)
            public = ReviewedPackageImport(
                stage_id=stage_id,
                operation_id=record.operation_id,
                filename=record.filename,
                package_sha256=digest,
                size_bytes=size,
                expires_at=record.expires_at,
                kind=plan.manifest.kind,
                selected_count=sum(item.selected for item in plan.items),
                required_count=sum(not item.selected for item in plan.items),
                items=tuple(
                    ReviewedImportItem.model_validate(item.model_dump(include=set(ReviewedImportItem.model_fields)))
                    for item in plan.items
                ),
                anima=plan.anima,
                review_digest=review_digest,
                non_portable=tuple(
                    ReviewedNonPortableItem.model_validate(
                        item.model_dump(include=set(ReviewedNonPortableItem.model_fields))
                    )
                    for item in plan.non_portable
                ),
            )
            published = lease.publish_review(
                {"plan": plan.model_dump(mode="json"), "public": public.model_dump(mode="json")}, review_digest
            )
            return public.model_copy(update={"expires_at": published.expires_at})

    async def _plan(
        self, *, user_id: str, lease: PackageStageLease, inspected: InspectedPackage, size: int, digest: str
    ) -> ReviewedImportPlan:
        if self._uow is None and any(entry.kind is ContentKind.AVATAR for entry in inspected.manifest.entries):
            raise ContentConflictError("package_avatar_import_unavailable")
        visible = await self._catalog.list_visible(user_id=user_id)
        names = {(item.kind, _name_key(item.display_name)) for item in visible}
        locators = {_name_key(item.relative_locator) for item in visible}
        items: list[PlannedImportItem] = []
        selected = set(inspected.manifest.root_entry_ids)
        if inspected.manifest.anima is not None:
            selected.update(entry_id for entry_id, _ in inspected.manifest.anima.entry_references())
        for entry in inspected.manifest.entries:
            descriptor = any(member.role == "descriptor" for member in entry.files)
            suffix = (
                ""
                if descriptor
                else PurePosixPath(inspected.entries[entry.package_entry_id].scanned.relative_locator).suffix
            )
            number = 1
            while True:
                name = _numbered_name(entry.display_name, number)
                filename = _numbered_name(_path_name(entry.display_name), number)
                locator = f"{definition_for_kind(entry.kind).directory}/{filename}{suffix}"
                if (
                    (entry.kind, _name_key(name)) not in names
                    and _name_key(locator) not in locators
                    and not self._store.package_destination_exists(relative_locator=locator)
                ):
                    break
                number += 1
                if number > 100_000:
                    raise ContentConflictError("package_name_exhausted")
            names.add((entry.kind, _name_key(name)))
            locators.add(_name_key(locator))
            items.append(
                PlannedImportItem(
                    entry_id=entry.package_entry_id,
                    kind=entry.kind,
                    original_name=entry.display_name,
                    name=name,
                    selected=entry.package_entry_id in selected,
                    item_id=str(uuid4()),
                    logical_key=f"local:{entry.kind.value}:{uuid4().hex}",
                    relative_locator=locator,
                )
            )
        anima = inspected.manifest.anima
        if anima is not None:
            await self._validate_prerequisite(anima.identity_markdown)
            assert self._uow is not None
            anima_names = {
                _name_key(item.display_name)
                for item in await self._uow.animas.list()
                if item.user_id in {None, user_id}
            }
            number = 1
            while _name_key(_numbered_name(anima.display_name, number, 40)) in anima_names:
                number += 1
            anima = anima.model_copy(update={"display_name": _numbered_name(anima.display_name, number, 40)})
        assert lease.record.operation_id is not None
        return ReviewedImportPlan(
            stage_id=lease.record.stage_id,
            operation_id=lease.record.operation_id,
            package_sha256=digest,
            size_bytes=size,
            manifest=inspected.manifest,
            items=tuple(items),
            anima=anima,
            default_model_provider_id=self._default_model if anima is not None else None,
            non_portable=_plan_non_portable(inspected.manifest, visible),
        )

    async def _validate_prerequisite(self, identity: str, *, lock: bool = False) -> None:
        if self._uow is None or self._default_model is None:
            raise ContentConflictError("package_anima_import_unavailable")
        normalize_identity(identity, max_bytes=self._max_identity_bytes)
        provider = await self._uow.model_providers.get(self._default_model, for_update=lock)
        if provider is None or not provider.active:
            raise ContentConflictError("anima_model_provider_unavailable")

    async def commit(
        self, *, user_id: str, stage_id: str, operation_id: str, review_digest: str
    ) -> PackageImportResult:
        """Replay first, then commit the exact reviewed whole package under its stage lock."""
        return await _finish_owned_work(
            self._commit(user_id=user_id, stage_id=stage_id, operation_id=operation_id, review_digest=review_digest)
        )

    async def _completed(self, *, user_id: str, operation_id: str, review_digest: str) -> PackageImportResult | None:
        self._content.require_owner(user_id)
        receipt = await self._catalog.get_mutation_receipt(user_id=user_id, operation_id=operation_id)
        if receipt is None:
            return None
        if receipt["request_digest"] != import_request_digest(review_digest):
            raise ContentConflictError("operation_id_reused")
        return PackageImportResult.model_validate(receipt["result"]["value"])

    def _release_completed_stage(self, *, user_id: str, operation_id: str) -> None:
        """A receipt can release stale protected quota, but never depends on stage availability."""
        try:
            stage = self._stages.find_import(user_id, operation_id)
            if stage is not None:
                with self._stages.acquire(user_id, stage.stage_id, allow_expired=True) as lease:
                    lease.set_state("completed")
        except (ContentConflictError, OSError):
            pass

    async def _commit(
        self, *, user_id: str, stage_id: str, operation_id: str, review_digest: str
    ) -> PackageImportResult:
        completed = await self._completed(user_id=user_id, operation_id=operation_id, review_digest=review_digest)
        if completed is not None:
            self._release_completed_stage(user_id=user_id, operation_id=operation_id)
            return completed
        async with self._import_stage(user_id=user_id, stage_id=stage_id) as lease:
            record = lease.record
            if record.operation_id != operation_id or record.review_digest != review_digest or record.review is None:
                raise ContentConflictError("package_review_mismatch")
            plan = ReviewedImportPlan.model_validate_json(json.dumps(record.review["plan"]))
            self._admit_manifest(plan.manifest)
            if _plan_digest(plan) != review_digest or plan.operation_id != operation_id or plan.stage_id != stage_id:
                raise ContentConflictError("package_review_mismatch")
            size, digest = await asyncio.to_thread(lease.verify_archive)
            if (size, digest) != (plan.size_bytes, plan.package_sha256):
                raise ContentConflictError("package_archive_changed")
            lease.set_state("committing")
            try:
                async with inspect_package(self._inspector, lease) as inspected:
                    self._admit_manifest(inspected.manifest)
                    if inspected.manifest != plan.manifest:
                        raise ContentConflictError("package_review_mismatch")

                    async def install() -> PackageImportResult:
                        return await self._install(
                            user_id=user_id, plan=plan, inspected=inspected, review_digest=review_digest
                        )

                    result = await self._mutations.run(
                        user_id=user_id,
                        operation_id=operation_id,
                        request_digest=import_request_digest(review_digest),
                        result_type=PackageImportResult,
                        action=install,
                    )
            except BaseException:
                completed = await self._completed(
                    user_id=user_id, operation_id=operation_id, review_digest=review_digest
                )
                if completed is not None:
                    try:
                        lease.set_state("completed")
                    except OSError:
                        pass
                    return completed
                lease.set_state(
                    "recovery_needed"
                    if self._mutations.has_pending(user_id=user_id, operation_id=operation_id)
                    else "failed"
                )
                raise
            # SQL is the completion authority. A lost stage update cannot turn a
            # committed import into a new installation on retry or status lookup.
            try:
                lease.set_state("completed")
            except OSError:
                pass
            return result

    async def _install(
        self, *, user_id: str, plan: ReviewedImportPlan, inspected: InspectedPackage, review_digest: str
    ) -> PackageImportResult:
        await self._content.rescan(user_id=user_id)
        visible = await self._catalog.list_visible(user_id=user_id)
        occupied_names = {(item.kind, _name_key(item.display_name)) for item in visible}
        occupied_locators = {_name_key(item.relative_locator) for item in visible}
        for item in plan.items:
            if (
                (item.kind, _name_key(item.name)) in occupied_names
                or _name_key(item.relative_locator) in occupied_locators
                or self._store.package_destination_exists(relative_locator=item.relative_locator)
            ):
                raise ContentConflictError("package_destination_changed")
        if plan.anima is not None:
            if plan.default_model_provider_id != self._default_model:
                raise ContentConflictError("package_prerequisite_changed")
            await self._validate_prerequisite(plan.anima.identity_markdown, lock=True)
            assert self._uow is not None
            if any(
                _name_key(item.display_name) == _name_key(plan.anima.display_name)
                for item in await self._uow.animas.list()
                if item.user_id in {None, user_id}
            ):
                raise ContentConflictError("package_destination_changed")
        current_non_portable = _plan_non_portable(plan.manifest, visible)
        if current_non_portable != plan.non_portable:
            raise ContentConflictError("package_prerequisite_changed")
        rebound = {
            (item.kind, item.logical_key): item.item_id for item in current_non_portable if item.item_id is not None
        }
        rebound_entries = {item.id: item for item in visible if item.id in rebound.values()}
        prepared = await asyncio.to_thread(self._prepare, plan, inspected)
        await asyncio.to_thread(
            self._store.install_package_atomic, entries=prepared, operation_id=plan.operation_id, require_new=True
        )
        await self._content.rescan(
            user_id=user_id,
            include_included=False,
            planned_item_ids={item.relative_locator: item.item_id for item in plan.items},
        )
        installed: dict[str, CatalogContentEntry] = {}
        for item in plan.items:
            current = await self._catalog.get_visible_item(item_id=item.item_id, user_id=user_id)
            if (
                current is None
                or current.status is not ContentStatus.VALID
                or current.logical_key != item.logical_key
                or current.revision_sha256 is None
            ):
                raise ContentConflictError("package_catalog_admission_failed")
            TypedContentService.parse(current)
            installed[item.entry_id] = await self._catalog.record_import_provenance(
                item_id=item.item_id,
                user_id=user_id,
                provenance={
                    **current.provenance,
                    "import": {
                        "package_schema": plan.manifest.schema_,
                        "package_sha256": plan.package_sha256,
                        "entry_id": item.entry_id,
                    },
                },
            )
        restored = _restored_idle_refs(plan)
        for entry in plan.manifest.entries:
            expected = {installed[dependency.ref].id for dependency in entry.dependencies}
            expected |= {rebound[(ContentKind.GESTURE, key)] for key in restored.get(entry.package_entry_id, {})}
            if set(installed[entry.package_entry_id].dependency_item_ids) != expected:
                raise ContentConflictError("package_dependency_admission_failed")
        # The Library's Avatar catalog resolves logical Avatar mappings, including
        # standalone models. Register them in the same files/SQL/receipt mutation;
        # full Anima materialization below reuses these exact mappings.
        for installed_item in installed.values():
            if installed_item.kind is ContentKind.AVATAR:
                if self._uow is None:
                    raise ContentConflictError("package_avatar_import_unavailable")
                await self._uow.avatars.resolve_catalog_avatar(user_id=user_id, item=installed_item)
        anima_id = None
        if plan.anima is not None:
            assert self._uow is not None and self._default_model is not None
            definition, entries = _rebind_anima(plan, installed, rebound, rebound_entries)
            validate_package_anima_runtime(definition, entries, max_identity_bytes=self._max_identity_bytes)
            spec = resolve_portable_anima(definition, entries, max_identity_bytes=self._max_identity_bytes)
            anima = await AnimaAggregateMaterializer(
                default_model_provider_id=self._default_model, max_identity_bytes=self._max_identity_bytes
            ).materialize(user_id=user_id, spec=spec, uow=self._uow)
            anima_id = anima.id
        return PackageImportResult(
            operation_id=plan.operation_id,
            review_digest=review_digest,
            package_sha256=plan.package_sha256,
            items=tuple(
                ImportedPackageItem(
                    entry_id=item.entry_id,
                    kind=item.kind,
                    item_id=item.item_id,
                    revision_sha256=installed[item.entry_id].revision_sha256 or "",
                    logical_key=item.logical_key,
                    name=item.name,
                    selected=item.selected,
                )
                for item in plan.items
            ),
            anima_id=anima_id,
        )

    @staticmethod
    def _prepare(plan: ReviewedImportPlan, inspected: InspectedPackage) -> tuple[PreparedPackageEntry, ...]:
        """Rewrite bounded JSON; reopen verified binary resources only when consumed."""
        references = {item.entry_id: item.logical_key for item in plan.items}
        catalog_ids = {item.entry_id: item.item_id for item in plan.items}
        portraits = {
            association.appearance_entry_id: catalog_ids[association.avatar_entry_id]
            for association in plan.manifest.avatar_portraits
        }
        manifest_entries = {entry.package_entry_id: entry for entry in plan.manifest.entries}
        restored = _restored_idle_refs(plan)
        result = []
        for item in plan.items:
            source = inspected.entries[item.entry_id]
            entry = manifest_entries[item.entry_id]
            locator = PurePosixPath(item.relative_locator)
            descriptor = not locator.suffix
            document = handler_for_kind(item.kind).catalog_projection(source.document)
            aliases = frozenset(dependency.alias for dependency in source.document.dependencies if dependency.alias)
            document = portable_json(document, references, aliases=aliases)
            if item.entry_id in restored:
                # Rebound non-portable Gestures keep their Included logical keys.
                document = restore_idle_refs(document, restored[item.entry_id])
            document["content_id"], document["name"] = item.logical_key, item.name
            if entry.license is not None:
                document["provenance"] = entry.license.model_dump(exclude_none=True)
            if item.kind is ContentKind.POSE:
                document["pose"] = {**document["pose"], "id": item.logical_key, "name": item.name}
            if item.kind is ContentKind.APPEARANCE:
                document.pop("avatar_model", None)
                document["presentation"] = (
                    {"avatar_item_id": portraits[item.entry_id]} if item.entry_id in portraits else {}
                )
            prepared: list[PreparedPackageFile] = []
            # Each descriptor gets a fresh directory. Keep its member names so
            # embedded image/texture references still address the same resources.
            filenames = {
                member.relative_path: member.relative_path if descriptor else locator.name
                for member in entry.files
                if member.role not in {"metadata", "descriptor"}
            }
            document["files"] = [
                {**value, "path": filenames.get(value["path"], value["path"])} for value in document.get("files", [])
            ]
            for member in entry.files:
                opener = None
                relative = member.relative_path
                if member.role in {"descriptor", "metadata"}:
                    relative = (
                        descriptor_filename(definition_for_kind(item.kind), locator.name)
                        if descriptor
                        else locator.with_suffix(".meta.json").name
                    )
                    opener = partial(_json_stream, document)
                else:
                    relative = filenames[member.relative_path]
                    if PurePosixPath(member.relative_path).suffix.lower() == ".json":
                        opener = partial(_rewritten_member, source, member.relative_path, references, aliases)
                if opener is not None:
                    # Preflight the exact output size, then close it. The store
                    # reopens each resource individually; JSON-heavy packages do
                    # not retain their expanded payloads in prepared closures.
                    with opener() as handle:
                        size_bytes = handle.seek(0, 2)
                else:
                    opener = partial(source.open_file, member.relative_path)
                    size_bytes = member.size_bytes
                prepared.append(
                    PreparedPackageFile(relative_path=relative, handle=None, size_bytes=size_bytes, open_source=opener)
                )
            # Standalone imports need an explicit durable identity sidecar.
            if not descriptor and not any(member.role == "metadata" for member in entry.files):
                document["files"] = [{**value, "path": locator.name} for value in document.get("files", [])]
                opener = partial(_json_stream, document)
                with opener() as handle:
                    size_bytes = handle.seek(0, 2)
                prepared.append(
                    PreparedPackageFile(
                        relative_path=locator.with_suffix(".meta.json").name,
                        handle=None,
                        size_bytes=size_bytes,
                        open_source=opener,
                    )
                )
            result.append(
                PreparedPackageEntry(kind=item.kind, relative_locator=item.relative_locator, files=tuple(prepared))
            )
        return tuple(result)

    async def operation_status(self, *, user_id: str, operation_id: str) -> PackageOperationStatus:
        """A durable receipt outranks missing stages, deleted results and cleanup state."""
        self._content.require_owner(user_id)
        receipt = await self._catalog.get_mutation_receipt(user_id=user_id, operation_id=operation_id)
        if receipt is not None:
            value = receipt["result"]["value"]
            if value.get("schema_version") == 1:
                completed = PackageImportResult.model_validate(value)
                self._release_completed_stage(user_id=user_id, operation_id=operation_id)
                return PackageOperationStatus(
                    operation_id=operation_id,
                    state="completed",
                    review_digest=completed.review_digest,
                    result=completed,
                )
            if "skipped_existing_item_ids" in value:
                result = LegacyPackageImportResult(
                    operation_id=operation_id,
                    items=tuple(
                        LegacyImportedPackageItem(
                            entry_id=item["id"],
                            kind=item["kind"],
                            item_id=item["id"],
                            logical_key=item.get("logical_key"),
                            name=item["display_name"],
                            selected=False,
                        )
                        for item in value["items"]
                    ),
                    skipped_existing_item_ids=tuple(value["skipped_existing_item_ids"]),
                )
                self._release_completed_stage(user_id=user_id, operation_id=operation_id)
                return PackageOperationStatus(operation_id=operation_id, state="completed", result=result)
            raise ContentConflictError("operation_id_reused")
        stage = self._stages.find_import(user_id, operation_id)
        if stage is None:
            if self._mutations.has_pending(user_id=user_id, operation_id=operation_id):
                return PackageOperationStatus(operation_id=operation_id, state="recovery_needed")
            return PackageOperationStatus(operation_id=operation_id, state="not_found")
        _, active = self._stages.status(user_id, stage.stage_id)
        if not active and stage.state in {"committing", "recovery_needed"}:
            try:
                with self._stages.acquire(user_id, stage.stage_id, allow_expired=True) as lease:

                    async def recovered() -> dict[str, Any] | None:
                        return await self._catalog.get_mutation_receipt(user_id=user_id, operation_id=operation_id)

                    receipt = await self._mutations.reconcile(recovered)
                    if receipt is not None:
                        lease.set_state("completed")
                        return await self.operation_status(user_id=user_id, operation_id=operation_id)
                    lease.set_state("failed")
                    stage = lease.record
            except (ContentConflictError, OSError):
                return PackageOperationStatus(
                    operation_id=operation_id,
                    state="recovery_needed",
                    stage_id=stage.stage_id,
                    review_digest=stage.review_digest,
                )
        state = "pending" if active or stage.state not in {"committing", "recovery_needed"} else "recovery_needed"
        return PackageOperationStatus(
            operation_id=operation_id, state=state, stage_id=stage.stage_id, review_digest=stage.review_digest
        )


def _plan_non_portable(
    manifest: PackageManifest, visible: list[CatalogContentEntry]
) -> tuple[PlannedNonPortableItem, ...]:
    """Match each omitted item to this installation's own non-portable Included item."""

    planned = []
    for reference in manifest.non_portable_references:
        # Dependency admission needs the key to be unique among all visible items.
        candidates = [item for item in visible if item.logical_key == reference.logical_key]
        match = candidates[0] if len(candidates) == 1 else None
        if match is not None and not (
            match.source is ContentSource.INCLUDED
            and match.status is ContentStatus.VALID
            and match.kind is reference.kind
            and is_non_portable(match)
        ):
            match = None
        planned.append(
            PlannedNonPortableItem(
                kind=reference.kind,
                name=match.display_name if match else reference.display_name,
                outcome="rebound" if match else "unavailable",
                logical_key=reference.logical_key,
                item_id=match.id if match else None,
            )
        )
    return tuple(planned)


def _restored_idle_refs(plan: ReviewedImportPlan) -> dict[str, dict[str, list[str]]]:
    """Package Idle Style entry id -> {rebound Gesture logical key: pools}."""

    rebound = {(item.kind, item.logical_key) for item in plan.non_portable if item.item_id is not None}
    restored: dict[str, dict[str, list[str]]] = {}
    for reference in plan.manifest.non_portable_references:
        if (reference.kind, reference.logical_key) not in rebound:
            continue
        for use in reference.uses:
            if use.entry_id is not None:
                restored.setdefault(use.entry_id, {})[reference.logical_key] = list(use.pools)
    return restored


def _rebind_anima(
    plan: ReviewedImportPlan,
    installed: dict[str, CatalogContentEntry],
    rebound: dict[tuple[ContentKind, str], str],
    rebound_entries: dict[str, CatalogContentEntry],
) -> tuple[PortableAnima, dict[str, CatalogContentEntry]]:
    """Add rebound Anima slots; unavailable ones keep the importer's default."""

    assert plan.anima is not None
    entries = dict(installed)
    gestures = list(plan.anima.gestures)
    idle_style = plan.anima.idle_style
    for index, reference in enumerate(plan.manifest.non_portable_references):
        item_id = rebound.get((reference.kind, reference.logical_key))
        if item_id is None:
            continue
        entry_id = f"non-portable-{index:04d}"
        while entry_id in entries:  # Never shadow a packaged entry with the same id.
            entry_id += "-x"
        for use in reference.uses:
            if use.anima_slot == "gesture" and use.semantic_key is not None:
                entries[entry_id] = rebound_entries[item_id]
                gestures.append(
                    PortableGestureSelection(entry_id=entry_id, semantic_key=use.semantic_key, config=use.config)
                )
            elif use.anima_slot == "idle_style":
                entries[entry_id] = rebound_entries[item_id]
                idle_style = entry_id
    definition = plan.anima.model_copy(update={"gestures": gestures, "idle_style": idle_style})
    return PortableAnima.model_validate(definition.model_dump()), entries
