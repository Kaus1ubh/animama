"""Plan and commit typed catalog selections on one Anima loadout."""

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Any, Literal, cast
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.avatar_repo import SQLAlchemyAvatarRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.starter_loadout_policy import starter_loadout_policy
from animama.app.services.typed_content_service import TypedCatalogItem, TypedContentService
from animama.domain.anima_creation import ResolvedAnimaSpec
from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.anima_loadout import (
    AnimaLoadout,
    AnimaLoadoutError,
    AppearanceBinding,
    CatalogLoadoutSource,
    GestureBinding,
    IdleAnimationSummary,
    IdleStyleBinding,
    LoadoutCommitResult,
    LoadoutDiagnostic,
    LoadoutPlan,
    MusicTrackBinding,
    ReactionCell,
)
from animama.domain.content_catalog import CatalogContentEntry, ContentKind, ContentSource, ContentStatus
from animama.domain.content_documents import (
    AppearanceDocumentV1,
    AvatarDocumentV1,
    GestureDocumentV1,
    IdleStyleDocumentV1,
    MusicTrackDocumentV1,
    ReactionDocumentV1,
    VoiceDocumentV1,
)
from animama.domain.emotions import TRACKED_EMOTIONS
from animama.orm.anima import ORMAnima
from animama.orm.anima_loadout import (
    ORMAnimaLoadout,
    ORMAnimaLoadoutDiagnostic,
    ORMAnimaLoadoutMutationReceipt,
)
from animama.orm.content_catalog import ORMAnimaContentBinding

LoadoutFamily = Literal[
    "gesture",
    "reaction",
    "idle_style",
    "music_track",
    "avatar",
    "appearance",
    "voice",
]


def _canonical(value: object) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def _digest(value: object) -> str:
    return hashlib.sha256(_canonical(value).encode()).hexdigest()


def _source(value: TypedCatalogItem) -> CatalogLoadoutSource:
    return CatalogLoadoutSource(
        catalog_item_id=value.item.id,
        source=value.item.source,
        logical_key=value.item.logical_key,
    )


def _implementation_kind(document: GestureDocumentV1) -> Literal["anima_clip", "vrma"]:
    return cast(Literal["anima_clip", "vrma"], document.implementation.kind)


