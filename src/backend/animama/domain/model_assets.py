"""Pinned downloadable asset descriptors, catalog validation and install state.

A model-asset catalog is packaged release data: every URL, size and digest is
fixed when the release is built. Requests name assets by ID only, so nothing
outside the catalog is ever fetched.

An asset is either one file or a multi-file *set* (for example a speech model
with its notices) that is verified file by file and activated as a whole.
"""

from __future__ import annotations

import re
from collections.abc import Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Final, Literal
from urllib.parse import urlsplit

ASSET_CATALOG_SCHEMA: Final = "animama-asset-catalog/1"
# The release host serving pinned assets. A catalog may not name any other host.
PRODUCTION_ASSET_HOSTS: Final = frozenset({"downloads.animama.ai"})

ASSET_ID_PATTERN: Final = re.compile(r"[a-z0-9][a-z0-9._-]{0,127}")
# A set file is one flat, visible name inside the set's version directory.
SET_FILE_PATH_PATTERN: Final = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,150}")
_SHA256_PATTERN: Final = re.compile(r"[0-9a-f]{64}")
_MEDIA_TYPE_PATTERN: Final = re.compile(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]+)?")
_LICENSE_REF_PATTERN: Final = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/+-]{0,199}")
# Free space kept beyond an asset's remaining bytes so an install never fills the data root.
INSTALL_HEADROOM_BYTES: Final = 64 * 1024 * 1024

AssetStatus = Literal["not_installed", "downloading", "installed", "failed"]
# Stable failure codes reported to clients; they never carry host paths or URLs.
AssetFailureReason = Literal[
    "asset_download_failed",
    "asset_host_not_allowed",
    "asset_size_invalid",
    "asset_hash_invalid",
    "asset_store_failed",
    "asset_insufficient_space",
]

_SINGLE_FILE_FIELDS: Final = frozenset({"id", "url", "size", "sha256", "media_type", "license_ref"})
_SET_FIELDS: Final = frozenset({"id", "manifest_sha256", "files", "license_ref"})
_SET_FILE_FIELDS: Final = frozenset({"path", "url", "size", "sha256"})
_OPTIONAL_FIELDS: Final = frozenset({"requires"})


def is_valid_asset_id(value: object) -> bool:
    """Accept only IDs that are also safe single directory names."""

    return isinstance(value, str) and ASSET_ID_PATTERN.fullmatch(value) is not None


def set_file_media_type(path: str) -> str:
    """Media type served for a set file, matching the desktop pack producer."""

    suffix = path.rsplit(".", 1)[-1].lower() if "." in path else ""
    if suffix == "json":
        return "application/json"
    if suffix in {"md", "txt"}:
        return "text/plain; charset=utf-8"
    return "application/octet-stream"


@dataclass(frozen=True, slots=True)
class AssetFile:
    """One pinned, immutable file of an asset.

    ``path`` is the file's name inside an installed set. A single-file asset's
    one file is stored under its digest, so its ``path`` is its ``sha256``.
    """

    path: str
    url: str
    size: int
    sha256: str
    media_type: str

    def __post_init__(self) -> None:
        if not isinstance(self.sha256, str) or not _SHA256_PATTERN.fullmatch(self.sha256):
            raise ValueError("Asset file digest must be a lowercase SHA-256 hex digest")
        if not isinstance(self.path, str) or not SET_FILE_PATH_PATTERN.fullmatch(self.path):
            raise ValueError(f"Asset file path {self.path!r} must be a single safe name")
        parts = urlsplit(self.url) if isinstance(self.url, str) else None
        if (
            parts is None
            or parts.scheme != "https"
            or not parts.hostname
            or parts.username
            or parts.password
            or parts.query
            or parts.fragment
            or parts.port not in (None, 443)
        ):
            raise ValueError(f"Asset file {self.path} URL must be a plain https URL on the default port")
        if type(self.size) is not int or self.size <= 0:
            raise ValueError(f"Asset file {self.path} size must be a positive integer")
        if not isinstance(self.media_type, str) or not _MEDIA_TYPE_PATTERN.fullmatch(self.media_type):
            raise ValueError(f"Asset file {self.path} media type must be a safe MIME value")

    @property
    def host(self) -> str:
        return urlsplit(self.url).hostname or ""


