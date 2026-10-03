"""Read-only package inspection, separate from catalog admission and installation."""

from __future__ import annotations

import hashlib
import json
import shutil
import stat
import struct
import unicodedata
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any
from zipfile import ZIP_DEFLATED, ZIP_STORED, BadZipFile, ZipFile, ZipInfo

from pydantic import ValidationError

from animama.app.contracts.content_package import (
    MAX_COMPRESSION_RATIO,
    MAX_MANIFEST_BYTES,
    MAX_PACKAGE_BYTES,
    MAX_PACKAGE_FILES,
    MAX_PACKAGE_METADATA_BYTES,
    PACKAGE_SCHEMA,
    PackageEntry,
    PackageFile,
    PackageManifest,
    safe_package_path,
)
from animama.app.ports.content_store import ContentStore
from animama.app.services.content_kind_registry import (
    MAX_JSON_BYTES,
    _validate_bounded_json,
    definition_for_kind,
    handler_for_kind,
)
from animama.app.services.idle_playback import derive_idle_playback
from animama.app.services.portable_anima_service import validate_package_anima_runtime
from animama.app.services.runtime_budget_policy import MAX_RUNTIME_BYTES, MAX_RUNTIME_CONFIG_BYTES
from animama.app.services.typed_content_service import TypedContentAdmissionError, TypedContentResolutionContext
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentConflictError,
    ContentScope,
    ContentSource,
    ContentStatus,
    ScannedContentEntry,
)
from animama.domain.content_documents import (
    ContentDocumentError,
    GestureDocumentV1,
    IdleStyleDocumentV1,
    IdleStyleDocumentV2,
    ReactionDocumentV1,
    TypedContentDocument,
)
from animama.utils.files import path_is_link

_CHUNK_BYTES = 1024 * 1024
MAX_ZIP_DIRECTORY_BYTES = 16 * 1024 * 1024


def _unique_object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("package_json_key_duplicate")
        result[key] = value
    return result


def _reject_constant(value: str) -> None:
    raise ValueError("package_json_nonfinite")


@dataclass(frozen=True, slots=True)
class InspectedPackageEntry:
    """Validated document and verified private file paths, with no open handles."""

    document: TypedContentDocument
    scanned: ScannedContentEntry
    files: dict[str, Path]
    root: Path


@dataclass(frozen=True, slots=True)
class InspectedPackage:
    manifest: PackageManifest
    entries: dict[str, InspectedPackageEntry]