class AnimaLoadoutService:
    """Typed aggregate over the neutral catalog and logical binding table."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._catalog = SQLAlchemyContentCatalog(session)
        self._animas = SQLAlchemyAnimaRepository(session)

    async def _root(self, *, user_id: str, anima_id: str, lock: bool = False) -> ORMAnimaLoadout:
        statement = select(ORMAnimaLoadout).where(
            ORMAnimaLoadout.anima_id == anima_id,
            ORMAnimaLoadout.owner_user_id == user_id,
        )
        if lock:
            statement = statement.with_for_update().execution_options(populate_existing=True)
        root = (await self._session.execute(statement)).scalar_one_or_none()
        if root is None:
            raise AnimaLoadoutError("anima_not_found")
        return root

    async def _aggregate_revision(self, *, user_id: str, anima_id: str) -> int:
        revision = await self._session.scalar(
            select(ORMAnima.aggregate_revision).where(
                ORMAnima.id == anima_id,
                ORMAnima.user_id == user_id,
            )
        )
        if revision is None:
            raise AnimaLoadoutError("anima_not_found")
        return revision

    async def _visible(self, user_id: str) -> tuple[list[CatalogContentEntry], dict[str, TypedCatalogItem]]:
        visible = await self._catalog.list_visible(user_id=user_id)
        parsed: dict[str, TypedCatalogItem] = {}
        for item in visible:
            if item.status is not ContentStatus.VALID or item.revision_sha256 is None:
                continue
            try:
                parsed[item.id] = TypedContentService.parse(item)
            except Exception:
                # Content Health owns malformed-item diagnostics. Loadout reads
                # continue so one bad item cannot disable the whole companion.
                continue
        return visible, parsed

    async def _bindings(self, anima_id: str) -> list[ORMAnimaContentBinding]:
        return list(
            (
                await self._session.execute(
                    select(ORMAnimaContentBinding)
                    .where(ORMAnimaContentBinding.anima_id == anima_id)
                    .order_by(ORMAnimaContentBinding.slot_key)
                )
            ).scalars()
        )

    async def read_model(self, *, user_id: str, anima_id: str) -> AnimaLoadout:
        """Return effective defaults plus custom typed catalog selections."""

        root = await self._root(user_id=user_id, anima_id=anima_id)
        visible, parsed = await self._visible(user_id)
        by_logical = {value.item.logical_key: value for value in parsed.values() if value.item.logical_key is not None}
        rows = await self._bindings(anima_id)
        rows_by_slot = {row.slot_key: row for row in rows}
        exclusions = {
            (str(value.get("slot")), str(value.get("runtime_id")))
            for value in root.starter_exclusions
            if isinstance(value, dict)
        }
        warnings: list[LoadoutDiagnostic] = []

        diagnostic_rows = list(
            (
                await self._session.execute(
                    select(ORMAnimaLoadoutDiagnostic)
                    .where(ORMAnimaLoadoutDiagnostic.anima_id == anima_id)
                    .order_by(ORMAnimaLoadoutDiagnostic.created_at)
                )
            ).scalars()
        )
        warnings.extend(
            LoadoutDiagnostic(
                code=row.code,
                message="A legacy direct component binding was removed; its content remains in the Library.",
                scope="source",
            )
            for row in diagnostic_rows
        )

        def selected(row: ORMAnimaContentBinding, expected: ContentKind) -> TypedCatalogItem | None:
            value = parsed.get(row.catalog_item_id)
            if value is None or value.item.kind is not expected:
                warnings.append(
                    LoadoutDiagnostic(
                        code="loadout_source_unavailable",
                        message=f"{row.slot_key} is unavailable and will be omitted until corrected.",
                        scope="source",
                    )
                )
                return None
            return value

        gestures: list[GestureBinding] = []
        occupied_gesture_keys: set[str] = set()
        for row in rows:
            if row.kind != ContentKind.GESTURE.value:
                continue
            value = selected(row, ContentKind.GESTURE)
            if value is None or not isinstance(value.document, GestureDocumentV1):
                continue
            semantic_key = value.document.semantic_key
            if row.slot_key != f"gesture:{semantic_key}" or semantic_key in occupied_gesture_keys:
                warnings.append(
                    LoadoutDiagnostic(
                        code="gesture_semantic_key_conflict",
                        message=f"Gesture {value.document.name} has a conflicting semantic key.",
                    )
                )
                continue
            occupied_gesture_keys.add(semantic_key)
            gestures.append(
                GestureBinding(
                    binding_id=row.id,
                    name=value.document.name,
                    description=value.document.description,
                    semantic_key=semantic_key,
                    origin="custom",
                    implementation_kind=_implementation_kind(value.document),
                    source=_source(value),
                    config_overrides=dict(row.config),
                )
            )

        starter = starter_loadout_policy(root.starter_catalog_version)
        disabled_starters: list[str] = []
        starter_implementation_kinds: dict[str, Literal["anima_clip", "vrma"]] = {}
        for raw in starter.get("gestures", []):
            if not isinstance(raw, dict):
                continue
            content_id = str(raw.get("content_id") or "")
            semantic_key = content_id.rsplit(":", 1)[-1]
            value = by_logical.get(content_id)
            if value is not None and isinstance(value.document, GestureDocumentV1):
                starter_implementation_kinds[semantic_key] = _implementation_kind(value.document)
            if ("gesture", semantic_key) in exclusions:
                disabled_starters.append(semantic_key)
                continue
            if semantic_key in occupied_gesture_keys:
                continue
            if value is None or not isinstance(value.document, GestureDocumentV1):
                warnings.append(
                    LoadoutDiagnostic(
                        code="starter_gesture_unavailable",
                        message=f"Included Gesture {semantic_key} is unavailable.",
                        scope="source",
                    )
                )
                continue
            gestures.append(
                GestureBinding(
                    binding_id=f"starter:{content_id}@{raw.get('version', 1)}",
                    name=value.document.name,
                    description=value.document.description,
                    semantic_key=semantic_key,
                    origin="starter",
                    implementation_kind=_implementation_kind(value.document),
                    source=_source(value),
                )
            )

        starter_reactions = {
            (str(raw.get("emotion")), int(raw.get("intensity", 0))): raw
            for raw in starter.get("reactions", [])
            if isinstance(raw, dict) and isinstance(raw.get("intensity"), int)
        }
        reactions: list[ReactionCell] = []
        for emotion in sorted(TRACKED_EMOTIONS):
            for intensity in (1, 2, 3):
                slot = f"reaction:{emotion}-{intensity}"
                row = rows_by_slot.get(slot)
                if row is not None:
                    value = selected(row, ContentKind.REACTION)
                    if value is not None and isinstance(value.document, ReactionDocumentV1):
                        reactions.append(
                            ReactionCell(
                                emotion=emotion,
                                intensity=intensity,
                                state="custom",
                                binding_id=row.id,
                                name=value.document.name,
                                source=_source(value),
                                config_overrides=dict(row.config),
                            )
                        )
                        continue
                if ("reaction", f"{emotion}-{intensity}") in exclusions:
                    reactions.append(ReactionCell(emotion, intensity, "empty"))
                    continue
                raw = starter_reactions.get((emotion, intensity))
                value = by_logical.get(str(raw.get("content_id"))) if raw else None
                if value is not None and isinstance(value.document, ReactionDocumentV1):
                    reactions.append(
                        ReactionCell(
                            emotion=emotion,
                            intensity=intensity,
                            state="starter",
                            binding_id=f"starter:{value.item.logical_key}@{raw.get('version', 1)}",
                            name=value.document.name,
                            source=_source(value),
                        )
                    )
                else:
                    reactions.append(ReactionCell(emotion, intensity, "empty"))

        idle_row = rows_by_slot.get("idle-style")
        idle_value = selected(idle_row, ContentKind.IDLE_STYLE) if idle_row is not None else None
        idle_state: Literal["starter", "custom", "empty"]
        if idle_value is not None and isinstance(idle_value.document, IdleStyleDocumentV1):
            idle_state = "custom"
            idle_config = dict(idle_row.config) if idle_row is not None else {}
        elif root.idle_style_empty:
            idle_state = "empty"
            idle_value = None
            idle_config = {}
        else:
            idle_state = "starter"
            idle_value = by_logical.get("builtin:idle-style:starter")
            idle_config = {}
        if idle_value is not None and isinstance(idle_value.document, IdleStyleDocumentV1):
            idle_document = idle_value.document
            raw_overrides = idle_config.get("pool_overrides", {})
            if not isinstance(raw_overrides, dict):
                raw_overrides = {}
            overrides = {
                str(key): tuple(str(item) for item in value)
                for key, value in raw_overrides.items()
                if isinstance(value, list)
            }
            effective_default = overrides.get("default", idle_document.default_pool)
            effective_emotions = dict(idle_document.emotion_pools)
            effective_emotions.update({key: value for key, value in overrides.items() if key != "default"})
            idle_style = IdleStyleBinding(
                state=idle_state,
                name=idle_document.name,
                description=idle_document.description,
                source=_source(idle_value),
                animations=tuple(
                    IdleAnimationSummary(value.animation_id, value.name, value.description)
                    for value in idle_document.animations
                ),
                document_default_pool=idle_document.default_pool,
                document_emotion_pools=idle_document.emotion_pools,
                effective_default_pool=effective_default,
                effective_emotion_pools=effective_emotions,
                pool_overrides=overrides,
                cross_fade_seconds=idle_document.cross_fade_seconds,
            )
        else:
            idle_style = IdleStyleBinding(state="empty")

        music_tracks: list[MusicTrackBinding] = []
        appearances: list[AppearanceBinding] = []
        avatar_source: CatalogLoadoutSource | None = None
        voice_source: CatalogLoadoutSource | None = None
        for row in rows:
            value = parsed.get(row.catalog_item_id)
            if value is None:
                continue
            if row.kind == ContentKind.MUSIC_TRACK.value and isinstance(value.document, MusicTrackDocumentV1):
                config = dict(row.config)
                music_tracks.append(
                    MusicTrackBinding(
                        binding_id=row.id,
                        item_id=value.item.id,
                        name=value.document.name,
                        description=value.document.description,
                        source=_source(value),
                        enabled=bool(config.get("enabled", True)),
                        autoplay=bool(config.get("autoplay", value.document.autoplay)),
                        effective_loop=bool(config.get("loop", value.document.loop)),
                        effective_gain=float(config.get("gain", value.document.gain)),
                        loop_override=config.get("loop") if isinstance(config.get("loop"), bool) else None,
                        gain_override=(
                            float(config["gain"])
                            if isinstance(config.get("gain"), int | float) and not isinstance(config.get("gain"), bool)
                            else None
                        ),
                        duration_seconds=value.document.duration_seconds,
                        codec=value.document.codec,
                    )
                )
            elif row.kind == ContentKind.AVATAR.value and isinstance(value.document, AvatarDocumentV1):
                avatar_source = _source(value)
            elif row.kind == ContentKind.VOICE.value and isinstance(value.document, VoiceDocumentV1):
                voice_source = _source(value)
            elif row.kind == ContentKind.APPEARANCE.value and isinstance(value.document, AppearanceDocumentV1):
                use = row.slot_key.split(":", 1)[-1]
                if use in {"profile", "background"}:
                    appearances.append(
                        AppearanceBinding(
                            binding_id=row.id,
                            use=cast(Literal["profile", "background"], use),
                            item_id=value.item.id,
                            name=value.document.name,
                            source=_source(value),
                            width=value.document.width,
                            height=value.document.height,
                            presentation={**value.document.presentation, **dict(row.config)},
                        )
                    )

        result = AnimaLoadout(
            anima_id=anima_id,
            revision=root.revision,
            aggregate_revision=await self._aggregate_revision(user_id=user_id, anima_id=anima_id),
            starter_version=root.starter_catalog_version,
            gestures=tuple(sorted(gestures, key=lambda value: (value.origin != "custom", value.name.casefold()))),
            disabled_starter_gestures=tuple(sorted(disabled_starters)),
            reactions=tuple(reactions),
            idle_style=idle_style,
            music_tracks=tuple(sorted(music_tracks, key=lambda value: value.name.casefold())),
            avatar_source=avatar_source,
            appearances=tuple(appearances),
            voice_source=voice_source,
            warnings=tuple(warnings),
        )
        # Retain the map on the service for the schema mapper without adding a
        # second persistence field to the framework-neutral aggregate.
        self.starter_gesture_implementation_kinds = starter_implementation_kinds
        return result

    async def _target(
        self,
        *,
        user_id: str,
        source: object,
        expected_kind: ContentKind,
        lock: bool = False,
    ) -> TypedCatalogItem:
        if not isinstance(source, dict) or source.get("type") != "catalog":
            raise AnimaLoadoutError("catalog_source_required")
        item_id = source.get("catalog_item_id")
        if not isinstance(item_id, str) or not item_id:
            raise AnimaLoadoutError("catalog_source_required")
        item = await self._catalog.get_visible_item(item_id=item_id, user_id=user_id, for_update=lock)
        if item is None or item.status is not ContentStatus.VALID or item.kind is not expected_kind:
            raise AnimaLoadoutError("loadout_source_unavailable")
        try:
            return TypedContentService.parse(item)
        except Exception as exc:
            raise AnimaLoadoutError("loadout_source_invalid") from exc

    async def _plan(
        self,
        *,
        root: ORMAnimaLoadout,
        user_id: str,
        family: LoadoutFamily,
        intent: dict[str, Any],
        lock_sources: bool = False,
    ) -> tuple[LoadoutPlan, TypedCatalogItem | None, str | None, ORMAnimaContentBinding | None]:
        operation = str(intent.get("operation") or "")
        rows = await self._bindings(root.anima_id)
        target: TypedCatalogItem | None = None
        slot: str | None = None
        current: ORMAnimaContentBinding | None = None
        expected_kind = ContentKind(family)

        if lock_sources and isinstance(intent.get("source"), dict):
            # Lock before parsing: source deletion cannot pass its reference
            # check while a newly committed binding is being assembled.
            await self._target(user_id=user_id, source=intent["source"], expected_kind=expected_kind, lock=True)

        if family == "gesture":
            if operation in {"add", "update", "reconfigure"}:
                target = await self._target(user_id=user_id, source=intent.get("source"), expected_kind=expected_kind)
                document = cast(GestureDocumentV1, target.document)
                slot = f"gesture:{document.semantic_key}"
                binding_id = intent.get("binding_id")
                if binding_id:
                    current = next(
                        (row for row in rows if row.id == binding_id and row.kind == ContentKind.GESTURE.value),
                        None,
                    )
                    if current is None:
                        raise AnimaLoadoutError("gesture_binding_unavailable")
                    conflict = next(
                        (row for row in rows if row.slot_key == slot and row.id != current.id),
                        None,
                    )
                    if conflict is not None:
                        raise AnimaLoadoutError("gesture_semantic_key_conflict")
                else:
                    current = next((row for row in rows if row.slot_key == slot), None)
                action = "update" if current else "add"
            elif operation in {"remove"}:
                current = next(
                    (
                        row
                        for row in rows
                        if row.id == intent.get("binding_id") and row.kind == ContentKind.GESTURE.value
                    ),
                    None,
                )
                slot = current.slot_key if current else None
                action = "remove" if current else "unchanged"
            elif operation in {"disable_starter", "restore_starter"}:
                starter_id = intent.get("starter_id")
                if not isinstance(starter_id, str) or not starter_id:
                    raise AnimaLoadoutError("starter_id_required")
                slot = f"gesture:{starter_id}"
                action = "leave_empty" if operation == "disable_starter" else "revert"
            else:
                raise AnimaLoadoutError("gesture_operation_invalid")
        elif family == "reaction":
            emotion = str(intent.get("emotion") or "")
            intensity = intent.get("intensity")
            if emotion not in TRACKED_EMOTIONS or intensity not in {1, 2, 3}:
                raise AnimaLoadoutError("reaction_cell_invalid")
            slot = f"reaction:{emotion}-{intensity}"
            current = next((row for row in rows if row.slot_key == slot), None)
            if operation in {"add", "replace", "update", "reconfigure"}:
                target = await self._target(user_id=user_id, source=intent.get("source"), expected_kind=expected_kind)
                action = "replace" if current else "add"
            elif operation == "revert":
                action = "revert"
            elif operation == "leave_empty":
                action = "leave_empty"
            else:
                raise AnimaLoadoutError("reaction_operation_invalid")
        elif family == "idle_style":
            slot = "idle-style"
            current = next((row for row in rows if row.slot_key == slot), None)
            if operation in {"set", "update", "reconfigure"}:
                target = await self._target(user_id=user_id, source=intent.get("source"), expected_kind=expected_kind)
                document = cast(IdleStyleDocumentV1, target.document)
                overrides = intent.get("pool_overrides", {})
                if not isinstance(overrides, dict):
                    raise AnimaLoadoutError("idle_pool_overrides_invalid")
                animation_ids = {animation.animation_id for animation in document.animations}
                for key, values in overrides.items():
                    if key != "default" and key not in TRACKED_EMOTIONS:
                        raise AnimaLoadoutError("idle_pool_overrides_invalid")
                    if not isinstance(values, list) or not values or not set(values).issubset(animation_ids):
                        raise AnimaLoadoutError("idle_pool_overrides_invalid")
                action = "update" if current else "add"
            elif operation == "revert":
                action = "revert"
            elif operation == "leave_empty":
                action = "leave_empty"
            else:
                raise AnimaLoadoutError("idle_style_operation_invalid")
        elif family == "music_track":
            binding_id = intent.get("binding_id")
            current = (
                next(
                    (row for row in rows if row.id == binding_id and row.kind == ContentKind.MUSIC_TRACK.value),
                    None,
                )
                if binding_id
                else None
            )
            if binding_id and current is None and operation != "remove":
                raise AnimaLoadoutError("music_binding_unavailable")
            if operation in {"add", "update", "reconfigure"}:
                target = await self._target(user_id=user_id, source=intent.get("source"), expected_kind=expected_kind)
                duplicate = next(
                    (
                        row
                        for row in rows
                        if row.kind == ContentKind.MUSIC_TRACK.value
                        and row.catalog_item_id == target.item.id
                        and (current is None or row.id != current.id)
                    ),
                    None,
                )
                if duplicate is not None:
                    raise AnimaLoadoutError("music_track_already_equipped")
                slot = current.slot_key if current else f"music:{target.item.id}"
                gain = intent.get("gain")
                if gain is not None and (
                    isinstance(gain, bool) or not isinstance(gain, int | float) or not 0 <= float(gain) <= 2
                ):
                    raise AnimaLoadoutError("music_gain_invalid")
                if bool(intent.get("autoplay", False)) and not bool(intent.get("enabled", True)):
                    raise AnimaLoadoutError("music_autoplay_requires_enabled")
                action = "update" if current else "add"
            elif operation == "remove":
                slot = current.slot_key if current else None
                action = "remove" if current else "unchanged"
            else:
                raise AnimaLoadoutError("music_operation_invalid")
        elif family in {"avatar", "voice"}:
            slot = family
            current = next((row for row in rows if row.slot_key == slot), None)
            if operation == "set":
                target = await self._target(user_id=user_id, source=intent.get("source"), expected_kind=expected_kind)
                action = "update" if current else "add"
            elif operation == "remove":
                action = "remove" if current else "unchanged"
                if family == "avatar" and current is None:
                    avatar_id = await self._session.scalar(
                        select(ORMAnima.avatar_id).where(ORMAnima.id == root.anima_id)
                    )
                    if avatar_id is not None:
                        action = "remove"
            else:
                raise AnimaLoadoutError(f"{family}_operation_invalid")
        else:
            use = intent.get("use")
            if use not in {"profile", "background"}:
                raise AnimaLoadoutError("appearance_use_invalid")
            slot = f"appearance:{use}"
            current = next((row for row in rows if row.slot_key == slot), None)
            if operation == "set":
                target = await self._target(user_id=user_id, source=intent.get("source"), expected_kind=expected_kind)
                action = "update" if current else "add"
            elif operation == "remove":
                action = "remove" if current else "unchanged"
            else:
                raise AnimaLoadoutError("appearance_operation_invalid")

        visible = {item.id: item for item in await self._catalog.list_visible(user_id=user_id)}
        counts: dict[str, int] = {}
        if target is not None:
            pending = list(target.item.dependency_item_ids)
            seen: set[str] = set()
            while pending:
                item_id = pending.pop()
                if item_id in seen:
                    continue
                seen.add(item_id)
                item = visible.get(item_id)
                if item is None:
                    continue
                counts[item.kind.value] = counts.get(item.kind.value, 0) + 1
                pending.extend(item.dependency_item_ids)
        final_gesture_count = sum(row.kind == ContentKind.GESTURE.value for row in rows)
        if family == "gesture":
            final_gesture_count += int(action == "add") - int(action == "remove")
        identity = {
            "anima_id": root.anima_id,
            "revision": root.revision,
            "aggregate_revision": await self._aggregate_revision(user_id=user_id, anima_id=root.anima_id),
            "family": family,
            "intent": intent,
            "action": action,
            "target_revision": target.item.revision_sha256 if target else None,
        }
        plan = LoadoutPlan(
            action=cast(Any, action),
            digest=_digest(identity),
            current_name=current.slot_key if current else None,
            target_name=target.document.name if target else None,
            included_resource_counts=counts,
            final_gesture_count=max(0, final_gesture_count),
            aggregate_revision=identity["aggregate_revision"],
        )
        return plan, target, slot, current

    async def plan(
        self,
        *,
        user_id: str,
        anima_id: str,
        family: LoadoutFamily,
        expected_revision: int,
        intent: dict[str, Any],
    ) -> LoadoutPlan:
        root = await self._root(user_id=user_id, anima_id=anima_id)
        if root.revision != expected_revision:
            raise AnimaLoadoutError("loadout_revision_conflict", current_revision=root.revision)
        plan, _, _, _ = await self._plan(root=root, user_id=user_id, family=family, intent=intent)
        return plan

    @staticmethod
    def _set_exclusion(root: ORMAnimaLoadout, *, slot: str, runtime_id: str, excluded: bool) -> None:
        values = [
            value
            for value in root.starter_exclusions
            if not (isinstance(value, dict) and value.get("slot") == slot and value.get("runtime_id") == runtime_id)
        ]
        if excluded:
            values.append({"slot": slot, "runtime_id": runtime_id})
        root.starter_exclusions = values

    async def _upsert(
        self,
        *,
        root: ORMAnimaLoadout,
        slot: str,
        kind: ContentKind,
        target: TypedCatalogItem,
        config: dict[str, Any],
        current: ORMAnimaContentBinding | None,
    ) -> None:
        existing = (
            current
            or (
                await self._session.execute(
                    select(ORMAnimaContentBinding).where(
                        ORMAnimaContentBinding.anima_id == root.anima_id,
                        ORMAnimaContentBinding.slot_key == slot,
                    )
                )
            ).scalar_one_or_none()
        )
        if existing is not None and existing.slot_key != slot:
            await self._session.delete(existing)
            existing = None
        if existing is None:
            self._session.add(
                ORMAnimaContentBinding(
                    id=str(uuid4()),
                    anima_id=root.anima_id,
                    slot_key=slot,
                    catalog_item_id=target.item.id,
                    kind=kind.value,
                    config=config,
                )
            )
        else:
            existing.catalog_item_id = target.item.id
            existing.kind = kind.value
            existing.config = config

    async def commit(
        self,
        *,
        user_id: str,
        anima_id: str,
        family: LoadoutFamily,
        expected_revision: int,
        intent: dict[str, Any],
        plan_digest: str,
        idempotency_key: str,
    ) -> LoadoutCommitResult:
        """Recheck a reviewed plan and atomically persist one typed intent."""

        # The common lock serializes identity/name and equipment edits as well
        # as concurrent retries of the same loadout idempotency receipt.
        try:
            definition = await self._animas.lock_definition(user_id=user_id, anima_id=anima_id)
        except AnimaDefinitionError as exc:
            raise AnimaLoadoutError(exc.code, current_revision=exc.current_revision) from exc
        request_digest = _digest(
            {
                "anima_id": anima_id,
                "family": family,
                "expected_revision": expected_revision,
                "intent": intent,
                "plan_digest": plan_digest,
            }
        )
        receipt = (
            await self._session.execute(
                select(ORMAnimaLoadoutMutationReceipt).where(
                    ORMAnimaLoadoutMutationReceipt.owner_user_id == user_id,
                    ORMAnimaLoadoutMutationReceipt.anima_id == anima_id,
                    ORMAnimaLoadoutMutationReceipt.idempotency_key == idempotency_key,
                )
            )
        ).scalar_one_or_none()
        if receipt is not None:
            if receipt.request_digest != request_digest:
                raise AnimaLoadoutError("idempotency_key_reused")
            return LoadoutCommitResult(
                anima_id=anima_id,
                revision=receipt.resulting_revision,
                action=str(receipt.result.get("action") or "unchanged"),
                idempotent_replay=True,
                aggregate_revision=receipt.result.get("aggregate_revision"),
            )

        root = await self._root(user_id=user_id, anima_id=anima_id, lock=True)
        if root.revision != expected_revision:
            raise AnimaLoadoutError("loadout_revision_conflict", current_revision=root.revision)
        plan, target, slot, current = await self._plan(
            root=root,
            user_id=user_id,
            family=family,
            intent=intent,
            lock_sources=True,
        )
        if plan.digest != plan_digest:
            raise AnimaLoadoutError("loadout_plan_stale", current_revision=root.revision)

        await self._apply_planned(
            root=root, family=family, intent=intent, plan=plan, target=target, slot=slot, current=current
        )
        if plan.action != "unchanged":
            root.revision += 1
            definition = await self._animas.record_definition_revision(
                user_id=user_id,
                anima_id=anima_id,
                expected_revision=definition.aggregate_revision,
                reason=f"loadout_{family}_update",
            )
        result = LoadoutCommitResult(
            anima_id=anima_id,
            revision=root.revision,
            action=plan.action,
            aggregate_revision=definition.aggregate_revision,
        )
        self._session.add(
            ORMAnimaLoadoutMutationReceipt(
                id=str(uuid4()),
                owner_user_id=user_id,
                anima_id=anima_id,
                idempotency_key=idempotency_key,
                request_digest=request_digest,
                result={"action": plan.action, "aggregate_revision": definition.aggregate_revision},
                resulting_revision=root.revision,
                expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            )
        )
        await self._session.commit()
        return result

    async def _apply_planned(
        self,
        *,
        root: ORMAnimaLoadout,
        family: LoadoutFamily,
        intent: dict[str, Any],
        plan: LoadoutPlan,
        target: TypedCatalogItem | None,
        slot: str | None,
        current: ORMAnimaContentBinding | None,
    ) -> None:
        """Shared typed persistence, with no revision bump, receipt, or commit."""

        operation = str(intent.get("operation"))
        if plan.action != "unchanged":
            if family == "gesture":
                if operation in {"add", "update", "reconfigure"} and target is not None and slot is not None:
                    await self._upsert(
                        root=root,
                        slot=slot,
                        kind=ContentKind.GESTURE,
                        target=target,
                        config=dict(intent.get("config_overrides") or {}),
                        current=current,
                    )
                    document = cast(GestureDocumentV1, target.document)
                    self._set_exclusion(root, slot="gesture", runtime_id=document.semantic_key, excluded=False)
                elif operation == "remove" and current is not None:
                    await self._session.delete(current)
                else:
                    starter_id = str(intent.get("starter_id"))
                    self._set_exclusion(
                        root,
                        slot="gesture",
                        runtime_id=starter_id,
                        excluded=operation == "disable_starter",
                    )
            elif family == "reaction" and slot is not None:
                emotion = str(intent["emotion"])
                intensity = int(intent["intensity"])
                if operation in {"add", "replace", "update", "reconfigure"} and target is not None:
                    await self._upsert(
                        root=root,
                        slot=slot,
                        kind=ContentKind.REACTION,
                        target=target,
                        config=dict(intent.get("config_overrides") or {}),
                        current=current,
                    )
                    self._set_exclusion(
                        root,
                        slot="reaction",
                        runtime_id=f"{emotion}-{intensity}",
                        excluded=False,
                    )
                else:
                    if current is not None:
                        await self._session.delete(current)
                    self._set_exclusion(
                        root,
                        slot="reaction",
                        runtime_id=f"{emotion}-{intensity}",
                        excluded=operation == "leave_empty",
                    )
            elif family == "idle_style" and slot is not None:
                if operation in {"set", "update", "reconfigure"} and target is not None:
                    await self._upsert(
                        root=root,
                        slot=slot,
                        kind=ContentKind.IDLE_STYLE,
                        target=target,
                        config={"pool_overrides": dict(intent.get("pool_overrides") or {})},
                        current=current,
                    )
                    root.idle_style_empty = False
                else:
                    if current is not None:
                        await self._session.delete(current)
                    root.idle_style_empty = operation == "leave_empty"
            elif family == "music_track":
                if operation in {"add", "update", "reconfigure"} and target is not None and slot is not None:
                    autoplay = bool(intent.get("autoplay", False))
                    if autoplay:
                        for row in await self._bindings(root.anima_id):
                            if row.kind == ContentKind.MUSIC_TRACK.value and row is not current:
                                row.config = {**dict(row.config), "autoplay": False}
                    config = {
                        "enabled": bool(intent.get("enabled", True)),
                        "autoplay": autoplay,
                    }
                    if intent.get("loop") is not None:
                        config["loop"] = bool(intent["loop"])
                    if intent.get("gain") is not None:
                        config["gain"] = float(intent["gain"])
                    await self._upsert(
                        root=root,
                        slot=slot,
                        kind=ContentKind.MUSIC_TRACK,
                        target=target,
                        config=config,
                        current=current,
                    )
                elif current is not None:
                    await self._session.delete(current)
            elif slot is not None:
                if operation == "set" and target is not None:
                    config = dict(intent.get("config") or {})
                    await self._upsert(
                        root=root,
                        slot=slot,
                        kind=ContentKind(family),
                        target=target,
                        config=config,
                        current=current,
                    )
                elif current is not None:
                    await self._session.delete(current)
            if family == "avatar":
                anima = await self._session.get(ORMAnima, root.anima_id)
                assert anima is not None
                avatar = (
                    await SQLAlchemyAvatarRepository(self._session).resolve_catalog_avatar(
                        user_id=root.owner_user_id,
                        item=target.item,
                    )
                    if target is not None
                    else None
                )
                anima.avatar_id = avatar.id if avatar else None
                # Keep an already loaded ORM relationship consistent in the
                # same transaction; future reads must not return the old model.
                self._session.expire(anima, ["avatar"])
        await self._session.flush()

    async def initialize(self, *, user_id: str, anima_id: str, spec: ResolvedAnimaSpec) -> None:
        """Compose exact Revision 1 selections using the normal typed validators.

        Explicit exclusions prevent unselected Recommended Starter entries from
        being implicitly restored. No intermediate equipment revisions escape.
        """

        cells = {(emotion, intensity) for emotion in TRACKED_EMOTIONS for intensity in (1, 2, 3)}
        selected_cells = [(cell.emotion, cell.intensity) for cell in spec.reactions]
        if len(selected_cells) != len(cells) or set(selected_cells) != cells:
            raise AnimaLoadoutError("reaction_matrix_incomplete")
        if (
            spec.idle_style.kind is not ContentKind.IDLE_STYLE
            or spec.idle_style.source is not ContentSource.INCLUDED
            or spec.idle_style.logical_key != "builtin:idle-style:starter"
        ):
            raise AnimaLoadoutError("starter_idle_style_required")
        root = ORMAnimaLoadout(
            anima_id=anima_id,
            owner_user_id=user_id,
            revision=1,
            starter_catalog_version=1,
            starter_exclusions=[
                {"slot": "gesture", "runtime_id": raw["content_id"].rsplit(":", 1)[-1]}
                for raw in starter_loadout_policy(1)["gestures"]
            ],
        )
        self._session.add(root)
        await self._session.flush()

        async def apply(
            family: LoadoutFamily, intent: dict[str, Any], source: CatalogContentEntry | None = None
        ) -> None:
            if source is not None:
                intent["source"] = {"type": "catalog", "catalog_item_id": source.id}
            plan, target, slot, current = await self._plan(
                root=root,
                user_id=user_id,
                family=family,
                intent=intent,
                lock_sources=True,
            )
            if source is not None and (target is None or target.item.revision_sha256 != source.revision_sha256):
                raise AnimaLoadoutError("loadout_source_stale")
            if family == "gesture" and current is not None:
                raise AnimaLoadoutError("gesture_semantic_key_conflict")
            await self._apply_planned(
                root=root,
                family=family,
                intent=intent,
                plan=plan,
                target=target,
                slot=slot,
                current=current,
            )

        await apply("avatar", {"operation": "set"}, spec.avatar)
        await apply("idle_style", {"operation": "set"}, spec.idle_style)
        for source in spec.gestures:
            await apply("gesture", {"operation": "add"}, source)
        for cell in spec.reactions:
            if cell.source is None:
                # The complete matrix was validated above. Empty cells need
                # only the shared exclusion rule, not 72 repeated catalog scans.
                self._set_exclusion(root, slot="reaction", runtime_id=f"{cell.emotion}-{cell.intensity}", excluded=True)
                continue
            await apply(
                "reaction",
                {
                    "operation": "replace",
                    "emotion": cell.emotion,
                    "intensity": cell.intensity,
                },
                cell.source,
            )
        for use, appearance in (("profile", spec.profile), ("background", spec.background)):
            if appearance is not None:
                await apply(
                    "appearance", {"operation": "set", "use": use, "config": appearance.presentation}, appearance.source
                )
        await self._session.flush()

    async def set_legacy_avatar_in_uow(
        self,
        *,
        user_id: str,
        anima_id: str,
        avatar_id: str | None,
    ) -> bool:
        """Adapt the old PATCH Avatar field to the same typed loadout authority.

        The caller already holds the aggregate lock and records its one revision.
        """

        root = await self._root(user_id=user_id, anima_id=anima_id, lock=True)
        anima = await self._session.get(ORMAnima, anima_id)
        assert anima is not None
        if anima.avatar_id == avatar_id:
            return False
        avatar = await SQLAlchemyAvatarRepository(self._session).get(avatar_id) if avatar_id else None
        if avatar_id and (avatar is None or (avatar.private and avatar.user_id != user_id)):
            raise AnimaLoadoutError("avatar_content_unavailable")
        current = next((row for row in await self._bindings(anima_id) if row.slot_key == "avatar"), None)
        if avatar is not None and avatar.catalog_item_id:
            intent = {"operation": "set", "source": {"type": "catalog", "catalog_item_id": avatar.catalog_item_id}}
            plan, target, slot, current = await self._plan(
                root=root,
                user_id=user_id,
                family="avatar",
                intent=intent,
                lock_sources=True,
            )
            await self._apply_planned(
                root=root,
                family="avatar",
                intent=intent,
                plan=plan,
                target=target,
                slot=slot,
                current=current,
            )
        else:
            if current is not None:
                await self._session.delete(current)
            anima.avatar_id = avatar_id
            self._session.expire(anima, ["avatar"])
        root.revision += 1
        await self._session.flush()
        return True


__all__ = ["AnimaLoadoutService", "LoadoutFamily"]
