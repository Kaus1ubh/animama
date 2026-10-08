"""Typed product views over the shared editable Content Catalog."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field, replace
from pathlib import Path

from animama.app.ports.content_catalog import ContentCatalog
from animama.app.ports.content_store import ContentStore
from animama.app.services.avatar_effect_conversion import require_converted_avatar_effect
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import RETIRED_CONTENT_KINDS, handler_for_kind
from animama.app.services.idle_playback import IdlePlaybackFacts, read_gesture_idle_playback
from animama.app.services.runtime_budget_policy import MAX_RUNTIME_BYTES, MAX_RUNTIME_CONFIG_BYTES, MAX_RUNTIME_ENTRIES
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentKind,
    ContentNotFoundError,
    ContentPreview,
    ContentStatus,
)
from animama.domain.content_documents import (
    ContentDocumentError,
    GestureDocumentV1,
    IdleStyleDocumentV1,
    IdleStyleDocumentV2,
    TypedContentDocument,
)


@dataclass(frozen=True, slots=True)
class TypedCatalogItem:
    """A valid catalog identity paired with its strict product document."""

    item: CatalogContentEntry
    document: TypedContentDocument
    # Only the caller-visible resolution context may expose dependency identities.
    dependency_ids: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class TypedContentPreview:
    """Exact preview membership paired with a typed product root."""

    preview: ContentPreview
    item: TypedCatalogItem
    supports: tuple[TypedCatalogItem, ...] = ()
    idle_playback: dict[str, IdlePlaybackFacts] = field(default_factory=dict)


class TypedContentAdmissionError(ContentNotFoundError):
    """Safe graph failure shared by typed Preview and strict private creation."""

    def __init__(self, code: str, item_id: str) -> None:
        super().__init__(code)
        self.code = code
        self.item_id = item_id


class TypedContentResolutionContext:
    """Resolve many typed roots over one immutable caller-visible catalog.

    Parsed documents and complete subgraph closures are cached for the life of
    the context. This keeps batch evidence and preview preparation proportional
    to the unique visible graph instead of the number of selected roots.
    """

    def __init__(self, visible: dict[str, CatalogContentEntry], *, allow_retired: bool = False) -> None:
        self.visible = visible
        self._allow_retired = allow_retired
        # Immutable old Styles can still point through old Actions after their
        # consumers move to Local copies. Keep such source definitions out of
        # supported typed selection without rewriting or hiding Health evidence.
        self._retired_closure = {item.id for item in visible.values() if item.kind in RETIRED_CONTENT_KINDS}
        parents: dict[str, list[str]] = {}
        for item in visible.values():
            for child in item.dependency_item_ids:
                parents.setdefault(child, []).append(item.id)
        pending = list(self._retired_closure)
        while pending:
            for parent in parents.get(pending.pop(), []):
                if parent not in self._retired_closure:
                    self._retired_closure.add(parent)
                    pending.append(parent)
        self._parsed: dict[str, TypedCatalogItem] = {}
        self._closures: dict[str, tuple[TypedCatalogItem, ...]] = {}
        logical: dict[str, list[str]] = {}
        locators: dict[str, list[str]] = {}
        for item in visible.values():
            if item.logical_key:
                logical.setdefault(item.logical_key, []).append(item.id)
            locators.setdefault(item.relative_locator, []).append(item.id)
        self.logical_index = {key: tuple(sorted(ids)) for key, ids in logical.items()}
        self.locator_index = {key: tuple(sorted(ids)) for key, ids in locators.items()}

    def parse(self, item: CatalogContentEntry) -> TypedCatalogItem:
        """Parse each visible catalog projection at most once."""

        if not self._allow_retired and item.kind in RETIRED_CONTENT_KINDS:
            raise TypedContentAdmissionError("content_kind_retired", item.id)
        if not self._allow_retired and item.id in self._retired_closure:
            raise TypedContentAdmissionError("content_dependency_retired", item.id)
        cached = self._parsed.get(item.id)
        if cached is None:
            parsed = TypedContentService.parse(item)
            dependencies = parsed.document.dependencies
            if not self._allow_retired and any(value.kind in RETIRED_CONTENT_KINDS for value in dependencies):
                raise TypedContentAdmissionError("content_dependency_retired", item.id)
            dependency_ids: dict[str, str] = {}
            if (
                item.id in self.visible
                and tuple(dependency.ref for dependency in dependencies) == item.dependencies
                and len(dependencies) == len(item.dependency_item_ids)
            ):
                for dependency, target_id in zip(dependencies, item.dependency_item_ids, strict=True):
                    target = self.visible.get(target_id)
                    candidates = self.logical_index.get(dependency.ref) or self.locator_index.get(dependency.ref) or ()
                    if (
                        target is not None
                        and target.status is ContentStatus.VALID
                        and target.revision_sha256 is not None
                        and target.kind is dependency.kind
                        and candidates == (target_id,)
                    ):
                        dependency_ids[dependency.ref] = target_id
            cached = replace(parsed, dependency_ids=dependency_ids)
            self._parsed[item.id] = cached
        return cached

    def resolve(self, item_id: str) -> tuple[TypedCatalogItem, ...]:
        """Return one dependency-first, duplicate-free typed closure."""

        cached = self._closures.get(item_id)
        if cached is not None:
            return cached

        visiting: set[str] = set()

        def visit(current_id: str) -> tuple[TypedCatalogItem, ...]:
            existing = self._closures.get(current_id)
            if existing is not None:
                return existing
            if current_id in visiting:
                raise TypedContentAdmissionError("dependency_cycle", current_id)
            entry = self.visible.get(current_id)
            if entry is None or entry.status is ContentStatus.MISSING:
                raise TypedContentAdmissionError("source_unavailable", current_id)
            if entry.status is ContentStatus.SCAN_REQUIRED:
                raise TypedContentAdmissionError("source_scan_required", current_id)
            if entry.status is not ContentStatus.VALID or entry.revision_sha256 is None:
                raise TypedContentAdmissionError("source_invalid", current_id)
            try:
                typed = self.parse(entry)
            except ContentNotFoundError as exc:
                raise TypedContentAdmissionError("typed_document_invalid", current_id) from exc

            handler = handler_for_kind(entry.kind)
            declarations = typed.document.dependencies
            if tuple(dependency.ref for dependency in declarations) != entry.dependencies or len(
                entry.dependencies
            ) != len(entry.dependency_item_ids):
                raise TypedContentAdmissionError("dependency_membership_invalid", current_id)
            if not entry.files or len(entry.files) > handler.definition.max_entry_files:
                raise TypedContentAdmissionError("registered_files_invalid", current_id)
            if (
                any(file.size_bytes <= 0 or file.size_bytes > handler.definition.max_file_bytes for file in entry.files)
                or sum(file.size_bytes for file in entry.files) > handler.definition.max_entry_bytes
            ):
                raise TypedContentAdmissionError("registered_file_budget", current_id)

            visiting.add(current_id)
            ordered: list[TypedCatalogItem] = []
            seen: set[str] = set()
            try:
                for declaration, target_id in zip(declarations, entry.dependency_item_ids, strict=True):
                    target = self.visible.get(target_id)
                    if target is None:
                        raise TypedContentAdmissionError("source_unavailable", target_id)
                    candidates = (
                        self.logical_index.get(declaration.ref) or self.locator_index.get(declaration.ref) or ()
                    )
                    if candidates != (target_id,):
                        raise TypedContentAdmissionError("dependency_ambiguous", current_id)
                    if target.kind not in handler.allowed_dependency_kinds or handler.validate_resolved_dependencies(
                        ((declaration, target.kind),)
                    ):
                        raise TypedContentAdmissionError("dependency_kind_mismatch", current_id)
                    for dependency in visit(target_id):
                        if dependency.item.id not in seen:
                            seen.add(dependency.item.id)
                            ordered.append(dependency)
                    if len(ordered) >= MAX_RUNTIME_ENTRIES:
                        raise TypedContentAdmissionError("runtime_entry_budget", current_id)
            finally:
                visiting.remove(current_id)
            if typed.item.id not in seen:
                ordered.append(typed)
            closure = tuple(ordered)
            self._closures[current_id] = closure
            return closure

        return visit(item_id)


class TypedContentService:
    """Expose product semantics without creating another persistence model."""

    def __init__(self, *, catalog: ContentCatalog, content: ContentCatalogService) -> None:
        self._catalog = catalog
        self._content = content

    @staticmethod
    def parse(item: CatalogContentEntry) -> TypedCatalogItem:
        """Rehydrate a strict document from the catalog's bounded projection."""

        try:
            parsed = handler_for_kind(item.kind).parse_document(
                item.metadata,
                fallback_path=Path(item.relative_locator),
                descriptor_backed=bool(item.relative_locator and not Path(item.relative_locator).suffix),
            )
        except ContentDocumentError as exc:
            raise ContentNotFoundError("typed catalog item is invalid") from exc
        return TypedCatalogItem(item=item, document=parsed.document)

    @classmethod
    def resolve_closure(
        cls,
        *,
        item_id: str,
        visible: dict[str, CatalogContentEntry],
    ) -> tuple[TypedCatalogItem, ...]:
        """Resolve exact typed edges; reject gaps, cycles and ambiguous references.

        Never repair a stored edge by choosing a newer or merely similarly named
        target. Creation and previews share this check over the admitted catalog.
        """

        return TypedContentResolutionContext(visible).resolve(item_id)

    async def list_kind(self, *, user_id: str, kind: ContentKind) -> tuple[TypedCatalogItem, ...]:
        """List only usable items of one exact product family."""

        if kind in RETIRED_CONTENT_KINDS:
            return ()
        items = await self._catalog.list_visible(user_id=user_id)
        context = TypedContentResolutionContext({item.id: item for item in items})
        result: list[TypedCatalogItem] = []
        for item in items:
            if item.kind is not kind or item.status is not ContentStatus.VALID:
                continue
            try:
                parsed = context.parse(item)
                if isinstance(parsed.document, IdleStyleDocumentV1):
                    continue
                result.append(parsed)
            except ContentNotFoundError:
                # Generic Content Health remains the place to inspect a bad
                # item; one malformed peer never breaks a typed family list.
                continue
        return tuple(result)

    async def get(self, *, user_id: str, kind: ContentKind, item_id: str) -> TypedCatalogItem:
        if kind in RETIRED_CONTENT_KINDS:
            raise ContentNotFoundError("typed catalog item was not found")
        visible = {item.id: item for item in await self._catalog.list_visible(user_id=user_id)}
        item = visible.get(item_id)
        if item is None or item.kind is not kind or item.status is not ContentStatus.VALID:
            raise ContentNotFoundError("typed catalog item was not found")
        parsed = TypedContentResolutionContext(visible).parse(item)
        if isinstance(parsed.document, IdleStyleDocumentV1):
            raise ContentNotFoundError("Idle Style requires local conversion")
        return parsed

    async def gesture_idle_playback(self, *, user_id: str, item_id: str) -> dict[str, object]:
        """Inspect one candidate lazily, without loading every listed Gesture's media."""

        visible = {entry.id: entry for entry in await self._catalog.list_visible(user_id=user_id)}
        item = visible.get(item_id)
        if item is None or item.kind is not ContentKind.GESTURE:
            raise ContentNotFoundError("typed catalog item was not found")
        try:
            ordered = TypedContentResolutionContext(visible).resolve(item_id)
            gesture = ordered[-1]
            assert isinstance(gesture.document, GestureDocumentV1)
            facts = await read_gesture_idle_playback(
                document=gesture.document,
                item=gesture.item,
                dependency_items=visible,
                store=self._content.mutations.store,
            )
        except (ContentDocumentError, TypedContentAdmissionError) as exc:
            return {"eligible": False, "reason": exc.code}
        return asdict(facts)

    async def preview(
        self,
        *,
        user_id: str,
        kind: ContentKind,
        item_id: str,
    ) -> TypedContentPreview:
        visible = {entry.id: entry for entry in await self._catalog.list_visible(user_id=user_id)}
        root = visible.get(item_id)
        if root is None or root.kind is not kind:
            raise ContentNotFoundError("typed catalog item was not found")
        ordered = TypedContentResolutionContext(visible).resolve(item_id)
        item = ordered[-1]
        if isinstance(item.document, IdleStyleDocumentV1):
            raise ContentNotFoundError("Idle Style requires local conversion")
        for entry in ordered:
            # A previewed Action must not hand the runtime an unconverted effect.
            require_converted_avatar_effect(entry.document)
        idle_playback: dict[str, IdlePlaybackFacts] = {}
        if isinstance(item.document, IdleStyleDocumentV2):
            facts = await validate_idle_style(
                document=item.document, visible=visible, store=self._content.mutations.store
            )
            idle_playback = {
                reference: facts[dependency_id]
                for reference, dependency_id in zip(item.item.dependencies, item.item.dependency_item_ids, strict=True)
            }
        elif isinstance(item.document, GestureDocumentV1) and item.item.logical_key is not None:
            try:
                gesture_facts = await read_gesture_idle_playback(
                    document=item.document,
                    item=item.item,
                    dependency_items=visible,
                    store=self._content.mutations.store,
                )
            except ContentDocumentError:
                # Idle consumers require these exact-preview facts. Ordinary Action
                # previews still permit authored playback that is unsuitable for idle.
                pass
            else:
                idle_playback[item.item.logical_key] = gesture_facts
        if len(ordered) > MAX_RUNTIME_ENTRIES:
            raise ContentNotFoundError("typed preview dependency budget exceeded")
        if sum(file.size_bytes for entry in ordered for file in entry.item.files) > MAX_RUNTIME_BYTES:
            raise ContentNotFoundError("typed preview byte budget exceeded")
        supports = tuple(entry for entry in ordered if entry.item.id != item.item.id)
        preview = await self._content.issue_preview_bundle(
            anchor=item.item,
            entries=tuple(value.item for value in ordered),
            user_id=user_id,
        )
        return TypedContentPreview(preview=preview, item=item, supports=supports, idle_playback=idle_playback)


