"""Plan and commit typed catalog selections on one Anima loadout."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, Literal, cast
from uuid import uuid4

from sqlalchemy import insert, select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.avatar_repo import SQLAlchemyAvatarRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.ports.content_store import ContentStore
from animama.app.services.avatar_effect_conversion import is_unconverted_avatar_effect
from animama.app.services.canonical_digest import canonical_digest
from animama.app.services.content_kind_registry import RETIRED_CONTENT_KINDS
from animama.app.services.idle_playback import read_gesture_idle_playback
from animama.app.services.starter_loadout_policy import (
    resolve_starter_idle_pool,
    starter_gestures,
    starter_reaction_pools,
)
from animama.app.services.typed_content_service import (
    TypedCatalogItem,
    TypedContentAdmissionError,
    TypedContentService,
)
from animama.domain.anima_creation import ResolvedAnimaSpec, ResolvedIdleMember
from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.anima_loadout import (
    IDLE_INTENSITIES,
    REACTION_INTENSITIES,
    REACTION_POOL_LIMIT,
    AnimaLoadout,
    AnimaLoadoutError,
    AppearanceBinding,
    CatalogLoadoutSource,
    GestureBinding,
    IdleCell,
    IdleMember,
    IdlePool,
    LoadoutCommitResult,
    LoadoutDiagnostic,
    LoadoutPlan,
    ReactionCell,
    ReactionMember,
    idle_cell_key,
    idle_slot_key,
    parse_idle_slot_key,
    parse_reaction_slot_key,
    reaction_cell_key,
    reaction_slot_key,
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
    AppearanceDocumentV1,
    AvatarDocumentV1,
    ContentDocumentError,
    GestureDocumentV1,
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
    "idle",
    "avatar",
    "appearance",
    "voice",
]


def _source(value: TypedCatalogItem) -> CatalogLoadoutSource:
    return CatalogLoadoutSource(
        catalog_item_id=value.item.id,
        source=value.item.source,
        logical_key=value.item.logical_key,
    )


def _implementation_kind(document: GestureDocumentV1) -> Literal["anima_clip", "vrma"]:
    return document.implementation.kind


def _is_ai_gesture_row(row: ORMAnimaContentBinding) -> bool:
    """Gesture rows equip AI-callable Gestures; Idle pool rows share the kind but not the role."""

    return row.kind == ContentKind.GESTURE.value and row.slot_key.startswith("gesture:")


def _reaction_cell_rows(rows: list[ORMAnimaContentBinding], cell: str) -> list[ORMAnimaContentBinding]:
    """Return the member rows of one Reaction pool cell."""

    return [
        row
        for row in rows
        if row.kind == ContentKind.REACTION.value
        and (parsed := parse_reaction_slot_key(row.slot_key)) is not None
        and parsed[0] == cell
    ]


_STARTER_UNAVAILABLE = {
    ContentKind.GESTURE: ("starter_gesture_unavailable", "Included Gesture {key} is unavailable and was left out."),
    ContentKind.REACTION: ("starter_reaction_unavailable", "Included Reaction {key} is unavailable and was left out."),
}
"""Each family's skipped-starter warning code and English detail; clients word it from the code."""


@dataclass(frozen=True, slots=True)
class _PlannedChange:
    """A validated intent: its public plan plus exactly the rows a commit writes or deletes.

    Most intents touch one ``slot`` (``target`` written there, ``current`` the
    existing row). A Reaction ``restore_starter`` touches several member rows,
    listed in ``additions`` (slot and Reaction) and ``removals``.
    """

    plan: LoadoutPlan
    target: TypedCatalogItem | None = None
    slot: str | None = None
    current: ORMAnimaContentBinding | None = None
    additions: tuple[tuple[str, TypedCatalogItem], ...] = ()
    removals: tuple[ORMAnimaContentBinding, ...] = ()


