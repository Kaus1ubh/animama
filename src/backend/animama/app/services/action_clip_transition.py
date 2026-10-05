"""Preserve legacy standalone clips as files owned by their existing Actions."""

from __future__ import annotations

import asyncio
import hashlib
import json
from contextlib import ExitStack
from dataclasses import dataclass, replace
from io import BytesIO
from pathlib import PurePosixPath
from typing import BinaryIO, cast

from animama.app.ports.content_store import LocalContentStore
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import handler_for_kind
from animama.app.services.local_content_mutations import mutation_digest
from animama.app.services.typed_content_service import (
    TypedContentAdmissionError,
    TypedContentResolutionContext,
    TypedContentService,
)
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentConflictError,
    ContentKind,
    ContentSource,
    ContentStatus,
    ContentValidationError,
)
from animama.domain.content_documents import (
    ActionImplementationV1,
    ContentDependencyV1,
    ContentDocumentError,
    ContentFileDeclarationV1,
    GestureDocumentV1,
    PoseClipDocumentV1,
    ReactionDocumentV1,
)


@dataclass(frozen=True, slots=True)
class ActionClipTransitionResult:
    """Receipt for one identity-preserving Action conversion."""

    action_item_id: str
    clip_item_id: str


class ActionClipTransitionService:
    """Convert under the existing filesystem journal and shared catalog transaction."""

    def __init__(self, *, content: ContentCatalogService) -> None:
        self._content = content

    async def convert(self, *, user_id: str) -> list[tuple[CatalogContentEntry, str]]:
        """Return safe source diagnostics; uncertain recovery conflicts propagate."""
        catalog = self._content.mutations.catalog
        failures = []
        for source in await catalog.list_visible(user_id=user_id):
            if (
                source.kind not in {ContentKind.GESTURE, ContentKind.REACTION}
                or source.status is not ContentStatus.VALID
                or source.source is not ContentSource.LOCAL
            ):
                continue
            action = TypedContentService.parse(source).document
            if not isinstance(action, GestureDocumentV1 | ReactionDocumentV1):
                continue
            reference = action.implementation.content_dependency_ref
            if reference is None:
                continue
            try:
                visible = {entry.id: entry for entry in await catalog.list_visible(user_id=user_id)}
                TypedContentResolutionContext(visible, allow_retired=True).resolve(source.id)
                target_id = dict(zip(source.dependencies, source.dependency_item_ids, strict=True)).get(reference)
                clip_entry = visible.get(target_id or "")
                if clip_entry is None or clip_entry.kind is not ContentKind.POSE_CLIP:
                    raise ContentDocumentError("action_clip_transition_source_invalid", "Action clip is unavailable")
                if not any(
                    file.role == "descriptor"
                    and str(PurePosixPath(file.relative_path).parent) == source.relative_locator
                    for file in source.files
                ):
                    raise ContentDocumentError(
                        "action_clip_transition_folder_required", "Action needs a descriptor folder"
                    )
                digest = mutation_digest(
                    {
                        "action": source.id,
                        "revision": source.revision_sha256,
                        "clip": clip_entry.id,
                        "clip_revision": clip_entry.revision_sha256,
                    }
                )
                operation_id = f"action-owned-clip-{digest[:32]}"
                selected_motion: CatalogContentEntry = clip_entry
                selected_action: GestureDocumentV1 | ReactionDocumentV1 = action

                async def convert_one(
                    before: CatalogContentEntry = source,
                    motion: CatalogContentEntry = selected_motion,
                    document: GestureDocumentV1 | ReactionDocumentV1 = selected_action,
                    evidence_id: str = operation_id,
                ) -> ActionClipTransitionResult:
                    for expected in (before, motion):
                        current = await catalog.get_visible_item(item_id=expected.id, user_id=user_id, for_update=True)
                        if current is None or current.revision_sha256 != expected.revision_sha256:
                            raise ContentConflictError("content_transition_source_changed")
                    store = cast(LocalContentStore, self._content.mutations.store)
                    for label, entry in (("action", before), ("clip", motion)):
                        await asyncio.to_thread(
                            store.retain_transition_originals,
                            operation_id=f"{evidence_id}-{label}",
                            entry=entry,
                            binding_facts=[],
                        )
                    await asyncio.to_thread(self.publish_owned, before, motion, document)
                    await self._content.rescan(user_id=user_id, include_included=False)
                    visible_now = {entry.id: entry for entry in await catalog.list_visible(user_id=user_id)}
                    TypedContentResolutionContext(visible_now).resolve(before.id)
                    return ActionClipTransitionResult(before.id, motion.id)

                await self._content.mutations.run(
                    user_id=user_id,
                    operation_id=operation_id,
                    request_digest=digest,
                    result_type=ActionClipTransitionResult,
                    action=convert_one,
                )
            except (ContentDocumentError, TypedContentAdmissionError) as exc:
                failures.append((source, exc.code))
            except ContentValidationError:
                failures.append((source, "action_clip_transition_limits"))
        return failures

    def publish_owned(
        self,
        source: CatalogContentEntry,
        motion: CatalogContentEntry,
        action: GestureDocumentV1 | ReactionDocumentV1,
        *,
        target_locator: str | None = None,
        content_id: str | None = None,
        require_new: bool = False,
    ) -> None:
        """Copy verified bytes and preserve Action metadata, identities and resources."""
        clip = TypedContentService.parse(motion).document
        if not isinstance(clip, PoseClipDocumentV1) or action.implementation.kind != "anima_clip":
            raise ContentDocumentError("action_clip_transition_source_invalid", "Action motion is not a clip")
        sequence_files = [file for file in motion.files if file.role in {"pose_clip", "sequence"}]
        if len(sequence_files) != 1:
            raise ContentDocumentError("action_clip_transition_source_invalid", "Action needs one clip sequence")
        sequence = sequence_files[0]
        dependencies, aliases = _promote_dependencies(action, clip)
        resources = [file for file in source.files if file.role not in {"descriptor", "metadata"}]
        names = {
            file.file_ref: str(PurePosixPath(file.relative_path).relative_to(source.relative_locator))
            for file in resources
        }
        stem = f"owned-clip-{hashlib.sha256(motion.id.encode()).hexdigest()[:12]}"
        filename = f"{stem}.json"
        suffix = 2
        while filename in names.values():
            filename = f"{stem}-{suffix}.json"
            suffix += 1
        converted = replace(
            action,
            content_id=content_id or action.content_id,
            implementation=ActionImplementationV1(kind="anima_clip", file_role="sequence"),
            dependencies=dependencies,
            files=(
                *tuple(
                    ContentFileDeclarationV1(
                        names[file.file_ref], "legacy_sequence" if file.role == "sequence" else file.role
                    )
                    for file in resources
                ),
                ContentFileDeclarationV1(filename, "sequence"),
            ),
        )
        descriptor = json.dumps(handler_for_kind(source.kind).catalog_projection(converted)).encode()
        store = cast(LocalContentStore, self._content.mutations.store)
        with ExitStack() as stack:
            companions: dict[str, tuple[BinaryIO, int]] = {}
            for file in [*resources, sequence]:
                opened = store.open_verified_file(
                    source=file.source,
                    source_mount_id=file.source_mount_id,
                    relative_path=file.relative_path,
                    expected_size_bytes=file.size_bytes,
                    expected_sha256=file.sha256,
                    media_type=file.media_type,
                )
                stack.callback(opened.handle.close)
                if file == sequence:
                    # Clip JSON is already bounded by its kind limit. Only event
                    # selectors change; timelines, IDs, poses and playback remain.
                    payload = json.loads(opened.handle.read())
                    if (
                        not isinstance(payload, dict)
                        or not isinstance(payload.get("events", []), list)
                        or any(not isinstance(event, dict) for event in payload.get("events", []))
                    ):
                        raise ContentDocumentError(
                            "action_clip_transition_events_invalid", "Legacy Action clip events must be objects"
                        )
                    if not isinstance(payload.get("dependencies", []), list) or any(
                        not isinstance(edge, dict) for edge in payload.get("dependencies", [])
                    ):
                        raise ContentDocumentError(
                            "action_clip_transition_dependencies_invalid",
                            "Legacy Action clip dependencies must be objects",
                        )
                    for event in payload.get("events", []):
                        for key in ("presetId", "effectId", "cueId"):
                            if isinstance(event.get(key), str) and event[key] in aliases:
                                event[key] = aliases[event[key]]
                    for dependency in payload.get("dependencies", []):
                        if isinstance(dependency.get("alias"), str) and dependency["alias"] in aliases:
                            dependency["alias"] = aliases[dependency["alias"]]
                    if aliases:
                        encoded = json.dumps(payload).encode()
                        companions[filename] = (stack.enter_context(BytesIO(encoded)), len(encoded))
                    else:
                        opened.handle.seek(0)
                        companions[filename] = (opened.handle, opened.size_bytes)
                else:
                    companions[filename if file == sequence else names[file.file_ref]] = (
                        opened.handle,
                        opened.size_bytes,
                    )
            store.save_descriptor_entry_streams(
                kind=source.kind,
                relative_locator=target_locator or source.relative_locator,
                descriptor=descriptor,
                companion_files=companions,
                require_new=require_new,
            )


