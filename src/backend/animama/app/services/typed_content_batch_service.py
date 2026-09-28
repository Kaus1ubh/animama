"""Shared multi-root resolution for exact evidence and preview capabilities."""

from __future__ import annotations

from dataclasses import dataclass
from time import perf_counter

from animama.app.ports.content_catalog import ContentCatalog
from animama.app.services.runtime_budget_policy import MAX_RUNTIME_BYTES, MAX_RUNTIME_ENTRIES
from animama.app.services.typed_content_service import (
    TypedCatalogItem,
    TypedContentAdmissionError,
    TypedContentResolutionContext,
)
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentKind,
    ContentNotFoundError,
    ContentSource,
    ContentStatus,
)
from animama.logging import get_logger

MAX_BATCH_DIAGNOSTICS = MAX_RUNTIME_ENTRIES


@dataclass(frozen=True, slots=True)
class CatalogTypedRoot:
    """An exact caller-visible catalog root with an optional revision fence."""

    kind: ContentKind
    item_id: str
    expected_revision_sha256: str | None = None

    @property
    def key(self) -> str:
        return f"catalog:{self.item_id}"


@dataclass(frozen=True, slots=True)
class BuiltinTypedRoot:
    """A versioned Included root resolved without downloading the catalog."""

    kind: ContentKind
    content_id: str
    version: int

    @property
    def key(self) -> str:
        return f"builtin:{self.kind.value}:{self.content_id}@{self.version}"


TypedRootLocator = CatalogTypedRoot | BuiltinTypedRoot


@dataclass(frozen=True, slots=True)
class TypedBatchDiagnostic:
    """Bounded path-free failure for one canonical requested root."""

    root_key: str
    code: str
    message: str
    item_id: str | None = None
    expected_revision_sha256: str | None = None
    current_revision_sha256: str | None = None


@dataclass(frozen=True, slots=True)
class ResolvedTypedRoot:
    """One canonical locator and its dependency-first exact closure."""

    key: str
    locator: TypedRootLocator
    item: TypedCatalogItem
    closure: tuple[TypedCatalogItem, ...]


@dataclass(frozen=True, slots=True)
class TypedBatchResolution:
    """Deterministic partial result over one caller-visible catalog read."""

    requested_roots: int
    unique_roots: int
    roots: tuple[ResolvedTypedRoot, ...]
    entries: tuple[TypedCatalogItem, ...]
    diagnostics: tuple[TypedBatchDiagnostic, ...]
    total_bytes: int

    @property
    def complete(self) -> bool:
        return not self.diagnostics and len(self.roots) == self.unique_roots


_SAFE_MESSAGES = {
    "root_declaration_conflict": "The same catalog source was declared with conflicting requirements.",
    "content_kind_retired": "This content kind is no longer supported.",
    "content_dependency_retired": "This Action needs conversion before it can be used.",
    "source_unavailable": "The selected source is unavailable.",
    "source_kind_mismatch": "The selected source has a different content kind.",
    "source_revision_changed": "The selected source revision changed.",
    "source_scan_required": "The selected source needs to be scanned again.",
    "source_invalid": "The selected source is invalid.",
    "typed_document_invalid": "The selected source document is invalid.",
    "dependency_membership_invalid": "A selected source has invalid dependency membership.",
    "dependency_ambiguous": "A selected source dependency is ambiguous.",
    "dependency_kind_mismatch": "A selected source dependency has the wrong content kind.",
    "dependency_cycle": "A selected source dependency graph contains a cycle.",
    "registered_files_invalid": "A selected source has invalid registered files.",
    "registered_file_budget": "A selected source exceeds a file budget.",
    "runtime_entry_budget": "The selected sources exceed the runtime entry budget.",
    "runtime_byte_budget": "The selected sources exceed the runtime byte budget.",
}


def _diagnostic(
    root_key: str,
    code: str,
    *,
    item_id: str | None = None,
    expected_revision_sha256: str | None = None,
    current_revision_sha256: str | None = None,
) -> TypedBatchDiagnostic:
    return TypedBatchDiagnostic(
        root_key=root_key,
        code=code,
        message=_SAFE_MESSAGES.get(code, "The selected source could not be resolved."),
        item_id=item_id,
        expected_revision_sha256=expected_revision_sha256,
        current_revision_sha256=current_revision_sha256,
    )


