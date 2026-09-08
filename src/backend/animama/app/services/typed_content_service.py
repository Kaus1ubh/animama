"""Typed product views over the shared editable Content Catalog."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from animama.app.ports.content_catalog import ContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import handler_for_kind
from animama.app.services.runtime_budget_policy import MAX_RUNTIME_BYTES, MAX_RUNTIME_ENTRIES
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentKind,
    ContentNotFoundError,
    ContentPreview,
    ContentStatus,
)
from animama.domain.content_documents import ContentDocumentError, TypedContentDocument


@dataclass(frozen=True, slots=True)
class TypedCatalogItem:
    """A valid catalog identity paired with its strict product document."""

    item: CatalogContentEntry
    document: TypedContentDocument


@dataclass(frozen=True, slots=True)
class TypedContentPreview:
    """Exact preview membership paired with a typed product root."""

    preview: ContentPreview
    item: TypedCatalogItem
    supports: tuple[TypedCatalogItem, ...] = ()


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

    def __init__(self, visible: dict[str, CatalogContentEntry]) -> None:
        self.visible = visible
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

        cached = self._parsed.get(item.id)
        if cached is None:
            cached = TypedContentService.parse(item)
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
            if any(
                file.size_bytes <= 0 or file.size_bytes > handler.definition.max_file_bytes
                for file in entry.files
            ) or sum(file.size_bytes for file in entry.files) > handler.definition.max_entry_bytes:
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

        items = await self._catalog.list_visible(user_id=user_id)
        result: list[TypedCatalogItem] = []
        for item in items:
            if item.kind is not kind or item.status is not ContentStatus.VALID:
                continue
            try:
                result.append(self.parse(item))
            except ContentNotFoundError:
                # Generic Content Health remains the place to inspect a bad
                # item; one malformed peer never breaks a typed family list.
                continue
        return tuple(result)

    async def get(self, *, user_id: str, kind: ContentKind, item_id: str) -> TypedCatalogItem:
        item = await self._catalog.get_visible_item(item_id=item_id, user_id=user_id)
        if item is None or item.kind is not kind or item.status is not ContentStatus.VALID:
            raise ContentNotFoundError("typed catalog item was not found")
        return self.parse(item)

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
        return TypedContentPreview(preview=preview, item=item, supports=supports)


__all__ = [
    "TypedCatalogItem",
    "TypedContentAdmissionError",
    "TypedContentPreview",
    "TypedContentResolutionContext",
    "TypedContentService",
]
