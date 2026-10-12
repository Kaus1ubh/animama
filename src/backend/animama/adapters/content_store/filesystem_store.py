"""Containment-safe filesystem implementation of the readable content store."""

from __future__ import annotations

import fnmatch
import hashlib
import json
import os
import re
import stat
import unicodedata
import uuid
from collections.abc import Iterable, Mapping
from contextlib import AbstractContextManager, nullcontext
from dataclasses import replace
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO, TypedDict

from animama.adapters.content_store.mutations import (
    MutationJournal,
    copy_file,
    create_journal,
    fingerprint,
    read_journals,
    safe_path,
)
from animama.app.ports.content_store import ContentMutationJournal, ContentStore
from animama.app.services.content_kind_registry import (
    CONTENT_KIND_REGISTRY,
    ContentKindDefinition,
    definition_for_kind,
    descriptor_file_paths,
    descriptor_filename,
    handler_for_kind,
    is_descriptor_path,
    media_type_for,
    parse_json_object,
    resolve_optional_dependencies,
    validate_descriptor,
    validate_metadata_sidecar,
    validate_standalone_file,
)
from animama.app.services.content_portability import (
    DISTRIBUTION_KEY,
    effective_provenance,
    resolve_rule_distribution,
    restricted_sha256 as manifest_sha256,
)
from animama.domain.content_catalog import (
    LOCAL_TOLERATED_DIAGNOSTICS,
    CatalogContentEntry,
    ContentConflictError,
    ContentDiagnostic,
    ContentIntegrityError,
    ContentKind,
    ContentPathError,
    ContentSource,
    ContentStatus,
    ContentValidationError,
    PreparedPackageEntry,
    ScannedContentEntry,
    ScannedContentFile,
    VerifiedContentFile,
)
from animama.domain.content_documents import ContentDocumentError, TypedContentDocument
from animama.domain.content_sources import IncludedContentSource
from animama.utils import files as safe_files

_IGNORED_NAMES = {".DS_Store", ".gitkeep", "README.md"}

_OPERATION_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_COMPANION_EXTENSIONS = {
    ".bin",
    ".flac",
    ".jpeg",
    ".jpg",
    ".json",
    ".md",
    ".mp3",
    ".ogg",
    ".png",
    ".svg",
    ".txt",
    ".vrm",
    ".vrma",
    ".wav",
    ".webp",
}


class _PackageTarget(TypedDict, total=False):
    """Internal staged-package paths and optional legacy recovery fingerprints."""

    locator: str
    directory: bool
    paths: list[str]
    new_paths: list[str]
    before: dict[str, dict[str, Any] | None]
    after: dict[str, dict[str, Any] | None]


def _scan_status(source: ContentSource, diagnostics: Iterable[ContentDiagnostic]) -> ContentStatus:
    """Invalid on any diagnostic, except those Local content outlives (it plays without the part)."""
    tolerated = LOCAL_TOLERATED_DIAGNOSTICS if source is ContentSource.LOCAL else frozenset()
    return ContentStatus.INVALID if any(item.code not in tolerated for item in diagnostics) else ContentStatus.VALID


def _with_relative_path(diagnostic: ContentDiagnostic, relative_path: str) -> ContentDiagnostic:
    return replace(diagnostic, relative_path=relative_path)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _entry_revision(
    files: list[ScannedContentFile],
    *,
    kind: ContentKind,
    relative_locator: str,
    descriptor_backed: bool,
    admission_projection: Mapping[str, Any],
) -> str | None:
    if not files:
        return None
    locator_prefix = f"{relative_locator.rstrip('/')}/"
    projection = []
    for item in sorted(files, key=lambda item: (item.role, item.relative_path)):
        # Catalog identity is independent from the entry's outer filename or
        # folder. Internal descriptor paths remain significant, while a bare
        # file rename can be reconciled by an otherwise unique byte revision.
        projected_path = item.relative_path.removeprefix(locator_prefix) if descriptor_backed else item.role
        projection.append(
            {
                "path": projected_path,
                "role": item.role,
                "media_type": item.media_type,
                "size": item.size_bytes,
                "sha256": item.sha256,
            }
        )
    identity = {
        "revision_schema": 2,
        "content_type": kind.value,
        "document": admission_projection,
        "files": projection,
    }
    return hashlib.sha256(json.dumps(identity, separators=(",", ":"), sort_keys=True).encode()).hexdigest()


def _validate_relative_path(value: str, *, allow_directory: bool = False) -> PurePosixPath:
    if not value or "\\" in value or "\x00" in value:
        raise ContentPathError("content locator is not a portable relative path")
    relative = PurePosixPath(value)
    if relative.is_absolute() or any(part in {"", ".", ".."} for part in relative.parts):
        raise ContentPathError("content locator cannot be absolute or contain traversal")
    if not allow_directory and value.endswith("/"):
        raise ContentPathError("file locator cannot end in a slash")
    return relative


def _validate_companion_file(path: Path) -> tuple[ContentDiagnostic, ...]:
    """Apply the registered structural parser to a descriptor companion."""

    suffix = path.suffix.lower()
    for definition in CONTENT_KIND_REGISTRY:
        if suffix in definition.standalone_extensions:
            return validate_standalone_file(definition, path)
    if suffix not in _COMPANION_EXTENSIONS:
        return (ContentDiagnostic("unsupported_extension", "Companion file extension is not supported"),)
    try:
        size = path.stat().st_size
    except OSError:
        return (ContentDiagnostic("unreadable_file", "Companion file could not be read"),)
    if size <= 0:
        return (ContentDiagnostic("empty_file", "Companion files cannot be empty"),)
    if size > 16 * 1024 * 1024 and suffix in {".md", ".txt"}:
        return (ContentDiagnostic("file_too_large", "Text companion exceeds the supported size limit"),)
    return ()


