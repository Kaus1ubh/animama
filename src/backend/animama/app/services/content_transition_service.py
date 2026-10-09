"""Preserve old Idle Style lanes and equipment as Gesture-based Style content."""

from __future__ import annotations

import asyncio
import hashlib
import json
from contextlib import ExitStack
from dataclasses import asdict, dataclass
from pathlib import PurePosixPath
from typing import Any, cast

from animama.app.ports.content_store import LocalContentStore
from animama.app.ports.content_transition import ContentTransitionBindings, IdleTransitionBinding
from animama.app.services.avatar_effect_transition import AvatarEffectTransitionService
from animama.app.services.clip_format import (
    CLIP_FORMAT_UNSUPPORTED,
    RETIRED_ANIMA_POSE_CLIP_SCHEMA,
    unsupported_clip_format_message,
)
from animama.app.services.content_catalog_service import ContentCatalogService, ContentRescanResult
from animama.app.services.content_kind_registry import handler_for_kind
from animama.app.services.content_portability import is_non_portable
from animama.app.services.idle_playback import derive_idle_playback, read_gesture_idle_playback
from animama.app.services.local_content_mutations import mutation_digest
from animama.app.services.music_retirement_service import MusicRetirementService
from animama.app.services.typed_content_service import (
    TypedContentAdmissionError,
    TypedContentResolutionContext,
    TypedContentService,
)
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentConflictError,
    ContentKind,
    ContentScanSummary,
    ContentSource,
    ContentStatus,
)
from animama.domain.content_documents import (
    ActionImplementationV1,
    ContentDependencyV1,
    ContentDocumentError,
    ContentFileDeclarationV1,
    GestureDocumentV1,
    IdleAnimationDocumentV1,
    IdleStyleDocumentV1,
    PoseClipDocumentV1,
)


def _key(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:24]


@dataclass(frozen=True, slots=True)
class IdleTransitionResult:
    """Durable source-to-result identities, independent of later Library edits."""

    source_item_id: str
    style_item_id: str
    gestures: dict[str, str]
    bindings: dict[str, str]


