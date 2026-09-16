"""Portable package import/export at the Content Catalog sharing boundary."""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
import re
import stat
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from tempfile import SpooledTemporaryFile
from typing import BinaryIO, Literal, TypedDict, cast
from zipfile import ZIP_DEFLATED, BadZipFile, ZipFile, ZipInfo

from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import (
    definition_for_kind,
    descriptor_filename,
    handler_for_kind,
)
from animama.app.services.content_save_service import readable_entry_name
from animama.app.services.local_content_mutations import mutation_digest
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentConflictError,
    ContentKind,
    ContentNotFoundError,
    ContentSource,
    ContentStatus,
    PreparedPackageEntry,
    PreparedPackageFile,
)
from animama.domain.content_documents import ContentDocumentError, TypedContentDocument


class _PackagePlan(TypedDict, total=False):
    """Validated import fields; skipped entries omit destination and byte fields."""

    skip: bool
    package_id: str
    package_logical_key: str
    logical_key: str
    kind: ContentKind
    document: None
    existing: CatalogContentEntry | None
    manifest_dependencies: list[tuple[str, ContentKind]]
    license: dict[str, object]
    display_name: str
    locator: str
    files: list[dict[str, object]]
    portable_revision: str


PACKAGE_SCHEMA = "animama-content-package/2"
MAX_PACKAGE_FILES = 2_048
MAX_PACKAGE_BYTES = 4 * 1024 * 1024 * 1024
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200
_OPERATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_PORTABLE_LICENSE_FIELDS = frozenset(
    {
        "author",
        "creator",
        "license",
        "license_name",
        "license_url",
        "redistribution",
        "redistribution_review",
        "source_url",
    }
)


@dataclass(frozen=True, slots=True)
class ExportedContentPackage:
    """One completed export staged outside the readable Local tree."""

    path: Path
    filename: str
    package_sha256: str
    size_bytes: int
    item_count: int


@dataclass(frozen=True, slots=True)
class ImportedContentPackage:
    """Catalog items admitted from a hostile package into editable Local files."""

    items: tuple[CatalogContentEntry, ...]
    skipped_existing_item_ids: tuple[str, ...]


def _safe_archive_path(value: str) -> PurePosixPath:
    normalized = value.replace("\\", "/")
    path = PurePosixPath(normalized)
    if (
        not normalized
        or normalized.startswith("/")
        or path.is_absolute()
        or any(part in {"", ".", ".."} for part in path.parts)
    ):
        raise ContentConflictError("package_path_invalid")
    return path


def _is_symlink(info: ZipInfo) -> bool:
    return stat.S_ISLNK((info.external_attr >> 16) & 0xFFFF)


def _entry_relative_file(entry: CatalogContentEntry, relative_path: str) -> str:
    locator = PurePosixPath(entry.relative_locator)
    path = PurePosixPath(relative_path)
    if locator.suffix:
        if path.parent != locator.parent:
            raise ContentConflictError("catalog_entry_file_outside_root")
        return path.name
    try:
        return path.relative_to(locator).as_posix()
    except ValueError as exc:
        raise ContentConflictError("catalog_entry_file_outside_root") from exc


def _portable_license(provenance: dict[str, object]) -> dict[str, object]:
    """Retain bounded redistribution facts without exporting local provenance."""

    result: dict[str, object] = {}
    for key in sorted(_PORTABLE_LICENSE_FIELDS):
        value = provenance.get(key)
        if isinstance(value, str) and 0 < len(value) <= 2_048:
            result[key] = value
        elif isinstance(value, bool):
            result[key] = value
        elif (
            isinstance(value, list)
            and len(value) <= 64
            and all(isinstance(item, str) and len(item) <= 512 for item in value)
        ):
            result[key] = list(value)
    return result


def _validate_package_license(value: object) -> dict[str, object]:
    if value is None:
        return {}
    if not isinstance(value, dict) or set(value) - _PORTABLE_LICENSE_FIELDS:
        raise ContentConflictError("package_license_invalid")
    portable = _portable_license(value)
    if portable != value:
        raise ContentConflictError("package_license_invalid")
    return portable


