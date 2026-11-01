"""Deterministic delivery bundles, independent of storage and runtime identity.

A bundle is a transport hint over issued descriptor members: the members' own sizes
and SHA-256 digests stay the integrity authority. Issuance calls
``select_runtime_bundles`` once and stores each bundle's members with the snapshot;
serving reads those stored lists, so a bundle ID names the same members for the life
of a revision even if this selection changes later.
"""

from __future__ import annotations

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any, Literal

BundleFormat = Literal["json", "binary"]

JSON_BUNDLE_MAX_MEMBERS = 256
JSON_BUNDLE_MAX_MEMBER_BYTES = 256 * 1024
JSON_BUNDLE_MAX_BYTES = 2 * 1024 * 1024
BINARY_BUNDLE_MEDIA_TYPES = frozenset({"image/png", "image/jpeg", "image/webp"})
BINARY_BUNDLE_MAX_MEMBERS = 64
BINARY_BUNDLE_MAX_MEMBER_BYTES = 512 * 1024
BINARY_BUNDLE_MAX_BYTES = 4 * 1024 * 1024
MAX_RUNTIME_BUNDLES = 32
# A binary bundle: this magic, a 4-byte big-endian header length, a UTF-8 JSON header
# naming each member's size or error, then the members' raw bytes in header order.
BINARY_BUNDLE_MAGIC = b"AMB1"

_LIMITS: dict[BundleFormat, tuple[int, int]] = {
    "json": (JSON_BUNDLE_MAX_MEMBERS, JSON_BUNDLE_MAX_BYTES),
    "binary": (BINARY_BUNDLE_MAX_MEMBERS, BINARY_BUNDLE_MAX_BYTES),
}


@dataclass(frozen=True, slots=True)
class RuntimeBundle:
    """One bundle of optional descriptor members, in ``file_ref`` order."""

    id: str
    format: BundleFormat
    members: tuple[dict[str, Any], ...]

    @property
    def file_refs(self) -> list[str]:
        return [member["file_ref"] for member in self.members]

    @property
    def total_bytes(self) -> int:
        return sum(member["size_bytes"] for member in self.members)


def runtime_bundle_id(format: BundleFormat, file_refs: Iterable[str]) -> str:
    """A digest of the bundle's format and member set."""

    text = "\n".join(["animama-runtime-bundle/1", format, *sorted(file_refs)])
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _bundle_format(member: dict[str, Any]) -> BundleFormat | None:
    size = member["size_bytes"]
    if (
        member["role"] in {"sequence", "manifest"}
        and member["media_type"] == "application/json"
        and 0 < size <= JSON_BUNDLE_MAX_MEMBER_BYTES
    ):
        return "json"
    if member["media_type"] in BINARY_BUNDLE_MEDIA_TYPES and 0 < size <= BINARY_BUNDLE_MAX_MEMBER_BYTES:
        return "binary"
    return None


def _root_ids(node: Any) -> set[str]:
    if not isinstance(node, dict):
        return set()
    ids = {value for value in node.get("runtime_root_ids") or [] if isinstance(value, str)}
    if isinstance(node.get("runtime_root_id"), str):
        ids.add(node["runtime_root_id"])
    return ids


def _projected_refs(value: Any) -> set[str]:
    """File refs the executable projection names, outside the descriptor and bundles."""

    refs: set[str] = set()

    def visit(node: Any) -> None:
        if isinstance(node, list):
            for child in node:
                visit(child)
        elif isinstance(node, dict):
            if isinstance(node.get("file_ref"), str):
                refs.add(node["file_ref"])
            for key, child in node.items():
                if key not in {"content_descriptor", "bundles"}:
                    visit(child)

    visit(value)
    return refs


def _pack(format: BundleFormat, members: list[dict[str, Any]]) -> list[RuntimeBundle]:
    """Next-fit packing in ``file_ref`` order; a bundle of one member is no bundle."""

    max_members, max_bytes = _LIMITS[format]
    groups: list[list[dict[str, Any]]] = [[]]
    for member in sorted(members, key=lambda item: item["file_ref"]):
        current = groups[-1]
        if current and (
            len(current) == max_members
            or sum(item["size_bytes"] for item in current) + member["size_bytes"] > max_bytes
        ):
            current = []
            groups.append(current)
        current.append(member)
    return [
        RuntimeBundle(
            id=runtime_bundle_id(format, (member["file_ref"] for member in group)), format=format, members=tuple(group)
        )
        for group in groups
        if len(group) >= 2
    ]


def select_runtime_bundles(catalog: dict[str, Any]) -> list[RuntimeBundle]:
    """Bundle small optional JSON and images, Idle members first, never the avatar or voice.

    Members are partitioned into Idle JSON, Idle binary, other JSON and other binary
    (a member an Idle root shares with another root counts as Idle), each packed in
    ``file_ref`` order within its format's limits, and the list is cut at
    ``MAX_RUNTIME_BUNDLES``.
    """

    descriptor = catalog.get("content_descriptor") or {}
    roots = {root["root_id"]: root["member_refs"] for root in descriptor.get("roots", [])}
    essential: set[str] = set()
    for node in (catalog.get("avatar"), catalog.get("voice")):
        # Direct references stay essential even with an incomplete root declaration.
        essential |= _projected_refs(node)
        for root_id in _root_ids(node):
            essential.update(roots.get(root_id, []))
    idle: set[str] = set()
    for gesture in (catalog.get("idle") or {}).get("gestures") or []:
        for root_id in _root_ids(gesture):
            idle.update(roots.get(root_id, []))
    optional = _projected_refs(catalog) - essential
    partitions: dict[tuple[bool, BundleFormat], list[dict[str, Any]]] = {
        (True, "json"): [],
        (True, "binary"): [],
        (False, "json"): [],
        (False, "binary"): [],
    }
    seen: set[str] = set()
    for member in descriptor.get("members", []):
        ref = member["file_ref"]
        if ref in seen or ref not in optional:
            continue
        seen.add(ref)
        format = _bundle_format(member)
        if format is not None:
            partitions[(ref in idle, format)].append(member)
    bundles = [bundle for (_, format), members in partitions.items() for bundle in _pack(format, members)]
    return bundles[:MAX_RUNTIME_BUNDLES]
