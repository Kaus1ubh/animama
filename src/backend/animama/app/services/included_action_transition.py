"""Copy immutable legacy Actions and remap their consumers in one mutation."""

from __future__ import annotations

import asyncio
import json
from dataclasses import asdict, dataclass, replace

from animama.app.ports.content_transition import ContentTransitionBindings
from animama.app.services.action_clip_transition import ActionClipTransitionService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import handler_for_kind
from animama.app.services.content_portability import is_non_portable
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
    ContentDocumentError,
    GestureDocumentV1,
    IdleStyleDocumentV2,
    ReactionDocumentV1,
)


@dataclass(frozen=True, slots=True)
class _Copy:
    source: CatalogContentEntry
    locator: str
    logical: str
    checkpoint: str
    motion: CatalogContentEntry | None = None


@dataclass(frozen=True, slots=True)
class IncludedActionTransitionResult:
    """Original-to-Local identities and consumers retained independently of edits."""

    replacements: dict[str, str]
    animas: tuple[str, ...]


def _copy(source: CatalogContentEntry, motion: CatalogContentEntry | None = None) -> _Copy:
    digest = mutation_digest(
        {
            "algorithm": "included-action-owned/1",
            "source": source.id,
            "revision": source.revision_sha256,
            "motion": motion.revision_sha256 if motion else None,
        }
    )
    directory = handler_for_kind(source.kind).definition.directory
    return _Copy(
        source,
        f"{directory}/converted-{digest[:24]}",
        f"local:{source.kind.value.replace('_', '-')}:converted-{digest[:24]}",
        f"included-owned-{digest[:40]}",
        motion,
    )


