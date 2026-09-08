"""SQLAlchemy repository for markdown memory entries."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import datetime
from typing import Any

from sqlalchemy import func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.ports.memory_entry_port import MemoryEntryRepository, MemoryEntryRepositoryConflictError
from animama.domain.memory_entry import (
    MEMORY_ENTRY_OPERATION_DELETE,
    MEMORY_ENTRY_OPERATION_MOVE,
    MEMORY_ENTRY_TYPE_FILE,
    MemoryEntry,
    MemoryEntryHeader,
    MemoryEntrySearchResult,
    MemoryEntryVersion,
)
from animama.domain.memory_episode import MEMORY_EPISODE_LOG_ENTRY_KIND
from animama.orm.memory_entry import ORMMemoryEntry, ORMMemoryEntryVersion

_MEMORY_ENTRY_NAMESPACE_CONSTRAINTS = frozenset(
    {
        "uq_memory_entries_non_root_sibling_name",
        "uq_memory_entries_user_root_name",
        "uq_memory_entries_anima_root_name",
        "uq_memory_entries_user_path",
        "uq_memory_entries_anima_path",
    }
)
_MEMORY_ENTRY_VERSION_CONSTRAINT = "uq_memory_entry_versions_entry_version"
_MEMORY_ENTRY_CONFLICT_CONSTRAINTS = _MEMORY_ENTRY_NAMESPACE_CONSTRAINTS | {_MEMORY_ENTRY_VERSION_CONSTRAINT}


def _scope_filter(model: type[ORMMemoryEntry], *, user_id: str, anima_id: str | None) -> tuple[object, ...]:
    filters: list[object] = [model.user_id == user_id]
    if anima_id is None:
        filters.append(model.anima_id.is_(None))
    else:
        filters.append(model.anima_id == anima_id)
    return tuple(filters)


def _snippet_for_query(entry: MemoryEntry, query: str, *, max_chars: int) -> str:
    source = "\n".join(
        part
        for part in (
            entry.path,
            entry.description or "",
            entry.content or "",
        )
        if part
    )
    text_value = " ".join(source.split())
    if len(text_value) <= max_chars:
        return text_value

    terms = [term.lower() for term in re.findall(r"[A-Za-z0-9_]{2,}", query)]
    lowered = text_value.lower()
    first_idx = -1
    for term in terms:
        idx = lowered.find(term)
        if idx >= 0 and (first_idx < 0 or idx < first_idx):
            first_idx = idx

    if first_idx < 0:
        return f"{text_value[: max_chars - 3].rstrip()}..."

    window_start = max(0, first_idx - max_chars // 3)
    window_end = min(len(text_value), window_start + max_chars)
    if window_end - window_start < max_chars:
        window_start = max(0, window_end - max_chars)

    prefix = "..." if window_start > 0 else ""
    suffix = "..." if window_end < len(text_value) else ""
    return f"{prefix}{text_value[window_start:window_end].strip()}{suffix}"


def _constraint_name_from_integrity_error(exc: IntegrityError) -> str | None:
    candidates: list[object | None] = [exc, exc.orig]
    seen: set[int] = set()
    text_parts = [str(exc)]

    while candidates:
        candidate = candidates.pop()
        if candidate is None or id(candidate) in seen:
            continue
        seen.add(id(candidate))
        text_parts.append(str(candidate))

        for attr in ("constraint_name", "constraint"):
            value = getattr(candidate, attr, None)
            if isinstance(value, str) and value:
                if value in _MEMORY_ENTRY_CONFLICT_CONSTRAINTS:
                    return value
                text_parts.append(value)

        diag = getattr(candidate, "diag", None)
        diag_constraint = getattr(diag, "constraint_name", None)
        if isinstance(diag_constraint, str) and diag_constraint:
            if diag_constraint in _MEMORY_ENTRY_CONFLICT_CONSTRAINTS:
                return diag_constraint
            text_parts.append(diag_constraint)

        candidates.extend(
            (
                getattr(candidate, "__cause__", None),
                getattr(candidate, "__context__", None),
            )
        )

    error_text = "\n".join(text_parts)
    for constraint_name in _MEMORY_ENTRY_CONFLICT_CONSTRAINTS:
        if constraint_name in error_text:
            return constraint_name
    return None


def _memory_entry_conflict_from_integrity_error(
    exc: IntegrityError,
) -> MemoryEntryRepositoryConflictError | None:
    constraint_name = _constraint_name_from_integrity_error(exc)
    if constraint_name not in _MEMORY_ENTRY_CONFLICT_CONSTRAINTS:
        return None
    return MemoryEntryRepositoryConflictError(constraint_name=constraint_name)


class SQLAlchemyMemoryEntryRepository(MemoryEntryRepository):
    """Persist memory entries and internal versions using SQLAlchemy."""

    def __init__(self, session: AsyncSession) -> None:
        self._s = session

    @staticmethod
    def _orm_to_domain(obj: ORMMemoryEntry) -> MemoryEntry:
        return MemoryEntry(
            id=obj.id,
            user_id=obj.user_id,
            anima_id=obj.anima_id,
            parent_id=obj.parent_id,
            type=obj.type,
            name=obj.name,
            normalized_name=obj.normalized_name,
            path=obj.path,
            normalized_path=obj.normalized_path,
            content=obj.content,
            content_sha256=obj.content_sha256,
            size_bytes=obj.size_bytes,
            version=obj.version,
            kind=obj.kind,
            description=obj.description,
            metadata=dict(obj.metadata_ or {}),
            created_at=obj.created_at,
            updated_at=obj.updated_at,
            deleted_at=obj.deleted_at,
        )

    @staticmethod
    def _version_orm_to_domain(obj: ORMMemoryEntryVersion) -> MemoryEntryVersion:
        return MemoryEntryVersion(
            id=obj.id,
            entry_id=obj.entry_id,
            user_id=obj.user_id,
            anima_id=obj.anima_id,
            parent_id=obj.parent_id,
            type=obj.type,
            name=obj.name,
            normalized_name=obj.normalized_name,
            path=obj.path,
            normalized_path=obj.normalized_path,
            version=obj.version,
            operation=obj.operation,
            content=obj.content,
            content_sha256=obj.content_sha256,
            size_bytes=obj.size_bytes,
            kind=obj.kind,
            description=obj.description,
            metadata=dict(obj.metadata_ or {}),
            change_metadata=dict(obj.change_metadata_ or {}),
            created_at=obj.created_at,
            deleted_at=obj.deleted_at,
        )

    @staticmethod
    def _entry_columns() -> tuple[object, ...]:
        return (
            ORMMemoryEntry.id,
            ORMMemoryEntry.user_id,
            ORMMemoryEntry.anima_id,
            ORMMemoryEntry.parent_id,
            ORMMemoryEntry.type,
            ORMMemoryEntry.name,
            ORMMemoryEntry.normalized_name,
            ORMMemoryEntry.path,
            ORMMemoryEntry.normalized_path,
            ORMMemoryEntry.content,
            ORMMemoryEntry.content_sha256,
            ORMMemoryEntry.size_bytes,
            ORMMemoryEntry.version,
            ORMMemoryEntry.kind,
            ORMMemoryEntry.description,
            ORMMemoryEntry.metadata_.label("metadata_"),
            ORMMemoryEntry.created_at,
            ORMMemoryEntry.updated_at,
            ORMMemoryEntry.deleted_at,
        )

    @staticmethod
    def _header_columns() -> tuple[object, ...]:
        return (
            ORMMemoryEntry.id,
            ORMMemoryEntry.user_id,
            ORMMemoryEntry.anima_id,
            ORMMemoryEntry.parent_id,
            ORMMemoryEntry.type,
            ORMMemoryEntry.name,
            ORMMemoryEntry.normalized_name,
            ORMMemoryEntry.path,
            ORMMemoryEntry.normalized_path,
            ORMMemoryEntry.content_sha256,
            ORMMemoryEntry.size_bytes,
            ORMMemoryEntry.version,
            ORMMemoryEntry.kind,
            ORMMemoryEntry.description,
            ORMMemoryEntry.metadata_.label("metadata_"),
            ORMMemoryEntry.created_at,
            ORMMemoryEntry.updated_at,
            ORMMemoryEntry.deleted_at,
        )

    @staticmethod
    def _row_to_domain(row: Mapping[str, Any]) -> MemoryEntry:
        return MemoryEntry(
            id=row["id"],
            user_id=row["user_id"],
            anima_id=row["anima_id"],
            parent_id=row["parent_id"],
            type=row["type"],
            name=row["name"],
            normalized_name=row["normalized_name"],
            path=row["path"],
            normalized_path=row["normalized_path"],
            content=row["content"],
            content_sha256=row["content_sha256"],
            size_bytes=row["size_bytes"],
            version=row["version"],
            kind=row["kind"],
            description=row["description"],
            metadata=dict(row["metadata_"] or {}),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted_at=row["deleted_at"],
        )

    @staticmethod
    def _row_to_header(row: Mapping[str, Any]) -> MemoryEntryHeader:
        return MemoryEntryHeader(
            id=row["id"],
            user_id=row["user_id"],
            anima_id=row["anima_id"],
            parent_id=row["parent_id"],
            type=row["type"],
            name=row["name"],
            normalized_name=row["normalized_name"],
            path=row["path"],
            normalized_path=row["normalized_path"],
            content_sha256=row["content_sha256"],
            size_bytes=row["size_bytes"],
            version=row["version"],
            kind=row["kind"],
            description=row["description"],
            metadata=dict(row["metadata_"] or {}),
            created_at=row["created_at"],
            updated_at=row["updated_at"],
            deleted_at=row["deleted_at"],
        )

    @staticmethod
    def _version_row_from_entry(entry: MemoryEntry, *, operation: str) -> dict[str, Any]:
        return {
            "entry_id": entry.id,
            "user_id": entry.user_id,
            "anima_id": entry.anima_id,
            "parent_id": entry.parent_id,
            "type": entry.type,
            "name": entry.name,
            "normalized_name": entry.normalized_name,
            "path": entry.path,
            "normalized_path": entry.normalized_path,
            "version": entry.version,
            "operation": operation,
            "content": entry.content,
            "content_sha256": entry.content_sha256,
            "size_bytes": entry.size_bytes,
            "kind": entry.kind,
            "description": entry.description,
            "metadata_": dict(entry.metadata or {}),
            "change_metadata_": {},
            "deleted_at": entry.deleted_at,
        }

    @staticmethod
    def _apply_domain(obj: ORMMemoryEntry, entry: MemoryEntry) -> None:
        obj.user_id = entry.user_id
        obj.anima_id = entry.anima_id
        obj.parent_id = entry.parent_id
        obj.type = entry.type
        obj.name = entry.name
        obj.normalized_name = entry.normalized_name
        obj.path = entry.path
        obj.normalized_path = entry.normalized_path
        obj.content = entry.content
        obj.content_sha256 = entry.content_sha256
        obj.size_bytes = entry.size_bytes
        obj.version = entry.version
        obj.kind = entry.kind
        obj.description = entry.description
        obj.metadata_ = dict(entry.metadata or {})
        obj.deleted_at = entry.deleted_at

    async def create_entry(self, entry: MemoryEntry) -> MemoryEntry:
        obj = ORMMemoryEntry(
            id=entry.id,
            user_id=entry.user_id,
            anima_id=entry.anima_id,
            parent_id=entry.parent_id,
            type=entry.type,
            name=entry.name,
            normalized_name=entry.normalized_name,
            path=entry.path,
            normalized_path=entry.normalized_path,
            content=entry.content,
            content_sha256=entry.content_sha256,
            size_bytes=entry.size_bytes,
            version=entry.version,
            kind=entry.kind,
            description=entry.description,
            metadata_=dict(entry.metadata or {}),
            deleted_at=entry.deleted_at,
        )
        self._s.add(obj)
        try:
            await self._s.flush()
        except IntegrityError as exc:
            if conflict := _memory_entry_conflict_from_integrity_error(exc):
                raise conflict from exc
            raise
        await self._s.refresh(obj)
        return self._orm_to_domain(obj)

    async def get_entry(self, *, user_id: str, entry_id: str, include_deleted: bool = False) -> MemoryEntry | None:
        stmt = select(ORMMemoryEntry).where(ORMMemoryEntry.user_id == user_id, ORMMemoryEntry.id == entry_id)
        if not include_deleted:
            stmt = stmt.where(ORMMemoryEntry.deleted_at.is_(None))
        result = await self._s.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._orm_to_domain(obj) if obj is not None else None

    async def get_entry_for_update(
        self,
        *,
        user_id: str,
        entry_id: str,
        include_deleted: bool = False,
    ) -> MemoryEntry | None:
        stmt = (
            select(ORMMemoryEntry)
            .where(ORMMemoryEntry.user_id == user_id, ORMMemoryEntry.id == entry_id)
            .with_for_update()
        )
        if not include_deleted:
            stmt = stmt.where(ORMMemoryEntry.deleted_at.is_(None))
        result = await self._s.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._orm_to_domain(obj) if obj is not None else None

    async def get_entry_by_path(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        normalized_path: str,
        type: str | None = None,
    ) -> MemoryEntry | None:
        stmt = select(ORMMemoryEntry).where(
            *_scope_filter(ORMMemoryEntry, user_id=user_id, anima_id=anima_id),
            ORMMemoryEntry.normalized_path == normalized_path,
            ORMMemoryEntry.deleted_at.is_(None),
        )
        if type is not None:
            stmt = stmt.where(ORMMemoryEntry.type == type)
        result = await self._s.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._orm_to_domain(obj) if obj is not None else None

    async def get_entry_by_path_for_update(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        normalized_path: str,
        type: str | None = None,
    ) -> MemoryEntry | None:
        stmt = (
            select(ORMMemoryEntry)
            .where(
                *_scope_filter(ORMMemoryEntry, user_id=user_id, anima_id=anima_id),
                ORMMemoryEntry.normalized_path == normalized_path,
                ORMMemoryEntry.deleted_at.is_(None),
            )
            .with_for_update()
        )
        if type is not None:
            stmt = stmt.where(ORMMemoryEntry.type == type)
        result = await self._s.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._orm_to_domain(obj) if obj is not None else None

    async def list_entries(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        parent_id: str | None,
        recursive: bool,
    ) -> list[MemoryEntry]:
        stmt = select(ORMMemoryEntry).where(
            *_scope_filter(ORMMemoryEntry, user_id=user_id, anima_id=anima_id),
            ORMMemoryEntry.deleted_at.is_(None),
        )
        if parent_id is None:
            if recursive:
                stmt = stmt.where(ORMMemoryEntry.parent_id.is_(None) | (ORMMemoryEntry.parent_id.is_not(None)))
            else:
                stmt = stmt.where(ORMMemoryEntry.parent_id.is_(None))
        elif recursive:
            parent = await self.get_entry(user_id=user_id, entry_id=parent_id)
            if parent is None:
                return []
            prefix = f"{parent.normalized_path}/"
            stmt = stmt.where(
                ORMMemoryEntry.id != parent.id,
                ORMMemoryEntry.normalized_path.startswith(prefix, autoescape=True),
            )
        else:
            stmt = stmt.where(ORMMemoryEntry.parent_id == parent_id)
        stmt = stmt.order_by(ORMMemoryEntry.type.asc(), ORMMemoryEntry.normalized_path.asc())
        result = await self._s.execute(stmt)
        return [self._orm_to_domain(obj) for obj in result.scalars()]

    async def list_entry_headers(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        parent_id: str | None,
        recursive: bool,
    ) -> list[MemoryEntryHeader]:
        stmt = select(*self._header_columns()).where(
            *_scope_filter(ORMMemoryEntry, user_id=user_id, anima_id=anima_id),
            ORMMemoryEntry.deleted_at.is_(None),
        )
        if parent_id is None:
            if not recursive:
                stmt = stmt.where(ORMMemoryEntry.parent_id.is_(None))
        elif recursive:
            parent = await self.get_entry(user_id=user_id, entry_id=parent_id)
            if parent is None:
                return []
            prefix = f"{parent.normalized_path}/"
            stmt = stmt.where(
                ORMMemoryEntry.id != parent.id,
                ORMMemoryEntry.normalized_path.startswith(prefix, autoescape=True),
            )
        else:
            stmt = stmt.where(ORMMemoryEntry.parent_id == parent_id)
        stmt = stmt.order_by(ORMMemoryEntry.type.asc(), ORMMemoryEntry.normalized_path.asc())
        result = await self._s.execute(stmt)
        return [self._row_to_header(row._mapping) for row in result]

    async def list_live_children(self, *, user_id: str, parent_id: str) -> list[MemoryEntry]:
        stmt = (
            select(ORMMemoryEntry)
            .where(
                ORMMemoryEntry.user_id == user_id,
                ORMMemoryEntry.parent_id == parent_id,
                ORMMemoryEntry.deleted_at.is_(None),
            )
            .order_by(ORMMemoryEntry.normalized_name.asc())
        )
        result = await self._s.execute(stmt)
        return [self._orm_to_domain(obj) for obj in result.scalars()]

    async def list_live_descendants(self, *, user_id: str, entry: MemoryEntry) -> list[MemoryEntry]:
        prefix = f"{entry.normalized_path}/"
        stmt = (
            select(ORMMemoryEntry)
            .where(
                *_scope_filter(ORMMemoryEntry, user_id=user_id, anima_id=entry.anima_id),
                ORMMemoryEntry.id != entry.id,
                ORMMemoryEntry.normalized_path.startswith(prefix, autoescape=True),
                ORMMemoryEntry.deleted_at.is_(None),
            )
            .order_by(ORMMemoryEntry.normalized_path.asc())
            .with_for_update()
        )
        result = await self._s.execute(stmt)
        return [self._orm_to_domain(obj) for obj in result.scalars()]

    async def has_live_descendant(
        self,
        *,
        user_id: str,
        entry: MemoryEntry,
        descendant_id: str | None = None,
    ) -> bool:
        prefix = f"{entry.normalized_path}/"
        stmt = select(ORMMemoryEntry.id).where(
            *_scope_filter(ORMMemoryEntry, user_id=user_id, anima_id=entry.anima_id),
            ORMMemoryEntry.id != entry.id,
            ORMMemoryEntry.normalized_path.startswith(prefix, autoescape=True),
            ORMMemoryEntry.deleted_at.is_(None),
        )
        if descendant_id is not None:
            stmt = stmt.where(ORMMemoryEntry.id == descendant_id)
        result = await self._s.execute(stmt.limit(1))
        return result.scalar_one_or_none() is not None

    async def max_live_descendant_path_suffix_length(self, *, user_id: str, entry: MemoryEntry) -> int | None:
        prefix = f"{entry.normalized_path}/"
        display_prefix_length = len(f"{entry.path}/")
        stmt = select(func.max(func.length(ORMMemoryEntry.path) - display_prefix_length)).where(
            *_scope_filter(ORMMemoryEntry, user_id=user_id, anima_id=entry.anima_id),
            ORMMemoryEntry.id != entry.id,
            ORMMemoryEntry.normalized_path.startswith(prefix, autoescape=True),
            ORMMemoryEntry.deleted_at.is_(None),
        )
        result = await self._s.execute(stmt)
        value = result.scalar_one_or_none()
        return int(value) if value is not None else None

    async def search_files(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        query: str,
        normalized_path_prefix: str | None,
        include_episodic_memory: bool = True,
        limit: int,
        context_chars: int,
    ) -> list[MemoryEntrySearchResult]:
        search_query = func.websearch_to_tsquery("english", query)
        score = func.ts_rank_cd(ORMMemoryEntry.search_vector, search_query).label("score")
        stmt = (
            select(ORMMemoryEntry, score)
            .where(
                *_scope_filter(ORMMemoryEntry, user_id=user_id, anima_id=anima_id),
                ORMMemoryEntry.type == MEMORY_ENTRY_TYPE_FILE,
                ORMMemoryEntry.deleted_at.is_(None),
                ORMMemoryEntry.search_vector.op("@@")(search_query),
            )
            .order_by(score.desc(), ORMMemoryEntry.updated_at.desc(), ORMMemoryEntry.normalized_path.asc())
        )
        if normalized_path_prefix:
            stmt = stmt.where(ORMMemoryEntry.normalized_path.startswith(normalized_path_prefix, autoescape=True))
        if not include_episodic_memory:
            stmt = stmt.where(
                or_(
                    ORMMemoryEntry.kind.is_(None),
                    ORMMemoryEntry.kind != MEMORY_EPISODE_LOG_ENTRY_KIND,
                ),
                ~ORMMemoryEntry.normalized_path.startswith("episodes/", autoescape=True),
            )
        stmt = stmt.limit(max(1, int(limit)))
        result = await self._s.execute(stmt)
        hits: list[MemoryEntrySearchResult] = []
        for row in result:
            obj, raw_score = row
            entry = self._orm_to_domain(obj)
            hits.append(
                MemoryEntrySearchResult(
                    entry=entry,
                    snippet=_snippet_for_query(entry, query, max_chars=max(80, int(context_chars))),
                    score=float(raw_score or 0.0),
                )
            )
        return hits

    async def update_entry(self, entry: MemoryEntry) -> MemoryEntry:
        obj = await self._s.get(ORMMemoryEntry, entry.id)
        if obj is None or obj.user_id != entry.user_id:
            raise ValueError(f"memory entry not found: {entry.id}")
        self._apply_domain(obj, entry)
        try:
            await self._s.flush()
        except IntegrityError as exc:
            if conflict := _memory_entry_conflict_from_integrity_error(exc):
                raise conflict from exc
            raise
        await self._s.refresh(obj)
        return self._orm_to_domain(obj)

    async def update_entries(self, entries: list[MemoryEntry]) -> list[MemoryEntry]:
        updated: list[MemoryEntry] = []
        for entry in entries:
            updated.append(await self.update_entry(entry))
        return updated

    async def list_versions(
        self,
        *,
        user_id: str,
        entry_id: str,
        before_version: int | None,
        limit: int,
    ) -> list[MemoryEntryVersion]:
        """List immutable snapshots newest first without crossing ownership."""

        stmt = select(ORMMemoryEntryVersion).where(
            ORMMemoryEntryVersion.user_id == user_id,
            ORMMemoryEntryVersion.entry_id == entry_id,
        )
        if before_version is not None:
            stmt = stmt.where(ORMMemoryEntryVersion.version < before_version)
        stmt = stmt.order_by(ORMMemoryEntryVersion.version.desc()).limit(limit)
        result = await self._s.execute(stmt)
        return [self._version_orm_to_domain(obj) for obj in result.scalars()]

    async def get_version(
        self,
        *,
        user_id: str,
        entry_id: str,
        version: int,
    ) -> MemoryEntryVersion | None:
        """Read one owned immutable snapshot by lineage and version."""

        stmt = select(ORMMemoryEntryVersion).where(
            ORMMemoryEntryVersion.user_id == user_id,
            ORMMemoryEntryVersion.entry_id == entry_id,
            ORMMemoryEntryVersion.version == version,
        )
        result = await self._s.execute(stmt)
        obj = result.scalar_one_or_none()
        return self._version_orm_to_domain(obj) if obj is not None else None

    async def move_live_descendants(
        self,
        *,
        user_id: str,
        entry: MemoryEntry,
        old_path_prefix: str,
        old_normalized_path_prefix: str,
        new_path_prefix: str,
        new_normalized_path_prefix: str,
    ) -> list[MemoryEntry]:
        path_suffix_start = len(old_path_prefix) + 1
        normalized_suffix_start = len(old_normalized_path_prefix) + 1
        stmt = (
            update(ORMMemoryEntry)
            .where(
                *_scope_filter(ORMMemoryEntry, user_id=user_id, anima_id=entry.anima_id),
                ORMMemoryEntry.id != entry.id,
                ORMMemoryEntry.normalized_path.startswith(
                    old_normalized_path_prefix,
                    autoescape=True,
                ),
                ORMMemoryEntry.deleted_at.is_(None),
            )
            .values(
                path=func.concat(new_path_prefix, func.substring(ORMMemoryEntry.path, path_suffix_start)),
                normalized_path=func.concat(
                    new_normalized_path_prefix,
                    func.substring(ORMMemoryEntry.normalized_path, normalized_suffix_start),
                ),
                version=ORMMemoryEntry.version + 1,
                updated_at=func.current_timestamp(),
            )
            .returning(*self._entry_columns())
            .execution_options(synchronize_session=False)
        )
        try:
            result = await self._s.execute(stmt)
            updated = [self._row_to_domain(row._mapping) for row in result]
            if updated:
                await self._s.execute(
                    insert(ORMMemoryEntryVersion),
                    [self._version_row_from_entry(item, operation=MEMORY_ENTRY_OPERATION_MOVE) for item in updated],
                )
            await self._s.flush()
        except IntegrityError as exc:
            if conflict := _memory_entry_conflict_from_integrity_error(exc):
                raise conflict from exc
            raise
        return updated

    async def soft_delete_live_descendants(
        self,
        *,
        user_id: str,
        entry: MemoryEntry,
        deleted_at: datetime,
    ) -> list[MemoryEntry]:
        prefix = f"{entry.normalized_path}/"
        stmt = (
            update(ORMMemoryEntry)
            .where(
                *_scope_filter(ORMMemoryEntry, user_id=user_id, anima_id=entry.anima_id),
                ORMMemoryEntry.id != entry.id,
                ORMMemoryEntry.normalized_path.startswith(prefix, autoescape=True),
                ORMMemoryEntry.deleted_at.is_(None),
            )
            .values(
                version=ORMMemoryEntry.version + 1,
                deleted_at=deleted_at,
                updated_at=func.current_timestamp(),
            )
            .returning(*self._entry_columns())
            .execution_options(synchronize_session=False)
        )
        try:
            result = await self._s.execute(stmt)
            updated = [self._row_to_domain(row._mapping) for row in result]
            if updated:
                await self._s.execute(
                    insert(ORMMemoryEntryVersion),
                    [self._version_row_from_entry(item, operation=MEMORY_ENTRY_OPERATION_DELETE) for item in updated],
                )
            await self._s.flush()
        except IntegrityError as exc:
            if conflict := _memory_entry_conflict_from_integrity_error(exc):
                raise conflict from exc
            raise
        return updated

    async def append_version(self, version: MemoryEntryVersion) -> MemoryEntryVersion:
        obj = ORMMemoryEntryVersion(
            entry_id=version.entry_id,
            user_id=version.user_id,
            anima_id=version.anima_id,
            parent_id=version.parent_id,
            type=version.type,
            name=version.name,
            normalized_name=version.normalized_name,
            path=version.path,
            normalized_path=version.normalized_path,
            version=version.version,
            operation=version.operation,
            content=version.content,
            content_sha256=version.content_sha256,
            size_bytes=version.size_bytes,
            kind=version.kind,
            description=version.description,
            metadata_=dict(version.metadata or {}),
            change_metadata_=dict(version.change_metadata or {}),
            deleted_at=version.deleted_at,
        )
        self._s.add(obj)
        try:
            await self._s.flush()
        except IntegrityError as exc:
            if conflict := _memory_entry_conflict_from_integrity_error(exc):
                raise conflict from exc
            raise
        await self._s.refresh(obj)
        return self._version_orm_to_domain(obj)


__all__ = ["SQLAlchemyMemoryEntryRepository"]