def _promote_dependencies(
    action: GestureDocumentV1 | ReactionDocumentV1,
    clip: PoseClipDocumentV1,
) -> tuple[tuple[ContentDependencyV1, ...], dict[str, str]]:
    """Lift clip support edges while keeping its event aliases unambiguous."""
    dependencies = [edge for edge in action.dependencies if edge.ref != action.implementation.content_dependency_ref]
    used = {edge.alias for edge in dependencies if edge.alias}
    aliases: dict[str, str] = {}
    for edge in clip.dependencies:
        existing = next((value for value in dependencies if value.ref == edge.ref), None)
        if existing is not None:
            if existing.kind != edge.kind or existing.config != edge.config or (edge.alias and not existing.alias):
                raise ContentDocumentError(
                    "action_clip_transition_dependency_conflict", "Action and clip support settings differ"
                )
            if edge.alias and existing.alias and edge.alias != existing.alias:
                aliases[edge.alias] = existing.alias
            continue
        alias = edge.alias
        if alias and alias in used:
            original_alias = alias
            stem = f"clip-{alias}"[:120]
            alias = stem
            suffix = 2
            while alias in used:
                alias = f"{stem}-{suffix}"
                suffix += 1
            aliases[original_alias] = alias
        if alias:
            used.add(alias)
        dependencies.append(replace(edge, alias=alias))
    return tuple(dependencies), aliases
