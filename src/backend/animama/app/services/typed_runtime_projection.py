"""Handler-owned typed projection of a compiled runtime closure."""

from __future__ import annotations

from pathlib import Path, PurePosixPath
from typing import Any

from animama.app.services.content_kind_registry import RuntimeProjectionInput, handler_for_kind
from animama.domain.content_catalog import CatalogContentEntry, ContentKind
from animama.domain.content_documents import ContentDocumentError, TypedContentDocument
from animama.domain.runtime_content_descriptor import (
    RuntimeContentDescriptor,
    RuntimeContentEntry,
    RuntimeContentMember,
    RuntimeContentRoot,
)

_SUPPORT_KINDS = {
    ContentKind.PARTICLE_EFFECT,
    ContentKind.AVATAR_EFFECT,
    ContentKind.SCENE_EFFECT,
    ContentKind.SOUND_EFFECT,
}


def _runtime_source(entry: RuntimeContentEntry, source: str) -> dict[str, Any]:
    return {
        "type": "catalog_item",
        "item_id": entry.item_id,
        "source": source,
        "revision": entry.revision_sha256,
    }


def _runtime_id(entry: RuntimeContentEntry) -> str:
    if entry.logical_key:
        return entry.logical_key.rsplit(":", 1)[-1]
    return f"content-{entry.item_id.replace('-', '')[:16]}"


def _public_member(
    member: RuntimeContentMember,
    *,
    ordinal: int,
) -> dict[str, Any]:
    return {
        "file_ref": member.file_ref,
        "role": member.role,
        "ordinal": ordinal,
        "filename": member.filename,
        "media_type": member.media_type,
        "size_bytes": member.size_bytes,
        "sha256": member.sha256,
    }


