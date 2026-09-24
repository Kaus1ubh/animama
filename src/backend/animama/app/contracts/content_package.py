"""Strict, authority-free metadata for portable Animama version-three archives."""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Mapping, Sequence
from pathlib import PurePosixPath
from typing import Annotated, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictStr, field_validator, model_validator

from animama.app.contracts.portable_anima import PortableAnima
from animama.domain.content_catalog import ContentKind

PACKAGE_SCHEMA: Literal["animama-content-package/3"] = "animama-content-package/3"
MAX_PACKAGE_FILES = 2_048
MAX_PACKAGE_BYTES = 4 * 1024 * 1024 * 1024
MAX_MANIFEST_BYTES = 4 * 1024 * 1024
MAX_COMPRESSION_RATIO = 200
MAX_PACKAGE_METADATA_BYTES = 16 * 1024 * 1024
PACKAGE_ROOT_KINDS = frozenset(
    {
        ContentKind.AVATAR,
        ContentKind.GESTURE,
        ContentKind.REACTION,
        ContentKind.IDLE_STYLE,
        ContentKind.POSE,
        ContentKind.PARTICLE_EFFECT,
        ContentKind.AVATAR_EFFECT,
        ContentKind.SCENE_EFFECT,
        ContentKind.SOUND_EFFECT,
    }
)
PACKAGE_ENTRY_KINDS = PACKAGE_ROOT_KINDS | {ContentKind.APPEARANCE}
PortableId = Annotated[StrictStr, Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]*$")]
Sha256 = Annotated[StrictStr, Field(pattern=r"^[0-9a-f]{64}$")]
LicenseText = Annotated[StrictStr, Field(min_length=1, max_length=2_048)]
LicenseList = Annotated[list[Annotated[StrictStr, Field(max_length=512)]], Field(max_length=64)]
LicenseValue = LicenseText | StrictBool | LicenseList


def safe_package_path(value: str) -> PurePosixPath:
    """Reject aliases and platform-dependent paths before accessing any bytes."""
    parts = value.split("/")
    if (
        not value
        or len(value) > 1_024
        or "\\" in value
        or ":" in value
        or any(ord(character) < 32 for character in value)
        or any(part in {"", ".", ".."} or part.endswith((".", " ")) for part in parts)
        or any(len(part.encode("utf-8")) > 255 for part in parts)
        or any(re.fullmatch(r"(?i)(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?", part) for part in parts)
    ):
        raise ValueError("package_path_invalid")
    return PurePosixPath(value)


class _PackageModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True, populate_by_name=True)


class PackageLicense(_PackageModel):
    """Attribution facts retained as metadata, never interpreted as permission."""

    author: LicenseValue | None = None
    creator: LicenseValue | None = None
    license: LicenseValue | None = None
    license_name: LicenseValue | None = None
    license_url: LicenseValue | None = None
    redistribution: LicenseValue | None = None
    redistribution_review: LicenseValue | None = None
    source_url: LicenseValue | None = None


class PackageFile(_PackageModel):
    """Exact declared bytes and their typed role within one entry."""

    archive_path: StrictStr
    relative_path: StrictStr
    role: Annotated[StrictStr, Field(min_length=1, max_length=64)]
    ordinal: Annotated[int, Field(ge=1, le=MAX_PACKAGE_FILES)]
    media_type: Annotated[StrictStr, Field(min_length=1, max_length=128)]
    size_bytes: Annotated[int, Field(gt=0, le=MAX_PACKAGE_BYTES)]
    sha256: Sha256

    @field_validator("archive_path", "relative_path")
    @classmethod
    def safe_path(cls, value: str) -> str:
        safe_package_path(value)
        return value


class PackageDependency(_PackageModel):
    ref: PortableId
    content_type: ContentKind = Field(strict=False)

    @field_validator("content_type")
    @classmethod
    def supported_kind(cls, value: ContentKind) -> ContentKind:
        if value not in PACKAGE_ROOT_KINDS:
            raise ValueError("package_dependency_kind_invalid")
        return value