class TypedContentBatchResolver:
    """Resolve a bounded root set with one visible-catalog read and shared caches."""

    def __init__(self, *, catalog: ContentCatalog) -> None:
        self._catalog = catalog
        self._log = get_logger("app.services.typed_content_batch")

    async def resolve(
        self,
        *,
        user_id: str,
        locators: tuple[TypedRootLocator, ...],
    ) -> TypedBatchResolution:
        started_at = perf_counter()
        visible_items = await self._catalog.list_visible(user_id=user_id)
        visible = {item.id: item for item in visible_items}
        context = TypedContentResolutionContext(visible)
        diagnostics: list[TypedBatchDiagnostic] = []

        catalog_declarations: dict[str, set[tuple[ContentKind, str | None]]] = {}
        by_key: dict[str, TypedRootLocator] = {}
        for locator in locators:
            by_key.setdefault(locator.key, locator)
            if isinstance(locator, CatalogTypedRoot):
                catalog_declarations.setdefault(locator.item_id, set()).add(
                    (locator.kind, locator.expected_revision_sha256)
                )

        conflicting_catalog_ids = {
            item_id for item_id, declarations in catalog_declarations.items() if len(declarations) > 1
        }
        for item_id in sorted(conflicting_catalog_ids):
            diagnostics.append(_diagnostic(f"catalog:{item_id}", "root_declaration_conflict", item_id=item_id))

        roots: list[ResolvedTypedRoot] = []
        union: dict[str, TypedCatalogItem] = {}
        file_sizes: dict[str, int] = {}

        for root_key in sorted(by_key):
            locator = by_key[root_key]
            if isinstance(locator, CatalogTypedRoot) and locator.item_id in conflicting_catalog_ids:
                continue
            item = self._resolve_locator(locator=locator, visible=visible, context=context, diagnostics=diagnostics)
            if item is None:
                continue
            try:
                closure = context.resolve(item.id)
            except TypedContentAdmissionError as exc:
                diagnostics.append(
                    _diagnostic(
                        root_key,
                        exc.code,
                        item_id=exc.item_id if exc.item_id in visible else None,
                    )
                )
                continue

            candidate_union = dict(union)
            candidate_union.update({entry.item.id: entry for entry in closure})
            candidate_files = dict(file_sizes)
            for entry in closure:
                for file in entry.item.files:
                    candidate_files.setdefault(file.file_ref, file.size_bytes)
            if len(candidate_union) > MAX_RUNTIME_ENTRIES:
                diagnostics.append(_diagnostic(root_key, "runtime_entry_budget", item_id=item.id))
                continue
            candidate_bytes = sum(candidate_files.values())
            if candidate_bytes > MAX_RUNTIME_BYTES:
                diagnostics.append(_diagnostic(root_key, "runtime_byte_budget", item_id=item.id))
                continue
            union = candidate_union
            file_sizes = candidate_files
            roots.append(
                ResolvedTypedRoot(
                    key=root_key,
                    locator=locator,
                    item=context.parse(item),
                    closure=closure,
                )
            )

        ordered_entries = tuple(union[item_id] for item_id in sorted(union))
        ordered_diagnostics = tuple(
            sorted(diagnostics, key=lambda value: (value.root_key, value.code, value.item_id or ""))[
                :MAX_BATCH_DIAGNOSTICS
            ]
        )
        result = TypedBatchResolution(
            requested_roots=len(locators),
            unique_roots=len(by_key),
            roots=tuple(roots),
            entries=ordered_entries,
            diagnostics=ordered_diagnostics,
            total_bytes=sum(file_sizes.values()),
        )
        self._log.info(
            "Resolved typed content batch",
            requested_roots=result.requested_roots,
            unique_roots=result.unique_roots,
            unique_closure_entries=len(result.entries),
            deduplicated_bytes=result.total_bytes,
            diagnostic_count=len(result.diagnostics),
            duration_ms=round((perf_counter() - started_at) * 1000, 3),
        )
        return result

    @staticmethod
    def _resolve_locator(
        *,
        locator: TypedRootLocator,
        visible: dict[str, CatalogContentEntry],
        context: TypedContentResolutionContext,
        diagnostics: list[TypedBatchDiagnostic],
    ) -> CatalogContentEntry | None:
        if isinstance(locator, CatalogTypedRoot):
            item = visible.get(locator.item_id)
            if item is None:
                diagnostics.append(_diagnostic(locator.key, "source_unavailable"))
                return None
            if item.kind is not locator.kind:
                diagnostics.append(_diagnostic(locator.key, "source_kind_mismatch", item_id=item.id))
                return None
            if (
                locator.expected_revision_sha256 is not None
                and item.revision_sha256 != locator.expected_revision_sha256
            ):
                diagnostics.append(
                    _diagnostic(
                        locator.key,
                        "source_revision_changed",
                        item_id=item.id,
                        expected_revision_sha256=locator.expected_revision_sha256,
                        current_revision_sha256=item.revision_sha256,
                    )
                )
                return None
            return item

        candidates: list[CatalogContentEntry] = []
        for item in sorted(visible.values(), key=lambda value: value.id):
            if (
                item.source is not ContentSource.INCLUDED
                or item.kind is not locator.kind
                or item.logical_key != locator.content_id
                or item.status is not ContentStatus.VALID
            ):
                continue
            try:
                typed = context.parse(item)
            except ContentNotFoundError:
                continue
            if typed.document.version == locator.version:
                candidates.append(item)
        if len(candidates) != 1:
            diagnostics.append(_diagnostic(locator.key, "source_unavailable"))
            return None
        return candidates[0]


__all__ = [
    "BuiltinTypedRoot",
    "CatalogTypedRoot",
    "ResolvedTypedRoot",
    "TypedBatchDiagnostic",
    "TypedBatchResolution",
    "TypedContentBatchResolver",
    "TypedRootLocator",
]