class AnimaLoadoutService:
    """Typed SQL aggregate over the catalog, loadout and logical bindings.

    The composition owns the supplied session and transaction. Multi-owner
    compositions must isolate every joined table at that boundary, including
    catalog invalidation; the internal catalog is not account mutation authority.
    """

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
        """Return the Anima's typed catalog selections; its Gestures are exactly its ``gesture:`` rows."""

        root = await self._root(user_id=user_id, anima_id=anima_id)
        visible, parsed = await self._visible(user_id)
        by_logical = {value.item.logical_key: value for value in parsed.values() if value.item.logical_key is not None}
        rows = await self._bindings(anima_id)
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
                        params={"slot": row.slot_key},
                    )
                )
                return None
            return value

        gestures: list[GestureBinding] = []
        occupied_gesture_keys: set[str] = set()
        for row in rows:
            if not _is_ai_gesture_row(row):
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
                        params={"name": value.document.name},
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
                    implementation_kind=_implementation_kind(value.document),
                    source=_source(value),
                    config_overrides=dict(row.config),
                )
            )

        visible_by_id = {item.id: item for item in visible}
        starter_pools = starter_reaction_pools(root.starter_catalog_version)
        reaction_members: dict[str, list[ReactionMember]] = {}
        for row in rows:
            reaction_slot = parse_reaction_slot_key(row.slot_key)
            if reaction_slot is None or row.kind != ContentKind.REACTION.value:
                continue
            # The row's catalog id is authoritative; the slot only names the cell.
            cell, item_id = reaction_slot[0], row.catalog_item_id
            entry = visible_by_id.get(item_id)
            origin: Literal["starter", "custom"] = (
                "starter"
                if entry is not None
                and entry.source is ContentSource.INCLUDED
                and entry.logical_key in starter_pools.get(cell, ())
                else "custom"
            )
            value = parsed.get(item_id)
            if value is not None and isinstance(value.document, ReactionDocumentV1):
                reaction_member = ReactionMember(
                    binding_id=row.id,
                    item_id=item_id,
                    name=value.document.name,
                    available=True,
                    origin=origin,
                    source=_source(value),
                    description=value.document.description,
                )
            else:
                # Keep an unavailable member visible so the owner can remove it;
                # it marks itself, so no Loadout warning repeats its internal slot.
                reaction_member = ReactionMember(
                    binding_id=row.id,
                    item_id=item_id,
                    name=entry.display_name if entry is not None else item_id,
                    available=False,
                    origin=origin,
                )
            reaction_members.setdefault(cell, []).append(reaction_member)

        reactions: list[ReactionCell] = []
        for emotion in sorted(TRACKED_EMOTIONS):
            for intensity in REACTION_INTENSITIES:
                cell = f"{emotion}-{intensity}"
                members = tuple(
                    sorted(reaction_members.get(cell, ()), key=lambda value: (value.name.casefold(), value.item_id))
                )
                starter_ids = {
                    value.item.id
                    for key in starter_pools.get(cell, ())
                    if (value := by_logical.get(key)) is not None
                    and value.item.source is ContentSource.INCLUDED
                    and isinstance(value.document, ReactionDocumentV1)
                }
                state: Literal["starter", "custom", "empty"] = (
                    "empty"
                    if not members
                    else "starter"
                    if {member.item_id for member in members} == starter_ids
                    else "custom"
                )
                reactions.append(ReactionCell(emotion, intensity, state, members))

        idle_members: dict[str, list[IdleMember]] = {}
        for row in rows:
            idle_slot = parse_idle_slot_key(row.slot_key)
            if idle_slot is None:
                continue
            # The row's catalog id is authoritative; the slot only names the cell.
            cell, item_id = idle_slot[0], row.catalog_item_id
            # An unavailable member is marked on its own entry; a Loadout warning
            # would only repeat it under the internal slot key.
            value = parsed.get(item_id)
            if (
                value is not None
                and value.item.kind is ContentKind.GESTURE
                and isinstance(value.document, GestureDocumentV1)
            ):
                member = IdleMember(
                    binding_id=row.id,
                    item_id=item_id,
                    name=value.document.name,
                    available=True,
                    source=_source(value),
                    description=value.document.description,
                )
            else:
                # Keep an unavailable member visible so the owner can remove it.
                entry = visible_by_id.get(item_id)
                member = IdleMember(
                    binding_id=row.id,
                    item_id=item_id,
                    name=entry.display_name if entry is not None else item_id,
                    available=False,
                )
            idle_members.setdefault(cell, []).append(member)

        def idle_cell(cell: str) -> tuple[IdleMember, ...]:
            return tuple(sorted(idle_members.get(cell, ()), key=lambda value: (value.name.casefold(), value.item_id)))

        idle = IdlePool(
            default_pool=idle_cell(idle_cell_key(None, None)),
            cells=tuple(
                IdleCell(emotion, intensity, idle_cell(idle_cell_key(emotion, intensity)))
                for emotion in sorted(TRACKED_EMOTIONS)
                for intensity in IDLE_INTENSITIES
            ),
        )

        appearances: list[AppearanceBinding] = []
        avatar_source: CatalogLoadoutSource | None = None
        voice_source: CatalogLoadoutSource | None = None
        for row in rows:
            value = parsed.get(row.catalog_item_id)
            if value is None:
                continue
            if row.kind == ContentKind.AVATAR.value and isinstance(value.document, AvatarDocumentV1):
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
            gestures=tuple(sorted(gestures, key=lambda value: (value.name.casefold(), value.semantic_key))),
            reactions=tuple(reactions),
            idle=idle,
            avatar_source=avatar_source,
            appearances=tuple(appearances),
            voice_source=voice_source,
            warnings=tuple(warnings),
        )
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
        return self._typed_target(item, expected_kind)

    @staticmethod
    def _typed_target(item: CatalogContentEntry | None, expected_kind: ContentKind) -> TypedCatalogItem:
        """A visible, valid catalog item of ``expected_kind`` as a typed loadout source."""

        if item is None or item.status is not ContentStatus.VALID or item.kind is not expected_kind:
            raise AnimaLoadoutError("loadout_source_unavailable")
        try:
            typed = TypedContentService.parse(item)
        except Exception as exc:
            raise AnimaLoadoutError("loadout_source_invalid") from exc
        # Outside the parse guard, so the specific code reaches the caller.
        if any(dependency.kind in RETIRED_CONTENT_KINDS for dependency in typed.document.dependencies):
            raise AnimaLoadoutError("content_dependency_retired")
        return typed

    async def _targets(
        self, *, user_id: str, item_ids: list[str], expected_kind: ContentKind, lock: bool
    ) -> dict[str, TypedCatalogItem | AnimaLoadoutError]:
        """Each item's typed source, or the error ``_target`` would raise for it, read in one batch."""

        items = await self._catalog.get_visible_items(item_ids=item_ids, user_id=user_id, for_update=lock)
        targets: dict[str, TypedCatalogItem | AnimaLoadoutError] = {}
        for item_id in dict.fromkeys(item_ids):
            try:
                targets[item_id] = self._typed_target(items.get(item_id), expected_kind)
            except AnimaLoadoutError as error:
                targets[item_id] = error
        return targets

    async def _exact_targets(
        self, *, user_id: str, sources: list[CatalogContentEntry], expected_kind: ContentKind
    ) -> list[TypedCatalogItem]:
        """Lock and type a new loadout's exact sources in one read, in order.

        The first failing source decides the error: unavailable or invalid as
        ``_target`` reports it, or ``loadout_source_stale`` when its revision
        changed since the caller resolved it.
        """

        targets = await self._targets(
            user_id=user_id, item_ids=[source.id for source in sources], expected_kind=expected_kind, lock=True
        )
        typed: list[TypedCatalogItem] = []
        for source in sources:
            target = targets[source.id]
            if isinstance(target, AnimaLoadoutError):
                raise target
            if target.item.revision_sha256 != source.revision_sha256:
                raise AnimaLoadoutError("loadout_source_stale")
            typed.append(target)
        return typed

    async def _insert_bindings(
        self,
        *,
        root: ORMAnimaLoadout,
        kind: ContentKind,
        members: list[tuple[str, TypedCatalogItem]],
        configs: Mapping[str, dict[str, Any]] | None = None,
    ) -> None:
        """Write a new loadout's rows of one kind in one statement; a repeated slot keeps its last member.

        ``configs`` holds each slot's binding configuration; a slot without one is empty.
        """

        rows: dict[str, dict[str, Any]] = {
            slot: {
                "id": str(uuid4()),
                "anima_id": root.anima_id,
                "slot_key": slot,
                "catalog_item_id": target.item.id,
                "kind": kind.value,
                "config": dict((configs or {}).get(slot, {})),
            }
            for slot, target in members
        }
        if rows:
            await self._session.execute(insert(ORMAnimaContentBinding).values(list(rows.values())))

    async def _require_idle_playback(
        self, *, user_id: str, target: TypedCatalogItem, store: ContentStore | None
    ) -> None:
        """Admit only Gestures whose exact motion bytes play for a finite time, as idle scheduling requires."""

        if store is None:
            raise AnimaLoadoutError("idle_playback_unavailable")
        visible = {item.id: item for item in await self._catalog.list_visible(user_id=user_id)}
        try:
            gesture = TypedContentService.resolve_closure(item_id=target.item.id, visible=visible)[-1]
            if not isinstance(gesture.document, GestureDocumentV1):
                raise AnimaLoadoutError("idle_gesture_ineligible")
            await read_gesture_idle_playback(
                document=gesture.document,
                item=gesture.item,
                dependency_items=visible,
                store=store,
            )
        except (
            TypedContentAdmissionError,
            ContentDocumentError,
            ContentIntegrityError,
            ContentPathError,
            OSError,
        ) as exc:
            raise AnimaLoadoutError("idle_gesture_ineligible") from exc

    async def _plan(
        self,
        *,
        root: ORMAnimaLoadout,
        user_id: str,
        family: LoadoutFamily,
        intent: dict[str, Any],
        lock_sources: bool = False,
        store: ContentStore | None = None,
    ) -> _PlannedChange:
        """Validate one intent against current rows; ``store`` is required only to add an Idle member."""

        operation = str(intent.get("operation") or "")
        rows = await self._bindings(root.anima_id)
        target: TypedCatalogItem | None = None
        slot: str | None = None
        current: ORMAnimaContentBinding | None = None
        additions: tuple[tuple[str, TypedCatalogItem], ...] = ()
        removals: tuple[ORMAnimaContentBinding, ...] = ()
        warnings: list[LoadoutDiagnostic] = []
        # Idle pool members are Gestures in a non-AI role.
        expected_kind = ContentKind.GESTURE if family == "idle" else ContentKind(family)
        if expected_kind in RETIRED_CONTENT_KINDS:
            raise AnimaLoadoutError("content_kind_retired")

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
                        (row for row in rows if row.id == binding_id and _is_ai_gesture_row(row)),
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
                    (row for row in rows if row.id == intent.get("binding_id") and _is_ai_gesture_row(row)),
                    None,
                )
                slot = current.slot_key if current else None
                action = "remove" if current else "unchanged"
            else:
                raise AnimaLoadoutError("gesture_operation_invalid")
        elif family == "reaction":
            if operation == "add":
                cell = reaction_cell_key(intent.get("emotion"), intent.get("intensity"))
                source = intent.get("source")
                item_id = source.get("catalog_item_id") if isinstance(source, dict) else None
                if not isinstance(item_id, str) or not item_id:
                    raise AnimaLoadoutError("catalog_source_required")
                members = _reaction_cell_rows(rows, cell)
                slot = reaction_slot_key(cell, item_id)
                # A row's catalog id stays authoritative; a row already at the new
                # member's slot also counts, so the add never rewrites another member.
                if any(row.catalog_item_id == item_id or row.slot_key == slot for row in members):
                    raise AnimaLoadoutError("reaction_member_duplicate")
                if len(members) >= REACTION_POOL_LIMIT:
                    raise AnimaLoadoutError("reaction_pool_full")
                target = await self._target(user_id=user_id, source=source, expected_kind=expected_kind)
                action = "add"
            elif operation == "remove":
                # Removal names the member row, so an unavailable Reaction can still be removed.
                current = next(
                    (
                        row
                        for row in rows
                        if row.id == intent.get("binding_id")
                        and row.kind == ContentKind.REACTION.value
                        and parse_reaction_slot_key(row.slot_key) is not None
                    ),
                    None,
                )
                slot = current.slot_key if current is not None else None
                action = "remove" if current is not None else "unchanged"
            elif operation == "restore_starter":
                cell = reaction_cell_key(intent.get("emotion"), intent.get("intensity"))
                starters, warnings = await self._starter_members(
                    user_id=user_id,
                    kind=ContentKind.REACTION,
                    keys=starter_reaction_pools(root.starter_catalog_version).get(cell, ()),
                    lock=lock_sources,
                    visible=await self._catalog.list_visible(user_id=user_id),
                )
                members = _reaction_cell_rows(rows, cell)
                starter_ids = {starter.item.id for starter in starters}
                present = {row.catalog_item_id for row in members}
                removals = tuple(row for row in members if row.catalog_item_id not in starter_ids)
                additions = tuple(
                    (reaction_slot_key(cell, starter.item.id), starter)
                    for starter in starters
                    if starter.item.id not in present
                )
                action = "revert" if additions or removals else "unchanged"
            else:
                raise AnimaLoadoutError("reaction_operation_invalid")
        elif family == "idle":
            if operation == "add":
                cell = idle_cell_key(intent.get("emotion"), intent.get("intensity"))
                source = intent.get("source")
                item_id = source.get("catalog_item_id") if isinstance(source, dict) else None
                if not isinstance(item_id, str) or not item_id:
                    raise AnimaLoadoutError("catalog_source_required")
                slot = idle_slot_key(cell, item_id)
                # Compare the stored Gesture, not the slot text, so a row's catalog id stays authoritative.
                if any(
                    (parsed := parse_idle_slot_key(row.slot_key)) is not None
                    and parsed[0] == cell
                    and row.catalog_item_id == item_id
                    for row in rows
                ):
                    raise AnimaLoadoutError("idle_gesture_duplicate")
                target = await self._target(user_id=user_id, source=source, expected_kind=expected_kind)
                await self._require_idle_playback(user_id=user_id, target=target, store=store)
                action = "add"
            elif operation == "remove":
                # Removal names the member row, so an unavailable Gesture can still be removed.
                current = next(
                    (
                        row
                        for row in rows
                        if row.id == intent.get("binding_id") and parse_idle_slot_key(row.slot_key) is not None
                    ),
                    None,
                )
                slot = current.slot_key if current is not None else None
                action = "remove" if current is not None else "unchanged"
            else:
                raise AnimaLoadoutError("idle_operation_invalid")
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

        targets = [value for value in (target, *(item for _, item in additions)) if value is not None]
        counts = await self._dependency_counts(user_id=user_id, targets=targets)
        final_gesture_count = sum(_is_ai_gesture_row(row) for row in rows)
        if family == "gesture":
            final_gesture_count += int(action == "add") - int(action == "remove")
        aggregate_revision = await self._aggregate_revision(user_id=user_id, anima_id=root.anima_id)
        identity: dict[str, Any] = {
            "anima_id": root.anima_id,
            "revision": root.revision,
            "aggregate_revision": aggregate_revision,
            "family": family,
            "intent": intent,
            "action": action,
            "target_revision": target.item.revision_sha256 if target else None,
        }
        if additions or removals:
            # A restore writes several rows; the commit must see the same Reactions at the same revisions.
            identity["members"] = {
                "add": sorted([item.item.id, item.item.revision_sha256] for _, item in additions),
                "remove": sorted(row.id for row in removals),
            }
        plan = LoadoutPlan(
            action=cast(Any, action),
            digest=canonical_digest(identity),
            current_name=current.slot_key if current else None,
            target_name=target.document.name if target else None,
            included_resource_counts=counts,
            final_gesture_count=max(0, final_gesture_count),
            warnings=tuple(warnings),
            aggregate_revision=aggregate_revision,
        )
        return _PlannedChange(plan, target, slot, current, additions, removals)

    async def _dependency_counts(self, *, user_id: str, targets: list[TypedCatalogItem]) -> dict[str, int]:
        """Count the targets' distinct transitive support content and refuse an unconverted Avatar Effect."""

        counts: dict[str, int] = {}
        if not targets:
            return counts
        visible = {item.id: item for item in await self._catalog.list_visible(user_id=user_id)}
        seen: set[str] = set()
        for target in targets:
            pending = list(target.item.dependency_item_ids)
            while pending:
                item_id = pending.pop()
                if item_id in seen:
                    continue
                seen.add(item_id)
                item = visible.get(item_id)
                if item is None:
                    continue
                if (
                    item.kind is ContentKind.AVATAR_EFFECT
                    and item.status is ContentStatus.VALID
                    and is_unconverted_avatar_effect(TypedContentService.parse(item).document)
                ):
                    raise AnimaLoadoutError("avatar_effect_conversion_required")
                counts[item.kind.value] = counts.get(item.kind.value, 0) + 1
                pending.extend(item.dependency_item_ids)
        return counts

    async def _starter_members(
        self,
        *,
        user_id: str,
        kind: Literal[ContentKind.GESTURE, ContentKind.REACTION],
        keys: tuple[str, ...],
        lock: bool,
        visible: list[CatalogContentEntry],
    ) -> tuple[list[TypedCatalogItem], list[LoadoutDiagnostic]]:
        """Resolve Included starter Gestures or Reactions by key in one read.

        An unavailable one is skipped with its family's ``_STARTER_UNAVAILABLE`` warning.
        """

        matched: dict[str, str | None] = {}
        for key in keys:
            matches = [
                item
                for item in visible
                if item.source is ContentSource.INCLUDED and item.kind is kind and item.logical_key == key
            ]
            matched[key] = matches[0].id if len(matches) == 1 else None
        # One locked read for every member, not one per member.
        targets = await self._targets(
            user_id=user_id,
            item_ids=[item_id for item_id in matched.values() if item_id is not None],
            expected_kind=kind,
            lock=lock,
        )
        code, message = _STARTER_UNAVAILABLE[kind]
        starters: list[TypedCatalogItem] = []
        warnings: list[LoadoutDiagnostic] = []
        for key in keys:
            item_id = matched[key]
            target = targets.get(item_id) if item_id is not None else None
            if isinstance(target, TypedCatalogItem):
                starters.append(target)
            else:
                warnings.append(
                    LoadoutDiagnostic(
                        code=code,
                        message=message.format(key=key),
                        scope="source",
                        params={"contentId": key},
                    )
                )
        return starters, warnings

    async def plan(
        self,
        *,
        user_id: str,
        anima_id: str,
        family: LoadoutFamily,
        expected_revision: int,
        intent: dict[str, Any],
        store: ContentStore | None = None,
    ) -> LoadoutPlan:
        root = await self._root(user_id=user_id, anima_id=anima_id)
        if root.revision != expected_revision:
            raise AnimaLoadoutError("loadout_revision_conflict", current_revision=root.revision)
        change = await self._plan(root=root, user_id=user_id, family=family, intent=intent, store=store)
        return change.plan

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
        family: LoadoutFamily | Literal["music_track"],
        expected_revision: int,
        intent: dict[str, Any],
        plan_digest: str,
        idempotency_key: str,
        store: ContentStore | None = None,
    ) -> LoadoutCommitResult:
        """Recheck a reviewed plan and atomically persist one typed intent.

        ``store`` lets an Idle add recheck the Gesture's finite playback bytes.
        """

        # The common lock serializes identity/name and equipment edits as well
        # as concurrent retries of the same loadout idempotency receipt.
        try:
            definition = await self._animas.lock_definition(user_id=user_id, anima_id=anima_id)
        except AnimaDefinitionError as exc:
            raise AnimaLoadoutError(exc.code, current_revision=exc.current_revision) from exc
        request_digest = canonical_digest(
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

        # Retired commands can resolve only a matching historical receipt. Reject
        # a new operation before current revisions or source state are consulted.
        if family == "music_track":
            raise AnimaLoadoutError("content_kind_retired")

        root = await self._root(user_id=user_id, anima_id=anima_id, lock=True)
        if root.revision != expected_revision:
            raise AnimaLoadoutError("loadout_revision_conflict", current_revision=root.revision)
        change = await self._plan(
            root=root,
            user_id=user_id,
            family=family,
            intent=intent,
            lock_sources=True,
            store=store,
        )
        plan = change.plan
        if plan.digest != plan_digest:
            raise AnimaLoadoutError("loadout_plan_stale", current_revision=root.revision)

        await self._apply_planned(root=root, family=family, intent=intent, change=change)
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
                expires_at=datetime.now(UTC) + timedelta(days=7),
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
        change: _PlannedChange,
    ) -> None:
        """Shared typed persistence, with no revision bump, receipt, or commit."""

        operation = str(intent.get("operation"))
        plan, target, slot, current = change.plan, change.target, change.slot, change.current
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
                elif operation == "remove" and current is not None:
                    await self._session.delete(current)
            elif family == "reaction":
                # Members carry no binding configuration; one runtime root serves every cell.
                if operation == "add" and target is not None and slot is not None:
                    await self._upsert(
                        root=root, slot=slot, kind=ContentKind.REACTION, target=target, config={}, current=None
                    )
                elif operation == "remove" and current is not None:
                    await self._session.delete(current)
                elif operation == "restore_starter":
                    for row in change.removals:
                        await self._session.delete(row)
                    # Delete before inserting so a re-added member cannot meet its old slot.
                    await self._session.flush()
                    for member_slot, member in change.additions:
                        await self._upsert(
                            root=root,
                            slot=member_slot,
                            kind=ContentKind.REACTION,
                            target=member,
                            config={},
                            current=None,
                        )
            elif family == "idle" and slot is not None:
                if operation == "add" and target is not None:
                    await self._upsert(
                        root=root,
                        slot=slot,
                        kind=ContentKind.GESTURE,
                        target=target,
                        config={},
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

    async def _create_root(
        self,
        *,
        user_id: str,
        anima_id: str,
        idle: tuple[ResolvedIdleMember, ...],
    ) -> ORMAnimaLoadout:
        """Write a new Revision 1 loadout on starter loadout version 1 with its exact Idle pool.

        The Idle pool is seeded only here, with the loadout, so content
        installed later never changes an existing Anima's pool.
        """

        root = ORMAnimaLoadout(
            anima_id=anima_id,
            owner_user_id=user_id,
            revision=1,
            starter_catalog_version=1,
        )
        self._session.add(root)
        await self._session.flush()
        # The starter seed keeps only finite-playback Gestures and package
        # archives check packaged members; a rebound Included member is checked
        # at runtime, which drops an ineligible Gesture alone. Here every member
        # passes the typed source checks, all locked and read in one batch, and the
        # first failing member (in pool order) decides the error.
        targets = await self._exact_targets(
            user_id=user_id, sources=[member.source for member in idle], expected_kind=ContentKind.GESTURE
        )
        members = [
            (idle_slot_key(member.cell, member.source.id), target) for member, target in zip(idle, targets, strict=True)
        ]
        await self._insert_bindings(root=root, kind=ContentKind.GESTURE, members=members)
        return root

    async def create_starter_loadout(
        self, *, user_id: str, anima_id: str, store: ContentStore
    ) -> tuple[LoadoutDiagnostic, ...]:
        """Start an owned Anima's first loadout from the starter loadout alone.

        For compositions that equip a starter without a creation request. The
        starter Gestures, Idle pool and Reaction pools are written as rows from
        the content installed now: each available starter Gesture under the
        semantic key its document declares, the Idle pool exactly as creation
        seeds it, and each Reaction cell's available Included starter
        Reactions, as ``restore_starter`` leaves it. An unavailable starter
        Gesture or Reaction is left out and returned as a diagnostic. Nothing is
        committed: the caller then sets the Avatar and other selections through
        ordinary plan/commit changes, whose first commit also commits the new
        loadout. An Anima that already has a loadout fails on its key.
        """

        if not await self._animas.is_owned_by_user(user_id=user_id, anima_id=anima_id):
            raise AnimaLoadoutError("anima_not_found")
        visible = await self._catalog.list_visible(user_id=user_id)
        idle = await resolve_starter_idle_pool(visible={item.id: item for item in visible}, store=store)
        root = await self._create_root(user_id=user_id, anima_id=anima_id, idle=idle)
        # Each family's starters are resolved, locked and written together.
        gesture_targets, gesture_warnings = await self._starter_members(
            user_id=user_id,
            kind=ContentKind.GESTURE,
            keys=starter_gestures(root.starter_catalog_version),
            lock=True,
            visible=visible,
        )
        gestures: dict[str, TypedCatalogItem] = {}
        for target in gesture_targets:
            # Included starters declare distinct keys; a repeat keeps the first.
            gestures.setdefault(f"gesture:{cast(GestureDocumentV1, target.document).semantic_key}", target)
        pools = starter_reaction_pools(root.starter_catalog_version)
        starters, reaction_warnings = await self._starter_members(
            user_id=user_id,
            kind=ContentKind.REACTION,
            keys=tuple(dict.fromkeys(key for keys in pools.values() for key in keys)),
            lock=True,
            visible=visible,
        )
        by_key = {target.item.logical_key: target for target in starters}
        members: list[tuple[str, TypedCatalogItem]] = []
        reaction_targets: list[TypedCatalogItem] = []
        for cell, keys in pools.items():
            cell_targets = [by_key[key] for key in keys if key in by_key]
            members.extend((reaction_slot_key(cell, target.item.id), target) for target in cell_targets)
            reaction_targets.extend(cell_targets)
        await self._insert_bindings(root=root, kind=ContentKind.GESTURE, members=list(gestures.items()))
        await self._insert_bindings(root=root, kind=ContentKind.REACTION, members=members)
        await self._dependency_counts(user_id=user_id, targets=[*gestures.values(), *reaction_targets])
        await self._session.flush()
        return (*gesture_warnings, *reaction_warnings)

    async def initialize(self, *, user_id: str, anima_id: str, spec: ResolvedAnimaSpec) -> None:
        """Compose exact Revision 1 selections using the normal typed validators.

        The Gestures and the Reaction and Idle pools hold exactly the spec's
        members, a starter Anima's included. No intermediate equipment
        revisions escape.

        Gestures and Reactions are each locked, read and written in one batch,
        so the statement count does not grow with them. Errors follow the
        checks' order: every Gesture's availability and revision (the first
        failing Gesture decides), then a repeated semantic key, then every
        Reaction's availability and revision, then the dependency refusal
        over both families.
        """

        reaction_pools: dict[str, list[str]] = {}
        for reaction in spec.reactions:
            pool = reaction_pools.setdefault(reaction_cell_key(reaction.emotion, reaction.intensity), [])
            if reaction.source.id in pool:
                raise AnimaLoadoutError("reaction_member_duplicate")
            if len(pool) >= REACTION_POOL_LIMIT:
                raise AnimaLoadoutError("reaction_pool_full")
            pool.append(reaction.source.id)
        root = await self._create_root(user_id=user_id, anima_id=anima_id, idle=spec.idle)

        async def apply(
            family: LoadoutFamily, intent: dict[str, Any], source: CatalogContentEntry | None = None
        ) -> None:
            if source is not None:
                intent["source"] = {"type": "catalog", "catalog_item_id": source.id}
            change = await self._plan(root=root, user_id=user_id, family=family, intent=intent, lock_sources=True)
            target = change.target
            if source is not None and (target is None or target.item.revision_sha256 != source.revision_sha256):
                raise AnimaLoadoutError("loadout_source_stale")
            await self._apply_planned(root=root, family=family, intent=intent, change=change)

        await apply("avatar", {"operation": "set"}, spec.avatar)
        if spec.voice_source is not None:
            await apply("voice", {"operation": "set"}, spec.voice_source)
        gesture_targets = await self._exact_targets(
            user_id=user_id,
            sources=[selection.source for selection in spec.gestures],
            expected_kind=ContentKind.GESTURE,
        )
        gestures: list[tuple[str, TypedCatalogItem]] = []
        configs: dict[str, dict[str, Any]] = {}
        for selection, target in zip(spec.gestures, gesture_targets, strict=True):
            slot = f"gesture:{cast(GestureDocumentV1, target.document).semantic_key}"
            if slot in configs:
                raise AnimaLoadoutError("gesture_semantic_key_conflict")
            configs[slot] = dict(selection.config)
            gestures.append((slot, target))
        reaction_targets = await self._exact_targets(
            user_id=user_id,
            sources=[reaction.source for reaction in spec.reactions],
            expected_kind=ContentKind.REACTION,
        )
        # One dependency walk over one catalog read refuses an unconverted
        # Avatar Effect behind any member; creation needs no counts.
        await self._dependency_counts(user_id=user_id, targets=[*gesture_targets, *reaction_targets])
        await self._insert_bindings(root=root, kind=ContentKind.GESTURE, members=gestures, configs=configs)
        await self._insert_bindings(
            root=root,
            kind=ContentKind.REACTION,
            members=[
                (reaction_slot_key(reaction_cell_key(reaction.emotion, reaction.intensity), reaction.source.id), target)
                for reaction, target in zip(spec.reactions, reaction_targets, strict=True)
            ],
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
            change = await self._plan(
                root=root,
                user_id=user_id,
                family="avatar",
                intent=intent,
                lock_sources=True,
            )
            await self._apply_planned(root=root, family="avatar", intent=intent, change=change)
        else:
            if current is not None:
                await self._session.delete(current)
            anima.avatar_id = avatar_id
            self._session.expire(anima, ["avatar"])
        root.revision += 1
        await self._session.flush()
        return True


__all__ = ["AnimaLoadoutService", "LoadoutFamily"]