@dataclass(frozen=True, slots=True)
class AssetDescriptor:
    """One pinned downloadable asset: a single file, or a set of files.

    A set carries the SHA-256 of its tracked manifest's bytes as
    ``manifest_sha256``; that digest names its installed version directory.
    ``requires`` lists assets that must be installed before this one.
    """

    id: str
    files: tuple[AssetFile, ...]
    license_ref: str
    manifest_sha256: str | None = None
    requires: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not is_valid_asset_id(self.id):
            raise ValueError(f"Asset ID {self.id!r} must match {ASSET_ID_PATTERN.pattern}")
        files = tuple(self.files) if isinstance(self.files, tuple | list) else ()
        if not files or not all(isinstance(file, AssetFile) for file in files):
            raise ValueError(f"Asset {self.id} must list its files")
        object.__setattr__(self, "files", files)
        if self.manifest_sha256 is None:
            if len(files) != 1 or files[0].path != files[0].sha256:
                raise ValueError(f"Asset {self.id} without a manifest digest must be exactly one file")
        else:
            if not isinstance(self.manifest_sha256, str) or not _SHA256_PATTERN.fullmatch(self.manifest_sha256):
                raise ValueError(f"Asset {self.id} manifest digest must be a lowercase SHA-256 hex digest")
            if len({file.path for file in files}) != len(files):
                raise ValueError(f"Asset {self.id} repeats a file path")
        if not isinstance(self.license_ref, str) or not _LICENSE_REF_PATTERN.fullmatch(self.license_ref):
            raise ValueError(f"Asset {self.id} needs a license reference")
        requires = tuple(self.requires) if isinstance(self.requires, tuple | list) else None
        if (
            requires is None
            or not all(is_valid_asset_id(required) for required in requires)
            or len(set(requires)) != len(requires)
            or self.id in requires
        ):
            raise ValueError(f"Asset {self.id} requirements must be distinct other asset IDs")
        object.__setattr__(self, "requires", requires)

    @classmethod
    def single_file(
        cls,
        *,
        id: str,  # noqa: A002 - mirrors the catalog field name
        url: str,
        size: int,
        sha256: str,
        media_type: str,
        license_ref: str,
        requires: tuple[str, ...] = (),
    ) -> AssetDescriptor:
        """Describe a single-file asset from its catalog fields."""

        return cls(
            id=id,
            files=(AssetFile(path=sha256, url=url, size=size, sha256=sha256, media_type=media_type),),
            license_ref=license_ref,
            requires=requires,
        )

    @property
    def is_set(self) -> bool:
        return self.manifest_sha256 is not None

    @property
    def version(self) -> str:
        """The installed version name: the manifest digest of a set, else the file digest."""

        return self.manifest_sha256 if self.manifest_sha256 is not None else self.files[0].sha256

    @property
    def size(self) -> int:
        """Total bytes of every file."""

        return sum(file.size for file in self.files)

    @property
    def media_type(self) -> str | None:
        """A single file's media type; a set's files each carry their own."""

        return None if self.is_set else self.files[0].media_type

    @property
    def required_free_bytes(self) -> int:
        """Free space needed to start a fresh install: every file plus headroom."""

        return self.free_bytes_needed(0)

    def free_bytes_needed(self, staged_bytes: int) -> int:
        """Free space needed to resume with ``staged_bytes`` already staged."""

        return max(0, self.size - staged_bytes) + INSTALL_HEADROOM_BYTES


@dataclass(frozen=True, slots=True)
class AssetCatalog:
    """A validated set of descriptors with unique IDs and resolvable requirements."""

    assets: tuple[AssetDescriptor, ...] = ()
    _by_id: Mapping[str, AssetDescriptor] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        by_id: dict[str, AssetDescriptor] = {}
        for asset in self.assets:
            if asset.id in by_id:
                raise ValueError(f"Asset catalog repeats asset ID {asset.id}")
            by_id[asset.id] = asset
        for asset in self.assets:
            for required in asset.requires:
                # One level only, so installs and removals never need ordering.
                if required not in by_id or by_id[required].requires:
                    raise ValueError(f"Asset {asset.id} requires {required}, which is not an independent asset")
        object.__setattr__(self, "_by_id", MappingProxyType(by_id))

    def get(self, asset_id: str) -> AssetDescriptor | None:
        return self._by_id.get(asset_id)

    def required_by(self, asset_id: str) -> tuple[AssetDescriptor, ...]:
        """Assets that list ``asset_id`` in their requirements."""

        return tuple(asset for asset in self.assets if asset_id in asset.requires)


