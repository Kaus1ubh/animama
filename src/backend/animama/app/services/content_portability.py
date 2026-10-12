"""Non-portable Included content: usable in the product, never shared as files.

An Included licence inventory rule may carry ``"distribution": "non-portable"``.
Matching entries play normally but never enter a portable package, a Local copy
or an import. The scanner records the effective value in each entry's
``provenance["distribution"]`` after merging descriptor metadata, so a
descriptor can neither claim nor remove the restriction. Bytes that match a
tracked private-pack manifest or the vendor preview deny list are restricted
wherever they are stored, which also covers Local copies and re-uploads in
builds that do not mount the pack.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterable
from functools import cache
from importlib.resources import files
from typing import Any, BinaryIO, Literal

from animama.domain.content_catalog import CatalogContentEntry, ContentConflictError, ContentSource

DISTRIBUTION_KEY = "distribution"
DISTRIBUTION_EXCLUDED = "excluded"
DISTRIBUTION_NON_PORTABLE = "non-portable"
INVENTORY_DISTRIBUTIONS = frozenset({DISTRIBUTION_EXCLUDED, DISTRIBUTION_NON_PORTABLE})

MIXAMO_MOTION_PACK_ID = "mixamo-motion"
WOW_COMEDY_SFX_PACK_ID = "wow-comedy-sfx"
# Private Included packs: separate, privately built sources bundled only into
# desktop and hosted builds.
PRIVATE_PACK_IDS = (MIXAMO_MOTION_PACK_ID, WOW_COMEDY_SFX_PACK_ID)

# Tracked, public-safe hash resources and the pack each must declare: every
# private pack's manifest, plus the hashes of the vendor's watermarked preview
# files, which may never ship anywhere.
RESTRICTED_RESOURCES: tuple[tuple[str, str | None], ...] = (
    *((f"{pack_id}-manifest.json", pack_id) for pack_id in PRIVATE_PACK_IDS),
    ("wow-comedy-sfx-preview-deny.json", None),
)

Portability = Literal["portable", "non-portable"]

_SHA256 = re.compile(r"[0-9a-f]{64}")


def parse_restricted_manifest(value: Any, *, pack_id: str | None = None) -> frozenset[str]:
    """Return the SHA-256 set from a tracked manifest, rejecting malformed data.

    ``pack_id``, when given, must equal the manifest's own, so a pack's hashes
    can never be supplied under another pack's name.
    """

    if not isinstance(value, dict) or value.get("schema_version") != 1 or not isinstance(value.get("files"), list):
        raise ValueError("Invalid non-portable manifest")
    if pack_id is not None and value.get("pack_id") != pack_id:
        raise ValueError("Non-portable manifest names another pack")
    hashes: set[str] = set()
    for item in value["files"]:
        digest = item.get("sha256") if isinstance(item, dict) else None
        if not isinstance(digest, str) or not _SHA256.fullmatch(digest):
            raise ValueError("Invalid non-portable manifest file hash")
        hashes.add(digest)
    return frozenset(hashes)


@cache
def restricted_sha256() -> frozenset[str]:
    """Hashes of every file in the tracked restricted resources (public-safe)."""

    resources = files("animama.resources")
    hashes: set[str] = set()
    for name, pack_id in RESTRICTED_RESOURCES:
        raw = resources.joinpath(name).read_text(encoding="utf-8")
        hashes |= parse_restricted_manifest(json.loads(raw), pack_id=pack_id)
    return frozenset(hashes)


def resolve_rule_distribution(values: Iterable[Any]) -> str | None:
    """Combine the first-matching rule value of each path, failing closed.

    Any non-portable or unrecognised value restricts the whole entry, so a typo
    in an inventory never makes licensed content shareable.
    """

    found = {value for value in values if value is not None}
    if found - {DISTRIBUTION_EXCLUDED}:
        return DISTRIBUTION_NON_PORTABLE
    return DISTRIBUTION_EXCLUDED if found else None


def reject_restricted_bytes(
    restricted: frozenset[str], streams: Iterable[BinaryIO] = (), payloads: Iterable[bytes | None] = ()
) -> None:
    """Refuse any incoming file whose bytes are non-portable; never echo contents."""

    if not restricted:
        return
    digests = [hashlib.sha256(payload).hexdigest() for payload in payloads if payload is not None]
    for stream in streams:
        position = stream.tell()
        try:
            stream.seek(0)
            digest = hashlib.sha256()
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
            digests.append(digest.hexdigest())
        finally:
            stream.seek(position)
    if restricted.intersection(digests):
        raise ContentConflictError("content_non_portable", field="files")


def effective_provenance(
    provenance: dict[str, Any],
    *,
    source: ContentSource,
    rule_distribution: Any,
    file_sha256: Iterable[str],
    restricted: frozenset[str],
) -> dict[str, Any]:
    """Replace any descriptor-supplied distribution with the trusted value.

    Only an Included rule can set a distribution. A restricted byte match makes
    any entry non-portable, whatever its source.
    """

    result = {key: value for key, value in provenance.items() if key != DISTRIBUTION_KEY}
    if source is ContentSource.INCLUDED and rule_distribution in INVENTORY_DISTRIBUTIONS:
        result[DISTRIBUTION_KEY] = rule_distribution
    if any(digest in restricted for digest in file_sha256):
        result[DISTRIBUTION_KEY] = DISTRIBUTION_NON_PORTABLE
    return result


def is_non_portable(entry: CatalogContentEntry) -> bool:
    """Whether the scanner marked this catalog entry as non-portable."""

    return entry.provenance.get(DISTRIBUTION_KEY) == DISTRIBUTION_NON_PORTABLE


def portability(entry: CatalogContentEntry) -> Portability:
    """Read-only API projection of the scanner's decision."""

    return "non-portable" if is_non_portable(entry) else "portable"