def portable_revision(files: Sequence[PackageFile | Mapping[str, object]]) -> str:
    """Hash ordered declarations using the version-two canonical byte convention."""
    values = [value.model_dump(mode="json") if isinstance(value, PackageFile) else value for value in files]
    return hashlib.sha256(json.dumps(values, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


class PackageEntry(_PackageModel):
    package_entry_id: PortableId
    kind: ContentKind = Field(strict=False)
    logical_key: PortableId
    display_name: Annotated[StrictStr, Field(min_length=1, max_length=120)]
    portable_revision_sha256: Sha256
    dependencies: Annotated[list[PackageDependency], Field(max_length=MAX_PACKAGE_FILES)]
    files: Annotated[list[PackageFile], Field(min_length=1, max_length=MAX_PACKAGE_FILES)]
    license: PackageLicense | None = None

    @model_validator(mode="after")
    def entry_contract(self) -> Self:
        if self.kind not in PACKAGE_ENTRY_KINDS:
            raise ValueError("package_kind_invalid")
        if self.logical_key != self.package_entry_id:
            raise ValueError("package_identity_not_portable")
        if [member.ordinal for member in self.files] != list(range(1, len(self.files) + 1)):
            raise ValueError("package_ordinal_invalid")
        if len({unicodedata.normalize("NFC", member.relative_path).casefold() for member in self.files}) != len(
            self.files
        ):
            raise ValueError("package_member_duplicate")
        if len({dependency.ref for dependency in self.dependencies}) != len(self.dependencies):
            raise ValueError("package_dependency_duplicate")
        if self.kind is ContentKind.APPEARANCE and self.dependencies:
            raise ValueError("package_appearance_dependency_invalid")
        if portable_revision(self.files) != self.portable_revision_sha256:
            raise ValueError("package_portable_revision_mismatch")
        return self


class PackageAvatarPortrait(_PackageModel):
    avatar_entry_id: PortableId
    appearance_entry_id: PortableId


class PackageManifest(_PackageModel):
    """One complete content selection or one portable Anima, with no ambient roots."""

    schema_: Literal["animama-content-package/3"] = Field(alias="schema")
    kind: Literal["content", "anima"]
    root_entry_ids: Annotated[list[PortableId], Field(max_length=MAX_PACKAGE_FILES)] = Field(default_factory=list)
    anima: PortableAnima | None = None
    entries: Annotated[list[PackageEntry], Field(min_length=1, max_length=MAX_PACKAGE_FILES)]
    avatar_portraits: Annotated[list[PackageAvatarPortrait], Field(max_length=MAX_PACKAGE_FILES)]
    capabilities: Annotated[list[Annotated[StrictStr, Field(min_length=1, max_length=128)]], Field(max_length=128)]

    @model_validator(mode="after")
    def complete_graph(self) -> Self:
        """Require exact typed closure without recursion over hostile graph depth."""
        entries = {entry.package_entry_id: entry for entry in self.entries}
        if len(entries) != len(self.entries):
            raise ValueError("package_entry_duplicate")
        if len(set(self.root_entry_ids)) != len(self.root_entry_ids):
            raise ValueError("package_root_duplicate")
        if len(set(self.capabilities)) != len(self.capabilities):
            raise ValueError("package_capability_duplicate")
        if self.kind == "content":
            if not self.root_entry_ids or self.anima is not None:
                raise ValueError("package_roots_invalid")
            roots = list(self.root_entry_ids)
            if any(root not in entries or entries[root].kind not in PACKAGE_ROOT_KINDS for root in roots):
                raise ValueError("package_root_kind_invalid")
        else:
            if self.root_entry_ids or self.anima is None:
                raise ValueError("package_anima_invalid")
            references = self.anima.entry_references()
            if any(ref not in entries or entries[ref].kind is not kind for ref, kind in references):
                raise ValueError("package_anima_reference_invalid")
            roots = [ref for ref, _ in references]
        edges: dict[str, list[str]] = {entry.package_entry_id: [] for entry in self.entries}
        for entry in self.entries:
            for dependency in entry.dependencies:
                if dependency.ref not in entries or entries[dependency.ref].kind is not dependency.content_type:
                    raise ValueError("package_dependency_invalid")
                edges[entry.package_entry_id].append(dependency.ref)
        associated: set[str] = set()
        for association in self.avatar_portraits:
            avatar, appearance = association.avatar_entry_id, association.appearance_entry_id
            if (
                avatar not in entries
                or entries[avatar].kind is not ContentKind.AVATAR
                or appearance not in entries
                or entries[appearance].kind is not ContentKind.APPEARANCE
                or avatar in associated
            ):
                raise ValueError("package_avatar_portrait_invalid")
            associated.add(avatar)
            edges[avatar].append(appearance)
        visited: set[str] = set()
        visiting: set[str] = set()
        for root in roots:
            pending = [(root, False)]
            while pending:
                entry_id, leaving = pending.pop()
                if leaving:
                    visiting.remove(entry_id)
                    visited.add(entry_id)
                elif entry_id in visiting:
                    raise ValueError("package_dependency_cycle")
                elif entry_id not in visited:
                    visiting.add(entry_id)
                    pending.append((entry_id, True))
                    pending.extend((child, False) for child in reversed(edges[entry_id]))
        if visited != set(entries):
            raise ValueError("package_disconnected_entries")
        files = [member for entry in self.entries for member in entry.files]
        names = [unicodedata.normalize("NFC", member.archive_path).casefold() for member in files]
        if "package.json" in names or len(set(names)) != len(names):
            raise ValueError("package_member_duplicate")
        if len(files) > MAX_PACKAGE_FILES or sum(member.size_bytes for member in files) > MAX_PACKAGE_BYTES:
            raise ValueError("package_size_invalid")
        return self


__all__ = [
    "MAX_COMPRESSION_RATIO",
    "MAX_MANIFEST_BYTES",
    "MAX_PACKAGE_BYTES",
    "MAX_PACKAGE_FILES",
    "MAX_PACKAGE_METADATA_BYTES",
    "PACKAGE_SCHEMA",
    "PackageAvatarPortrait",
    "PackageDependency",
    "PackageEntry",
    "PackageFile",
    "PackageLicense",
    "PackageManifest",
    "portable_revision",
    "safe_package_path",
]