class IncludedActionTransitionService:
    """Keep immutable bytes intact while preserving explicit and default consumers."""

    def __init__(self, *, content: ContentCatalogService, bindings: ContentTransitionBindings) -> None:
        self._content = content
        self._bindings = bindings

    async def convert(self, *, user_id: str) -> list[tuple[CatalogContentEntry, str]]:
        catalog = self._content.mutations.catalog
        visible = {item.id: item for item in await catalog.list_visible(user_id=user_id)}
        context = TypedContentResolutionContext(visible, allow_retired=True)
        copies: list[_Copy] = []
        failures: list[tuple[CatalogContentEntry, str]] = []
        logical_replacements: dict[str, str] = {}
        completed: dict[str, str] = {}
        for item in visible.values():
            if (
                item.source is not ContentSource.INCLUDED
                or item.status is not ContentStatus.VALID
                or item.kind not in {ContentKind.GESTURE, ContentKind.REACTION}
                # Non-portable motion is never copied into Local content.
                or is_non_portable(item)
            ):
                continue
            document = TypedContentService.parse(item).document
            if (
                not isinstance(document, GestureDocumentV1 | ReactionDocumentV1)
                or not document.implementation.content_dependency_ref
            ):
                continue
            try:
                context.resolve(item.id)
                motion_id = dict(zip(item.dependencies, item.dependency_item_ids, strict=True)).get(
                    document.implementation.content_dependency_ref
                )
                motion = visible.get(motion_id or "")
                if motion is None or motion.kind is not ContentKind.POSE_CLIP:
                    raise ContentDocumentError("action_clip_transition_source_invalid", "Action clip is unavailable")
                planned = _copy(item, motion)
                receipt = await catalog.get_mutation_receipt(user_id=user_id, operation_id=planned.checkpoint)
                if receipt is not None:
                    # A completed copy must not overwrite a later edit or recreate
                    # a deleted result. The immutable source may still be scanned.
                    logical_replacements[item.id] = str(receipt["result"]["value"]["logical_key"])
                    completed[item.id] = str(receipt["result"]["value"]["item_id"])
                    continue
                if is_non_portable(motion):
                    # Leave the source as it is; never copy non-portable motion
                    # bytes into Local content.
                    continue
                copies.append(planned)
                logical_replacements[item.id] = planned.logical
            except (ContentDocumentError, TypedContentAdmissionError) as exc:
                failures.append((item, exc.code))
        styles = []
        for item in visible.values():
            if (
                item.kind is not ContentKind.IDLE_STYLE
                or item.status is not ContentStatus.VALID
                or not logical_replacements.keys() & set(item.dependency_item_ids)
            ):
                continue
            document = TypedContentService.parse(item).document
            if not isinstance(document, IdleStyleDocumentV2):
                continue  # The preceding v1 transition owns its conversion.
            planned = _copy(item)
            if item.source is ContentSource.INCLUDED:
                receipt = await catalog.get_mutation_receipt(user_id=user_id, operation_id=planned.checkpoint)
                if receipt is not None:
                    completed[item.id] = str(receipt["result"]["value"]["item_id"])
                    continue
                copies.append(planned)
            else:
                planned = replace(planned, locator=item.relative_locator, logical=item.logical_key or planned.logical)
            styles.append(planned)
        sources = {planned.source.id: planned.source for planned in [*copies, *styles]}
        for planned in copies:
            if planned.motion is not None:
                sources[planned.motion.id] = planned.motion
        replacements_needed = (*(planned.source.id for planned in copies), *completed)
        consumers = await self._bindings.content_consumers(
            user_id=user_id,
            item_ids=replacements_needed,
            included_by_logical={
                item.logical_key: item.id
                for item in visible.values()
                if item.source is ContentSource.INCLUDED and item.logical_key
            },
        )
        if not copies and not styles and not consumers:
            return failures
        # Completed copies remain authoritative when a new or repaired consumer
        # arrives later. Only fence targets used by this operation; an unrelated
        # deleted copy must neither be recreated nor prevent another conversion.
        used = {target for planned in styles for target in planned.source.dependency_item_ids}
        used.update(selection.catalog_item_id for before in consumers for selection in before.selections)
        completed = {source: target for source, target in completed.items() if source in used}
        for source, target in completed.items():
            sources[source] = visible[source]
            if target in visible:
                sources[target] = visible[target]
        digest = mutation_digest(
            {
                "algorithm": "included-action-group/1",
                "copies": [planned.checkpoint for planned in copies],
                "sources": {item.id: item.revision_sha256 for item in sources.values()},
                "consumers": [asdict(value) for value in consumers],
                "completed": completed,
            }
        )
        operation_id = f"included-action-group-{digest[:40]}"

        async def convert_group() -> IncludedActionTransitionResult:
            await catalog.lock_source(source=ContentSource.INCLUDED)
            for target in completed.values():
                if target not in visible:
                    raise ContentDocumentError(
                        "action_clip_transition_result_missing", "The existing converted Local copy is unavailable"
                    )
            for source in sources.values():
                current = await catalog.get_visible_item(item_id=source.id, user_id=user_id, for_update=True)
                if current is None or current.revision_sha256 != source.revision_sha256:
                    raise ContentConflictError("content_transition_source_changed")
                await asyncio.to_thread(
                    self._content.mutations.store.retain_transition_originals,
                    operation_id=f"{operation_id}-{mutation_digest({'source': source.id})[:16]}",
                    entry=source,
                    binding_facts=[asdict(value) for value in consumers],
                )
            publisher = ActionClipTransitionService(content=self._content)
            for planned in copies:
                if planned.motion is None:
                    continue
                action = TypedContentService.parse(planned.source).document
                assert isinstance(action, GestureDocumentV1 | ReactionDocumentV1)
                await asyncio.to_thread(
                    publisher.publish_owned,
                    planned.source,
                    planned.motion,
                    replace(action, provenance={**planned.source.provenance, **action.provenance}),
                    target_locator=planned.locator,
                    content_id=planned.logical,
                    require_new=True,
                )
            for planned in styles:
                document = TypedContentService.parse(planned.source).document
                assert isinstance(document, IdleStyleDocumentV2)
                refs = {
                    ref: logical_replacements[target_id]
                    for ref, target_id in zip(
                        planned.source.dependencies, planned.source.dependency_item_ids, strict=True
                    )
                    if target_id in logical_replacements
                }
                converted = replace(
                    document,
                    content_id=planned.logical,
                    provenance={**planned.source.provenance, **document.provenance},
                    dependencies=tuple(
                        replace(edge, ref=refs.get(edge.ref, edge.ref)) for edge in document.dependencies
                    ),
                    default_pool=tuple(refs.get(ref, ref) for ref in document.default_pool),
                    cells={
                        emotion: {
                            intensity: replace(cell, gestures=tuple(refs.get(ref, ref) for ref in cell.gestures))
                            for intensity, cell in levels.items()
                        }
                        for emotion, levels in document.cells.items()
                    },
                )
                await asyncio.to_thread(
                    self._content.mutations.store.save_descriptor_entry,
                    kind=ContentKind.IDLE_STYLE,
                    relative_locator=planned.locator,
                    descriptor=json.dumps(
                        handler_for_kind(ContentKind.IDLE_STYLE).catalog_projection(converted)
                    ).encode(),
                    companion_files={},
                    require_new=planned.source.source is ContentSource.INCLUDED,
                )
            await self._content.rescan(user_id=user_id, include_included=False)
            after = {item.id: item for item in await catalog.list_visible(user_id=user_id)}
            admitted = TypedContentResolutionContext(after)
            replacements = dict(completed)
            for target in completed.values():
                admitted.resolve(target)
            for planned in copies:
                result = await catalog.get_by_locator(source=ContentSource.LOCAL, relative_locator=planned.locator)
                if result is None:
                    raise ContentDocumentError(
                        "action_clip_transition_result_invalid", "Converted content is unavailable"
                    )
                admitted.resolve(result.id)
                replacements[planned.source.id] = result.id
            for planned in styles:
                if planned.source.source is ContentSource.LOCAL:
                    admitted.resolve(planned.source.id)
            for before in consumers:
                await self._bindings.replace_content(user_id=user_id, before=before, replacements=replacements)
            # These per-source checkpoints share the outer SQL commit; they are
            # not independent filesystem operations. The outer receipt alone
            # decides its journal's recovery outcome. They let future source
            # additions leave already converted and subsequently edited copies.
            for planned in copies:
                await catalog.record_mutation_receipt(
                    user_id=user_id,
                    operation_id=planned.checkpoint,
                    request_digest=mutation_digest({"checkpoint": planned.checkpoint}),
                    result={"value": {"item_id": replacements[planned.source.id], "logical_key": planned.logical}},
                )
            return IncludedActionTransitionResult(replacements, tuple(value.anima_id for value in consumers))

        try:
            await self._content.mutations.run(
                user_id=user_id,
                operation_id=operation_id,
                request_digest=digest,
                result_type=IncludedActionTransitionResult,
                action=convert_group,
            )
        except (ContentDocumentError, TypedContentAdmissionError) as exc:
            failures.extend(
                (source, exc.code) for source in {p.source.id: p.source for p in [*copies, *styles]}.values()
            )
        except ContentValidationError:
            failures.extend(
                (source, "action_clip_transition_limits")
                for source in {p.source.id: p.source for p in [*copies, *styles]}.values()
            )
        return failures