def _portable_revision(files: list[dict[str, object]]) -> str:
    return hashlib.sha256(json.dumps(files, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class ContentPackageService:
    """Generate self-contained archives and install validated editable copies."""

    def __init__(
        self,
        *,
        content: ContentCatalogService,
        exports_root: Path,
    ) -> None:
        self._catalog = content.mutations.catalog
        self._store = content.mutations.store
        self._content = content
        self._exports_root = exports_root

    async def _visible_closure(self, *, user_id: str, root_item_id: str) -> list[CatalogContentEntry]:
        visible = {item.id: item for item in await self._catalog.list_visible(user_id=user_id)}
        root = visible.get(root_item_id)
        if root is None or root.status is not ContentStatus.VALID:
            raise ContentNotFoundError("exportable catalog item was not found")
        ordered: list[CatalogContentEntry] = []
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(item: CatalogContentEntry) -> None:
            if item.id in visiting:
                raise ContentConflictError("package_dependency_cycle")
            if item.id in visited:
                return
            visiting.add(item.id)
            if item.kind is ContentKind.ANIMA:
                raise ContentConflictError("anima_package_reserved")
            for dependency_id in sorted(item.dependency_item_ids):
                dependency = visible.get(dependency_id)
                if dependency is None or dependency.status is not ContentStatus.VALID:
                    raise ContentConflictError("package_dependency_unavailable")
                visit(dependency)
            visiting.remove(item.id)
            visited.add(item.id)
            ordered.append(item)

        visit(root)
        return ordered

    async def export_item(
        self,
        *,
        user_id: str,
        root_item_id: str,
        operation_id: str,
    ) -> ExportedContentPackage:
        """Write a deterministic, dependency-complete typed package."""

        if not _OPERATION_ID.fullmatch(operation_id):
            raise ContentConflictError("invalid_operation_id")
        closure = await self._visible_closure(user_id=user_id, root_item_id=root_item_id)
        self._exports_root.mkdir(parents=True, exist_ok=True)
        destination = self._exports_root / f"{operation_id}.animama"
        temporary = self._exports_root / f".{operation_id}.animama.tmp"
        destination.unlink(missing_ok=True)
        temporary.unlink(missing_ok=True)

        portable_ids = {
            entry.id: entry.logical_key or f"package:{entry.kind.value}:{index:04d}"
            for index, entry in enumerate(closure)
        }
        reference_rewrites: dict[str, str] = {}
        for entry in closure:
            portable_id = portable_ids[entry.id]
            reference_rewrites[entry.id] = portable_id
            reference_rewrites[entry.relative_locator] = portable_id
            if entry.logical_key:
                reference_rewrites[entry.logical_key] = portable_id
            for registered in entry.files:
                reference_rewrites[registered.file_ref] = (
                    f"{portable_id}:file:{registered.role}:{PurePosixPath(registered.relative_path).name}"
                )

        manifest_entries: list[dict[str, object]] = []
        try:
            with ZipFile(temporary, "x", compression=ZIP_DEFLATED, compresslevel=6) as archive:
                for entry_index, entry in enumerate(closure):
                    handler = handler_for_kind(entry.kind)
                    parsed = handler.parse_document(
                        entry.metadata,
                        fallback_path=Path(entry.display_name),
                        descriptor_backed=not PurePosixPath(entry.relative_locator).suffix,
                    )
                    package_files: list[dict[str, object]] = []
                    registered_files = sorted(entry.files, key=lambda value: (value.role, value.relative_path))
                    for file_index, registered in enumerate(registered_files):
                        relative = _entry_relative_file(entry, registered.relative_path)
                        archive_path = f"entries/{entry_index:04d}/{relative}"
                        opened = self._store.open_verified_file(
                            source=registered.source,
                            source_mount_id=registered.source_mount_id,
                            relative_path=registered.relative_path,
                            expected_size_bytes=registered.size_bytes,
                            expected_sha256=registered.sha256,
                            media_type=registered.media_type,
                        )
                        payload: bytes | None = None
                        try:
                            if registered.role in {"descriptor", "metadata"}:
                                payload = handler.rewrite_package_document(
                                    opened.handle.read(),
                                    reference_rewrites=reference_rewrites,
                                    descriptor_backed=registered.role == "descriptor",
                                )
                            digest = hashlib.sha256()
                            size = 0
                            info = ZipInfo(archive_path, date_time=(1980, 1, 1, 0, 0, 0))
                            info.compress_type = ZIP_DEFLATED
                            info.external_attr = 0o600 << 16
                            with archive.open(info, "w") as target:
                                source = SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
                                try:
                                    if payload is not None:
                                        source.write(payload)
                                    else:
                                        opened.handle.seek(0)
                                        while chunk := opened.handle.read(1024 * 1024):
                                            source.write(chunk)
                                    source.seek(0)
                                    while chunk := source.read(1024 * 1024):
                                        size += len(chunk)
                                        digest.update(chunk)
                                        target.write(chunk)
                                finally:
                                    source.close()
                        finally:
                            opened.handle.close()
                        package_files.append(
                            {
                                "archive_path": archive_path,
                                "relative_path": relative,
                                "role": registered.role,
                                "ordinal": file_index + 1,
                                "media_type": registered.media_type,
                                "size_bytes": size,
                                "sha256": digest.hexdigest(),
                            }
                        )
                    license_facts = _portable_license(entry.provenance)
                    manifest_entry: dict[str, object] = {
                        "package_entry_id": portable_ids[entry.id],
                        "kind": entry.kind.value,
                        "logical_key": parsed.document.content_id or portable_ids[entry.id],
                        "display_name": parsed.document.name,
                        "portable_revision_sha256": _portable_revision(package_files),
                        "dependencies": [
                            {
                                "ref": reference_rewrites.get(value.ref, value.ref),
                                "content_type": value.kind.value,
                            }
                            for value in parsed.document.dependencies
                        ],
                        "files": package_files,
                    }
                    if license_facts:
                        manifest_entry["license"] = license_facts
                    manifest_entries.append(manifest_entry)
                manifest_payload = (
                    json.dumps(
                        {
                            "schema": PACKAGE_SCHEMA,
                            "root_entry_id": portable_ids[closure[-1].id],
                            "entries": manifest_entries,
                        },
                        indent=2,
                        sort_keys=True,
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode()
                manifest_info = ZipInfo("package.json", date_time=(1980, 1, 1, 0, 0, 0))
                manifest_info.compress_type = ZIP_DEFLATED
                manifest_info.external_attr = 0o600 << 16
                archive.writestr(manifest_info, manifest_payload)
            os.replace(temporary, destination)
        except ContentDocumentError as exc:
            temporary.unlink(missing_ok=True)
            raise ContentConflictError(exc.code) from exc
        except Exception:
            temporary.unlink(missing_ok=True)
            raise

        digest = hashlib.sha256()
        size_bytes = 0
        with destination.open("rb") as handle:
            while chunk := handle.read(1024 * 1024):
                size_bytes += len(chunk)
                digest.update(chunk)
        root_name = readable_entry_name(closure[-1].display_name)
        return ExportedContentPackage(
            path=destination,
            filename=f"{root_name}.animama",
            package_sha256=digest.hexdigest(),
            size_bytes=size_bytes,
            item_count=len(closure),
        )

    @staticmethod
    def _validated_archive(path: Path) -> tuple[ZipFile, dict[str, object], dict[str, ZipInfo]]:
        try:
            archive = ZipFile(path, "r")
        except (OSError, BadZipFile) as exc:
            raise ContentConflictError("package_archive_invalid") from exc
        infos = archive.infolist()
        if not infos or len(infos) > MAX_PACKAGE_FILES + 1:
            archive.close()
            raise ContentConflictError("package_file_count_invalid")
        total = 0
        indexed: dict[str, ZipInfo] = {}
        for info in infos:
            if info.is_dir():
                continue
            safe = _safe_archive_path(info.filename).as_posix()
            if safe in indexed or _is_symlink(info):
                archive.close()
                raise ContentConflictError("package_entry_unsafe")
            if info.file_size <= 0 or info.file_size > MAX_PACKAGE_BYTES:
                archive.close()
                raise ContentConflictError("package_file_size_invalid")
            if info.compress_size == 0 or info.file_size / info.compress_size > MAX_COMPRESSION_RATIO:
                archive.close()
                raise ContentConflictError("package_compression_ratio_invalid")
            total += info.file_size
            if total > MAX_PACKAGE_BYTES:
                archive.close()
                raise ContentConflictError("package_size_invalid")
            indexed[safe] = info
        manifest_info = indexed.get("package.json")
        if manifest_info is None or manifest_info.file_size > MAX_MANIFEST_BYTES:
            archive.close()
            raise ContentConflictError("package_manifest_missing")
        try:
            manifest = json.loads(archive.read(manifest_info))
        except (UnicodeError, json.JSONDecodeError, RuntimeError) as exc:
            archive.close()
            raise ContentConflictError("package_manifest_invalid") from exc
        if not isinstance(manifest, dict) or manifest.get("schema") != PACKAGE_SCHEMA:
            archive.close()
            raise ContentConflictError("package_schema_unsupported")
        return archive, manifest, indexed

    @staticmethod
    def _read_verified_member(archive: ZipFile, info: ZipInfo, expected: dict[str, object]) -> BinaryIO:
        expected_size = expected.get("size_bytes")
        expected_digest = expected.get("sha256")
        if not isinstance(expected_size, int) or expected_size <= 0 or info.file_size != expected_size:
            raise ContentConflictError("package_member_size_mismatch")
        if not isinstance(expected_digest, str) or not re.fullmatch(r"[0-9a-f]{64}", expected_digest):
            raise ContentConflictError("package_member_digest_invalid")
        target = SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b")
        digest = hashlib.sha256()
        received = 0
        with archive.open(info, "r") as source:
            while chunk := source.read(1024 * 1024):
                received += len(chunk)
                if received > expected_size:
                    target.close()
                    raise ContentConflictError("package_member_size_mismatch")
                digest.update(chunk)
                target.write(chunk)
        if received != expected_size or digest.hexdigest() != expected_digest:
            target.close()
            raise ContentConflictError("package_member_digest_mismatch")
        target.seek(0)
        # The binary spool provides the stream contract expected by consumers.
        return cast(BinaryIO, target)

    async def import_package(
        self,
        *,
        user_id: str,
        archive_path: Path,
        operation_id: str,
        collision: Literal["cancel", "keep_both", "replace"],
    ) -> ImportedContentPackage:
        """Preflight and atomically install an untrusted typed package."""

        def fingerprint() -> str:
            with archive_path.open("rb") as stream:
                return mutation_digest({"operation": "import", "collision": collision}, (stream,))

        request_digest = await asyncio.to_thread(fingerprint)

        return await self._content.mutations.run(
            user_id=user_id,
            operation_id=operation_id,
            request_digest=request_digest,
            result_type=ImportedContentPackage,
            action=lambda: self._import_package(
                user_id=user_id, archive_path=archive_path, operation_id=operation_id, collision=collision
            ),
        )

    async def _import_package(
        self,
        *,
        user_id: str,
        archive_path: Path,
        operation_id: str,
        collision: Literal["cancel", "keep_both", "replace"],
    ) -> ImportedContentPackage:
        """Validate and publish one typed closure inside the owned mutation."""

        if not _OPERATION_ID.fullmatch(operation_id):
            raise ContentConflictError("invalid_operation_id")
        await self._content.rescan(user_id=user_id)
        visible = await self._catalog.list_visible(user_id=user_id)
        by_locator = {(item.source, item.relative_locator): item for item in visible}
        by_logical: dict[str, list[CatalogContentEntry]] = {}
        for item in visible:
            if item.logical_key:
                by_logical.setdefault(item.logical_key, []).append(item)

        archive, manifest, indexed = self._validated_archive(archive_path)
        open_members: list[BinaryIO] = []
        try:
            raw_entries = manifest.get("entries")
            root_entry_id = manifest.get("root_entry_id")
            if (
                not isinstance(raw_entries, list)
                or not raw_entries
                or len(raw_entries) > MAX_PACKAGE_FILES
                or not isinstance(root_entry_id, str)
                or not root_entry_id
            ):
                raise ContentConflictError("package_manifest_invalid")

            plans: list[_PackagePlan] = []
            package_ids: set[str] = set()
            declared_archive_paths = {"package.json"}
            rewrites: dict[str, str] = {}
            skipped: list[str] = []
            entry_fields = {
                "package_entry_id",
                "kind",
                "logical_key",
                "display_name",
                "portable_revision_sha256",
                "dependencies",
                "license",
                "files",
            }
            member_fields = {
                "archive_path",
                "relative_path",
                "role",
                "ordinal",
                "media_type",
                "size_bytes",
                "sha256",
            }

            for index, raw in enumerate(raw_entries):
                if not isinstance(raw, dict) or set(raw) - entry_fields:
                    raise ContentConflictError("package_manifest_invalid")
                package_id = raw.get("package_entry_id")
                logical_key = raw.get("logical_key")
                display_name = raw.get("display_name")
                raw_files = raw.get("files")
                raw_dependencies = raw.get("dependencies")
                portable_revision = raw.get("portable_revision_sha256")
                if (
                    not isinstance(package_id, str)
                    or not package_id
                    or package_id in package_ids
                    or not isinstance(logical_key, str)
                    or not logical_key
                    or not isinstance(display_name, str)
                    or not isinstance(raw_files, list)
                    or not raw_files
                    or not isinstance(raw_dependencies, list)
                    or not isinstance(portable_revision, str)
                    or not re.fullmatch(r"[0-9a-f]{64}", portable_revision)
                ):
                    raise ContentConflictError("package_manifest_invalid")
                package_ids.add(package_id)
                try:
                    kind = ContentKind(str(raw["kind"]))
                except (KeyError, ValueError) as exc:
                    raise ContentConflictError("package_kind_invalid") from exc
                if kind is ContentKind.ANIMA:
                    raise ContentConflictError("anima_package_reserved")
                license_facts = _validate_package_license(raw.get("license"))
                definition = definition_for_kind(kind)

                manifest_dependencies: list[tuple[str, ContentKind]] = []
                for dependency in raw_dependencies:
                    if not isinstance(dependency, dict) or set(dependency) != {
                        "ref",
                        "content_type",
                    }:
                        raise ContentConflictError("package_dependency_invalid")
                    reference = dependency.get("ref")
                    try:
                        dependency_kind = ContentKind(str(dependency.get("content_type")))
                    except ValueError as exc:
                        raise ContentConflictError("package_dependency_invalid") from exc
                    if not isinstance(reference, str) or not reference:
                        raise ContentConflictError("package_dependency_invalid")
                    manifest_dependencies.append((reference, dependency_kind))

                roles: list[str] = []
                member_facts: list[tuple[str, int, str]] = []
                for ordinal, member in enumerate(raw_files, start=1):
                    if not isinstance(member, dict) or set(member) - member_fields:
                        raise ContentConflictError("package_manifest_invalid")
                    archive_member = member.get("archive_path")
                    relative_member = member.get("relative_path")
                    role = member.get("role")
                    declared_ordinal = member.get("ordinal")
                    size = member.get("size_bytes")
                    digest = member.get("sha256")
                    if (
                        not isinstance(archive_member, str)
                        or not isinstance(relative_member, str)
                        or not isinstance(role, str)
                        or not role
                        or declared_ordinal != ordinal
                        or not isinstance(size, int)
                        or size <= 0
                        or not isinstance(digest, str)
                        or not re.fullmatch(r"[0-9a-f]{64}", digest)
                    ):
                        raise ContentConflictError("package_manifest_invalid")
                    archive_name = _safe_archive_path(archive_member).as_posix()
                    _safe_archive_path(relative_member)
                    if archive_name in declared_archive_paths:
                        raise ContentConflictError("package_member_duplicate")
                    declared_archive_paths.add(archive_name)
                    roles.append(role)
                    member_facts.append((role, size, digest))
                if _portable_revision(raw_files) != portable_revision:
                    raise ContentConflictError("package_portable_revision_mismatch")

                descriptor_backed = roles.count("descriptor") == 1
                if roles.count("descriptor") > 1:
                    raise ContentConflictError("package_descriptor_invalid")
                if descriptor_backed and definition.descriptor_suffix is None:
                    raise ContentConflictError("package_descriptor_invalid")
                primary = [
                    member for member in raw_files if isinstance(member, dict) and member.get("role") != "metadata"
                ]
                if not descriptor_backed and len(primary) != 1:
                    raise ContentConflictError("package_primary_file_invalid")
                suffix = ""
                if not descriptor_backed:
                    relative_primary = primary[0].get("relative_path")
                    if not isinstance(relative_primary, str):
                        raise ContentConflictError("package_manifest_invalid")
                    suffix = PurePosixPath(relative_primary).suffix.lower()
                    if suffix not in definition.standalone_extensions:
                        raise ContentConflictError("package_primary_file_invalid")

                if descriptor_backed:
                    descriptor_member = next(
                        member
                        for member in raw_files
                        if isinstance(member, dict) and member.get("role") == "descriptor"
                    )
                    descriptor_relative = descriptor_member.get("relative_path")
                    if not isinstance(descriptor_relative, str) or definition.descriptor_suffix is None:
                        raise ContentConflictError("package_descriptor_invalid")
                    descriptor_name = PurePosixPath(descriptor_relative).name
                    if not descriptor_name.endswith(definition.descriptor_suffix):
                        raise ContentConflictError("package_descriptor_invalid")
                    source_entry_name = descriptor_name[: -len(definition.descriptor_suffix)]
                    destination_name = readable_entry_name(source_entry_name)
                else:
                    relative_primary = primary[0].get("relative_path")
                    if not isinstance(relative_primary, str):
                        raise ContentConflictError("package_manifest_invalid")
                    destination_name = readable_entry_name(PurePosixPath(relative_primary).stem)
                default_locator = (
                    f"{definition.directory}/{destination_name}"
                    if descriptor_backed
                    else f"{definition.directory}/{destination_name}{suffix}"
                )
                logical_existing = [
                    item for item in by_logical.get(logical_key, []) if item.source is ContentSource.LOCAL
                ]
                locator_existing = by_locator.get((ContentSource.LOCAL, default_locator))
                existing_candidates = {
                    item.id: item for item in [*logical_existing, *([locator_existing] if locator_existing else [])]
                }
                if len(existing_candidates) > 1:
                    raise ContentConflictError("package_destination_ambiguous")
                existing = next(iter(existing_candidates.values()), None)

                exact_existing = None
                for candidate in by_logical.get(logical_key, []):
                    candidate_facts = sorted((file.role, file.size_bytes, file.sha256) for file in candidate.files)
                    if candidate.status is ContentStatus.VALID and candidate_facts == sorted(member_facts):
                        exact_existing = candidate
                        break
                if package_id != root_entry_id and exact_existing is not None:
                    skipped.append(exact_existing.id)
                    final_logical = exact_existing.logical_key or logical_key
                    rewrites[package_id] = final_logical
                    rewrites[logical_key] = final_logical
                    plans.append(
                        {
                            "skip": True,
                            "package_id": package_id,
                            "package_logical_key": logical_key,
                            "logical_key": final_logical,
                            "kind": kind,
                            "document": None,
                            "existing": exact_existing,
                            "manifest_dependencies": manifest_dependencies,
                            "license": license_facts,
                        }
                    )
                    continue

                final_logical = logical_key
                # A reconciled missing row is the catalog's durable tombstone,
                # not an occupied filesystem destination. Reuse it as the
                # preflight expectation so the later drift check can still
                # detect resurrection, while allowing installation without a
                # keep-both/replace choice.
                if existing is not None and existing.status is not ContentStatus.MISSING:
                    if collision == "cancel":
                        raise ContentConflictError("package_destination_exists")
                    if collision == "keep_both":
                        suffix_token = hashlib.sha256(f"{operation_id}:{package_id}:{index}".encode()).hexdigest()[:8]
                        destination_name = f"{destination_name}-copy-{suffix_token}"
                        final_logical = f"{logical_key}-copy-{suffix_token}"
                        existing = None
                destination_locator = (
                    existing.relative_locator
                    if existing is not None
                    else (
                        f"{definition.directory}/{destination_name}"
                        if descriptor_backed
                        else f"{definition.directory}/{destination_name}{suffix}"
                    )
                )
                if existing is not None:
                    locator_path = PurePosixPath(existing.relative_locator)
                    destination_name = locator_path.stem if locator_path.suffix else locator_path.name
                rewrites[package_id] = final_logical
                rewrites[logical_key] = final_logical
                plans.append(
                    {
                        "skip": False,
                        "package_id": package_id,
                        "package_logical_key": logical_key,
                        "logical_key": final_logical,
                        "kind": kind,
                        "display_name": destination_name,
                        "locator": destination_locator,
                        "existing": existing,
                        "files": raw_files,
                        "portable_revision": portable_revision,
                        "manifest_dependencies": manifest_dependencies,
                        "license": license_facts,
                    }
                )

            if root_entry_id not in package_ids or set(indexed) != declared_archive_paths:
                raise ContentConflictError("package_member_missing")

            package_by_logical = {str(plan["package_logical_key"]): str(plan["package_id"]) for plan in plans}
            if len(package_by_logical) != len(plans):
                raise ContentConflictError("package_logical_key_duplicate")
            plan_by_package_id = {str(plan["package_id"]): plan for plan in plans}
            manifest_edges: dict[str, list[str]] = {}
            for plan in plans:
                package_id = str(plan["package_id"])
                manifest_edges[package_id] = []
                dependencies = plan.get("manifest_dependencies")
                assert isinstance(dependencies, list)
                for reference, _kind in dependencies:
                    target_id = package_by_logical.get(reference)
                    if target_id is None:
                        raise ContentConflictError("package_dependency_unavailable")
                    manifest_target_plan = plan_by_package_id[target_id]
                    if manifest_target_plan.get("kind") is not _kind:
                        raise ContentConflictError("package_dependency_kind_mismatch")
                    source_kind = plan.get("kind")
                    if (
                        not isinstance(source_kind, ContentKind)
                        or _kind not in handler_for_kind(source_kind).allowed_dependency_kinds
                    ):
                        raise ContentConflictError("package_dependency_kind_not_allowed")
                    manifest_edges[package_id].append(target_id)

            reachable: set[str] = set()

            def visit_manifest(package_id: str, visiting: set[str]) -> None:
                if package_id in visiting:
                    raise ContentConflictError("package_dependency_cycle")
                if package_id in reachable:
                    return
                visiting.add(package_id)
                for target_id in manifest_edges.get(package_id, []):
                    visit_manifest(target_id, visiting)
                visiting.remove(package_id)
                reachable.add(package_id)

            visit_manifest(root_entry_id, set())
            if reachable != package_ids:
                raise ContentConflictError("package_closure_incomplete")

            prepared_entries: list[PreparedPackageEntry] = []
            documents: dict[str, TypedContentDocument] = {}
            for raw, plan in zip(raw_entries, plans, strict=True):
                if plan.get("skip") is True:
                    continue
                assert isinstance(raw, dict)
                kind = plan["kind"]
                destination_name = plan["display_name"]
                destination_locator = plan["locator"]
                raw_files = plan["files"]
                assert isinstance(kind, ContentKind)
                assert isinstance(destination_name, str)
                assert isinstance(destination_locator, str)
                assert isinstance(raw_files, list)
                handler = handler_for_kind(kind)
                definition = definition_for_kind(kind)
                descriptor_backed = any(
                    isinstance(member, dict) and member.get("role") == "descriptor" for member in raw_files
                )
                path_rewrites: dict[str, str] = {}
                if descriptor_backed and kind in {ContentKind.GESTURE, ContentKind.REACTION}:
                    playable_members = [
                        member
                        for member in raw_files
                        if isinstance(member, dict) and member.get("role") in {"animation", "sequence"}
                    ]
                    if len(playable_members) == 1:
                        playable_relative = playable_members[0].get("relative_path")
                        if isinstance(playable_relative, str):
                            playable_path = PurePosixPath(playable_relative)
                            path_rewrites[playable_relative] = f"{destination_name}{playable_path.suffix}"
                prepared_files: list[PreparedPackageFile] = []
                document_payload: dict[str, object] | None = None

                for member in raw_files:
                    assert isinstance(member, dict)
                    archive_name = member["archive_path"]
                    relative_name = member["relative_path"]
                    role = member["role"]
                    size = member["size_bytes"]
                    assert isinstance(archive_name, str)
                    assert isinstance(relative_name, str)
                    assert isinstance(role, str)
                    assert isinstance(size, int)
                    info = indexed.get(_safe_archive_path(archive_name).as_posix())
                    if info is None:
                        raise ContentConflictError("package_member_missing")
                    opened = self._read_verified_member(archive, info, member)
                    open_members.append(opened)

                    staged_relative = path_rewrites.get(
                        _safe_archive_path(relative_name).as_posix(),
                        _safe_archive_path(relative_name).as_posix(),
                    )
                    if descriptor_backed and role == "descriptor":
                        staged_relative = descriptor_filename(definition, destination_name)
                    elif not descriptor_backed:
                        destination = PurePosixPath(destination_locator)
                        staged_relative = (
                            destination.with_suffix(".meta.json").name if role == "metadata" else destination.name
                        )

                    payload_handle = opened
                    payload_size = size
                    if role in {"descriptor", "metadata"}:
                        opened.seek(0)
                        try:
                            rewritten = handler.rewrite_package_document(
                                opened.read(),
                                reference_rewrites={**rewrites, **path_rewrites},
                                descriptor_backed=role == "descriptor",
                            )
                        except ContentDocumentError as exc:
                            raise ContentConflictError(exc.code) from exc
                        payload_handle = cast(BinaryIO, SpooledTemporaryFile(max_size=8 * 1024 * 1024, mode="w+b"))
                        payload_handle.write(rewritten)
                        payload_handle.seek(0)
                        payload_size = len(rewritten)
                        open_members.append(payload_handle)
                        value = json.loads(rewritten)
                        if isinstance(value, dict):
                            document_payload = value
                    elif kind is ContentKind.POSE_CLIP:
                        opened.seek(0)
                        try:
                            pose_value = json.loads(opened.read())
                        except (UnicodeError, json.JSONDecodeError) as exc:
                            raise ContentConflictError("package_descriptor_invalid") from exc
                        if isinstance(pose_value, dict):
                            document_payload = pose_value
                        opened.seek(0)
                    prepared_files.append(
                        PreparedPackageFile(
                            relative_path=staged_relative,
                            handle=payload_handle,
                            size_bytes=payload_size,
                        )
                    )

                parsed = handler.parse_document(
                    document_payload,
                    fallback_path=Path(destination_name),
                    descriptor_backed=descriptor_backed,
                )
                documents[str(plan["package_id"])] = parsed.document
                prepared_entries.append(
                    PreparedPackageEntry(
                        kind=kind,
                        relative_locator=destination_locator,
                        files=tuple(prepared_files),
                    )
                )

            for plan in plans:
                if plan.get("skip") is not True:
                    continue
                existing = plan.get("existing")
                skipped_kind = plan.get("kind")
                if not isinstance(existing, CatalogContentEntry) or not isinstance(skipped_kind, ContentKind):
                    raise ContentConflictError("package_dependency_unavailable")
                documents[str(plan["package_id"])] = (
                    handler_for_kind(skipped_kind)
                    .parse_document(
                        existing.metadata,
                        fallback_path=Path(existing.display_name),
                        descriptor_backed=not PurePosixPath(existing.relative_locator).suffix,
                    )
                    .document
                )

            for package_id, document in documents.items():
                plan = plan_by_package_id[package_id]
                planned_dependencies = plan.get("manifest_dependencies")
                assert isinstance(planned_dependencies, list)
                expected_dependencies = {
                    (rewrites.get(reference, reference), dependency_kind)
                    for reference, dependency_kind in planned_dependencies
                }
                actual_dependencies = {
                    (dependency.ref, dependency.kind) for dependency in getattr(document, "dependencies", ())
                }
                if actual_dependencies != expected_dependencies:
                    raise ContentConflictError("package_dependency_manifest_mismatch")

            plan_by_logical = {
                str(plan["logical_key"]): plan for plan in plans if isinstance(plan.get("logical_key"), str)
            }
            visible_by_logical = {
                item.logical_key: item
                for item in visible
                if item.logical_key is not None and item.status is ContentStatus.VALID
            }
            edges: dict[str, list[str]] = {}
            for package_id, document in documents.items():
                document_dependencies = document.dependencies
                edges[package_id] = []
                for dependency in document_dependencies:
                    target_plan = plan_by_logical.get(dependency.ref)
                    target_item = visible_by_logical.get(dependency.ref)
                    if target_plan is None and target_item is None:
                        raise ContentConflictError("package_dependency_unavailable")
                    target_kind = (
                        target_plan.get("kind")
                        if target_plan is not None
                        else target_item.kind
                        if target_item is not None
                        else None
                    )
                    if target_kind is not dependency.kind:
                        raise ContentConflictError("package_dependency_kind_mismatch")
                    if target_plan is not None and target_plan.get("skip") is not True:
                        target_id = str(target_plan["package_id"])
                        edges[package_id].append(target_id)

            visiting: set[str] = set()
            visited: set[str] = set()

            def visit(package_id: str) -> None:
                if package_id in visiting:
                    raise ContentConflictError("package_dependency_cycle")
                if package_id in visited:
                    return
                visiting.add(package_id)
                for target_id in edges.get(package_id, []):
                    visit(target_id)
                visiting.remove(package_id)
                visited.add(package_id)

            for package_id in edges:
                visit(package_id)

            await self._content.rescan(user_id=user_id)
            for plan in plans:
                if plan.get("skip") is True:
                    continue
                locator = str(plan["locator"])
                current = await self._catalog.get_by_locator(
                    source=ContentSource.LOCAL,
                    relative_locator=locator,
                )
                expected = plan.get("existing")
                if expected is None and current is not None:
                    raise ContentConflictError("package_destination_drift")
                if isinstance(expected, CatalogContentEntry) and (
                    current is None or current.id != expected.id or current.revision_sha256 != expected.revision_sha256
                ):
                    raise ContentConflictError("package_destination_drift")

            await asyncio.to_thread(
                self._store.install_package_atomic,
                entries=tuple(prepared_entries),
                operation_id=operation_id,
            )
            await self._content.rescan(user_id=user_id)

            installed_items: list[CatalogContentEntry] = []
            for plan in plans:
                if plan.get("skip") is True:
                    continue
                imported_item = await self._catalog.get_by_locator(
                    source=ContentSource.LOCAL,
                    relative_locator=str(plan["locator"]),
                )
                if imported_item is None or imported_item.status is not ContentStatus.VALID:
                    raise ContentConflictError("package_install_reconcile_failed")
                if plan.get("existing") is None:
                    imported_item = await self._catalog.assign_creator_owner(item_id=imported_item.id, user_id=user_id)
                provenance = {
                    **(dict(plan["license"]) if isinstance(plan.get("license"), dict) else {}),
                    "import": {
                        "package_schema": PACKAGE_SCHEMA,
                        "package_entry_id": plan["package_id"],
                        "logical_key": plan["logical_key"],
                        "portable_revision_sha256": plan["portable_revision"],
                    },
                }
                installed_items.append(
                    await self._catalog.record_import_provenance(
                        item_id=imported_item.id,
                        user_id=user_id,
                        provenance=provenance,
                    )
                )
            return ImportedContentPackage(tuple(installed_items), tuple(skipped))
        finally:
            for member in open_members:
                member.close()
            archive.close()


__all__ = [
    "ContentPackageService",
    "ExportedContentPackage",
    "ImportedContentPackage",
    "PACKAGE_SCHEMA",
]
