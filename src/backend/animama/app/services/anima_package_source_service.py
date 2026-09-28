"""Strict saved-authority projection and reverse mapping for portable Animas."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import ValidationError

from animama.app.contracts.portable_anima import PortableAnima
from animama.app.ports.anima_package_source import AnimaPackageSourceRepository, SavedAnimaPackageSource
from animama.app.ports.content_catalog import ContentCatalog
from animama.domain.anima_definition import ANIMA_IDENTITY_MAX_BYTES
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentConflictError,
    ContentKind,
    ContentNotFoundError,
    ContentSource,
    ContentStatus,
)
from animama.domain.content_documents import AppearanceDocumentV1, GestureDocumentV1, VoiceDocumentV1
from animama.domain.emotions import TRACKED_EMOTIONS

from .content_voice import POCKET_CLONE_CODEC
from .portable_anima_service import resolve_portable_anima
from .starter_loadout_policy import starter_loadout_policy
from .typed_content_service import TypedContentService


@dataclass(frozen=True, slots=True)
class AnimaPackageSnapshot:
    source: SavedAnimaPackageSource
    source_revisions: tuple[tuple[str, str], ...]


@dataclass(frozen=True, slots=True)
class AnimaExportProjection:
    definition: PortableAnima
    selected_item_ids: tuple[str, ...]
    snapshot: AnimaPackageSnapshot


class AnimaPackageSourceService:
    def __init__(
        self,
        *,
        sources: AnimaPackageSourceRepository,
        catalog: ContentCatalog,
        max_identity_bytes: int = ANIMA_IDENTITY_MAX_BYTES,
    ) -> None:
        self.sources = sources
        self.catalog = catalog
        self.max_identity_bytes = min(max_identity_bytes, ANIMA_IDENTITY_MAX_BYTES)

    async def capture(
        self,
        *,
        user_id: str,
        anima_id: str,
        expected_aggregate_revision: int | None = None,
        expected_loadout_revision: int | None = None,
    ) -> AnimaExportProjection:
        """Read complete saved choices; an invalid explicit choice never falls back."""
        source = await self.sources.read_owned(user_id=user_id, anima_id=anima_id)
        if (expected_aggregate_revision is not None and source.aggregate_revision != expected_aggregate_revision) or (
            expected_loadout_revision is not None and source.loadout_revision != expected_loadout_revision
        ):
            raise ContentConflictError("package_anima_source_changed")
        visible = {item.id: item for item in await self.catalog.list_visible(user_id=user_id)}
        selected: dict[str, CatalogContentEntry] = {}

        def select_item(item_id: str, kind: ContentKind) -> CatalogContentEntry:
            item = visible.get(item_id)
            if item is None or item.status is not ContentStatus.VALID or item.revision_sha256 is None:
                raise ContentConflictError("package_anima_source_unavailable")
            if item.kind is not kind:
                raise ContentConflictError("package_anima_source_kind_invalid")
            selected[item.id] = item
            return item

        def included(logical_key: str, kind: ContentKind) -> CatalogContentEntry:
            candidates = [
                item
                for item in visible.values()
                if item.source is ContentSource.INCLUDED and item.logical_key == logical_key
            ]
            if len(candidates) != 1:
                raise ContentConflictError("package_anima_starter_unavailable")
            return select_item(candidates[0].id, kind)

        policy = starter_loadout_policy(source.starter_catalog_version)
        exclusions: set[tuple[str, str]] = set()
        for exclusion in source.starter_exclusions:
            if (
                not isinstance(exclusion, dict)
                or set(exclusion) != {"slot", "runtime_id"}
                or not all(isinstance(value, str) for value in exclusion.values())
            ):
                raise ContentConflictError("package_anima_exclusions_invalid")
            exclusions.add((exclusion["slot"], exclusion["runtime_id"]))
        rows = {row.slot_key: row for row in source.bindings}
        if len(rows) != len(source.bindings):
            raise ContentConflictError("package_anima_bindings_invalid")
        gestures: list[dict[str, Any]] = []
        reactions: dict[str, dict[str, Any]] = {
            emotion: {str(level): None for level in (1, 2, 3)} for emotion in TRACKED_EMOTIONS
        }
        appearance: dict[str, Any] = {"profile": None, "background": None}
        avatar: str | None = None
        idle: str | None = None
        pocket_voice: str | None = None
        for row in source.bindings:
            if row.kind == "music_track" or row.kind == "voice" and source.effective_tts_provider != "pocket_tts":
                continue
            try:
                kind = ContentKind(row.kind)
                item = select_item(row.catalog_item_id, kind)
                document = TypedContentService.parse(item).document
            except (ValueError, ContentNotFoundError) as exc:
                raise ContentConflictError("package_anima_source_invalid") from exc
            if kind is ContentKind.GESTURE and isinstance(document, GestureDocumentV1):
                if row.slot_key != f"gesture:{document.semantic_key}":
                    raise ContentConflictError("package_anima_gesture_key_mismatch")
                gestures.append({"semantic_key": document.semantic_key, "entry_id": item.id, "config": row.config})
            elif kind is ContentKind.REACTION and row.slot_key.startswith("reaction:"):
                emotion, _, level = row.slot_key.removeprefix("reaction:").rpartition("-")
                if emotion not in reactions or level not in reactions[emotion]:
                    raise ContentConflictError("package_anima_reaction_cell_invalid")
                reactions[emotion][level] = {"entry_id": item.id, "config": row.config}
            elif kind is ContentKind.AVATAR and row.slot_key == "avatar" and not row.config:
                avatar = item.id
            elif kind is ContentKind.IDLE_STYLE and row.slot_key == "idle-style" and not row.config:
                idle = item.id
            elif (
                kind is ContentKind.VOICE
                and row.slot_key == "voice"
                and not row.config
                and isinstance(document, VoiceDocumentV1)
                and document.codec == POCKET_CLONE_CODEC
                and not document.dependencies
            ):
                pocket_voice = item.id
            elif (
                kind is ContentKind.APPEARANCE
                and isinstance(document, AppearanceDocumentV1)
                and row.slot_key in {"appearance:profile", "appearance:background"}
            ):
                fields = {"fit", "focal_x", "focal_y", "zoom"}
                if set(row.config) - fields:
                    raise ContentConflictError("package_anima_binding_config_invalid")
                presentation = {"fit": "cover", "focal_x": 0.5, "focal_y": 0.5, "zoom": 1.0}
                presentation.update({key: value for key, value in document.presentation.items() if key in fields})
                presentation.update(row.config)
                appearance[row.slot_key.split(":")[1]] = {"entry_id": item.id, "presentation": presentation}
            else:
                raise ContentConflictError("package_anima_binding_unsupported")
        for starter in policy["gestures"]:
            key = starter["content_id"].rsplit(":", 1)[-1]
            if f"gesture:{key}" not in rows and ("gesture", key) not in exclusions:
                item = included(starter["content_id"], ContentKind.GESTURE)
                gestures.append({"semantic_key": key, "entry_id": item.id, "config": {}})
        for starter in policy["reactions"]:
            emotion, level = starter["emotion"], str(starter["intensity"])
            if f"reaction:{emotion}-{level}" not in rows and ("reaction", f"{emotion}-{level}") not in exclusions:
                item = included(starter["content_id"], ContentKind.REACTION)
                reactions[emotion][level] = {"entry_id": item.id, "config": {}}
        if "idle-style" not in rows and not source.idle_style_empty:
            idle = included("builtin:idle-style:starter", ContentKind.IDLE_STYLE).id
        if avatar is None:
            if source.avatar_catalog_item_id is not None:
                avatar = select_item(source.avatar_catalog_item_id, ContentKind.AVATAR).id
            else:
                locator = (source.avatar_relative_locator or "").removeprefix("/shared/")
                candidates = [
                    item
                    for item in visible.values()
                    if item.source is ContentSource.INCLUDED
                    and item.relative_locator == locator
                    and item.kind is ContentKind.AVATAR
                ]
                if len(candidates) != 1:
                    raise ContentConflictError("package_anima_avatar_unavailable")
                avatar = select_item(candidates[0].id, ContentKind.AVATAR).id
        try:
            definition = PortableAnima.model_validate(
                {
                    "display_name": source.display_name,
                    "identity_markdown": source.identity_markdown,
                    "avatar": avatar,
                    "gestures": gestures,
                    "reactions": reactions,
                    "idle_style": idle,
                    "appearance": appearance,
                    "pocket_voice": pocket_voice,
                }
            )
        except ValidationError as exc:
            raise ContentConflictError("package_anima_definition_invalid") from exc
        resolve_portable_anima(definition, selected, max_identity_bytes=self.max_identity_bytes)
        snapshot = AnimaPackageSnapshot(
            source, tuple(sorted((item.id, item.revision_sha256 or "") for item in selected.values()))
        )
        return AnimaExportProjection(
            definition, tuple(item_id for item_id, _ in definition.entry_references()), snapshot
        )

    async def recheck(self, *, user_id: str, snapshot: AnimaPackageSnapshot) -> None:
        """Reject authority or selected-source changes before sealing an export cache."""
        if user_id != snapshot.source.owner_user_id:
            raise ContentConflictError("package_anima_source_changed")
        current = await self.capture(user_id=user_id, anima_id=snapshot.source.anima_id)
        if current.snapshot != snapshot:
            raise ContentConflictError("package_anima_source_changed")
