"""Deterministic delivery selection, independent of storage and runtime identity."""

from __future__ import annotations

from typing import Any

JSON_BUNDLE_MAX_MEMBERS = 256
JSON_BUNDLE_MAX_MEMBER_BYTES = 256 * 1024
JSON_BUNDLE_MAX_BYTES = 2 * 1024 * 1024


def select_runtime_json_members(catalog: dict[str, Any]) -> list[dict[str, Any]]:
    """Select small executable JSON, never the avatar's essential closure or metadata."""
    projected: set[str] = set()

    def visit(value: Any) -> None:
        if isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, dict):
            if isinstance(value.get("file_ref"), str):
                projected.add(value["file_ref"])
            for key, child in value.items():
                if key not in {"content_descriptor", "json_bundle"}:
                    visit(child)

    descriptor = catalog.get("content_descriptor", {})
    avatar = catalog.get("avatar") or {}
    essential_roots = set(avatar.get("runtime_root_ids", []))
    essential_roots.add(avatar.get("runtime_root_id"))
    essential = {
        ref for root in descriptor.get("roots", []) if root["root_id"] in essential_roots for ref in root["member_refs"]
    }
    # Direct model references stay essential even with an incomplete root declaration.
    visit(avatar)
    essential.update(projected)
    projected.clear()
    visit(catalog)
    optional_refs = projected - essential
    candidates = {
        member["file_ref"]: member
        for member in descriptor.get("members", [])
        if member["file_ref"] in optional_refs
        and member["role"] in {"sequence", "manifest"}
        and member["media_type"] == "application/json"
        and 0 < member["size_bytes"] <= JSON_BUNDLE_MAX_MEMBER_BYTES
    }
    selected: list[dict[str, Any]] = []
    remaining = JSON_BUNDLE_MAX_BYTES
    for ref in sorted(candidates):
        member = candidates[ref]
        if member["size_bytes"] <= remaining:
            selected.append(member)
            remaining -= member["size_bytes"]
        if len(selected) == JSON_BUNDLE_MAX_MEMBERS:
            break
    return selected if len(selected) >= 2 else []