class FilesystemContentStore(ContentStore):
    """Scan and update only registered roots without exposing host paths."""

    def __init__(
        self,
        *,
        included_root: Path,
        local_root: Path,
        operations_root: Path,
        included_sources: tuple[IncludedContentSource, ...] = (),
        restricted_sha256: frozenset[str] | None = None,
    ) -> None:
        # Bytes that are non-portable wherever they are stored (see
        # content_portability). Tests inject a set; services use the manifest.
        self._restricted_sha256 = manifest_sha256() if restricted_sha256 is None else restricted_sha256
        self._roots = {
            ContentSource.INCLUDED: included_root.resolve(strict=False),
            ContentSource.LOCAL: local_root.resolve(strict=False),
        }
        self._operations_root = operations_root.resolve(strict=False)
        # The coordinator holds the Local lock and owns this store for a request.
        # An attribute survives to_thread calls; thread-local context would not.
        self._mutation: MutationJournal | None = None
        self._included_sources = included_sources
        self._included_stores = {
            source.mount_id: FilesystemContentStore(
                included_root=source.root,
                local_root=local_root,
                operations_root=operations_root,
                restricted_sha256=self._restricted_sha256,
            )
            for source in included_sources
        }

    @property
    def restricted_sha256(self) -> frozenset[str]:
        """Hashes of non-portable bytes that must never enter Local content."""

        return self._restricted_sha256

    @property
    def included_mount_ids(self) -> tuple[str, ...] | None:
        """None retains the development single-root reconciliation contract."""

        return tuple(self._included_stores) if self._included_sources else None

    def _source_root(self, source: ContentSource) -> Path:
        return self._roots[source]

    def _safe_path(self, source: ContentSource, relative_path: str) -> Path:
        relative = _validate_relative_path(relative_path)
        root = self._source_root(source)
        candidate = root.joinpath(*relative.parts)
        resolved_parent = candidate.parent.resolve(strict=False)
        if not resolved_parent.is_relative_to(root):
            raise ContentPathError("content path escaped its configured root")
        cursor = root
        for part in relative.parts[:-1]:
            cursor /= part
            try:
                metadata = cursor.lstat()
            except FileNotFoundError:
                continue
            except OSError as exc:
                raise ContentPathError("content directory could not be inspected") from exc
            if not safe_files.is_directory(metadata):
                raise ContentPathError("symlinked content directories are not allowed")
        return candidate

    @staticmethod
    def _assert_regular_file(path: Path) -> os.stat_result:
        try:
            metadata = path.lstat()
        except OSError as exc:
            raise ContentPathError("registered content file is unavailable") from exc
        if safe_files.is_link(metadata) or not stat.S_ISREG(metadata.st_mode):
            raise ContentPathError("registered content must be a regular non-symlink file")
        if metadata.st_nlink != 1:
            raise ContentPathError("hard-linked content files are not allowed")
        return metadata

    def _walk_definition(
        self,
        root: Path,
    ) -> tuple[list[Path], dict[str, ContentDiagnostic]]:
        regular_files: list[Path] = []
        unsafe: dict[str, ContentDiagnostic] = {}
        casefolded: dict[str, str] = {}
        if not root.exists():
            return regular_files, unsafe

        for current, directory_names, file_names in os.walk(root, topdown=True, followlinks=False):
            current_path = Path(current)
            retained_directories: list[str] = []
            for name in directory_names:
                if name.startswith("."):
                    continue
                path = current_path / name
                relative = path.relative_to(root).as_posix()
                try:
                    metadata = path.lstat()
                except OSError:
                    unsafe[relative] = ContentDiagnostic("unreadable_path", "Directory could not be inspected")
                    continue
                if safe_files.is_link(metadata):
                    unsafe[relative] = ContentDiagnostic("symlink_rejected", "Symlinked directories are not scanned")
                    continue
                if not stat.S_ISDIR(metadata.st_mode):
                    unsafe[relative] = ContentDiagnostic(
                        "special_file_rejected", "Only ordinary directories are allowed"
                    )
                    continue
                retained_directories.append(name)
            directory_names[:] = retained_directories

            for name in file_names:
                if name == ".animama-operation":
                    path = current_path / name
                    relative = path.relative_to(root).as_posix()
                    unsafe[relative] = ContentDiagnostic(
                        "incomplete_operation",
                        "Entry has an interrupted multi-file Save and requires reconciliation",
                    )
                    continue
                if name in _IGNORED_NAMES or name.startswith("."):
                    continue
                path = current_path / name
                relative = path.relative_to(root).as_posix()
                folded = relative.casefold()
                previous = casefolded.get(folded)
                if previous is not None and previous != relative:
                    diagnostic = ContentDiagnostic(
                        "case_collision",
                        "Two paths differ only by case and are not portable",
                    )
                    unsafe[relative] = diagnostic
                    unsafe[previous] = diagnostic
                else:
                    casefolded[folded] = relative
                try:
                    metadata = path.lstat()
                except OSError:
                    unsafe[relative] = ContentDiagnostic("unreadable_path", "File could not be inspected")
                    continue
                if safe_files.is_link(metadata):
                    unsafe[relative] = ContentDiagnostic("symlink_rejected", "Symlinked files are not scanned")
                elif not stat.S_ISREG(metadata.st_mode):
                    unsafe[relative] = ContentDiagnostic("special_file_rejected", "Only regular files are scanned")
                elif metadata.st_nlink != 1:
                    unsafe[relative] = ContentDiagnostic("hard_link_rejected", "Hard-linked files are not scanned")
                else:
                    regular_files.append(path)
        return regular_files, unsafe

    def _license_inventory(self) -> list[dict[str, Any]]:
        inventory_path = self._roots[ContentSource.INCLUDED] / "licenses" / "inventory.json"
        value, error = parse_json_object(inventory_path) if inventory_path.exists() else (None, None)
        if error or not value or not isinstance(value.get("rules"), list):
            return []
        return [rule for rule in value["rules"] if isinstance(rule, dict) and isinstance(rule.get("glob"), str)]

    @staticmethod
    def _matched_provenance(relative_locator: str, rules: list[dict[str, Any]]) -> dict[str, Any]:
        for rule in rules:
            if fnmatch.fnmatch(relative_locator, str(rule["glob"])):
                return {key: value for key, value in rule.items() if key != "glob"}
        return {}

    def _scanned_file(self, source_root: Path, path: Path, role: str) -> ScannedContentFile:
        metadata = self._assert_regular_file(path)
        return ScannedContentFile(
            relative_path=path.relative_to(source_root).as_posix(),
            role=role,
            media_type=media_type_for(path),
            size_bytes=metadata.st_size,
            sha256=_sha256_file(path),
        )

    def _descriptor_entry(
        self,
        *,
        source: ContentSource,
        source_root: Path,
        definition: ContentKindDefinition,
        type_root: Path,
        descriptor: Path,
        entry_paths: list[Path],
        unsafe: dict[str, ContentDiagnostic],
        license_rules: list[dict[str, Any]],
        nested_descriptor: bool,
    ) -> ScannedContentEntry:
        entry_root = descriptor.parent
        locator = f"{definition.directory}/{entry_root.relative_to(type_root).as_posix()}".rstrip("/.")
        descriptor_relative = descriptor.relative_to(source_root).as_posix()
        handler = handler_for_kind(definition.kind)
        value, parse_error = parse_json_object(descriptor)
        diagnostics = [_with_relative_path(parse_error, descriptor_relative)] if parse_error is not None else []
        parsed = None
        if value is not None:
            try:
                parsed = handler.parse_document(
                    value,
                    fallback_path=entry_root,
                    descriptor_backed=True,
                )
            except ContentDocumentError as exc:
                diagnostics.append(ContentDiagnostic(exc.code, str(exc), descriptor_relative))
        if nested_descriptor:
            diagnostics.append(
                ContentDiagnostic(
                    "nested_descriptor",
                    "Descriptor-backed entries cannot be nested inside one another",
                    descriptor_relative,
                )
            )

        for relative, diagnostic in unsafe.items():
            unsafe_path = type_root / relative
            if unsafe_path == entry_root or entry_root in unsafe_path.parents:
                diagnostics.append(_with_relative_path(diagnostic, unsafe_path.relative_to(source_root).as_posix()))
        if len(entry_paths) > definition.max_entry_files:
            diagnostics.append(ContentDiagnostic("too_many_files", "Entry contains too many files", locator))

        scanned_files: list[ScannedContentFile] = []
        total_bytes = 0
        for path in sorted(entry_paths):
            relative = path.relative_to(source_root).as_posix()
            role = "descriptor" if path == descriptor else "dependency"
            if parsed is not None:
                role = handler.role_for_file(
                    relative_path=relative,
                    descriptor_relative_path=descriptor_relative,
                    document=parsed.document,
                    entry_relative_path=locator,
                )
            try:
                scanned = self._scanned_file(source_root, path, role)
            except (ContentPathError, OSError):
                diagnostics.append(ContentDiagnostic("unreadable_file", "Entry file could not be read", relative))
                continue
            scanned_files.append(scanned)
            total_bytes += scanned.size_bytes
            if path != descriptor:
                diagnostics.extend(
                    _with_relative_path(diagnostic, relative)
                    for diagnostic in (
                        validate_standalone_file(definition, path)
                        if definition.kind is ContentKind.APPEARANCE
                        else _validate_companion_file(path)
                    )
                )
        if total_bytes > definition.max_entry_bytes:
            diagnostics.append(ContentDiagnostic("entry_too_large", "Entry exceeds the supported byte limit", locator))

        if parsed is not None:
            diagnostics.extend(
                handler.validate_companion_files(
                    parsed.document,
                    {path.relative_to(entry_root).as_posix(): path for path in entry_paths if path != descriptor},
                )
            )
        metadata = parsed.metadata if parsed is not None else (value or {})
        if value is not None:
            for declared in descriptor_file_paths(value):
                try:
                    declared_relative = _validate_relative_path(declared)
                except ContentPathError:
                    diagnostics.append(
                        ContentDiagnostic(
                            "unsafe_descriptor_path", "Descriptor file paths must stay in the entry", declared
                        )
                    )
                    continue
                declared_path = entry_root.joinpath(*declared_relative.parts)
                if entry_root not in declared_path.parents or not declared_path.is_file():
                    diagnostics.append(
                        ContentDiagnostic("missing_descriptor_file", "A declared entry file is missing", declared)
                    )

        display_name = parsed.display_name if parsed is not None else entry_root.name[:120]
        logical_key = parsed.logical_key if parsed is not None else None
        provenance = self._matched_provenance(locator, license_rules) if source is ContentSource.INCLUDED else {}
        descriptor_provenance = metadata.get("provenance")
        if isinstance(descriptor_provenance, dict):
            provenance.update(descriptor_provenance)
        if source is ContentSource.INCLUDED and not provenance:
            diagnostics.append(
                ContentDiagnostic("provenance_missing", "Included entry has no license inventory record", locator)
            )

        return ScannedContentEntry(
            source=source,
            kind=definition.kind,
            relative_locator=locator,
            display_name=display_name,
            status=_scan_status(source, diagnostics),
            revision_sha256=_entry_revision(
                scanned_files,
                kind=definition.kind,
                relative_locator=locator,
                descriptor_backed=True,
                admission_projection=(
                    handler.admission_projection(parsed.document) if parsed is not None else metadata
                ),
            ),
            files=tuple(scanned_files),
            descriptor_relative_path=descriptor_relative,
            logical_key=logical_key,
            dependencies=tuple(item.ref for item in parsed.dependencies) if parsed is not None else (),
            provenance=provenance,
            metadata=metadata,
            diagnostics=tuple(diagnostics),
        )

    def _standalone_entry(
        self,
        *,
        source: ContentSource,
        source_root: Path,
        definition: ContentKindDefinition,
        path: Path,
        unsafe: dict[str, ContentDiagnostic],
        type_root: Path,
        license_rules: list[dict[str, Any]],
    ) -> ScannedContentEntry:
        locator = path.relative_to(source_root).as_posix()
        diagnostics = [_with_relative_path(item, locator) for item in validate_standalone_file(definition, path)]
        handler = handler_for_kind(definition.kind)
        type_relative = path.relative_to(type_root).as_posix()
        if type_relative in unsafe:
            diagnostics.append(_with_relative_path(unsafe[type_relative], locator))

        metadata: dict[str, Any] = {}
        parsed_document = None
        sidecar = path.with_suffix(".meta.json")
        files: list[ScannedContentFile] = []
        if path.suffix.lower() == ".json":
            parsed_primary, _ = parse_json_object(path)
            if parsed_primary is not None:
                metadata = parsed_primary
        if sidecar.exists() and sidecar != path:
            sidecar_relative = sidecar.relative_to(source_root).as_posix()
            sidecar_value, sidecar_error = parse_json_object(sidecar)
            if sidecar_error is not None:
                diagnostics.append(_with_relative_path(sidecar_error, sidecar_relative))
            elif sidecar_value is not None:
                metadata = sidecar_value
        try:
            parsed_document = handler.parse_document(
                metadata,
                fallback_path=path,
                descriptor_backed=False,
            )
            metadata = parsed_document.metadata
        except ContentDocumentError as exc:
            diagnostics.append(ContentDiagnostic(exc.code, str(exc), locator))

        document: TypedContentDocument | None = parsed_document.document if parsed_document is not None else None
        try:
            role = (
                handler.role_for_file(
                    relative_path=locator,
                    descriptor_relative_path=None,
                    document=document,
                    entry_relative_path=locator,
                )
                if document is not None
                else "primary"
            )
            files.append(self._scanned_file(source_root, path, role))
        except (ContentPathError, OSError):
            diagnostics.append(ContentDiagnostic("unreadable_file", "Primary file could not be read", locator))
        if sidecar.exists() and sidecar != path:
            sidecar_relative = sidecar.relative_to(source_root).as_posix()
            try:
                files.append(self._scanned_file(source_root, sidecar, "metadata"))
            except (ContentPathError, OSError):
                diagnostics.append(
                    ContentDiagnostic("unreadable_file", "Metadata sidecar could not be read", sidecar_relative)
                )

        display_name = parsed_document.display_name if parsed_document is not None else path.stem[:120]
        logical_key = parsed_document.logical_key if parsed_document is not None else None
        provenance = self._matched_provenance(locator, license_rules) if source is ContentSource.INCLUDED else {}
        if isinstance(metadata.get("provenance"), dict):
            provenance.update(metadata["provenance"])
        if source is ContentSource.INCLUDED and not provenance:
            diagnostics.append(
                ContentDiagnostic("provenance_missing", "Included entry has no license inventory record", locator)
            )
        return ScannedContentEntry(
            source=source,
            kind=definition.kind,
            relative_locator=locator,
            display_name=display_name,
            status=ContentStatus.INVALID if diagnostics else ContentStatus.VALID,
            revision_sha256=_entry_revision(
                files,
                kind=definition.kind,
                relative_locator=locator,
                descriptor_backed=False,
                admission_projection=(
                    handler.admission_projection(parsed_document.document) if parsed_document is not None else metadata
                ),
            ),
            files=tuple(files),
            logical_key=logical_key,
            dependencies=(
                tuple(item.ref for item in parsed_document.dependencies) if parsed_document is not None else ()
            ),
            provenance=provenance,
            metadata=metadata,
            diagnostics=tuple(diagnostics),
        )

    def scan(self, source: ContentSource) -> list[ScannedContentEntry]:
        """Authoritatively scan registered roots while isolating entry failures.

        Optional edges resolve against everything Included this store mounts,
        so a missing private pack leaves its effects valid and silent.
        """

        entries = self._scan_entries(source)
        return resolve_optional_dependencies(entries) if source is ContentSource.INCLUDED else entries

    def _scan_entries(self, source: ContentSource) -> list[ScannedContentEntry]:
        if source is ContentSource.INCLUDED and self._included_sources:
            result: list[ScannedContentEntry] = []
            identities: dict[str, str] = {}
            for mount_id, store in self._included_stores.items():
                for entry in store._scan_entries(source):
                    for identity in (entry.relative_locator, entry.logical_key):
                        if identity is None:
                            continue
                        folded = "entry:" + unicodedata.normalize("NFC", identity).casefold()
                        owner = f"{mount_id}/{entry.relative_locator}"
                        if folded in identities and identities[folded] != owner:
                            raise ContentPathError("Included sources contain colliding identities or files")
                        identities[folded] = owner
                    for file in entry.files:
                        folded = "file:" + unicodedata.normalize("NFC", file.relative_path).casefold()
                        owner = f"{mount_id}/{file.relative_path}"
                        if folded in identities and identities[folded] != owner:
                            raise ContentPathError("Included sources contain colliding files")
                        identities[folded] = owner
                    result.append(replace(entry, source_mount_id=mount_id))
            return result

        source_root = self._source_root(source)
        license_rules = self._license_inventory() if source is ContentSource.INCLUDED else []
        entries: list[ScannedContentEntry] = []
        for definition in CONTENT_KIND_REGISTRY:
            type_root = source_root.joinpath(*PurePosixPath(definition.directory).parts)
            all_files, unsafe = self._walk_definition(type_root)
            descriptors = sorted(path for path in all_files if is_descriptor_path(definition, path, type_root))
            descriptor_roots = {path.parent for path in descriptors}
            # Index each file under every enclosing descriptor root in one pass.
            # Comparing every file with every root is quadratic in library size.
            files_by_root: dict[Path, list[Path]] = {root: [] for root in descriptor_roots}
            for path in all_files:
                for parent in path.parents:
                    if parent in descriptor_roots:
                        files_by_root[parent].append(path)
                    if parent == type_root:
                        break
            for descriptor in descriptors:
                nested = any(parent in descriptor_roots for parent in descriptor.parent.parents)
                entries.append(
                    self._descriptor_entry(
                        source=source,
                        source_root=source_root,
                        definition=definition,
                        type_root=type_root,
                        descriptor=descriptor,
                        entry_paths=files_by_root[descriptor.parent],
                        unsafe=unsafe,
                        license_rules=license_rules,
                        nested_descriptor=nested,
                    )
                )

            for path in sorted(all_files):
                if is_descriptor_path(definition, path, type_root) or path.name.endswith(".meta.json"):
                    continue
                if any(parent in descriptor_roots for parent in path.parents):
                    continue
                if path.suffix.lower() not in definition.standalone_extensions:
                    continue
                entries.append(
                    self._standalone_entry(
                        source=source,
                        source_root=source_root,
                        definition=definition,
                        path=path,
                        unsafe=unsafe,
                        type_root=type_root,
                        license_rules=license_rules,
                    )
                )
        return [self._with_distribution(entry, license_rules) for entry in entries]

    def _with_distribution(
        self, entry: ScannedContentEntry, license_rules: list[dict[str, Any]]
    ) -> ScannedContentEntry:
        """Apply the trusted distribution after descriptor provenance was merged."""

        rule_distribution = None
        if entry.source is ContentSource.INCLUDED:
            # Match the locator and every file, case-sensitively like staging.
            paths = (entry.relative_locator, *(file.relative_path for file in entry.files))
            rule_distribution = resolve_rule_distribution(
                next(
                    (rule.get(DISTRIBUTION_KEY) for rule in license_rules if fnmatch.fnmatchcase(path, rule["glob"])),
                    None,
                )
                for path in paths
            )
        provenance = effective_provenance(
            entry.provenance,
            source=entry.source,
            rule_distribution=rule_distribution,
            file_sha256=(file.sha256 for file in entry.files),
            restricted=self._restricted_sha256,
        )
        return entry if provenance == entry.provenance else replace(entry, provenance=provenance)

    def inspect_package_tree(self, root: Path) -> list[ScannedContentEntry]:
        """Reuse the canonical scanner with private roots and no publication or journals."""
        inspector = FilesystemContentStore(
            included_root=root,
            local_root=root,
            operations_root=root / ".unused",
            restricted_sha256=self._restricted_sha256,
        )
        return inspector.scan(ContentSource.LOCAL)

    def open_verified_file(
        self,
        *,
        source: ContentSource,
        relative_path: str,
        expected_size_bytes: int,
        expected_sha256: str,
        media_type: str,
        source_mount_id: str | None = None,
    ) -> VerifiedContentFile:
        """Open and hash a registered regular file before any HTTP condition is evaluated."""

        if source is ContentSource.INCLUDED and self._included_sources:
            store = self._included_stores.get(source_mount_id or "")
            if store is None:
                raise ContentPathError("Registered Included source is not mounted")
            return store.open_verified_file(
                source=source,
                relative_path=relative_path,
                expected_size_bytes=expected_size_bytes,
                expected_sha256=expected_sha256,
                media_type=media_type,
            )
        if source_mount_id is not None:
            raise ContentPathError("Registered source does not match the active library")
        path = self._safe_path(source, relative_path)
        self._assert_regular_file(path)
        try:
            descriptor = safe_files.open_no_follow(path, os.O_RDONLY)
        except OSError as exc:
            raise ContentPathError("registered content file could not be opened") from exc
        handle = os.fdopen(descriptor, "rb")
        try:
            opened = os.fstat(handle.fileno())
            if not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1:
                raise ContentPathError("registered content changed during open")
            if opened.st_size != expected_size_bytes:
                raise ContentIntegrityError("registered content size no longer matches the catalog")
            digest = hashlib.sha256()
            while chunk := handle.read(1024 * 1024):
                digest.update(chunk)
            if digest.hexdigest() != expected_sha256:
                raise ContentIntegrityError("registered content digest no longer matches the catalog")
            handle.seek(0)
            return VerifiedContentFile(handle, expected_size_bytes, expected_sha256, media_type)
        except Exception:
            handle.close()
            raise

    def _receipt(self, operation_id: str, payload: dict[str, Any]) -> None:
        if self._mutation is not None:
            # Only the outer catalog transaction may establish replay success.
            return
        destination = safe_path(self._operations_root, f"{operation_id}.json", create_parents=True)
        temporary = destination.with_name(f".{operation_id}.{uuid.uuid4().hex}.json.tmp")
        descriptor = safe_files.open_no_follow(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        try:
            with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, sort_keys=True)
                handle.flush()
                os.fsync(handle.fileno())
            if destination.exists() or safe_files.path_is_link(destination):
                self._assert_regular_file(destination)
            safe_files.replace(temporary, destination)
            safe_files.sync_directory(destination.parent)
        finally:
            temporary.unlink(missing_ok=True)

    @staticmethod
    def _validated_operation_id(operation_id: str | None) -> str:
        candidate = operation_id or str(uuid.uuid4())
        if not _OPERATION_ID.fullmatch(candidate):
            raise ContentPathError("operation ID is not a portable identifier")
        return candidate

    def _completed_receipt(self, operation_id: str, request_digest: str) -> bool:
        """Return a matching completed retry or reject operation-id reuse."""

        if self._mutation is not None:
            return False
        destination = self._operations_root / f"{operation_id}.json"
        if not destination.exists():
            return False
        try:
            value = json.loads(destination.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ContentConflictError("operation_receipt_unreadable") from exc
        if value.get("request_digest") != request_digest:
            raise ContentConflictError("operation_id_reused")
        if value.get("status") == "completed":
            return True
        raise ContentConflictError("operation_incomplete")

    def retain_transition_originals(
        self, *, operation_id: str, entry: CatalogContentEntry | None, binding_facts: list[dict[str, Any]]
    ) -> None:
        """Retain immutable pre-transition bytes even after successful journal cleanup.

        A partial backup can be resumed, but an existing byte or manifest mismatch
        is a preservation conflict. No original or operator edit is overwritten.
        """

        if self._mutation is None:
            raise ContentConflictError("content_transition_requires_mutation")
        operation_id = self._validated_operation_id(operation_id)
        manifest_path = safe_path(
            self._operations_root, f"transitions/{operation_id}/manifest.json", create_parents=True
        )
        inventory = []
        for index, file in enumerate(entry.files if entry is not None else ()):
            name = f"{index:04d}.original"
            destination = safe_path(manifest_path.parent, name)
            facts = {
                "backup": name,
                "relative_path": file.relative_path,
                "role": file.role,
                "size_bytes": file.size_bytes,
                "sha256": file.sha256,
            }
            inventory.append(facts)
            if destination.exists() or safe_files.path_is_link(destination):
                self._assert_regular_file(destination)
                if destination.stat().st_size != file.size_bytes or _sha256_file(destination) != file.sha256:
                    raise ContentConflictError("content_transition_original_conflict")
                continue
            source = self.open_verified_file(
                source=file.source,
                relative_path=file.relative_path,
                expected_size_bytes=file.size_bytes,
                expected_sha256=file.sha256,
                media_type=file.media_type,
                source_mount_id=file.source_mount_id,
            )
            temporary = destination.with_name(f".{name}.{uuid.uuid4().hex}.tmp")
            try:
                with source.handle, temporary.open("xb") as target:
                    safe_files.set_mode(target.fileno(), 0o600)
                    while chunk := source.handle.read(1024 * 1024):
                        target.write(chunk)
                    target.flush()
                    os.fsync(target.fileno())
                if temporary.stat().st_size != file.size_bytes or _sha256_file(temporary) != file.sha256:
                    raise ContentIntegrityError("content transition original changed while retaining it")
                safe_files.replace(temporary, destination)
                safe_files.sync_directory(destination.parent)
            finally:
                source.handle.close()
                temporary.unlink(missing_ok=True)
        payload = json.dumps(
            {
                "schema": "animama-content-transition-originals/1",
                "source_item_id": entry.id if entry is not None else None,
                "source": entry.source.value if entry is not None else None,
                "source_mount_id": entry.source_mount_id if entry is not None else None,
                "source_revision": entry.revision_sha256 if entry is not None else None,
                "bindings": binding_facts,
                "files": inventory,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
        if manifest_path.exists() or safe_files.path_is_link(manifest_path):
            self._assert_regular_file(manifest_path)
            if manifest_path.read_bytes() != payload:
                raise ContentConflictError("content_transition_original_conflict")
            return
        temporary = manifest_path.with_name(f".manifest.{uuid.uuid4().hex}.tmp")
        try:
            with temporary.open("xb") as target:
                safe_files.set_mode(target.fileno(), 0o600)
                target.write(payload)
                target.flush()
                os.fsync(target.fileno())
            safe_files.replace(temporary, manifest_path)
            safe_files.sync_directory(manifest_path.parent)
        finally:
            temporary.unlink(missing_ok=True)

    def begin_mutation(self, *, operation_id: str, user_id: str, request_digest: str) -> str:
        """Install one request-owned journal after recovery and Local lock acquisition."""

        if self._mutation is not None or self.pending_mutations():
            raise ContentConflictError("content_mutation_recovery_required")
        self._mutation = create_journal(
            local_root=self._roots[ContentSource.LOCAL],
            operations_root=self._operations_root,
            operation_id=operation_id,
            user_id=user_id,
            request_digest=request_digest,
        )
        return self._mutation.identity.journal_id

    def pending_mutations(self) -> tuple[ContentMutationJournal, ...]:
        """Expose identities only; the database receipt decides a crash's outcome."""

        return tuple(
            journal.identity
            for journal in read_journals(
                local_root=self._roots[ContentSource.LOCAL], operations_root=self._operations_root
            )
        )

    def finalize_mutation(self, *, journal_id: str, commit: bool, expected_request_digest: str | None = None) -> None:
        """Finalize a catalog decision without discarding conflicting originals."""

        try:
            journals = read_journals(local_root=self._roots[ContentSource.LOCAL], operations_root=self._operations_root)
            journal = next((item for item in journals if item.identity.journal_id == journal_id), None)
            if journal is None:
                # Another lock holder may have recovered a DB-committed journal
                # before this request reacquires the lock for final cleanup.
                return
            if expected_request_digest is not None and journal.identity.request_digest != expected_request_digest:
                # A queued command may have recovered this attempt and reused
                # its owner/operation ID before delayed cleanup acquired the lock.
                # Release our handle without changing the newer command's bytes.
                return
            if journal.payload["status"] == "committed" and not commit:
                raise ContentConflictError("content_mutation_receipt_missing")
            journal.finish(commit=commit)
        except ContentPathError as exc:
            raise ContentConflictError("content_recovery_conflict") from exc
        finally:
            self._mutation = None

    def recover_mutations(self, *, committed_journal_ids: set[str]) -> None:
        """Resolve interrupted writes under the coordinator's Local source lock."""

        if self._mutation is not None:
            raise ContentConflictError("content_mutation_active")
        for journal in self.pending_mutations():
            self.finalize_mutation(journal_id=journal.journal_id, commit=journal.journal_id in committed_journal_ids)
        self.recover_package_installs()

    def _replace_local(self, staged: Path, destination: Path, *, require_new: bool = False) -> None:
        """Use recoverable promotion when an outer mutation owns the write."""

        if self._mutation is not None:
            self._mutation.replace(staged, destination, require_new=require_new)
        else:
            safe_files.replace(staged, destination)

    def _delete_local(self, destination: Path) -> None:
        """Keep the original registered bytes until catalog deletion is durable."""

        if self._mutation is not None:
            self._mutation.replace(None, destination)
        else:
            destination.unlink()

    def _promote_mutation_package(
        self, *, stage_root: Path, targets: list[_PackageTarget], require_new: bool = False
    ) -> None:
        """Promote validated package files individually so every replace remains atomic."""

        local_root = self._roots[ContentSource.LOCAL]
        for target in targets:
            if require_new and self.package_destination_exists(relative_locator=target["locator"]):
                raise ContentConflictError("package_destination_changed")
            old_files: set[Path] = set()
            new_files: list[tuple[Path, Path]] = []
            for relative in target["paths"]:
                destination = safe_path(local_root, relative)
                if target["directory"] and destination.exists():
                    old_files.update(self._mutation_tree_files(destination))
                elif destination.exists() or safe_files.path_is_link(destination):
                    fingerprint(destination)
                    old_files.add(destination)
            for relative in target["new_paths"]:
                staged = safe_path(stage_root, relative)
                if target["directory"]:
                    new_files.extend(
                        (file, local_root / file.relative_to(stage_root)) for file in self._mutation_tree_files(staged)
                    )
                else:
                    new_files.append((staged, local_root / relative))
            intended = {destination for _, destination in new_files}
            if require_new and target["directory"]:
                assert self._mutation is not None
                self._mutation.create_directory(safe_path(local_root, target["locator"]))
            for staged, destination in new_files:
                self._replace_local(staged, destination, require_new=require_new)
            for destination in sorted(old_files - intended):
                self._delete_local(destination)

    @staticmethod
    def _mutation_tree_files(root: Path) -> list[Path]:
        """Inspect every package file without allowing symlink or special-file traversal."""

        if not safe_files.is_directory(root.lstat()):
            raise ContentPathError("package entry is not a safe directory")
        files: list[Path] = []
        for child in sorted(root.iterdir()):
            if safe_files.is_directory(child.lstat()):
                files.extend(FilesystemContentStore._mutation_tree_files(child))
            else:
                fingerprint(child)
                files.append(child)
        return files

    @staticmethod
    def _remove_private_tree(path: Path) -> None:
        """Remove one exact internal tree without following links."""

        try:
            metadata = path.lstat()
        except FileNotFoundError:
            return
        if not safe_files.is_directory(metadata):
            path.unlink()
            return
        for child in path.iterdir():
            FilesystemContentStore._remove_private_tree(child)
        path.rmdir()

    def _package_paths(self, operation_id: str) -> tuple[Path, Path, str]:
        local_root = self._roots[ContentSource.LOCAL]
        return (
            local_root / f".animama-import-{operation_id}",
            local_root / f".animama-import-backup-{operation_id}",
            f"package-install-{operation_id}",
        )

    def _recover_package_payload(self, operation_id: str, payload: dict[str, Any]) -> None:
        """Recover legacy package receipts without overwriting later manual edits."""

        stage_root, backup_root, _ = self._package_paths(operation_id)
        targets = payload.get("targets")
        completed = payload.get("status") in {"completed", "rolled_back"}
        promoted = set(payload.get("promoted", [])) if isinstance(payload.get("promoted"), list) else set()
        active_index = payload.get("active_index")
        if not isinstance(targets, list):
            raise ContentConflictError("operation_receipt_unreadable")
        restore: list[tuple[Path, Path | None, Any]] = []
        if not completed:
            for index in reversed(range(len(targets))):
                raw = targets[index]
                if not isinstance(raw, dict):
                    raise ContentConflictError("operation_receipt_unreadable")
                paths = raw.get("paths")
                if not isinstance(paths, list):
                    raise ContentConflictError("operation_receipt_unreadable")
                if any(key in raw and not isinstance(raw[key], dict) for key in ("before", "after")):
                    raise ContentConflictError("operation_receipt_unreadable")
                target_was_touched = index in promoted or active_index == index
                for relative_value in reversed(paths):
                    if not isinstance(relative_value, str):
                        raise ContentConflictError("operation_receipt_unreadable")
                    destination = safe_path(self._roots[ContentSource.LOCAL], relative_value)
                    backup = safe_path(backup_root, relative_value)
                    current = self._package_signature(destination)
                    original = self._package_signature(backup)
                    if original is not None and relative_value in raw.get("before", {}):
                        if original != raw["before"][relative_value]:
                            raise ContentConflictError("content_recovery_conflict")
                    intended = raw.get("after", {}).get(relative_value)
                    has_hash = isinstance(raw.get("after"), dict) and relative_value in raw["after"]
                    if original is not None:
                        if current == original:
                            continue
                        if current is not None and (not has_hash or current != intended):
                            raise ContentConflictError("content_recovery_conflict")
                        restore.append((destination, backup, current))
                    elif target_was_touched and current is not None:
                        if not has_hash or current != intended:
                            raise ContentConflictError("content_recovery_conflict")
                        # A new journal records whether this path had an original.
                        # Missing an expected backup cannot authorize deleting it.
                        if raw.get("before", {}).get(relative_value) is not None:
                            raise ContentConflictError("content_recovery_conflict")
                        restore.append((destination, None, current))
            # Preflight all targets before any compensation. Legacy receipts
            # without hashes can restore absent destinations but cannot prove
            # that an existing destination is still the originally promoted one.
            for destination, backup_source, expected in restore:
                if self._package_signature(destination) != expected:
                    raise ContentConflictError("content_recovery_conflict")
                if backup_source is not None:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    temporary = destination.with_name(f".animama-restore-{uuid.uuid4().hex}")
                    try:
                        original = self._package_signature(backup_source)
                        if original is not None and "files" in original:
                            temporary.mkdir(mode=0o700)
                            for relative, state in original["files"].items():
                                target = safe_path(temporary, relative, create_parents=True)
                                copy_file(safe_path(backup_source, relative), target, state)
                        elif original is not None:
                            copy_file(backup_source, temporary, original)
                        else:
                            raise ContentConflictError("content_recovery_conflict")
                        if self._package_signature(destination) != expected:
                            raise ContentConflictError("content_recovery_conflict")
                        self._remove_private_tree(destination)
                        safe_files.replace(temporary, destination)
                    finally:
                        self._remove_private_tree(temporary)
                else:
                    self._remove_private_tree(destination)
                safe_files.sync_directory(destination.parent)
            payload["status"] = "rolled_back"
            self._receipt(f"package-install-{operation_id}", payload)
        self._remove_private_tree(stage_root)
        self._remove_private_tree(backup_root)

    @classmethod
    def _package_signature(cls, path: Path) -> dict[str, Any] | None:
        """Identify exact legacy package trees without following links."""

        try:
            metadata = path.lstat()
        except FileNotFoundError:
            return None
        if safe_files.is_directory(metadata):
            return {
                "files": {
                    child.relative_to(path).as_posix(): fingerprint(child) for child in cls._mutation_tree_files(path)
                }
            }
        return fingerprint(path)

    def recover_package_installs(self) -> None:
        """Compensate interrupted package promotions before authoritative scan."""

        if not self._operations_root.exists():
            return
        for journal in sorted(self._operations_root.glob("package-install-*.json")):
            operation_id = journal.stem.removeprefix("package-install-")
            if not _OPERATION_ID.fullmatch(operation_id):
                raise ContentConflictError("operation_receipt_unreadable")
            try:
                metadata = self._assert_regular_file(journal)
                if metadata.st_size > 8 * 1024 * 1024:
                    raise ContentConflictError("operation_receipt_unreadable")
                payload = json.loads(journal.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise ContentConflictError("operation_receipt_unreadable") from exc
            if isinstance(payload, dict):
                self._recover_package_payload(operation_id, payload)
            else:
                raise ContentConflictError("operation_receipt_unreadable")

    def install_package_atomic(
        self,
        *,
        entries: tuple[PreparedPackageEntry, ...],
        operation_id: str,
        require_new: bool = False,
    ) -> None:
        """Stage, scan, and compensate one complete package closure."""

        operation_id = self._validated_operation_id(operation_id)
        if not entries:
            raise ContentConflictError("package_entries_empty")
        locators = [entry.relative_locator for entry in entries]
        if len(set(locators)) != len(locators):
            raise ContentConflictError("package_destination_collision")
        stage_root, backup_root, receipt_id = self._package_paths(operation_id)
        journal_path = self._operations_root / f"{receipt_id}.json"
        if self._mutation is not None:
            stage_root = self._mutation.temporary("package-stage", directory=True)
            backup_root = self._mutation.temporary("package-backup", directory=True)
        request_digest = hashlib.sha256(
            json.dumps(
                [
                    {
                        "kind": entry.kind.value,
                        "locator": entry.relative_locator,
                        "files": [(file.relative_path, file.size_bytes) for file in entry.files],
                    }
                    for entry in entries
                ],
                separators=(",", ":"),
                sort_keys=True,
            ).encode()
        ).hexdigest()
        if self._mutation is None and journal_path.exists():
            try:
                prior = json.loads(journal_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError) as exc:
                raise ContentConflictError("operation_receipt_unreadable") from exc
            if not isinstance(prior, dict) or prior.get("request_digest") != request_digest:
                raise ContentConflictError("operation_id_reused")
            if prior.get("status") == "completed":
                self._recover_package_payload(operation_id, prior)
                return
            self._recover_package_payload(operation_id, prior)

        local_root = self._roots[ContentSource.LOCAL]
        local_root.mkdir(parents=True, exist_ok=True)
        stage_root.mkdir()
        backup_root.mkdir()
        targets: list[_PackageTarget] = []
        receipt: dict[str, Any] = {
            "operation_id": operation_id,
            "operation": "install_package",
            "request_digest": request_digest,
            "status": "staging",
            "targets": targets,
            "promoted": [],
            "started_at": datetime.now(UTC).isoformat(),
        }
        self._receipt(receipt_id, receipt)
        try:
            for entry in entries:
                definition = definition_for_kind(entry.kind)
                locator = _validate_relative_path(
                    entry.relative_locator,
                    allow_directory=PurePosixPath(entry.relative_locator).suffix == "",
                )
                kind_parts = PurePosixPath(definition.directory).parts
                if tuple(locator.parts[: len(kind_parts)]) != kind_parts:
                    raise ContentPathError("package destination does not match its content kind")
                descriptor_backed = locator.suffix == ""
                base = (
                    stage_root.joinpath(*locator.parts)
                    if descriptor_backed
                    else stage_root.joinpath(*locator.parent.parts)
                )
                base.mkdir(parents=True, exist_ok=True)
                target_paths: list[str] = []
                for member in entry.files:
                    relative = _validate_relative_path(member.relative_path)
                    target_relative = locator / relative if descriptor_backed else locator.parent / relative
                    target_path = stage_root.joinpath(*target_relative.parts)
                    if target_path.exists():
                        raise ContentConflictError("package_destination_collision")
                    target_path.parent.mkdir(parents=True, exist_ok=True)
                    written = 0
                    if sum(value is not None for value in (member.handle, member.source_path, member.open_source)) != 1:
                        raise ContentValidationError("package member requires exactly one byte source")
                    source_context: AbstractContextManager[BinaryIO]
                    if member.open_source is not None:
                        source_context = member.open_source()
                    elif member.source_path is not None:
                        if not stat.S_ISREG(member.source_path.lstat().st_mode):
                            raise ContentPathError("package member is not a regular private file")
                        source_context = os.fdopen(safe_files.open_no_follow(member.source_path, os.O_RDONLY), "rb")
                    else:
                        assert member.handle is not None
                        source_context = nullcontext(member.handle)
                    with source_context as source, target_path.open("xb") as handle:
                        source.seek(0)
                        while chunk := source.read(1024 * 1024):
                            written += len(chunk)
                            if written > member.size_bytes:
                                raise ContentValidationError("package member exceeds its verified size")
                            handle.write(chunk)
                        if written != member.size_bytes:
                            raise ContentValidationError("package member size changed during staging")
                        handle.flush()
                        os.fsync(handle.fileno())
                    target_paths.append(target_relative.as_posix())
                targets.append(
                    {
                        "locator": locator.as_posix(),
                        "directory": descriptor_backed,
                        "paths": (
                            [locator.as_posix()]
                            if descriptor_backed
                            else sorted(
                                set(
                                    target_paths
                                    + [
                                        locator.as_posix(),
                                        locator.with_suffix(".meta.json").as_posix(),
                                    ]
                                )
                            )
                        ),
                        "new_paths": [locator.as_posix()] if descriptor_backed else target_paths,
                    }
                )
                self._receipt(receipt_id, receipt)

            staging_store = FilesystemContentStore(
                included_root=self._roots[ContentSource.INCLUDED],
                local_root=stage_root,
                operations_root=self._operations_root / f".{receipt_id}-validation",
                included_sources=self._included_sources,
                restricted_sha256=self._restricted_sha256,
            )
            scanned = staging_store.scan(ContentSource.LOCAL)
            scanned_by_locator = {item.relative_locator: item for item in scanned}
            if set(scanned_by_locator) != set(locators):
                raise ContentValidationError("staged package does not match its declared entries")
            for entry in entries:
                scanned_entry = scanned_by_locator[entry.relative_locator]
                if scanned_entry.kind is not entry.kind or scanned_entry.status is not ContentStatus.VALID:
                    reason = scanned_entry.diagnostics[0].message if scanned_entry.diagnostics else "entry is invalid"
                    raise ContentValidationError(f"staged package entry is invalid: {reason}")

            if require_new and any(self.package_destination_exists(relative_locator=locator) for locator in locators):
                raise ContentConflictError("package_destination_changed")
            if self._mutation is not None:
                self._promote_mutation_package(stage_root=stage_root, targets=targets, require_new=require_new)
                self._remove_private_tree(stage_root)
                self._remove_private_tree(backup_root)
                return

            for target in targets:
                target["before"] = {
                    relative: self._package_signature(safe_path(local_root, relative)) for relative in target["paths"]
                }
                target["after"] = {
                    relative: self._package_signature(safe_path(stage_root, relative))
                    if relative in target["new_paths"]
                    else None
                    for relative in target["paths"]
                }
            receipt["status"] = "promoting"
            self._receipt(receipt_id, receipt)
            for index, target in enumerate(targets):
                receipt["active_index"] = index
                self._receipt(receipt_id, receipt)
                target_paths = target["paths"]
                new_paths = target["new_paths"]
                assert isinstance(target_paths, list)
                assert isinstance(new_paths, list)
                for relative_value in target_paths:
                    assert isinstance(relative_value, str)
                    relative = _validate_relative_path(
                        relative_value,
                        allow_directory=bool(target["directory"]),
                    )
                    destination = local_root.joinpath(*relative.parts)
                    backup = backup_root.joinpath(*relative.parts)
                    if destination.exists():
                        backup.parent.mkdir(parents=True, exist_ok=True)
                        safe_files.replace(destination, backup)
                for relative_value in new_paths:
                    assert isinstance(relative_value, str)
                    relative = _validate_relative_path(
                        relative_value,
                        allow_directory=bool(target["directory"]),
                    )
                    staged = stage_root.joinpath(*relative.parts)
                    destination = local_root.joinpath(*relative.parts)
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    safe_files.replace(staged, destination)
                cast_promoted = receipt["promoted"]
                assert isinstance(cast_promoted, list)
                cast_promoted.append(index)
                receipt["active_index"] = None
                self._receipt(receipt_id, receipt)
            receipt.update(
                status="promoted",
                active_index=None,
                promoted_at=datetime.now(UTC).isoformat(),
            )
            self._receipt(receipt_id, receipt)
        except Exception as exc:
            if self._mutation is not None:
                self._remove_private_tree(stage_root)
                self._remove_private_tree(backup_root)
                raise
            receipt.update(
                status="failed",
                failed_at=datetime.now(UTC).isoformat(),
                error=exc.__class__.__name__,
            )
            self._receipt(receipt_id, receipt)
            self._recover_package_payload(operation_id, receipt)
            raise

    def package_destination_exists(self, *, relative_locator: str) -> bool:
        """Include sidecars, empty directories, and case aliases in fresh-path admission."""
        locator = _validate_relative_path(
            relative_locator, allow_directory=PurePosixPath(relative_locator).suffix == ""
        )
        destination = safe_path(self._roots[ContentSource.LOCAL], locator.as_posix())
        names = {unicodedata.normalize("NFC", destination.name).casefold()}
        if locator.suffix:
            names.add(unicodedata.normalize("NFC", destination.with_suffix(".meta.json").name).casefold())
        if destination.exists() or safe_files.path_is_link(destination):
            return True
        if destination.parent.exists():
            return any(
                unicodedata.normalize("NFC", child.name).casefold() in names for child in destination.parent.iterdir()
            )
        return False

    def finalize_package_install(self, *, operation_id: str, commit: bool) -> None:
        """Keep promoted bytes only after their catalog transaction succeeds."""

        if self._mutation is not None:
            return
        operation_id = self._validated_operation_id(operation_id)
        _, _, receipt_id = self._package_paths(operation_id)
        journal = self._operations_root / f"{receipt_id}.json"
        try:
            payload = json.loads(journal.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError) as exc:
            raise ContentConflictError("operation_receipt_unreadable") from exc
        if not isinstance(payload, dict) or payload.get("status") != "promoted":
            raise ContentConflictError("package_install_not_promoted")
        if commit:
            payload.update(
                status="completed",
                completed_at=datetime.now(UTC).isoformat(),
            )
            self._receipt(receipt_id, payload)
        else:
            payload.update(
                status="failed",
                failed_at=datetime.now(UTC).isoformat(),
                error="catalog_reconciliation_failed",
            )
            self._receipt(receipt_id, payload)
        self._recover_package_payload(operation_id, payload)

    def _write_temporary_stream(
        self,
        destination: Path,
        operation_id: str,
        payload_stream: BinaryIO,
        *,
        expected_size_bytes: int,
        max_size_bytes: int,
    ) -> tuple[Path, str]:
        """Copy a seekable source into one adjacent bounded, fsynced file."""

        temporary = destination.with_name(f".{operation_id}-{destination.name}")
        if self._mutation is not None:
            temporary = self._mutation.temporary(destination.name)
        written = 0
        digest = hashlib.sha256()
        try:
            payload_stream.seek(0)
            with temporary.open("xb") as handle:
                while chunk := payload_stream.read(1024 * 1024):
                    written += len(chunk)
                    if written > expected_size_bytes or written > max_size_bytes:
                        raise ContentValidationError("content payload exceeds its declared or supported limit")
                    digest.update(chunk)
                    handle.write(chunk)
                if written != expected_size_bytes or written == 0:
                    raise ContentValidationError("content payload size does not match its declaration")
                handle.flush()
                os.fsync(handle.fileno())
            return temporary, digest.hexdigest()
        except Exception:
            temporary.unlink(missing_ok=True)
            raise

    def _write_temporary(self, destination: Path, operation_id: str, payload: bytes) -> Path:
        temporary, _ = self._write_temporary_stream(
            destination,
            operation_id,
            BytesIO(payload),
            expected_size_bytes=len(payload),
            max_size_bytes=len(payload),
        )
        return temporary

    def _local_destination(self, relative_locator: str, *, directory: bool = False) -> Path:
        relative = _validate_relative_path(relative_locator, allow_directory=directory)
        root = self._roots[ContentSource.LOCAL]
        destination = root.joinpath(*relative.parts)
        if not destination.resolve(strict=False).is_relative_to(root):
            raise ContentPathError("Local destination escaped its configured root")
        cursor = root
        for part in relative.parts[:-1] if not directory else relative.parts:
            cursor /= part
            try:
                metadata = cursor.lstat()
            except FileNotFoundError:
                cursor.mkdir()
                metadata = cursor.lstat()
            except OSError as exc:
                raise ContentPathError("Local destination could not be inspected") from exc
            if not safe_files.is_directory(metadata):
                raise ContentPathError("Local destination contains an unsafe directory")
        return destination

    @staticmethod
    def _safe_entry_destination(entry_root: Path, relative: PurePosixPath) -> Path:
        """Create nested companion directories without following host symlinks."""

        cursor = entry_root
        for part in relative.parts[:-1]:
            cursor /= part
            try:
                metadata = cursor.lstat()
            except FileNotFoundError:
                cursor.mkdir()
                metadata = cursor.lstat()
            except OSError as exc:
                raise ContentPathError("companion directory could not be inspected") from exc
            if not safe_files.is_directory(metadata):
                raise ContentPathError("companion path contains an unsafe directory")
        return cursor / relative.name

    def save_standalone(
        self,
        *,
        kind: ContentKind,
        relative_locator: str,
        payload: bytes,
        metadata_sidecar: bytes | None = None,
        operation_id: str | None = None,
    ) -> str:
        """Compatibility wrapper for callers that already hold bounded bytes."""

        return self.save_standalone_stream(
            kind=kind,
            relative_locator=relative_locator,
            payload_stream=BytesIO(payload),
            payload_size_bytes=len(payload),
            metadata_sidecar=metadata_sidecar,
            operation_id=operation_id,
        )

    def save_standalone_stream(
        self,
        *,
        kind: ContentKind,
        relative_locator: str,
        payload_stream: BinaryIO,
        payload_size_bytes: int,
        metadata_sidecar: bytes | None = None,
        operation_id: str | None = None,
    ) -> str:
        """Validate a bounded adjacent stream, then atomically replace the Local source."""

        definition = definition_for_kind(kind)
        relative = _validate_relative_path(relative_locator)
        if (
            tuple(relative.parts[: len(PurePosixPath(definition.directory).parts)])
            != PurePosixPath(definition.directory).parts
        ):
            raise ContentPathError("file locator does not belong to the requested content kind")
        if payload_size_bytes <= 0 or payload_size_bytes > definition.max_file_bytes:
            raise ContentValidationError("content payload is empty or exceeds the supported limit")
        if metadata_sidecar is not None and (not metadata_sidecar or len(metadata_sidecar) > definition.max_file_bytes):
            raise ContentValidationError("metadata sidecar is empty or exceeds the supported limit")
        destination = self._local_destination(relative_locator)
        operation_id = self._validated_operation_id(operation_id)
        temporary: Path | None
        temporary, payload_sha256 = self._write_temporary_stream(
            destination,
            operation_id,
            payload_stream,
            expected_size_bytes=payload_size_bytes,
            max_size_bytes=definition.max_file_bytes,
        )
        sidecar_temporary: Path | None = None
        sidecar_destination: Path | None = None
        try:
            diagnostics = validate_standalone_file(definition, temporary)
            if diagnostics:
                raise ContentValidationError(diagnostics[0].message)
            if metadata_sidecar is not None:
                sidecar_destination = destination.with_suffix(".meta.json")
                sidecar_temporary = self._write_temporary(sidecar_destination, operation_id, metadata_sidecar)
                _, sidecar_diagnostics = validate_metadata_sidecar(
                    sidecar_temporary,
                    kind=kind,
                    primary_path=destination,
                )
                if sidecar_diagnostics:
                    raise ContentValidationError(sidecar_diagnostics[0].message)
        except Exception:
            temporary.unlink(missing_ok=True)
            if sidecar_temporary is not None:
                sidecar_temporary.unlink(missing_ok=True)
            raise
        request_digest = hashlib.sha256(
            json.dumps(
                {
                    "kind": kind.value,
                    "relative_locator": relative_locator,
                    "payload_sha256": payload_sha256,
                    "metadata_sha256": hashlib.sha256(metadata_sidecar).hexdigest()
                    if metadata_sidecar is not None
                    else None,
                },
                separators=(",", ":"),
                sort_keys=True,
            ).encode()
        ).hexdigest()
        try:
            completed_retry = self._completed_receipt(operation_id, request_digest)
        except Exception:
            temporary.unlink(missing_ok=True)
            if sidecar_temporary is not None:
                sidecar_temporary.unlink(missing_ok=True)
            raise
        if completed_retry:
            temporary.unlink(missing_ok=True)
            if sidecar_temporary is not None:
                sidecar_temporary.unlink(missing_ok=True)
            return operation_id
        receipt: dict[str, Any] = {
            "operation_id": operation_id,
            "operation": "save_standalone",
            "kind": kind.value,
            "relative_locator": relative_locator,
            "request_digest": request_digest,
            "status": "started",
            "started_at": datetime.now(UTC).isoformat(),
        }
        try:
            self._receipt(operation_id, receipt)
        except Exception:
            temporary.unlink(missing_ok=True)
            if sidecar_temporary is not None:
                sidecar_temporary.unlink(missing_ok=True)
            raise
        try:
            if sidecar_temporary is not None and sidecar_destination is not None:
                self._replace_local(sidecar_temporary, sidecar_destination)
                sidecar_temporary = None
            self._replace_local(temporary, destination)
            temporary = None
            receipt.update(status="completed", completed_at=datetime.now(UTC).isoformat())
            self._receipt(operation_id, receipt)
            return operation_id
        except Exception as exc:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
            if sidecar_temporary is not None:
                sidecar_temporary.unlink(missing_ok=True)
            receipt.update(
                status="failed",
                failed_at=datetime.now(UTC).isoformat(),
                error=exc.__class__.__name__,
            )
            self._receipt(operation_id, receipt)
            raise

    def delete_entry(self, *, entry: CatalogContentEntry) -> None:
        """Delete the catalog-frozen files for one Local entry without recursion."""

        if entry.source is not ContentSource.LOCAL:
            raise ContentPathError("Included content is read-only")
        local_root = self._roots[ContentSource.LOCAL]
        locator = PurePosixPath(entry.relative_locator)
        descriptor_root = locator if locator.suffix == "" else locator.parent
        registered_paths = sorted(
            {file.relative_path for file in entry.files},
            key=lambda value: len(PurePosixPath(value).parts),
            reverse=True,
        )
        registrations = {file.relative_path: file for file in entry.files}
        destinations: list[Path] = []
        for relative_path in registered_paths:
            relative = _validate_relative_path(relative_path)
            if locator.suffix:
                allowed = relative == locator or relative == locator.with_suffix(".meta.json")
            else:
                allowed = relative == descriptor_root or descriptor_root in relative.parents
            if not allowed:
                raise ContentPathError("registered content escaped its catalog entry")
            path = self._safe_path(ContentSource.LOCAL, relative.as_posix())
            self._assert_regular_file(path)
            expected = registrations[relative_path]
            current = fingerprint(path)
            if current is None or (current["sha256"], current["size"]) != (expected.sha256, expected.size_bytes):
                raise ContentIntegrityError("registered content changed before deletion")
            destinations.append(path)
        for destination in destinations:
            self._delete_local(destination)

        cursor = local_root.joinpath(*descriptor_root.parts)
        # Visit only ancestors of the catalog-frozen files. Walking the entry
        # tree would grant authority over unrelated empty directories or links.
        nested_parents: set[Path] = set()
        for destination in destinations:
            for parent in destination.parents:
                if parent == cursor or not parent.is_relative_to(cursor):
                    break
                nested_parents.add(parent)
        for directory in sorted(nested_parents, key=lambda path: len(path.parts), reverse=True):
            checked = self._safe_path(ContentSource.LOCAL, directory.relative_to(local_root).as_posix())
            try:
                checked.rmdir()
            except OSError:
                # A remaining unregistered file, directory, or link is kept.
                continue

        if locator.suffix:
            cursor = cursor.parent
        while cursor != local_root and cursor.is_relative_to(local_root):
            try:
                cursor.rmdir()
            except OSError:
                break
            cursor = cursor.parent

    def save_descriptor_entry(
        self,
        *,
        kind: ContentKind,
        relative_locator: str,
        descriptor: bytes,
        companion_files: Mapping[str, bytes],
        operation_id: str | None = None,
        require_new: bool = False,
    ) -> str:
        """Compatibility wrapper for callers that already hold bounded bytes."""

        return self.save_descriptor_entry_streams(
            kind=kind,
            relative_locator=relative_locator,
            descriptor=descriptor,
            companion_files={name: (BytesIO(payload), len(payload)) for name, payload in companion_files.items()},
            operation_id=operation_id,
            require_new=require_new,
        )

    def save_descriptor_entry_streams(
        self,
        *,
        kind: ContentKind,
        relative_locator: str,
        descriptor: bytes,
        companion_files: Mapping[str, tuple[BinaryIO, int]],
        operation_id: str | None = None,
        require_new: bool = False,
    ) -> str:
        """Stage streamed files, replace companions, and publish the descriptor last."""

        definition = definition_for_kind(kind)
        if definition.descriptor_suffix is None:
            raise ContentValidationError("this content kind does not use a folder descriptor")
        relative = _validate_relative_path(relative_locator, allow_directory=True)
        kind_parts = PurePosixPath(definition.directory).parts
        if tuple(relative.parts[: len(kind_parts)]) != kind_parts or len(relative.parts) <= len(kind_parts):
            raise ContentPathError("descriptor entry must be a named folder beneath its registered type root")
        if not descriptor or len(descriptor) > definition.max_file_bytes:
            raise ContentValidationError("descriptor is empty or exceeds the supported limit")
        if len(companion_files) + 1 > definition.max_entry_files:
            raise ContentValidationError("descriptor entry contains too many files")
        if len(descriptor) + sum(size for _, size in companion_files.values()) > definition.max_entry_bytes:
            raise ContentValidationError("descriptor entry exceeds the supported byte limit")

        entry_root = self._local_destination(relative_locator, directory=True)
        if require_new and any(entry_root.iterdir()):
            # A rolled-back attempt may leave an empty folder. Existing files,
            # including manual edits and hidden entries, must never be replaced
            # by a conversion claiming to create a fresh editable item.
            raise ContentConflictError("content_destination_exists")
        descriptor_name = descriptor_filename(definition, entry_root.name)
        descriptor_destination = entry_root / descriptor_name
        operation_marker = entry_root / ".animama-operation"
        operation_id = self._validated_operation_id(operation_id)
        receipt: dict[str, Any] = {
            "operation_id": operation_id,
            "operation": "save_descriptor_entry",
            "kind": kind.value,
            "relative_locator": relative_locator,
            "status": "started",
            "started_at": datetime.now(UTC).isoformat(),
        }
        staged: list[tuple[Path, Path]] = []
        existing_before, _ = self._walk_definition(entry_root)
        owns_marker = False
        commit_started = False
        receipt_written = False
        try:
            if self._mutation is None:
                try:
                    with operation_marker.open("x", encoding="utf-8") as handle:
                        handle.write(json.dumps({"operation_id": operation_id}) + "\n")
                        handle.flush()
                        os.fsync(handle.fileno())
                    owns_marker = True
                except FileExistsError as exc:
                    raise ContentValidationError("descriptor entry already has an active or interrupted Save") from exc
            elif operation_marker.exists() or safe_files.path_is_link(operation_marker):
                raise ContentConflictError("content_mutation_recovery_required")
            companion_digests: dict[str, str] = {}
            for name, (payload_stream, payload_size_bytes) in companion_files.items():
                companion_relative = _validate_relative_path(name)
                companion_parent_name = companion_relative.parent.name
                is_nested_descriptor = bool(companion_parent_name) and companion_relative.name == descriptor_filename(
                    definition,
                    companion_parent_name,
                )
                if companion_relative.name == descriptor_name or is_nested_descriptor:
                    raise ContentValidationError("descriptor must be supplied through the descriptor parameter")
                if Path(companion_relative.name).suffix.lower() not in _COMPANION_EXTENSIONS:
                    raise ContentValidationError("companion file extension is not supported")
                if payload_size_bytes <= 0 or payload_size_bytes > definition.max_file_bytes:
                    raise ContentValidationError("companion file is empty or exceeds the supported limit")
                destination = self._safe_entry_destination(entry_root, companion_relative)
                temporary, companion_sha256 = self._write_temporary_stream(
                    destination,
                    operation_id,
                    payload_stream,
                    expected_size_bytes=payload_size_bytes,
                    max_size_bytes=definition.max_file_bytes,
                )
                companion_diagnostics = (
                    validate_standalone_file(definition, temporary)
                    if kind is ContentKind.APPEARANCE
                    else _validate_companion_file(temporary)
                )
                if companion_diagnostics:
                    temporary.unlink(missing_ok=True)
                    raise ContentValidationError(companion_diagnostics[0].message)
                staged.append((temporary, destination))
                companion_digests[name] = companion_sha256

            staged_descriptor = self._write_temporary(descriptor_destination, operation_id, descriptor)
            value, diagnostics = validate_descriptor(staged_descriptor, kind=kind)
            if diagnostics or value is None:
                raise ContentValidationError(diagnostics[0].message if diagnostics else "descriptor is invalid")
            handler = handler_for_kind(kind)
            parsed = handler.parse_document(value, fallback_path=entry_root, descriptor_backed=True)
            companion_diagnostics = handler.validate_companion_files(
                parsed.document,
                {destination.relative_to(entry_root).as_posix(): temporary for temporary, destination in staged},
            )
            if companion_diagnostics:
                raise ContentValidationError(companion_diagnostics[0].message)
            available = set(companion_files)
            existing_files, _ = self._walk_definition(entry_root)
            available.update(path.relative_to(entry_root).as_posix() for path in existing_files)
            for declared in descriptor_file_paths(value):
                _validate_relative_path(declared)
                if declared not in available:
                    raise ContentValidationError(f"descriptor file is missing: {declared}")

            request_digest = hashlib.sha256(
                json.dumps(
                    {
                        "kind": kind.value,
                        "relative_locator": relative_locator,
                        "descriptor_sha256": hashlib.sha256(descriptor).hexdigest(),
                        "companions": dict(sorted(companion_digests.items())),
                    },
                    separators=(",", ":"),
                    sort_keys=True,
                ).encode()
            ).hexdigest()
            if self._completed_receipt(operation_id, request_digest):
                for temporary, _ in staged:
                    temporary.unlink(missing_ok=True)
                staged_descriptor.unlink(missing_ok=True)
                if owns_marker:
                    operation_marker.unlink(missing_ok=True)
                owns_marker = False
                return operation_id
            receipt["request_digest"] = request_digest
            self._receipt(operation_id, receipt)
            receipt_written = True

            commit_started = True
            for temporary, destination in staged:
                self._replace_local(temporary, destination)
            self._replace_local(staged_descriptor, descriptor_destination)
            intended = {destination for _, destination in staged}
            intended.add(descriptor_destination)
            for stale in existing_before:
                if stale not in intended:
                    self._assert_regular_file(stale)
                    self._delete_local(stale)
            # Prune only empty directories inside this entry. Never recurse or
            # follow links while reconciling a replaced descriptor payload.
            for directory in sorted(
                {path.parent for path in existing_before if path.parent != entry_root},
                key=lambda path: len(path.parts),
                reverse=True,
            ):
                try:
                    directory.rmdir()
                except OSError:
                    pass
            if owns_marker:
                operation_marker.unlink()
            owns_marker = False
            receipt.update(status="completed", completed_at=datetime.now(UTC).isoformat())
            self._receipt(operation_id, receipt)
            return operation_id
        except Exception as exc:
            for temporary, _ in staged:
                temporary.unlink(missing_ok=True)
            staged_descriptor_path = descriptor_destination.with_name(f".{operation_id}-{descriptor_destination.name}")
            staged_descriptor_path.unlink(missing_ok=True)
            if owns_marker and not commit_started:
                operation_marker.unlink(missing_ok=True)
                owns_marker = False
            if receipt_written:
                receipt.update(
                    status="failed",
                    failed_at=datetime.now(UTC).isoformat(),
                    error=exc.__class__.__name__,
                    requires_reconciliation=owns_marker,
                )
                self._receipt(operation_id, receipt)
            raise


__all__ = ["FilesystemContentStore"]