class ContentTransitionService:
    """Convert only the known local content transition under mutation authority."""

    def __init__(self, *, content: ContentCatalogService, bindings: ContentTransitionBindings) -> None:
        self._content = content
        self._bindings = bindings

    async def transition(self, *, user_id: str, include_included: bool = True) -> ContentRescanResult:
        """Preserve existing content before exposing the supported product catalog."""
        scanned = await self.convert_idle_styles(user_id=user_id, include_included=include_included)
        # Action conversions rescan Local. Reapply already diagnosed source
        # failures afterward so a successful peer cannot erase a repair result.
        failures = [
            (item, item.diagnostics[0].code)
            for item in scanned.items
            if item.status is ContentStatus.INVALID and item.diagnostics
        ]
        failures.extend(await AvatarEffectTransitionService(content=self._content).convert(user_id=user_id))
        await MusicRetirementService(content=self._content, bindings=self._bindings).retire(user_id=user_id)
        catalog = self._content.mutations.catalog
        for item, code in failures:
            await catalog.record_transition_failure(
                user_id=user_id, item_id=item.id, expected_revision=item.revision_sha256 or "", code=code
            )
        return await self._content.visible_scan_result(scanned.summaries, user_id=user_id)

    async def convert_idle_styles(self, *, user_id: str, include_included: bool = True) -> ContentRescanResult:
        """Preserve each legacy Style and its consumers before new runtime admission."""
        scanned = await self._content.rescan(user_id=user_id, include_included=include_included)
        catalog = self._content.mutations.catalog
        failures: list[tuple[CatalogContentEntry, str]] = []
        for item in await catalog.list_visible(user_id=user_id):
            # Non-portable Styles are never copied into Local content.
            if (
                item.kind is not ContentKind.IDLE_STYLE
                or item.status is not ContentStatus.VALID
                or is_non_portable(item)
            ):
                continue
            document = TypedContentService.parse(item).document
            if not isinstance(document, IdleStyleDocumentV1):
                continue
            # Included bytes stay immutable after conversion. Their source receipt
            # prevents another startup from recreating or overwriting Local copies.
            operation_id = f"idle-v2-{_key([item.id, item.revision_sha256])}"
            if await catalog.get_mutation_receipt(user_id=user_id, operation_id=operation_id) is not None:
                continue
            bindings = await self._bindings.idle_consumers(
                user_id=user_id, item_id=item.id, is_starter=item.logical_key == "builtin:idle-style:starter"
            )
            facts = [asdict(binding) for binding in bindings]
            digest = mutation_digest({"source": item.id, "revision": item.revision_sha256, "bindings": facts})
            legacy_document: IdleStyleDocumentV1 = document

            async def convert(
                source: CatalogContentEntry = item,
                legacy: IdleStyleDocumentV1 = legacy_document,
                consumers: tuple[IdleTransitionBinding, ...] = bindings,
                originals_id: str = f"{operation_id}-{digest[:16]}",
            ) -> IdleTransitionResult:
                current = await catalog.get_visible_item(item_id=source.id, user_id=user_id, for_update=True)
                if current is None or current.revision_sha256 != source.revision_sha256:
                    raise ContentConflictError("content_transition_source_changed")
                visible = {value.id: value for value in await catalog.list_visible(user_id=user_id)}
                TypedContentResolutionContext(visible, allow_retired=True).resolve(source.id)
                await asyncio.to_thread(
                    cast(LocalContentStore, self._content.mutations.store).retain_transition_originals,
                    operation_id=originals_id,
                    entry=source,
                    binding_facts=[asdict(value) for value in consumers],
                )
                gestures = {}
                for lane in legacy.animations:
                    gestures[lane.animation_id] = await self._gesture(source, lane, visible)
                base = self._style_document(legacy, gestures, {})
                local_key = f"local:idle-style:converted-{_key([source.id, source.revision_sha256])}"
                base["content_id"] = source.logical_key if source.source is ContentSource.LOCAL else local_key
                locator = (
                    source.relative_locator
                    if source.source is ContentSource.LOCAL
                    else f"idle-styles/converted-{_key(local_key)}"
                )
                await self._save(
                    ContentKind.IDLE_STYLE, locator, base, require_new=source.source is not ContentSource.LOCAL
                )
                variants = {json.dumps(base, sort_keys=True): locator}
                selections = {}
                for before in consumers:
                    overrides = before.config.get("pool_overrides", {})
                    if not isinstance(overrides, dict):
                        raise ContentDocumentError(
                            "idle_transition_overrides_invalid", "Legacy idle pool overrides are invalid"
                        )
                    variant = {
                        **base,
                        **self._style_document(legacy, gestures, overrides),
                        "content_id": base["content_id"],
                    }
                    signature = json.dumps(variant, sort_keys=True)
                    target = variants.get(signature)
                    if target is None:
                        suffix = _key([source.id, source.revision_sha256, signature])
                        target = f"idle-styles/converted-{suffix}"
                        variant["content_id"] = f"local:idle-style:converted-{suffix}"
                        variant["name"] = f"{legacy.name[:100]} custom"
                        await self._save(ContentKind.IDLE_STYLE, target, variant)
                        variants[signature] = target
                    selections[before.anima_id] = target
                await self._content.rescan(user_id=user_id, include_included=False)
                converted = await catalog.get_by_locator(source=ContentSource.LOCAL, relative_locator=locator)
                if converted is None or converted.status is not ContentStatus.VALID:
                    raise ContentDocumentError("idle_transition_result_invalid", "Converted Style failed validation")
                changed = {}
                for before in consumers:
                    selected = await catalog.get_by_locator(
                        source=ContentSource.LOCAL, relative_locator=selections[before.anima_id]
                    )
                    if selected is None or selected.status is not ContentStatus.VALID:
                        raise ContentDocumentError(
                            "idle_transition_result_invalid", "Converted selection failed validation"
                        )
                    await self._bindings.replace_idle(user_id=user_id, before=before, item_id=selected.id)
                    changed[before.anima_id] = selected.id
                return IdleTransitionResult(source.id, converted.id, gestures, changed)

            try:
                await self._content.mutations.run(
                    user_id=user_id,
                    operation_id=operation_id,
                    request_digest=digest,
                    result_type=IdleTransitionResult,
                    action=convert,
                )
            except (ContentDocumentError, TypedContentAdmissionError) as exc:
                # Mutation recovery has already compensated cooperating writes.
                # Only known source errors become repair diagnostics; journal or
                # preservation conflicts must propagate to the readiness fence.
                failures.append((item, exc.code))
        # A later successful conversion rescans all Local entries. Publish repair
        # diagnostics after the last scan so one good source cannot erase them.
        for item, code in failures:
            await catalog.record_transition_failure(
                user_id=user_id,
                item_id=item.id,
                expected_revision=item.revision_sha256 or "",
                code=code,
            )
        items = tuple(await catalog.list_visible(user_id=user_id))
        summaries = tuple(
            ContentScanSummary(
                source=summary.source,
                scanned=sum(
                    value.source is summary.source and value.status is not ContentStatus.MISSING for value in items
                ),
                valid=sum(value.source is summary.source and value.status is ContentStatus.VALID for value in items),
                invalid=sum(
                    value.source is summary.source and value.status is ContentStatus.INVALID for value in items
                ),
                missing=sum(
                    value.source is summary.source and value.status is ContentStatus.MISSING for value in items
                ),
            )
            for summary in scanned.summaries
        )
        return ContentRescanResult(summaries, items)

    async def _save(
        self, kind: ContentKind, locator: str, document: dict[str, Any], *, require_new: bool = True
    ) -> None:
        """Publish descriptor-only converted Styles inside the caller's journal."""
        await asyncio.to_thread(
            self._content.mutations.store.save_descriptor_entry,
            kind=kind,
            relative_locator=locator,
            descriptor=json.dumps(document).encode(),
            companion_files={},
            require_new=require_new,
        )

    @staticmethod
    def _style_document(
        legacy: IdleStyleDocumentV1, gestures: dict[str, str], overrides: dict[str, Any]
    ) -> dict[str, Any]:
        """Map emotion-only pools to all levels, preserving empty-cell inheritance."""

        def pool(value: object) -> list[str]:
            if not isinstance(value, tuple | list) or any(
                not isinstance(key, str) or key not in gestures for key in value
            ):
                raise ContentDocumentError(
                    "idle_transition_pool_invalid", "Legacy idle pool refers to an unavailable lane"
                )
            return list(dict.fromkeys(gestures[key] for key in value))

        default = pool(overrides.get("default", legacy.default_pool))
        cells = {}
        for emotion, members in {
            **legacy.emotion_pools,
            **{key: value for key, value in overrides.items() if key != "default"},
        }.items():
            selected = pool(members)
            if selected:
                cells[emotion] = {str(level): {"mode": "pool", "gestures": selected} for level in (1, 2, 3)}
        required = sorted(
            {*default, *(ref for levels in cells.values() for cell in levels.values() for ref in cell["gestures"])}
        )
        return {
            "schema_version": 2,
            "content_type": "idle_style",
            "name": legacy.name,
            **({"description": legacy.description} if legacy.description else {}),
            "provenance": legacy.provenance,
            "compatibility": legacy.compatibility,
            "default_pool": default,
            "cells": cells,
            "dependencies": [{"ref": ref, "content_type": "gesture"} for ref in required],
        }

    async def _gesture(
        self,
        source: CatalogContentEntry,
        lane: IdleAnimationDocumentV1,
        visible: dict[str, CatalogContentEntry],
    ) -> str:
        """Reuse an identical Action or preserve one complete owned implementation."""
        store = self._content.mutations.store
        suffix = _key([source.id, source.revision_sha256, lane.animation_id])
        logical = f"local:gesture:idle-{suffix}"
        owner = source
        dependencies: tuple[ContentDependencyV1, ...] = ()
        config = dict(lane.playback)
        provenance = dict(source.provenance)
        motion_path = lane.file_ref
        implementation = ActionImplementationV1(kind="vrma", file_role="animation")
        original_gesture: GestureDocumentV1 | None = None
        if lane.dependency_ref:
            target_id = dict(zip(source.dependencies, source.dependency_item_ids, strict=True)).get(lane.dependency_ref)
            target = visible.get(target_id or "")
            if target is None:
                raise ContentDocumentError(
                    "idle_transition_dependency_missing", "Legacy idle dependency is unavailable"
                )
            document = TypedContentService.parse(target).document
            if isinstance(document, GestureDocumentV1):
                original_gesture = document
                config = {**document.config, **lane.playback}
                if config == document.config and document.implementation.content_dependency_ref is None:
                    await read_gesture_idle_playback(
                        document=document, item=target, dependency_items=visible, store=store
                    )
                    return target.logical_key or target.relative_locator
                owner = target
                dependencies = document.dependencies
                provenance = {**target.provenance, **provenance}
                implementation = document.implementation
                if implementation.content_dependency_ref:
                    ref = dict(zip(target.dependencies, target.dependency_item_ids, strict=True)).get(
                        implementation.content_dependency_ref
                    )
                    dependency_owner = visible.get(ref or "")
                    if dependency_owner is None:
                        raise ContentDocumentError("idle_transition_dependency_missing", "Action motion is unavailable")
                    owner = dependency_owner
                    document = TypedContentService.parse(owner).document
                    dependencies = tuple(
                        value for value in dependencies if value.ref != implementation.content_dependency_ref
                    )
                else:
                    document = original_gesture
            if isinstance(document, PoseClipDocumentV1):
                # Retired standalone clips were animaPoseClip/1.0, which is rejected.
                raise ContentDocumentError(
                    CLIP_FORMAT_UNSUPPORTED, unsupported_clip_format_message(RETIRED_ANIMA_POSE_CLIP_SCHEMA)
                )
            if not isinstance(document, GestureDocumentV1):
                raise ContentDocumentError(
                    "idle_transition_dependency_invalid", "Legacy idle dependency is not an Action or clip"
                )
            motion_path = None
        role = implementation.file_role or ("animation" if implementation.kind == "vrma" else "sequence")
        motion_files = [
            file
            for file in owner.files
            if (
                file.relative_path == str(PurePosixPath(owner.relative_locator) / motion_path)
                if motion_path
                else file.role in {role, "pose_clip"}
                if implementation.kind == "anima_clip"
                else file.role == role
            )
        ]
        if len(motion_files) != 1:
            raise ContentDocumentError(
                "idle_transition_motion_ambiguous", "Legacy idle lane needs one registered motion file"
            )
        motion = motion_files[0]
        if is_non_portable(owner):
            # Never copy non-portable motion bytes into Local content.
            raise ContentDocumentError("content_non_portable", "Non-portable motion cannot be copied")
        # Clone runtime resources; the canonical descriptor replaces control
        # metadata (including a standalone VRMA sidecar). Original controls stay
        # untouched. A clip dependency becomes the Action's owned sequence.
        selected_files = (
            [file for file in owner.files if file.role not in {"descriptor", "metadata"}]
            if owner.kind is ContentKind.GESTURE
            else [motion]
        )
        names = {
            file.file_ref: ("motion.vrma" if implementation.kind == "vrma" else "clip.json")
            if file == motion
            else str(PurePosixPath(file.relative_path).relative_to(owner.relative_locator))
            for file in selected_files
        }
        gesture = GestureDocumentV1(
            kind=ContentKind.GESTURE,
            name=lane.name,
            description=lane.description,
            content_id=logical,
            semantic_key=original_gesture.semantic_key if original_gesture else f"idle-{suffix}",
            implementation=ActionImplementationV1(kind=implementation.kind, file_role=role),
            files=tuple(
                ContentFileDeclarationV1(names[file.file_ref], role if file == motion else file.role)
                for file in selected_files
            ),
            config=config,
            dependencies=tuple({value.ref: value for value in dependencies}.values()),
            provenance=provenance,
        )
        descriptor = json.dumps(handler_for_kind(ContentKind.GESTURE).catalog_projection(gesture)).encode()

        def publish() -> None:
            with ExitStack() as stack:
                companions = {}
                for file in selected_files:
                    opened = store.open_verified_file(
                        source=file.source,
                        source_mount_id=file.source_mount_id,
                        relative_path=file.relative_path,
                        expected_size_bytes=file.size_bytes,
                        expected_sha256=file.sha256,
                        media_type=file.media_type,
                    )
                    stack.callback(opened.handle.close)
                    companions[names[file.file_ref]] = (opened.handle, opened.size_bytes)
                    if file == motion:
                        derive_idle_playback(gesture, opened.handle)
                store.save_descriptor_entry_streams(
                    kind=ContentKind.GESTURE,
                    relative_locator=f"gestures/idle-{suffix}",
                    descriptor=descriptor,
                    companion_files=companions,
                    require_new=True,
                )

        await asyncio.to_thread(publish)
        return logical