async def validate_idle_style(
    *,
    document: IdleStyleDocumentV2,
    visible: dict[str, CatalogContentEntry],
    store: ContentStore,
) -> dict[str, IdlePlaybackFacts]:
    """Resolve each complete Gesture closure and derive immutable finite playback facts.

    This also serves a prospective Save document before it has a catalog row.
    Resolution never guesses a suffix or substitutes an unavailable dependency.
    """

    context = TypedContentResolutionContext(visible)
    result: dict[str, IdlePlaybackFacts] = {}
    gestures: list[TypedCatalogItem] = []
    admitted: dict[str, CatalogContentEntry] = {}
    if len(document.dependencies) >= MAX_RUNTIME_ENTRIES:
        raise ContentDocumentError("runtime_entry_budget", "Idle Style dependency budget exceeded")
    for dependency in document.dependencies:
        ids = context.logical_index.get(dependency.ref) or context.locator_index.get(dependency.ref) or ()
        if len(ids) != 1:
            raise ContentDocumentError("idle_gesture_unavailable", "Idle Gesture dependency is missing or ambiguous")
        try:
            closure = context.resolve(ids[0])
        except TypedContentAdmissionError as exc:
            raise ContentDocumentError(exc.code, "Idle Gesture dependency closure is unavailable") from exc
        gesture = closure[-1]
        if not isinstance(gesture.document, GestureDocumentV1):
            raise ContentDocumentError("idle_gesture_required", "Idle pools require Gesture content")
        admitted.update((value.item.id, value.item) for value in closure)
        if len(admitted) >= MAX_RUNTIME_ENTRIES:
            raise ContentDocumentError("runtime_entry_budget", "Idle Style dependency budget exceeded")
        gestures.append(gesture)
    # Validate the union before opening media. A set of individually valid
    # Gesture closures must not bypass the existing whole-root runtime limits.
    if sum(file.size_bytes for item in admitted.values() for file in item.files) > MAX_RUNTIME_BYTES:
        raise ContentDocumentError("runtime_byte_budget", "Idle Style byte budget exceeded")
    if sum(len(json.dumps(item.metadata).encode()) for item in admitted.values()) > MAX_RUNTIME_CONFIG_BYTES:
        raise ContentDocumentError("runtime_config_budget", "Idle Style metadata budget exceeded")
    for gesture in gestures:
        assert isinstance(gesture.document, GestureDocumentV1)
        result[gesture.item.id] = await read_gesture_idle_playback(
            document=gesture.document,
            item=gesture.item,
            dependency_items=visible,
            store=store,
        )
    return result


__all__ = [
    "validate_idle_style",
    "TypedCatalogItem",
    "TypedContentAdmissionError",
    "TypedContentPreview",
    "TypedContentResolutionContext",
    "TypedContentService",
]
