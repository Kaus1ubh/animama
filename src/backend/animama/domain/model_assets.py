"""Pinned downloadable asset descriptors, catalog validation and install state.

A model-asset catalog is packaged release data: every URL, size and digest is
fixed when the release is built. Requests name assets by ID only, so nothing
outside the catalog is ever fetched.
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
_SHA256_PATTERN: Final = re.compile(r"[0-9a-f]{64}")
_MEDIA_TYPE_PATTERN: Final = re.compile(r"[A-Za-z0-9!#$&^_.+-]+/[A-Za-z0-9!#$&^_.+-]+(?:;[\x20-\x7e]+)?")
_LICENSE_REF_PATTERN: Final = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:/+-]{0,199}")

AssetStatus = Literal["not_installed", "downloading", "installed", "failed"]
# Stable failure codes reported to clients; they never carry host paths or URLs.
AssetFailureReason = Literal[
    "asset_download_failed",
    "asset_host_not_allowed",
    "asset_size_invalid",
    "asset_hash_invalid",
    "asset_store_failed",
]


def is_valid_asset_id(value: object) -> bool:
    """Accept only IDs that are also safe single directory names."""

    return isinstance(value, str) and ASSET_ID_PATTERN.fullmatch(value) is not None


@dataclass(frozen=True, slots=True)
class AssetDescriptor:
    """One pinned, immutable downloadable file."""

    id: str
    url: str
    size: int
    sha256: str
    media_type: str
    license_ref: str

    def __post_init__(self) -> None:
        if not is_valid_asset_id(self.id):
            raise ValueError(f"Asset ID {self.id!r} must match {ASSET_ID_PATTERN.pattern}")
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
            raise ValueError(f"Asset {self.id} URL must be a plain https URL on the default port")
        if type(self.size) is not int or self.size <= 0:
            raise ValueError(f"Asset {self.id} size must be a positive integer")
        if not isinstance(self.sha256, str) or not _SHA256_PATTERN.fullmatch(self.sha256):
            raise ValueError(f"Asset {self.id} digest must be a lowercase SHA-256 hex digest")
        if not isinstance(self.media_type, str) or not _MEDIA_TYPE_PATTERN.fullmatch(self.media_type):
            raise ValueError(f"Asset {self.id} media type must be a safe MIME value")
        if not isinstance(self.license_ref, str) or not _LICENSE_REF_PATTERN.fullmatch(self.license_ref):
            raise ValueError(f"Asset {self.id} needs a license reference")

    @property
    def host(self) -> str:
        return urlsplit(self.url).hostname or ""


@dataclass(frozen=True, slots=True)
class AssetCatalog:
    """A validated set of descriptors with unique IDs, all on allowed hosts."""

    assets: tuple[AssetDescriptor, ...] = ()
    _by_id: Mapping[str, AssetDescriptor] = field(init=False, repr=False, compare=False)

    def __post_init__(self) -> None:
        by_id: dict[str, AssetDescriptor] = {}
        for asset in self.assets:
            if asset.id in by_id:
                raise ValueError(f"Asset catalog repeats asset ID {asset.id}")
            by_id[asset.id] = asset
        object.__setattr__(self, "_by_id", MappingProxyType(by_id))

    def get(self, asset_id: str) -> AssetDescriptor | None:
        return self._by_id.get(asset_id)


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
    fields = {"id", "url", "size", "sha256", "media_type", "license_ref"}
    descriptors: list[AssetDescriptor] = []
    for entry in entries:
        if not isinstance(entry, dict) or set(entry) != fields:
            raise ValueError(f"Asset catalog entries must contain exactly {sorted(fields)}")
        descriptor = AssetDescriptor(**entry)
        if descriptor.host not in allowed_hosts:
            raise ValueError(f"Asset {descriptor.id} URL host is not an allowed release host")
        descriptors.append(descriptor)
    return AssetCatalog(tuple(descriptors))


@dataclass(frozen=True, slots=True)
class AssetState:
    """Observable install state; progress fields are set only while downloading."""

    asset: AssetDescriptor
    status: AssetStatus
    bytes_downloaded: int | None = None
    total_bytes: int | None = None
    reason: AssetFailureReason | None = None


@dataclass(frozen=True, slots=True)
class AssetRemovalVeto:
    """A consumer's refusal to remove an installed asset.

    ``code`` is a stable machine-readable reason (for example
    ``pocket_voice_in_use``); ``details`` must be JSON-serializable and must not
    contain host paths or secrets.
    """

    code: str
    details: Mapping[str, Any] = field(default_factory=dict)