class ContentPackageArchive:
    """Inspect exact archive bytes without accessing installed catalog state."""

    def __init__(self, *, store: ContentStore) -> None:
        self._store = store

    @classmethod
    @contextmanager
    def _open_bounded(cls, archive_path: Path) -> Iterator[tuple[ZipFile, dict[str, ZipInfo], PackageManifest]]:
        """Share parser budgets and declared-member checks before any extraction."""
        try:
            if not stat.S_ISREG(archive_path.lstat().st_mode) or archive_path.stat().st_size > MAX_PACKAGE_BYTES:
                raise ContentConflictError("package_archive_size_invalid")
            cls._directory_budget(archive_path)
            with ZipFile(archive_path) as archive:
                indexed = cls._index(archive)
                manifest = cls._manifest(archive, indexed)
                from animama.app.services.content_package_capabilities import validate_declared_capabilities

                validate_declared_capabilities(manifest.capabilities)
                declared = {member.archive_path: member for entry in manifest.entries for member in entry.files}
                if set(indexed) != declared.keys() | {"package.json"}:
                    raise ContentConflictError("package_members_mismatch")
                if any(indexed[path].file_size != member.size_bytes for path, member in declared.items()):
                    raise ContentConflictError("package_member_size_mismatch")
                yield archive, indexed, manifest
        except ContentDocumentError as exc:
            raise ContentConflictError(exc.code) from exc
        except (OSError, ValueError, BadZipFile, RuntimeError, RecursionError, struct.error, EOFError) as exc:
            raise ContentConflictError("package_archive_invalid") from exc

    @classmethod
    def expanded_size(cls, archive_path: Path) -> int:
        """Return the bounded expanded byte requirement, including the manifest.

        This is a disk-space preflight, not admission: inspection still verifies
        every streamed byte, digest, typed document and runtime dependency.
        """
        with cls._open_bounded(archive_path) as (_, indexed, _manifest):
            return sum(info.file_size for info in indexed.values())

    def inspect(self, archive_path: Path, *, destination: Path) -> InspectedPackage:
        """Return an owned private tree; caller removes it after review or publication."""
        if destination.exists() or path_is_link(destination):
            raise ContentConflictError("package_inspection_destination_exists")
        created = False
        try:
            with self._open_bounded(archive_path) as (archive, indexed, manifest):
                destination.mkdir(mode=0o700)
                created = True
                inspected: dict[str, InspectedPackageEntry] = {}
                expanded = indexed["package.json"].file_size
                retained_metadata = 0
                for index, entry in enumerate(manifest.entries):
                    root = destination / "entries" / f"{index:04d}"
                    base, locator = self._layout(entry, root)
                    files: dict[str, Path] = {}
                    for member in entry.files:
                        target = base.joinpath(*safe_package_path(member.relative_path).parts)
                        target.parent.mkdir(parents=True, exist_ok=True)
                        expanded += self._extract(archive, indexed[member.archive_path], member, target)
                        if expanded > MAX_PACKAGE_BYTES:
                            raise ContentConflictError("package_expanded_size_invalid")
                        files[member.relative_path] = target
                    result = self._validate_entry(entry, root, locator, files)
                    retained_metadata += len(
                        json.dumps(result.scanned.metadata, sort_keys=True, separators=(",", ":")).encode()
                    )
                    if retained_metadata > MAX_PACKAGE_METADATA_BYTES:
                        raise ContentConflictError("package_metadata_budget")
                    inspected[entry.package_entry_id] = result
                self._validate_runtime(manifest, inspected)
                return InspectedPackage(manifest, inspected)
        except Exception as exc:
            if created:
                shutil.rmtree(destination)
            if isinstance(exc, ContentConflictError):
                raise
            if isinstance(exc, ContentDocumentError | TypedContentAdmissionError):
                raise ContentConflictError(exc.code) from exc
            if isinstance(
                exc, OSError | ValueError | BadZipFile | RuntimeError | RecursionError | struct.error | EOFError
            ):
                raise ContentConflictError("package_archive_invalid") from exc
            raise

    @staticmethod
    def _directory_budget(path: Path) -> None:
        """Bound ZIP parser allocation before ZipFile reads the central directory."""
        size = path.stat().st_size
        with path.open("rb") as source:
            source.seek(max(0, size - 65_557))
            tail = source.read(65_557)
            offset = tail.rfind(b"PK\x05\x06")
            if offset < 0 or len(tail) - offset < 22:
                raise ContentConflictError("package_zip_directory_invalid")
            _, disk, directory_disk, disk_count, count, directory_size, directory_offset, comment = struct.unpack_from(
                "<4s4H2IH", tail, offset
            )
            end_offset = size - len(tail) + offset
            if offset + 22 + comment != len(tail) or disk or directory_disk or disk_count != count:
                raise ContentConflictError("package_zip_directory_invalid")
            needs_zip64 = count == 0xFFFF or directory_size == 0xFFFFFFFF or directory_offset == 0xFFFFFFFF
            locator = b""
            if end_offset >= 20:
                source.seek(end_offset - 20)
                locator = source.read(20)
            directory_end = end_offset
            # ZipFile honors an adjacent ZIP64 locator even when the classic
            # fields are not sentinels. Bound exactly the metadata it will use.
            if locator.startswith(b"PK\x06\x07"):
                _, zip_disk, zip_offset, disks = struct.unpack("<4sIQI", locator)
                # The standard reader uses the fixed record immediately before
                # the locator; reject a pointer to different, benign metadata.
                if zip_disk or disks != 1 or zip_offset != end_offset - 76:
                    raise ContentConflictError("package_zip_directory_invalid")
                source.seek(zip_offset)
                header = source.read(56)
                (
                    signature,
                    record_size,
                    _,
                    _,
                    disk,
                    directory_disk,
                    disk_count,
                    count,
                    directory_size,
                    directory_offset,
                ) = struct.unpack("<4sQ2H2I4Q", header)
                if signature != b"PK\x06\x06" or record_size != 44 or disk or directory_disk or disk_count != count:
                    raise ContentConflictError("package_zip_directory_invalid")
                directory_end = zip_offset
            elif needs_zip64:
                raise ContentConflictError("package_zip_directory_invalid")
            if (
                count > MAX_PACKAGE_FILES + 1
                or directory_size > MAX_ZIP_DIRECTORY_BYTES
                or directory_offset + directory_size > directory_end
            ):
                raise ContentConflictError("package_zip_directory_budget")
            # EOCD counts can also lie. Count bounded central records before
            # ZipFile allocates a ZipInfo for every actual entry in the directory.
            position = directory_end - directory_size
            actual_count = 0
            while position < directory_end:
                source.seek(position)
                header = source.read(46)
                if len(header) != 46 or header[:4] != b"PK\x01\x02":
                    raise ContentConflictError("package_zip_directory_invalid")
                lengths = struct.unpack_from("<3H", header, 28)
                position += 46 + sum(lengths)
                actual_count += 1
                if actual_count > MAX_PACKAGE_FILES + 1 or position > directory_end:
                    raise ContentConflictError("package_zip_directory_budget")
            if actual_count != count:
                raise ContentConflictError("package_zip_directory_invalid")

    @staticmethod
    def _index(archive: ZipFile) -> dict[str, ZipInfo]:
        infos = archive.infolist()
        if not infos or len(infos) > MAX_PACKAGE_FILES + 1:
            raise ContentConflictError("package_file_count_invalid")
        indexed: dict[str, ZipInfo] = {}
        names: set[str] = set()
        expanded = 0
        for info in infos:
            if info.orig_filename != info.filename:
                raise ContentConflictError("package_path_invalid")
            name = safe_package_path(info.filename).as_posix()
            key = unicodedata.normalize("NFC", name).casefold()
            mode = stat.S_IFMT(info.external_attr >> 16)
            if key in names:
                raise ContentConflictError("package_member_duplicate")
            if info.is_dir() or mode not in {0, stat.S_IFREG} or info.external_attr & 0x10:
                raise ContentConflictError("package_member_not_regular")
            if info.flag_bits & 1 or info.compress_type not in {ZIP_STORED, ZIP_DEFLATED}:
                raise ContentConflictError("package_member_encoding_invalid")
            if info.file_size <= 0 or info.file_size > MAX_PACKAGE_BYTES or info.compress_size <= 0:
                raise ContentConflictError("package_member_size_invalid")
            if info.file_size > info.compress_size * MAX_COMPRESSION_RATIO:
                raise ContentConflictError("package_compression_ratio_invalid")
            expanded += info.file_size
            if expanded > MAX_PACKAGE_BYTES:
                raise ContentConflictError("package_expanded_size_invalid")
            indexed[name] = info
            names.add(key)
        return indexed

    @staticmethod
    def _manifest(archive: ZipFile, indexed: dict[str, ZipInfo]) -> PackageManifest:
        info = indexed.get("package.json")
        if info is None or info.file_size > MAX_MANIFEST_BYTES:
            raise ContentConflictError("package_manifest_size_invalid")
        with archive.open(info) as stream:
            payload = stream.read(MAX_MANIFEST_BYTES + 1)
        if len(payload) != info.file_size or len(payload) > MAX_MANIFEST_BYTES:
            raise ContentConflictError("package_manifest_size_invalid")
        value = json.loads(payload, object_pairs_hook=_unique_object, parse_constant=_reject_constant)
        _validate_bounded_json(value)
        if not isinstance(value, dict) or value.get("schema") != PACKAGE_SCHEMA:
            raise ContentConflictError("package_schema_unsupported")
        try:
            return PackageManifest.model_validate(value)
        except ValidationError as exc:
            raise ContentConflictError("package_manifest_invalid") from exc

    @staticmethod
    def _layout(entry: PackageEntry, root: Path) -> tuple[Path, str]:
        definition = definition_for_kind(entry.kind)
        if (
            len(entry.files) > definition.max_entry_files
            or sum(file.size_bytes for file in entry.files) > definition.max_entry_bytes
        ):
            raise ContentConflictError("package_entry_size_invalid")
        if any(file.size_bytes > definition.max_file_bytes for file in entry.files):
            raise ContentConflictError("package_member_size_invalid")
        descriptors = [file for file in entry.files if file.role == "descriptor"]
        if descriptors:
            relative = PurePosixPath(descriptors[0].relative_path)
            if len(descriptors) != 1 or not definition.descriptor_suffix or relative.parent != PurePosixPath("."):
                raise ContentConflictError("package_descriptor_invalid")
            if not relative.name.endswith(definition.descriptor_suffix):
                raise ContentConflictError("package_descriptor_invalid")
            name = relative.name[: -len(definition.descriptor_suffix)]
            safe_package_path(name)
            locator = f"{definition.directory}/{name}"
            return root / locator, locator
        primary = [file for file in entry.files if file.role != "metadata"]
        if len(primary) != 1 or len(entry.files) > 2:
            raise ContentConflictError("package_primary_file_invalid")
        relative = PurePosixPath(primary[0].relative_path)
        if relative.parent != PurePosixPath(".") or relative.suffix.lower() not in definition.standalone_extensions:
            raise ContentConflictError("package_primary_file_invalid")
        if any(
            file.role == "metadata" and file.relative_path != relative.with_suffix(".meta.json").name
            for file in entry.files
        ):
            raise ContentConflictError("package_metadata_invalid")
        locator = f"{definition.directory}/{relative.name}"
        return root / definition.directory, locator

    @staticmethod
    def _extract(archive: ZipFile, info: ZipInfo, member: PackageFile, target: Path) -> int:
        if info.file_size != member.size_bytes:
            raise ContentConflictError("package_member_size_mismatch")
        digest = hashlib.sha256()
        size = 0
        with archive.open(info) as source, target.open("xb") as output:
            while chunk := source.read(_CHUNK_BYTES):
                size += len(chunk)
                if size > member.size_bytes or size > MAX_PACKAGE_BYTES:
                    raise ContentConflictError("package_member_size_mismatch")
                digest.update(chunk)
                output.write(chunk)
        if size != member.size_bytes or digest.hexdigest() != member.sha256:
            raise ContentConflictError("package_member_digest_mismatch")
        return size

    def _validate_entry(
        self, entry: PackageEntry, root: Path, locator: str, files: dict[str, Path]
    ) -> InspectedPackageEntry:
        for relative, path in files.items():
            if PurePosixPath(relative).suffix.lower() == ".json":
                if path.stat().st_size > MAX_JSON_BYTES:
                    raise ContentConflictError("package_json_size_invalid")
                with path.open("rb") as stream:
                    value = json.loads(
                        stream.read(MAX_JSON_BYTES + 1),
                        object_pairs_hook=_unique_object,
                        parse_constant=_reject_constant,
                    )
                _validate_bounded_json(value)
        scanned = self._store.inspect_package_tree(root)
        if len(scanned) != 1 or scanned[0].relative_locator != locator:
            raise ContentConflictError("package_entry_members_mismatch")
        item = scanned[0]
        if item.kind is not entry.kind or item.status is not ContentStatus.VALID:
            raise ContentConflictError("package_entry_invalid")
        if item.logical_key != entry.package_entry_id or item.display_name != entry.display_name:
            raise ContentConflictError("package_entry_identity_mismatch")
        actual = {(file.relative_path, file.role, file.size_bytes, file.sha256, file.media_type) for file in item.files}
        declared = {
            (
                files[file.relative_path].relative_to(root).as_posix(),
                file.role,
                file.size_bytes,
                file.sha256,
                file.media_type,
            )
            for file in entry.files
        }
        if actual != declared:
            raise ContentConflictError("package_file_registration_mismatch")
        document = (
            handler_for_kind(entry.kind)
            .parse_document(
                item.metadata, fallback_path=Path(locator), descriptor_backed=item.descriptor_relative_path is not None
            )
            .document
        )
        if isinstance(document, IdleStyleDocumentV1):
            raise ContentConflictError("package_idle_style_schema_unsupported")
        if isinstance(document, GestureDocumentV1 | ReactionDocumentV1):
            role = document.implementation.file_role or (
                "animation" if document.implementation.kind == "vrma" else "sequence"
            )
            motion = [file for file in item.files if file.role == role]
            if (
                role in {"descriptor", "metadata"}
                or len(motion) != 1
                or Path(motion[0].relative_path).suffix.lower()
                != (".vrma" if document.implementation.kind == "vrma" else ".json")
            ):
                raise ContentConflictError("package_action_motion_invalid")
        if {(edge.ref, edge.kind) for edge in document.dependencies} != {
            (edge.ref, edge.content_type) for edge in entry.dependencies
        }:
            raise ContentConflictError("package_dependency_manifest_mismatch")
        return InspectedPackageEntry(document, item, files, root)

    @staticmethod
    def _validate_runtime(manifest: PackageManifest, inspected: dict[str, InspectedPackageEntry]) -> None:
        from animama.app.services.content_package_capabilities import derive_capabilities, validate_capabilities

        required: set[str] = set()
        catalog: dict[str, CatalogContentEntry] = {}
        documents = {entry_id: result.document for entry_id, result in inspected.items()}
        for entry in manifest.entries:
            result = inspected[entry.package_entry_id]
            required.update(
                derive_capabilities(
                    entry.kind,
                    result.document,
                    result.files,
                    roles={member.relative_path: member.role for member in entry.files},
                    documents=documents,
                )
            )
            item = result.scanned
            catalog[entry.package_entry_id] = CatalogContentEntry(
                id=entry.package_entry_id,
                source=ContentSource.LOCAL,
                scope=ContentScope.OWNER,
                owner_user_id=None,
                kind=entry.kind,
                relative_locator=item.relative_locator,
                display_name=item.display_name,
                status=item.status,
                revision_sha256=entry.portable_revision_sha256,
                logical_key=entry.package_entry_id,
                files=tuple(
                    CatalogContentFile(
                        file_ref=f"{entry.package_entry_id}:{index}",
                        item_id=entry.package_entry_id,
                        source=ContentSource.LOCAL,
                        relative_path=file.relative_path,
                        role=file.role,
                        media_type=file.media_type,
                        size_bytes=file.size_bytes,
                        sha256=file.sha256,
                    )
                    for index, file in enumerate(item.files)
                ),
                dependencies=item.dependencies,
                dependency_item_ids=tuple(edge.ref for edge in entry.dependencies),
                metadata=item.metadata,
                provenance=item.provenance,
            )
        validate_capabilities(manifest.capabilities, required)
        context = TypedContentResolutionContext(catalog)
        for entry_id, result in inspected.items():
            closure = context.resolve(entry_id)
            if (
                sum(file.size_bytes for item in closure for file in item.item.files) > MAX_RUNTIME_BYTES
                or sum(len(json.dumps(item.item.metadata).encode()) for item in closure) > MAX_RUNTIME_CONFIG_BYTES
            ):
                raise ContentConflictError("package_runtime_budget")
            document = result.document
            if isinstance(document, IdleStyleDocumentV2):
                gesture_ids = set(document.default_pool)
                gesture_ids.update(
                    ref for levels in document.cells.values() for cell in levels.values() for ref in cell.gestures
                )
                for gesture_id in gesture_ids:
                    gesture = inspected[gesture_id]
                    if not isinstance(gesture.document, GestureDocumentV1):
                        raise ContentConflictError("package_idle_gesture_invalid")
                    role = gesture.document.implementation.file_role or (
                        "animation" if gesture.document.implementation.kind == "vrma" else "sequence"
                    )
                    motion = [file for file in gesture.scanned.files if file.role == role]
                    if len(motion) != 1:
                        raise ContentConflictError("package_idle_motion_invalid")
                    with (gesture.root / motion[0].relative_path).open("rb") as stream:
                        derive_idle_playback(gesture.document, stream)
        if manifest.anima is not None:
            validate_package_anima_runtime(manifest.anima, catalog)
