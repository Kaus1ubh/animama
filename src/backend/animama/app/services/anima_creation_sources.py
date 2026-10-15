"""Read-only typed source resolution for private live-Anima commands.

Unlike runtime degradation, any rejected selected root or support fails the
whole command. Catalog entries remain logical sources, not durable mount pins.
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from functools import lru_cache
from importlib.resources import files
from pathlib import PurePosixPath
from typing import Any, cast

from animama.app.anima_creation_contract import AnimaSpec, ItemRevisionRef
from animama.app.ports.content_catalog import ContentCatalog
from animama.app.ports.content_store import ContentStore
from animama.domain.anima_creation import (
    ResolvedAnimaSpec,
    ResolvedAppearanceSelection,
    ResolvedGestureSelection,
    ResolvedReactionSelection,
)
from animama.domain.anima_creation_error import AnimaCreationError, AnimaCreationIssue, bounded_issues
from animama.domain.anima_definition import (
    ANIMA_DISPLAY_NAME_MAX_CHARACTERS,
    ANIMA_IDENTITY_MAX_BYTES,
    normalize_identity,
)
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentIntegrityError,
    ContentKind,
    ContentPathError,
    ContentSource,
    ContentStatus,
)
from animama.domain.content_documents import (
    GestureDocumentV1,
    ReactionDocumentV1,
    VoiceDocumentV1,
)
from animama.domain.emotions import TRACKED_EMOTIONS
from animama.domain.runtime_content_descriptor import RuntimeContentRootSelection

from .content_file_validation import ContentFileInvalidError
from .content_gltf import MAX_VRM_SOURCE_BYTES, validate_vrm_stream
from .content_image import (
    MAX_APPEARANCE_DIMENSION,
    MAX_APPEARANCE_SOURCE_BYTES,
    MAX_IMAGE_PIXELS,
    validate_appearance_image_stream,
)
from .runtime_budget_policy import MAX_RUNTIME_BYTES, MAX_RUNTIME_CONFIG_BYTES, MAX_RUNTIME_ENTRIES
from .runtime_content_closure import RuntimeContentClosureCompiler
from .starter_idle_pool import resolve_starter_idle_pool
from .starter_loadout_policy import starter_loadout_policy, starter_pack_identity
from .typed_content_service import TypedCatalogItem, TypedContentAdmissionError, TypedContentService


@lru_cache(maxsize=1)
def creation_pocket_presets() -> frozenset[str]:
    """Read the same release selection that generates the browser voice catalog."""
    selection = json.loads(files("animama.resources").joinpath("pocket-voice-selection.json").read_text())
    return frozenset(voice["id"] for voice in selection["voices"])


@dataclass(frozen=True, slots=True)
class CreationSources:
    resolved: ResolvedAnimaSpec
    warnings: list[dict[str, Any]]


def item_ref(item: CatalogContentEntry) -> dict[str, str]:
    return {"item_id": item.id, "revision_sha256": item.revision_sha256 or ""}


def source_revisions(items: dict[str, TypedCatalogItem]) -> dict[str, dict[str, str]]:
    return {
        item_id: {"kind": typed.item.kind.value, "revision_sha256": typed.item.revision_sha256 or ""}
        for item_id, typed in sorted(items.items())
    }


class AnimaCreationSources:
    """No writes, reservations, scans, previews, providers, or runtime issuance."""

    def __init__(
        self, *, catalog: ContentCatalog, store: ContentStore, max_identity_bytes: int = ANIMA_IDENTITY_MAX_BYTES
    ) -> None:
        self.catalog = catalog
        self.store = store
        self.max_identity_bytes = min(ANIMA_IDENTITY_MAX_BYTES, max_identity_bytes)

    @staticmethod
    def _included(
        visible: dict[str, CatalogContentEntry], *, key: str, kind: ContentKind
    ) -> CatalogContentEntry | None:
        matches = [
            entry
            for entry in visible.values()
            if entry.source is ContentSource.INCLUDED and entry.logical_key == key and entry.kind is kind
        ]
        return matches[0] if len(matches) == 1 else None

    async def options(self, *, user_id: str) -> dict[str, Any]:
        """Expose server-derived policy selections and complete closure evidence."""

        visible = {item.id: item for item in await self.catalog.list_visible(user_id=user_id)}
        policy = starter_loadout_policy()
        admitted: dict[str, TypedCatalogItem] = {}
        diagnostics: list[AnimaCreationIssue] = []

        def include(key: str, kind: ContentKind, path: str) -> CatalogContentEntry | None:
            item = self._included(visible, key=key, kind=kind)
            if item is None:
                diagnostics.append(
                    AnimaCreationIssue("recommended_source_unavailable", "Recommended content is unavailable.", path)
                )
                return None
            try:
                closure = TypedContentService.resolve_closure(item_id=item.id, visible=visible)
            except TypedContentAdmissionError as exc:
                diagnostics.append(AnimaCreationIssue(exc.code, "Recommended content needs repair.", path, item.id))
                return None
            admitted.update((typed.item.id, typed) for typed in closure)
            return item

        gestures = []
        for choice in policy["gestures"]:
            item = include(choice["content_id"], ContentKind.GESTURE, "/recommended/gestures")
            if item is not None:
                gestures.append(
                    {
                        "semantic_key": cast(GestureDocumentV1, admitted[item.id].document).semantic_key,
                        "source": item_ref(item),
                    }
                )
        reactions: dict[str, dict[str, Any]] = {
            emotion: {str(level): None for level in (1, 2, 3)} for emotion in TRACKED_EMOTIONS
        }
        for choice in policy["reactions"]:
            item = include(choice["content_id"], ContentKind.REACTION, "/recommended/reactions")
            if item is not None:
                # The policy, not the mutable document hint, owns the starter cell.
                reactions[choice["emotion"]][str(choice["intensity"])] = item_ref(item)
        revisions = source_revisions(admitted)
        return {
            "schema_version": 1,
            "limits": {
                "display_name_max_characters": ANIMA_DISPLAY_NAME_MAX_CHARACTERS,
                "identity_max_bytes": self.max_identity_bytes,
                "avatar_max_bytes": MAX_VRM_SOURCE_BYTES,
                "image_max_bytes": MAX_APPEARANCE_SOURCE_BYTES,
                "image_max_dimension": MAX_APPEARANCE_DIMENSION,
                "image_max_pixels": MAX_IMAGE_PIXELS,
                "source_max_items": MAX_RUNTIME_ENTRIES,
                "source_max_bytes": MAX_RUNTIME_BYTES,
                "runtime_config_max_bytes": MAX_RUNTIME_CONFIG_BYTES,
            },
            "starter_pack": starter_pack_identity(),
            "recommended": {
                "gestures": sorted(gestures, key=lambda value: value["semantic_key"]),
                "reactions": reactions,
            },
            "counts": {
                "recommended_gestures": len(policy["gestures"]),
                "recommended_reaction_cells": len(policy["reactions"]),
                "available_gestures": len(gestures),
                "available_reaction_cells": sum(
                    value is not None for cells in reactions.values() for value in cells.values()
                ),
            },
            "expected_source_revisions": revisions,
            "diagnostics": bounded_issues(diagnostics),
        }

    async def resolve(self, *, user_id: str, spec: AnimaSpec) -> CreationSources:
        """Recheck all exact roots/supports and derive no-commit materializer input."""

        normalize_identity(spec.identity_markdown, max_bytes=self.max_identity_bytes)
        if spec.starter_pack.model_dump() != starter_pack_identity():
            raise AnimaCreationError(
                "anima_creation_sources_stale",
                status=409,
                retryable=True,
                message="The Starter Pack changed; review the draft again.",
                issues=[
                    AnimaCreationIssue("starter_policy_stale", "The Starter Pack revision changed.", "/starter_pack")
                ],
            )
        visible = {item.id: item for item in await self.catalog.list_visible(user_id=user_id)}
        roots: list[tuple[str, ContentKind, ItemRevisionRef]] = [("/avatar", ContentKind.AVATAR, spec.avatar)]
        voice = spec.voice
        if voice and voice.pocket.type == "clone":
            roots.append(("/voice/pocket/source", ContentKind.VOICE, voice.pocket.source))
        elif voice and voice.pocket.type == "preset" and voice.pocket.voice_id not in creation_pocket_presets():
            raise AnimaCreationError(
                issues=[
                    AnimaCreationIssue(
                        "voice_preset_unavailable", "Choose an available PocketTTS voice.", "/voice/pocket/voice_id"
                    )
                ]
            )
        for slot in ("profile", "background"):
            choice = getattr(spec.appearance, slot)
            if choice is not None:
                roots.append((f"/appearance/{slot}/source", ContentKind.APPEARANCE, choice.source))
        roots.extend(
            (f"/gestures/{index}/source", ContentKind.GESTURE, choice.source)
            for index, choice in enumerate(spec.gestures)
        )
        roots.extend(
            (f"/reactions/{emotion}/{level}", ContentKind.REACTION, source)
            for emotion, cells in spec.reactions.items()
            for level, source in cells.items()
            if source is not None
        )
        typed_items: dict[str, TypedCatalogItem] = {}
        origins: dict[str, tuple[str, str | None]] = {}
        selections = []
        for path, kind, reference in roots:
            item = visible.get(reference.item_id)
            action = reference.item_id if kind in {ContentKind.GESTURE, ContentKind.REACTION} else None
            if item is None:
                raise AnimaCreationError(
                    "anima_creation_source_unavailable",
                    status=404,
                    message="Selected content is unavailable.",
                    issues=[
                        AnimaCreationIssue(
                            "source_unavailable", "Selected content is unavailable.", path, reference.item_id, action
                        )
                    ],
                )
            if item.kind is not kind:
                raise AnimaCreationError(
                    issues=[
                        AnimaCreationIssue(
                            "source_kind_mismatch", "The source has the wrong content kind.", path, item.id, action
                        )
                    ]
                )
            self._revision(item, reference.revision_sha256, path, action)
            try:
                closure = TypedContentService.resolve_closure(item_id=item.id, visible=visible)
            except TypedContentAdmissionError as exc:
                code, status = {
                    "source_unavailable": ("anima_creation_source_unavailable", 404),
                    "source_scan_required": ("anima_creation_sources_stale", 409),
                }.get(exc.code, ("anima_creation_invalid", 422))
                raise AnimaCreationError(
                    code,
                    status=status,
                    retryable=status == 409,
                    issues=[
                        AnimaCreationIssue(
                            exc.code,
                            "The selected content or one of its required supports needs repair.",
                            path,
                            exc.item_id if exc.item_id in spec.expected_source_revisions else item.id,
                            action,
                        )
                    ],
                ) from exc
            for typed in closure:
                typed_items[typed.item.id] = typed
                origins.setdefault(typed.item.id, (path, action))
            selections.append(RuntimeContentRootSelection(slot_key=path, catalog_item_id=item.id, kind=kind))
        actual = source_revisions(typed_items)
        expected = spec.expected_source_revisions
        if set(actual) != set(expected):
            issues = [
                AnimaCreationIssue(
                    "source_revision_missing",
                    "A required source revision is missing.",
                    "/expected_source_revisions",
                    item_id,
                    origins[item_id][1],
                )
                for item_id in sorted(set(actual) - set(expected))
            ]
            issues.extend(
                AnimaCreationIssue(
                    "source_revision_extra",
                    "This item is outside the selected dependency closure.",
                    f"/expected_source_revisions/{item_id}",
                    item_id,
                )
                for item_id in sorted(set(expected) - set(actual))
            )
            raise AnimaCreationError(issues=issues)
        for item_id, typed in typed_items.items():
            path, action = origins[item_id]
            if expected[item_id].kind != typed.item.kind.value:
                raise AnimaCreationError(
                    issues=[
                        AnimaCreationIssue(
                            "source_kind_mismatch",
                            "The expected source kind is incorrect.",
                            f"/expected_source_revisions/{item_id}",
                            item_id,
                            action,
                        )
                    ]
                )
            self._revision(typed.item, expected[item_id].revision_sha256, path, action)
        for index, choice in enumerate(spec.gestures):
            if cast(GestureDocumentV1, typed_items[choice.source.item_id].document).semantic_key != choice.semantic_key:
                raise AnimaCreationError(
                    issues=[
                        AnimaCreationIssue(
                            "gesture_semantic_key_mismatch",
                            "The Gesture semantic key does not match its source.",
                            f"/gestures/{index}/semantic_key",
                            choice.source.item_id,
                            choice.source.item_id,
                        )
                    ]
                )
        voice_source = None
        speech_preferences = None
        if voice:
            if voice.pocket.type == "clone":
                clone = typed_items[voice.pocket.source.item_id]
                if not isinstance(clone.document, VoiceDocumentV1) or clone.document.codec != "pocket-tts-catalog-v1":
                    raise AnimaCreationError(
                        issues=[
                            AnimaCreationIssue(
                                "voice_codec_invalid",
                                "Choose a saved PocketTTS voice clone.",
                                "/voice/pocket/source",
                                clone.item.id,
                            )
                        ]
                    )
                voice_source = clone.item
            speech_preferences = {
                "tts_provider": voice.provider,
                "tts_pocket_anima_voice": voice.pocket.voice_id if voice.pocket.type == "preset" else "eve",
                "tts_pocket_anima_custom_voice_available": False,
                "elevenlabs": {"primary_voice": {"voice_id": voice.elevenlabs_voice_id}}
                if voice.elevenlabs_voice_id
                else {},
            }
        descriptor = await RuntimeContentClosureCompiler(catalog=self.catalog, store=self.store).compile(
            user_id=user_id,
            loadout_revision=1,
            selections=tuple(selections),
            visible_items=list(visible.values()),
            mark_scan_required=False,
        )
        if descriptor.diagnostics:
            stale = any(issue.code == "runtime_source_changed" for issue in descriptor.diagnostics)
            raise AnimaCreationError(
                "anima_creation_sources_stale" if stale else "anima_creation_invalid",
                status=409 if stale else 422,
                retryable=stale,
                issues=[
                    AnimaCreationIssue(
                        issue.code,
                        "A selected source cannot be admitted; repair or remove it explicitly.",
                        issue.slot_key,
                        issue.item_id,
                        origins.get(issue.item_id, ("", None))[1] if issue.item_id is not None else None,
                    )
                    for issue in descriptor.diagnostics
                ],
            )
        for item_id, typed in typed_items.items():
            self._validate_playable_files(typed, typed_items, origins[item_id])
            if typed.item.kind in {ContentKind.AVATAR, ContentKind.APPEARANCE}:
                await self._validate_media(typed.item, origins[item_id])

        def appearance(slot: str) -> ResolvedAppearanceSelection | None:
            choice = getattr(spec.appearance, slot)
            return (
                ResolvedAppearanceSelection(typed_items[choice.source.item_id].item, choice.presentation.model_dump())
                if choice
                else None
            )

        warnings = []
        if not spec.gestures:
            warnings.append(
                AnimaCreationIssue("no_gestures_selected", "This Anima has no Gestures selected.", "/gestures")
            )
        if not any(source is not None for cells in spec.reactions.values() for source in cells.values()):
            warnings.append(
                AnimaCreationIssue("no_reactions_selected", "This Anima has no Reactions selected.", "/reactions")
            )
        if spec.appearance.profile is None:
            warnings.append(
                AnimaCreationIssue(
                    "profile_portrait_unavailable", "No profile portrait was selected.", "/appearance/profile"
                )
            )
        return CreationSources(
            resolved=ResolvedAnimaSpec(
                speech_preferences=speech_preferences,
                voice_source=voice_source,
                display_name=spec.display_name,
                identity=spec.identity_markdown,
                avatar=typed_items[spec.avatar.item_id].item,
                idle=await resolve_starter_idle_pool(visible=visible, store=self.store),
                gestures=tuple(
                    ResolvedGestureSelection(typed_items[choice.source.item_id].item) for choice in spec.gestures
                ),
                reactions=tuple(
                    ResolvedReactionSelection(emotion, int(level), typed_items[source.item_id].item if source else None)
                    for emotion, cells in spec.reactions.items()
                    for level, source in cells.items()
                ),
                profile=appearance("profile"),
                background=appearance("background"),
            ),
            warnings=bounded_issues(warnings),
        )

    @staticmethod
    def _revision(item: CatalogContentEntry, expected: str, path: str, action: str | None) -> None:
        if item.status is ContentStatus.MISSING:
            raise AnimaCreationError(
                "anima_creation_source_unavailable",
                status=404,
                issues=[
                    AnimaCreationIssue("source_unavailable", "Selected content is unavailable.", path, item.id, action)
                ],
            )
        if item.status is ContentStatus.INVALID:
            raise AnimaCreationError(
                issues=[AnimaCreationIssue("source_invalid", "Selected content needs repair.", path, item.id, action)],
            )
        if item.revision_sha256 != expected or item.status is ContentStatus.SCAN_REQUIRED:
            raise AnimaCreationError(
                "anima_creation_sources_stale",
                status=409,
                retryable=True,
                message="Selected source content changed; review the draft again.",
                issues=[
                    AnimaCreationIssue(
                        "source_revision_stale",
                        "The visible source revision changed.",
                        path,
                        item.id,
                        action,
                        expected,
                        item.revision_sha256,
                    )
                ],
            )

    @staticmethod
    def _validate_playable_files(
        typed: TypedCatalogItem, items: dict[str, TypedCatalogItem], origin: tuple[str, str | None]
    ) -> None:
        """Require the implementation's registered bytes, not just a valid label."""

        document = typed.document
        files = [file for file in typed.item.files if file.role not in {"metadata", "descriptor"}]
        valid = True
        if isinstance(document, GestureDocumentV1 | ReactionDocumentV1):
            implementation = document.implementation
            if implementation.content_dependency_ref:
                targets = [
                    items[item_id]
                    for item_id in typed.item.dependency_item_ids
                    if items[item_id].item.logical_key == implementation.content_dependency_ref
                    or items[item_id].item.relative_locator == implementation.content_dependency_ref
                ]
                files = [
                    file
                    for target in targets
                    for file in target.item.files
                    if file.role not in {"metadata", "descriptor"}
                ]
            valid = bool(files) and (
                implementation.file_role is None or any(file.role == implementation.file_role for file in files)
            )
        if not valid:
            raise AnimaCreationError(
                issues=[
                    AnimaCreationIssue(
                        "implementation_file_unavailable",
                        "Required implementation files are unavailable.",
                        origin[0],
                        typed.item.id,
                        origin[1],
                    )
                ]
            )

    async def _validate_media(self, item: CatalogContentEntry, origin: tuple[str, str | None]) -> dict[str, Any]:
        role = "model" if item.kind is ContentKind.AVATAR else "image"
        files = [file for file in item.files if file.role == role]
        if len(files) != 1:
            raise AnimaCreationError(
                issues=[
                    AnimaCreationIssue(
                        "registered_media_invalid",
                        "Exactly one registered media file is required.",
                        origin[0],
                        item.id,
                        origin[1],
                    )
                ]
            )
        file = files[0]

        def validate() -> dict[str, Any]:
            opened = self.store.open_verified_file(
                source=file.source,
                source_mount_id=file.source_mount_id,
                relative_path=file.relative_path,
                expected_size_bytes=file.size_bytes,
                expected_sha256=file.sha256,
                media_type=file.media_type,
            )
            try:
                if item.kind is ContentKind.AVATAR:
                    return validate_vrm_stream(content=opened.handle, size_bytes=file.size_bytes)[1]
                return validate_appearance_image_stream(
                    extension=PurePosixPath(file.relative_path).suffix,
                    content=opened.handle,
                    size_bytes=file.size_bytes,
                    declared_content_type=file.media_type,
                ).metadata
            finally:
                opened.handle.close()

        try:
            return await asyncio.to_thread(validate)
        except ContentFileInvalidError as exc:
            raise AnimaCreationError(
                issues=[
                    AnimaCreationIssue(
                        exc.reason, "The selected media failed structural validation.", origin[0], item.id, origin[1]
                    )
                ]
            ) from exc
        except (ContentIntegrityError, ContentPathError, OSError) as exc:
            raise AnimaCreationError(
                "anima_creation_sources_stale",
                status=409,
                retryable=True,
                issues=[
                    AnimaCreationIssue(
                        "runtime_source_changed",
                        "Registered media changed; Rescan and review it again.",
                        origin[0],
                        item.id,
                        origin[1],
                    )
                ],
            ) from exc