def project_typed_runtime_catalog(
    *,
    loadout_revision: int,
    descriptor: RuntimeContentDescriptor,
    visible: list[CatalogContentEntry],
) -> dict[str, Any]:
    """Project typed roots while leaving traversal and budgets generic."""

    entries = {entry.item_id: entry for entry in descriptor.entries}
    visible_by_id = {item.id: item for item in visible}
    visible_sources = {item.id: item.source.value for item in visible}
    member_by_ref = {member.file_ref: member for member in descriptor.members}
    documents: dict[str, TypedContentDocument] = {}
    projection_warnings: list[dict[str, str]] = []

    for entry in descriptor.entries:
        try:
            documents[entry.item_id] = (
                handler_for_kind(entry.kind)
                .parse_document(
                    entry.metadata,
                    fallback_path=Path(entry.logical_key or entry.display_name),
                    descriptor_backed=False,
                )
                .document
            )
        except ContentDocumentError as exc:
            projection_warnings.append(
                {
                    "code": exc.code,
                    "message": f"{entry.display_name} could not be projected and requires Rescan.",
                    "scope": "source",
                }
            )

    def entry_files(item_id: str, *, playable: bool = True) -> list[dict[str, Any]]:
        entry = entries[item_id]
        members = [member_by_ref[ref] for ref in entry.member_refs if ref in member_by_ref]
        if playable:
            members = [member for member in members if member.role not in {"descriptor", "metadata"}]
        return [
            _public_member(
                member,
                ordinal=index,
            )
            for index, member in enumerate(members, start=1)
        ]

    def logical_files(item_id: str) -> dict[str, dict[str, Any]]:
        """Index playable files by their portable descriptor-relative path."""

        item = visible_by_id.get(item_id)
        if item is None:
            return {}
        entry = entries[item_id]
        members = [member_by_ref[ref] for ref in entry.member_refs if ref in member_by_ref]
        standalone = any(member.relative_path == item.relative_locator for member in members)
        root = PurePosixPath(item.relative_locator)
        entry_root = root.parent if standalone else root
        result: dict[str, dict[str, Any]] = {}
        ordinal = 0
        for member in members:
            if member.role in {"descriptor", "metadata"}:
                continue
            ordinal += 1
            relative = PurePosixPath(member.relative_path)
            try:
                logical_path = relative.relative_to(entry_root).as_posix()
            except ValueError:
                logical_path = relative.name
            result[logical_path] = _public_member(member, ordinal=ordinal)
        return result

    def closure_entries(root: RuntimeContentRoot) -> list[RuntimeContentEntry]:
        return [entries[item_id] for item_id in root.entry_ids if item_id in entries]

    def resolve_reference(root: RuntimeContentRoot, reference: str) -> RuntimeContentEntry | None:
        candidates = closure_entries(root)
        exact = [entry for entry in candidates if entry.logical_key == reference]
        if len(exact) == 1:
            return exact[0]
        suffix = reference.rsplit(":", 1)[-1]
        matches = [
            entry for entry in candidates if entry.logical_key and entry.logical_key.rsplit(":", 1)[-1] == suffix
        ]
        return matches[0] if len(matches) == 1 else None

    def dependency_files(root: RuntimeContentRoot, document: TypedContentDocument) -> dict[str, list[dict[str, Any]]]:
        result: dict[str, list[dict[str, Any]]] = {}
        for dependency in document.dependencies:
            target = resolve_reference(root, dependency.ref)
            if target is not None:
                result[dependency.ref] = entry_files(target.item_id)
        return result

    def reference_map(root: RuntimeContentRoot, document: TypedContentDocument) -> dict[str, str]:
        result: dict[str, str] = {}
        for dependency in document.dependencies:
            target = resolve_reference(root, dependency.ref)
            if dependency.alias and target is not None:
                result[dependency.alias] = _runtime_id(target)
        return result

    def projection_input(
        *,
        root: RuntimeContentRoot,
        entry: RuntimeContentEntry,
        document: TypedContentDocument,
        slot_key: str,
        context: dict[str, Any],
    ) -> RuntimeProjectionInput:
        return RuntimeProjectionInput(
            item_id=entry.item_id,
            runtime_root_id=root.root_id,
            slot_key=slot_key,
            source=_runtime_source(entry, visible_sources.get(entry.item_id, "local")),
            revision=entry.revision_sha256,
            context=context,
            files=entry_files(entry.item_id),
            logical_files=logical_files(entry.item_id),
            dependency_files=dependency_files(root, document),
            reference_map=reference_map(root, document),
        )

    lanes: dict[str, list[dict[str, Any]]] = {
        "gesture": [],
        "pose": [],
        "reaction": [],
        "music_track": [],
        "appearance": [],
    }
    idle_style: dict[str, Any] | None = None
    avatar: dict[str, Any] | None = None
    voice: dict[str, Any] | None = None
    supports: dict[str, dict[str, Any]] = {}

    for root in descriptor.roots:
        root_entry = entries.get(root.item_id)
        document = documents.get(root.item_id)
        if root_entry is None or document is None:
            continue
        projected = handler_for_kind(root.kind).project_runtime(
            document,
            projection_input(
                root=root,
                entry=root_entry,
                document=document,
                slot_key=root.slot_key,
                context=dict(root.context),
            ),
        )
        if projected.payload is not None:
            if projected.lane == "idle_style":
                idle_style = projected.payload
            elif projected.lane == "avatar":
                avatar = projected.payload
            elif projected.lane == "voice":
                voice = projected.payload
            elif projected.lane in lanes:
                lanes[projected.lane].append(projected.payload)

        for support_entry in closure_entries(root):
            if support_entry.kind not in _SUPPORT_KINDS:
                continue
            existing = supports.get(support_entry.item_id)
            if existing is not None:
                if root.root_id not in existing["runtime_root_ids"]:
                    existing["runtime_root_ids"].append(root.root_id)
                continue
            support_document = documents.get(support_entry.item_id)
            if support_document is None:
                continue
            dependency_context: dict[str, Any] = {}
            for dependency in document.dependencies:
                target = resolve_reference(root, dependency.ref)
                if target is not None and target.item_id == support_entry.item_id:
                    dependency_context = {"config": dependency.config}
                    break
            support_projection = handler_for_kind(support_entry.kind).project_runtime(
                support_document,
                projection_input(
                    root=root,
                    entry=support_entry,
                    document=support_document,
                    slot_key=f"support:{_runtime_id(support_entry)}",
                    context=dependency_context,
                ),
            )
            if support_projection.payload is None:
                continue
            payload = support_projection.payload
            payload["runtime_root_ids"] = [root.root_id]
            files_by_ref = {value["file_ref"]: value for value in payload.get("files", [])}
            item = visible_by_id.get(support_entry.item_id)
            logical_resources: dict[str, dict[str, Any]] = {}
            for ref in support_entry.member_refs:
                member = member_by_ref.get(ref)
                if (
                    member is None
                    or member.role in {"descriptor", "manifest", "metadata"}
                    or member.file_ref not in files_by_ref
                ):
                    continue
                prefix = f"{item.relative_locator.rstrip('/')}/" if item else ""
                logical_name = (
                    member.relative_path.removeprefix(prefix)
                    if prefix and member.relative_path.startswith(prefix)
                    else PurePosixPath(member.relative_path).name
                )
                logical_resources[logical_name] = files_by_ref[member.file_ref]
            payload["logical_resource_files"] = {
                name: {"role": file["role"], "ordinal": file["ordinal"]} for name, file in logical_resources.items()
            }
            payload["_logical_resource_refs"] = {name: file["file_ref"] for name, file in logical_resources.items()}
            payload["logical_resource_urls"] = {}
            supports[support_entry.item_id] = payload

    by_type: dict[str, list[dict[str, Any]]] = {
        "particle_effect": [],
        "avatar_effect": [],
        "scene_effect": [],
        "sound_effect": [],
    }
    for support in supports.values():
        by_type[str(support["content_type"])].append(support)

    content_descriptor = {
        "schema_version": descriptor.schema_version,
        "revision": descriptor.revision,
        "admitted_item_revisions": descriptor.admitted_item_revisions,
        "total_bytes": descriptor.total_bytes,
        "roots": [
            {
                "root_id": root.root_id,
                "slot_key": root.slot_key,
                "item_id": root.item_id,
                "kind": root.kind.value,
                "revision_sha256": root.revision_sha256,
                "entry_ids": list(root.entry_ids),
                "member_refs": list(root.member_refs),
            }
            for root in descriptor.roots
        ],
        "entries": [
            {
                "item_id": entry.item_id,
                "kind": entry.kind.value,
                "display_name": entry.display_name,
                "revision_sha256": entry.revision_sha256,
                "logical_key": entry.logical_key,
                "member_refs": list(entry.member_refs),
            }
            for entry in descriptor.entries
        ],
        "members": [
            {
                "file_ref": member.file_ref,
                "item_id": member.item_id,
                "role": member.role,
                "filename": member.filename,
                "media_type": member.media_type,
                "size_bytes": member.size_bytes,
                "sha256": member.sha256,
            }
            for member in descriptor.members
        ],
        "diagnostics": [
            {
                "root_id": diagnostic.root_id,
                "slot_key": diagnostic.slot_key,
                "code": diagnostic.code,
                "message": diagnostic.message,
                "item_id": diagnostic.item_id,
            }
            for diagnostic in descriptor.diagnostics
        ],
    }
    return {
        "catalog_version": 4,
        "loadout_revision": loadout_revision,
        "can_chat": True,
        "content_descriptor": content_descriptor,
        "gestures": lanes["gesture"],
        "poses": lanes["pose"],
        "reactions": lanes["reaction"],
        "idle_style": idle_style,
        "music_tracks": lanes["music_track"],
        "avatar": avatar,
        "voice": voice,
        "appearances": lanes["appearance"],
        "particle_effects": by_type["particle_effect"],
        "avatar_effects": by_type["avatar_effect"],
        "scene_effects": by_type["scene_effect"],
        "sound_effects": by_type["sound_effect"],
        "warnings": [
            *[{"code": value.code, "message": value.message, "scope": "source"} for value in descriptor.diagnostics],
            *projection_warnings,
        ],
    }


__all__ = ["project_typed_runtime_catalog"]