def _requirements(entry: dict[str, Any], asset_id: object) -> tuple[str, ...]:
    if "requires" not in entry:
        return ()
    requires = entry["requires"]
    if not isinstance(requires, list) or not requires or not all(isinstance(item, str) for item in requires):
        raise ValueError(f"Asset {asset_id} 'requires' must be a non-empty list of asset IDs")
    return tuple(requires)


def _parse_entry(entry: object) -> AssetDescriptor:
    if not isinstance(entry, dict):
        raise ValueError("Asset catalog entries must be objects")
    fields = set(entry) - _OPTIONAL_FIELDS
    requires = _requirements(entry, entry.get("id"))
    if fields == _SINGLE_FILE_FIELDS:
        return AssetDescriptor.single_file(**{name: entry[name] for name in _SINGLE_FILE_FIELDS}, requires=requires)
    if fields == _SET_FIELDS:
        files = entry["files"]
        if not isinstance(files, list) or not files:
            raise ValueError(f"Asset set {entry['id']} must list its files")
        parsed: list[AssetFile] = []
        for file in files:
            if not isinstance(file, dict) or set(file) != _SET_FILE_FIELDS:
                raise ValueError(f"Asset set files must contain exactly {sorted(_SET_FILE_FIELDS)}")
            path = file["path"]
            media_type = set_file_media_type(path) if isinstance(path, str) else ""
            parsed.append(AssetFile(**file, media_type=media_type))
        return AssetDescriptor(
            id=entry["id"],
            files=tuple(parsed),
            license_ref=entry["license_ref"],
            manifest_sha256=entry["manifest_sha256"],
            requires=requires,
        )
    raise ValueError(
        f"Asset catalog entries must contain exactly {sorted(_SINGLE_FILE_FIELDS)} or {sorted(_SET_FIELDS)}"
        " (optionally 'requires')"
    )


def parse_asset_catalog(
    document: Any,
    *,
    allowed_hosts: frozenset[str] = PRODUCTION_ASSET_HOSTS,
) -> AssetCatalog:
    """Validate an ``animama-asset-catalog/1`` document.

    ``allowed_hosts`` defaults to the production release host. Only tests pass
    another set, together with a matching test-only fetcher.
    """

    if not isinstance(document, dict) or set(document) != {"schema", "assets"}:
        raise ValueError("Asset catalog must contain exactly 'schema' and 'assets'")
    if document["schema"] != ASSET_CATALOG_SCHEMA:
        raise ValueError(f"Asset catalog schema must be {ASSET_CATALOG_SCHEMA}")
    entries = document["assets"]
    if not isinstance(entries, list):
        raise ValueError("Asset catalog 'assets' must be a list")
    descriptors: list[AssetDescriptor] = []
    for entry in entries:
        descriptor = _parse_entry(entry)
        if any(file.host not in allowed_hosts for file in descriptor.files):
            raise ValueError(f"Asset {descriptor.id} URL host is not an allowed release host")
        descriptors.append(descriptor)
    return AssetCatalog(tuple(descriptors))


@dataclass(frozen=True, slots=True)
class AssetState:
    """Observable install state; progress fields are set only while downloading.

    ``bytes_downloaded`` aggregates every file of a set, including bytes
    resumed from staging. ``files_verified`` counts files whose size and digest
    have been checked: all of them once installed.
    """

    asset: AssetDescriptor
    status: AssetStatus
    bytes_downloaded: int | None = None
    total_bytes: int | None = None
    reason: AssetFailureReason | None = None
    files_verified: int = 0


@dataclass(frozen=True, slots=True)
class AssetRemovalVeto:
    """A consumer's refusal to remove an installed asset.

    ``code`` is a stable machine-readable reason (for example
    ``pocket_voice_in_use``); ``details`` must be JSON-serializable and must not
    contain host paths or secrets.
    """

    code: str
    details: Mapping[str, Any] = field(default_factory=dict)
