from __future__ import annotations

import hashlib
from dataclasses import replace
from datetime import datetime
from typing import cast

import pytest

from animama.app.ports.anima_port import AnimaRepository
from animama.app.ports.memory_entry_port import MemoryEntryRepositoryConflictError
from animama.app.services.memory_entry_service import (
    MEMORY_ENTRY_DEFAULT_MAX_BYTES,
    MEMORY_ENTRY_EPISODES_ROOT_PATH,
    MEMORY_ENTRY_MAX_NAME_CHARS,
    MEMORY_ENTRY_MAX_PATH_CHARS,
    MemoryEntryConfigurationError,
    MemoryEntryConflictError,
    MemoryEntryNotFoundError,
    MemoryEntryProtectedError,
    MemoryEntryService,
    MemoryEntryValidationError,
    normalize_memory_entry_name,
    normalize_memory_entry_path,
    normalize_memory_file_path,
)
from animama.domain.anima import Anima
from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.memory_entry import (
    MEMORY_ENTRY_OPERATION_DELETE,
    MEMORY_ENTRY_OPERATION_MOVE,
    MEMORY_ENTRY_OPERATION_REVERT,
    MEMORY_ENTRY_TYPE_DIRECTORY,
    MEMORY_ENTRY_TYPE_FILE,
    AnimaIdentitySummary,
    MemoryEntry,
    MemoryEntryHeader,
    MemoryEntrySearchResult,
    MemoryEntryVersion,
)
from animama.domain.memory_episode import MEMORY_EPISODE_LOG_ENTRY_KIND


def _header_from_entry(entry: MemoryEntry) -> MemoryEntryHeader:
    return MemoryEntryHeader(
        id=entry.id,
        user_id=entry.user_id,
        anima_id=entry.anima_id,
        parent_id=entry.parent_id,
        type=entry.type,
        name=entry.name,
        normalized_name=entry.normalized_name,
        path=entry.path,
        normalized_path=entry.normalized_path,
        content_sha256=entry.content_sha256,
        size_bytes=entry.size_bytes,
        version=entry.version,
        kind=entry.kind,
        description=entry.description,
        metadata=dict(entry.metadata or {}),
        created_at=entry.created_at,
        updated_at=entry.updated_at,
        deleted_at=entry.deleted_at,
    )


def _version_from_entry(entry: MemoryEntry, *, operation: str) -> MemoryEntryVersion:
    return MemoryEntryVersion(
        id=None,
        entry_id=entry.id,
        user_id=entry.user_id,
        anima_id=entry.anima_id,
        parent_id=entry.parent_id,
        type=entry.type,
        name=entry.name,
        normalized_name=entry.normalized_name,
        path=entry.path,
        normalized_path=entry.normalized_path,
        version=entry.version,
        operation=operation,
        content=entry.content,
        content_sha256=entry.content_sha256,
        size_bytes=entry.size_bytes,
        kind=entry.kind,
        description=entry.description,
        metadata=dict(entry.metadata or {}),
        change_metadata={},
        deleted_at=entry.deleted_at,
    )


class _FakeMemoryEntryRepository:
    def __init__(self) -> None:
        self.entries: dict[str, MemoryEntry] = {}
        self.versions: list[MemoryEntryVersion] = []
        self.next_conflict_constraint_name: str | None = None
        self.update_entry_calls: list[str] = []
        self.update_entries_calls = 0
        self.move_live_descendants_calls = 0
        self.soft_delete_live_descendants_calls = 0

    def raise_next_repository_conflict(self, constraint_name: str) -> None:
        self.next_conflict_constraint_name = constraint_name

    def _raise_conflict_if_requested(self) -> None:
        constraint_name = self.next_conflict_constraint_name
        if constraint_name is None:
            return
        self.next_conflict_constraint_name = None
        raise MemoryEntryRepositoryConflictError(constraint_name=constraint_name)

    async def create_entry(self, entry: MemoryEntry) -> MemoryEntry:
        self._raise_conflict_if_requested()
        self.entries[entry.id] = entry
        return entry

    async def get_entry(self, *, user_id: str, entry_id: str, include_deleted: bool = False) -> MemoryEntry | None:
        entry = self.entries.get(entry_id)
        if entry is None or entry.user_id != user_id:
            return None
        if not include_deleted and entry.deleted_at is not None:
            return None
        return entry

    async def get_entry_for_update(
        self,
        *,
        user_id: str,
        entry_id: str,
        include_deleted: bool = False,
    ) -> MemoryEntry | None:
        return await self.get_entry(user_id=user_id, entry_id=entry_id, include_deleted=include_deleted)

    async def get_entry_by_path(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        normalized_path: str,
        type: str | None = None,
    ) -> MemoryEntry | None:
        for entry in self.entries.values():
            if (
                entry.user_id == user_id
                and entry.anima_id == anima_id
                and entry.normalized_path == normalized_path
                and entry.deleted_at is None
                and (type is None or entry.type == type)
            ):
                return entry
        return None

    async def get_entry_by_path_for_update(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        normalized_path: str,
        type: str | None = None,
    ) -> MemoryEntry | None:
        return await self.get_entry_by_path(
            user_id=user_id,
            anima_id=anima_id,
            normalized_path=normalized_path,
            type=type,
        )

    async def list_entries(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        parent_id: str | None,
        recursive: bool,
    ) -> list[MemoryEntry]:
        live = [
            entry
            for entry in self.entries.values()
            if entry.user_id == user_id and entry.anima_id == anima_id and entry.deleted_at is None
        ]
        if parent_id is None:
            entries = live if recursive else [entry for entry in live if entry.parent_id is None]
        elif recursive:
            parent = self.entries[parent_id]
            prefix = f"{parent.normalized_path}/"
            entries = [entry for entry in live if entry.id != parent_id and entry.normalized_path.startswith(prefix)]
        else:
            entries = [entry for entry in live if entry.parent_id == parent_id]
        return sorted(entries, key=lambda entry: entry.normalized_path)

    async def list_anima_identity_summaries(self, *, user_id: str) -> list[AnimaIdentitySummary]:
        # This fake stores memory only; Anima rows live in the SQL-backed tests.
        return []

    async def list_entry_headers(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        parent_id: str | None,
        recursive: bool,
    ) -> list[MemoryEntryHeader]:
        entries = await self.list_entries(
            user_id=user_id,
            anima_id=anima_id,
            parent_id=parent_id,
            recursive=recursive,
        )
        return [_header_from_entry(entry) for entry in entries]

    async def list_live_children(self, *, user_id: str, parent_id: str) -> list[MemoryEntry]:
        return sorted(
            [
                entry
                for entry in self.entries.values()
                if entry.user_id == user_id and entry.parent_id == parent_id and entry.deleted_at is None
            ],
            key=lambda entry: entry.normalized_name,
        )

    async def list_live_descendants(self, *, user_id: str, entry: MemoryEntry) -> list[MemoryEntry]:
        prefix = f"{entry.normalized_path}/"
        return sorted(
            [
                candidate
                for candidate in self.entries.values()
                if candidate.user_id == user_id
                and candidate.anima_id == entry.anima_id
                and candidate.id != entry.id
                and candidate.normalized_path.startswith(prefix)
                and candidate.deleted_at is None
            ],
            key=lambda entry: entry.normalized_path,
        )

    async def has_live_descendant(
        self,
        *,
        user_id: str,
        entry: MemoryEntry,
        descendant_id: str | None = None,
    ) -> bool:
        descendants = await self.list_live_descendants(user_id=user_id, entry=entry)
        if descendant_id is None:
            return bool(descendants)
        return any(descendant.id == descendant_id for descendant in descendants)

    async def max_live_descendant_path_suffix_length(self, *, user_id: str, entry: MemoryEntry) -> int | None:
        descendants = await self.list_live_descendants(user_id=user_id, entry=entry)
        if not descendants:
            return None
        prefix = f"{entry.path}/"
        return max(len(descendant.path[len(prefix) :]) for descendant in descendants)

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
        lowered = query.casefold()
        results: list[MemoryEntrySearchResult] = []
        for entry in self.entries.values():
            if entry.user_id != user_id or entry.anima_id != anima_id or entry.type != MEMORY_ENTRY_TYPE_FILE:
                continue
            if entry.deleted_at is not None:
                continue
            if normalized_path_prefix and not entry.normalized_path.startswith(normalized_path_prefix):
                continue
            if not include_episodic_memory and (
                entry.kind == MEMORY_EPISODE_LOG_ENTRY_KIND or entry.normalized_path.startswith("episodes/")
            ):
                continue
            haystack = "\n".join([entry.path, entry.description or "", entry.content or ""]).casefold()
            if lowered in haystack:
                results.append(MemoryEntrySearchResult(entry=entry, snippet=entry.content or "", score=1.0))
        return results[:limit]

    async def update_entry(self, entry: MemoryEntry) -> MemoryEntry:
        self._raise_conflict_if_requested()
        self.update_entry_calls.append(entry.id)
        self.entries[entry.id] = entry
        return entry

    async def update_entries(self, entries: list[MemoryEntry]) -> list[MemoryEntry]:
        self._raise_conflict_if_requested()
        self.update_entries_calls += 1
        for entry in entries:
            self.entries[entry.id] = entry
        return entries

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
        self._raise_conflict_if_requested()
        self.move_live_descendants_calls += 1
        updated: list[MemoryEntry] = []
        for descendant in await self.list_live_descendants(user_id=user_id, entry=entry):
            moved = replace(
                descendant,
                path=f"{new_path_prefix}{descendant.path[len(old_path_prefix) :]}",
                normalized_path=(
                    f"{new_normalized_path_prefix}{descendant.normalized_path[len(old_normalized_path_prefix) :]}"
                ),
                version=descendant.version + 1,
            )
            self.entries[moved.id] = moved
            updated.append(moved)
            await self.append_version(_version_from_entry(moved, operation=MEMORY_ENTRY_OPERATION_MOVE))
        return updated

    async def soft_delete_live_descendants(
        self,
        *,
        user_id: str,
        entry: MemoryEntry,
        deleted_at: datetime,
    ) -> list[MemoryEntry]:
        self._raise_conflict_if_requested()
        self.soft_delete_live_descendants_calls += 1
        updated: list[MemoryEntry] = []
        for descendant in await self.list_live_descendants(user_id=user_id, entry=entry):
            deleted = replace(descendant, version=descendant.version + 1, deleted_at=deleted_at)
            self.entries[deleted.id] = deleted
            updated.append(deleted)
            await self.append_version(_version_from_entry(deleted, operation=MEMORY_ENTRY_OPERATION_DELETE))
        return updated

    async def append_version(self, version: MemoryEntryVersion) -> MemoryEntryVersion:
        self._raise_conflict_if_requested()
        stored = replace(version, id=len(self.versions) + 1)
        self.versions.append(stored)
        return stored

    async def list_versions(
        self,
        *,
        user_id: str,
        entry_id: str,
        before_version: int | None,
        limit: int,
    ) -> list[MemoryEntryVersion]:
        versions = [
            version
            for version in self.versions
            if version.user_id == user_id
            and version.entry_id == entry_id
            and (before_version is None or version.version < before_version)
        ]
        return sorted(versions, key=lambda version: version.version, reverse=True)[:limit]

    async def get_version(
        self,
        *,
        user_id: str,
        entry_id: str,
        version: int,
    ) -> MemoryEntryVersion | None:
        return next(
            (
                item
                for item in self.versions
                if item.user_id == user_id and item.entry_id == entry_id and item.version == version
            ),
            None,
        )


class _FakeUnitOfWork:
    def __init__(self) -> None:
        self.commit_calls = 0
        self.rollback_calls = 0

    async def commit(self) -> None:
        self.commit_calls += 1

    async def rollback(self) -> None:
        self.rollback_calls += 1


class _FakeAnimaRepository:
    def __init__(self, owned: set[tuple[str, str]] | None = None) -> None:
        self.owned = {("user-1", "anima-1")} if owned is None else owned
        self.ownership_checks: list[tuple[str, str]] = []
        self.anima = Anima(id="anima-1", display_name="Fixture", user_id="user-1")

    async def is_owned_by_user(self, *, user_id: str, anima_id: str) -> bool:
        self.ownership_checks.append((user_id, anima_id))
        return (user_id, anima_id) in self.owned

    async def get(self, anima_id: str) -> Anima | None:
        return self.anima if anima_id == self.anima.id else None

    async def lock_definition(self, *, user_id: str, anima_id: str, expected_revision: int | None = None) -> Anima:
        if (user_id, anima_id) not in self.owned:
            raise AnimaDefinitionError("anima_not_found")
        if expected_revision is not None and expected_revision != self.anima.aggregate_revision:
            raise AnimaDefinitionError("anima_revision_conflict", current_revision=self.anima.aggregate_revision)
        return self.anima

    async def record_definition_revision(
        self, *, user_id: str, anima_id: str, expected_revision: int, reason: str
    ) -> Anima:
        await self.lock_definition(user_id=user_id, anima_id=anima_id, expected_revision=expected_revision)
        self.anima.aggregate_revision += 1
        return self.anima


def _service(
    *,
    animas: _FakeAnimaRepository | None = None,
    max_file_bytes: int = MEMORY_ENTRY_DEFAULT_MAX_BYTES,
    commit_on_write: bool = True,
) -> tuple[MemoryEntryService, _FakeMemoryEntryRepository, _FakeUnitOfWork]:
    repo = _FakeMemoryEntryRepository()
    uow = _FakeUnitOfWork()
    return (
        MemoryEntryService(
            memory_entries=repo,
            uow=uow,
            # This fixture implements only the Anima reads exercised by this service.
            animas=cast(AnimaRepository | None, animas),
            max_file_bytes=max_file_bytes,
            commit_on_write=commit_on_write,
        ),
        repo,
        uow,
    )


@pytest.mark.parametrize("name", ["profile.md", "notes", "v1.profile.md", "identity.md", "project-notes"])
def test_memory_entry_name_normalization_accepts_stable_segments(name: str) -> None:
    assert normalize_memory_entry_name(name) == (name, name.casefold())


@pytest.mark.parametrize(
    "name",
    [
        "",
        " ",
        ".",
        "..",
        "notes/today",
        "notes\\today",
        "display name.md",
        "[user-1]",
        "bad\x00name.md",
        "x" * (MEMORY_ENTRY_MAX_NAME_CHARS + 1),
    ],
)
def test_memory_entry_name_normalization_rejects_invalid_segments(name: str) -> None:
    with pytest.raises(MemoryEntryValidationError):
        normalize_memory_entry_name(name)


def test_memory_entry_path_normalization_and_markdown_file_rule() -> None:
    assert normalize_memory_entry_path("notes/Profile.md") == ("notes/Profile.md", "notes/profile.md")
    assert normalize_memory_file_path("notes/profile.md") == ("notes/profile.md", "notes/profile.md")

    with pytest.raises(MemoryEntryValidationError):
        normalize_memory_entry_path("/absolute.md")
    with pytest.raises(MemoryEntryValidationError):
        normalize_memory_entry_path("notes//profile.md")
    with pytest.raises(MemoryEntryValidationError):
        normalize_memory_file_path("notes/profile.txt")
    with pytest.raises(MemoryEntryValidationError):
        normalize_memory_entry_path(f"{'x' * (MEMORY_ENTRY_MAX_PATH_CHARS + 1)}.md")


@pytest.mark.asyncio
async def test_content_byte_limit_and_sha256_calculation() -> None:
    service, _repo, _uow = _service(max_file_bytes=5)

    created = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="notes.md",
        content="hé",
    )

    assert created.size_bytes == 3
    assert created.content_sha256 == hashlib.sha256("hé".encode()).hexdigest()

    with pytest.raises(MemoryEntryValidationError):
        await service.create_entry(
            user_id="user-1",
            type=MEMORY_ENTRY_TYPE_FILE,
            name="too-large.md",
            content="abcdef",
        )


@pytest.mark.asyncio
async def test_file_and_directory_validation() -> None:
    service, _repo, _uow = _service()

    directory = await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="notes")
    assert directory.content is None
    assert directory.content_sha256 is None
    assert directory.size_bytes is None

    with pytest.raises(MemoryEntryValidationError):
        await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="bad.md")
    with pytest.raises(MemoryEntryValidationError):
        await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="scratch", content="x")
    with pytest.raises(MemoryEntryValidationError):
        await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_FILE, name="scratch", content="x")
    with pytest.raises(MemoryEntryValidationError):
        await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_FILE, name="scratch.md")


@pytest.mark.asyncio
async def test_create_file_can_create_missing_parents_below_explicit_parent() -> None:
    service, repo, uow = _service()
    notes = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_DIRECTORY,
        name="notes",
    )

    created = await service.create_entry(
        user_id="user-1",
        parent_id=notes.id,
        type=MEMORY_ENTRY_TYPE_FILE,
        name="projects/launch.md",
        content="# Launch",
        expected_version=0,
        create_parents=True,
    )

    assert created.path == "notes/projects/launch.md"
    assert created.content == "# Launch"
    assert {entry.path for entry in repo.entries.values()} == {
        "notes",
        "notes/projects",
        "notes/projects/launch.md",
    }
    assert uow.commit_calls == 2

    with pytest.raises(MemoryEntryConflictError, match="version conflict"):
        await service.create_entry(
            user_id="user-1",
            parent_id=notes.id,
            type=MEMORY_ENTRY_TYPE_FILE,
            name="projects/launch.md",
            content="# Replacement",
            expected_version=0,
            create_parents=True,
        )


@pytest.mark.asyncio
async def test_create_parents_rejects_directory_requests() -> None:
    service, _repo, uow = _service()

    with pytest.raises(MemoryEntryValidationError, match="only be created for file"):
        await service.create_entry(
            user_id="user-1",
            type=MEMORY_ENTRY_TYPE_DIRECTORY,
            name="projects/launches",
            create_parents=True,
        )

    assert uow.commit_calls == 0


@pytest.mark.asyncio
async def test_user_scope_operations_do_not_require_anima_repository() -> None:
    service, _repo, uow = _service()

    created = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="profile.md",
        content="Profile",
    )
    fetched = await service.get_entry(user_id="user-1", entry_id=created.id)
    patched = await service.patch_entry(
        user_id="user-1",
        entry_id=created.id,
        expected_version=fetched.version,
        description="Updated",
        description_set=True,
    )
    listing = await service.list_entries(user_id="user-1")

    assert patched.description == "Updated"
    assert [entry.id for entry in listing.entries] == [created.id]
    assert uow.commit_calls == 2


@pytest.mark.asyncio
async def test_episode_log_namespace_is_protected_from_public_creates() -> None:
    service, _repo, uow = _service()

    with pytest.raises(MemoryEntryProtectedError, match="read-only"):
        await service.create_entry(
            user_id="user-1",
            type=MEMORY_ENTRY_TYPE_DIRECTORY,
            name=MEMORY_ENTRY_EPISODES_ROOT_PATH,
        )
    with pytest.raises(MemoryEntryProtectedError, match="read-only"):
        await service.create_entry(
            user_id="user-1",
            type=MEMORY_ENTRY_TYPE_FILE,
            name="daily.md",
            content="Generated",
            kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        )
    with pytest.raises(MemoryEntryProtectedError, match="read-only"):
        await service.put_file_by_path(
            user_id="user-1",
            path="episodes/2026/07/2026-07-07.md",
            content="# Episodes",
            kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
            expected_version=0,
            create_parents=True,
        )

    assert uow.commit_calls == 0


@pytest.mark.asyncio
async def test_system_managed_episode_log_can_create_and_refresh_daily_file() -> None:
    service, repo, _uow = _service()

    created = await service.put_file_by_path(
        user_id="user-1",
        path="episodes/2026/07/2026-07-07.md",
        content="# Episodes\n\n- [ ] First",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        description="Generated episodic memory log for 2026-07-07.",
        expected_version=0,
        create_parents=True,
        allow_system_managed=True,
    )
    refreshed = await service.put_file_by_path(
        user_id="user-1",
        path="episodes/2026/07/2026-07-07.md",
        content="# Episodes\n\n- [x] First",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        description="Generated episodic memory log for 2026-07-07.",
        expected_version=created.version,
        create_parents=True,
        allow_system_managed=True,
    )

    assert refreshed.id == created.id
    assert refreshed.version == 2
    assert refreshed.content == "# Episodes\n\n- [x] First"
    assert {entry.path for entry in repo.entries.values()} == {
        "episodes",
        "episodes/2026",
        "episodes/2026/07",
        "episodes/2026/07/2026-07-07.md",
    }


@pytest.mark.asyncio
async def test_episode_log_entries_and_generated_directories_are_protected_from_public_mutations() -> None:
    service, repo, _uow = _service()
    episode_file = await service.put_file_by_path(
        user_id="user-1",
        path="episodes/2026/07/2026-07-07.md",
        content="# Episodes",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        expected_version=0,
        create_parents=True,
        allow_system_managed=True,
    )
    episodes_root = next(entry for entry in repo.entries.values() if entry.path == "episodes")
    profile = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="profile.md",
        content="Profile",
    )

    with pytest.raises(MemoryEntryProtectedError, match="read-only"):
        await service.patch_entry(
            user_id="user-1",
            entry_id=episode_file.id,
            expected_version=episode_file.version,
            content="# Hacked",
            content_set=True,
        )
    with pytest.raises(MemoryEntryProtectedError, match="read-only"):
        await service.patch_entry(
            user_id="user-1",
            entry_id=episode_file.id,
            expected_version=episode_file.version,
            name="renamed.md",
            name_set=True,
        )
    with pytest.raises(MemoryEntryProtectedError, match="read-only"):
        await service.patch_entry(
            user_id="user-1",
            entry_id=profile.id,
            expected_version=profile.version,
            parent_id=episodes_root.id,
            parent_id_set=True,
        )
    with pytest.raises(MemoryEntryProtectedError, match="read-only"):
        await service.delete_entry(
            user_id="user-1",
            entry_id=episode_file.id,
            expected_version=episode_file.version,
        )
    with pytest.raises(MemoryEntryProtectedError, match="read-only"):
        await service.delete_entry(
            user_id="user-1",
            entry_id=episodes_root.id,
            expected_version=episodes_root.version,
            recursive=True,
        )

    assert repo.entries[episode_file.id].content == "# Episodes"
    assert repo.entries[episode_file.id].deleted_at is None
    assert repo.entries[episodes_root.id].deleted_at is None
    assert repo.entries[profile.id].path == "profile.md"


@pytest.mark.asyncio
async def test_search_files_includes_episode_log_content() -> None:
    service, _repo, _uow = _service()
    await service.put_file_by_path(
        user_id="user-1",
        path="episodes/2026/07/2026-07-07.md",
        content="The user wants help with the Amaryllis launch.",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        expected_version=0,
        create_parents=True,
        allow_system_managed=True,
    )

    results = await service.search_files(user_id="user-1", query="Amaryllis")
    curated_only = await service.search_files(
        user_id="user-1",
        query="Amaryllis",
        include_episodic_memory=False,
    )

    assert [result.entry.path for result in results] == ["episodes/2026/07/2026-07-07.md"]
    assert curated_only == []


@pytest.mark.asyncio
@pytest.mark.parametrize("operation", ["list", "list_headers", "create", "put", "get_by_path", "search"])
async def test_anima_scope_requires_configured_anima_repository_for_explicit_scope(operation: str) -> None:
    service, _repo, _uow = _service()

    with pytest.raises(MemoryEntryConfigurationError, match="not configured to validate anima-scoped memory"):
        if operation == "list":
            await service.list_entries(user_id="user-1", anima_id="anima-1")
        elif operation == "list_headers":
            await service.list_entry_headers(user_id="user-1", anima_id="anima-1")
        elif operation == "create":
            await service.create_entry(
                user_id="user-1",
                anima_id="anima-1",
                type=MEMORY_ENTRY_TYPE_FILE,
                name="identity.md",
                content="Identity",
            )
        elif operation == "put":
            await service.put_file_by_path(
                user_id="user-1",
                anima_id="anima-1",
                path="identity.md",
                content="Identity",
                expected_version=0,
            )
        elif operation == "get_by_path":
            await service.get_entry_by_path(user_id="user-1", anima_id="anima-1", path="identity.md")
        else:
            await service.search_files(user_id="user-1", anima_id="anima-1", query="identity")


@pytest.mark.asyncio
async def test_existing_anima_scope_entry_requires_configured_anima_repository_for_id_operations() -> None:
    service, repo, uow = _service()
    entry = MemoryEntry(
        id="mem-anima-identity",
        user_id="user-1",
        anima_id="anima-1",
        parent_id=None,
        type=MEMORY_ENTRY_TYPE_FILE,
        name="identity.md",
        normalized_name="identity.md",
        path="identity.md",
        normalized_path="identity.md",
        content="Identity",
        content_sha256=hashlib.sha256(b"Identity").hexdigest(),
        size_bytes=len(b"Identity"),
        version=1,
        kind="anima_identity",
        description=None,
        metadata={},
    )
    repo.entries[entry.id] = entry

    with pytest.raises(MemoryEntryConfigurationError):
        await service.get_entry(user_id="user-1", entry_id=entry.id)
    with pytest.raises(MemoryEntryConfigurationError):
        await service.patch_entry(
            user_id="user-1",
            entry_id=entry.id,
            expected_version=1,
            description="Updated",
            description_set=True,
        )
    with pytest.raises(MemoryEntryConfigurationError):
        await service.delete_entry(user_id="user-1", entry_id=entry.id, expected_version=1)

    assert uow.commit_calls == 0


@pytest.mark.asyncio
async def test_anima_scope_uses_configured_anima_ownership_repository() -> None:
    animas = _FakeAnimaRepository()
    service, _repo, _uow = _service(animas=animas)

    created = await service.create_entry(
        user_id="user-1",
        anima_id="anima-1",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="identity.md",
        content="Identity",
        expected_aggregate_revision=1,
    )

    assert created.anima_id == "anima-1"
    assert ("user-1", "anima-1") in animas.ownership_checks

    foreign_service, _foreign_repo, _foreign_uow = _service(animas=_FakeAnimaRepository(owned=set()))
    with pytest.raises(MemoryEntryNotFoundError, match="Anima not found"):
        await foreign_service.list_entries(user_id="user-1", anima_id="anima-1")


@pytest.mark.asyncio
async def test_explicit_directory_creation_and_nested_file_with_auto_created_parents() -> None:
    service, repo, uow = _service()

    notes = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_DIRECTORY,
        name="notes",
        description="Note directory",
    )
    stored = await service.put_file_by_path(
        user_id="user-1",
        path="projects/launch.md",
        content="Launch notes",
        kind="user_memory",
        create_parents=True,
        expected_version=0,
    )

    assert notes.path == "notes"
    assert stored.path == "projects/launch.md"
    assert stored.parent_id is not None
    assert {entry.path for entry in repo.entries.values()} == {"notes", "projects", "projects/launch.md"}
    assert [version.operation for version in repo.versions] == ["create", "create", "create"]
    assert uow.commit_calls == 2


@pytest.mark.asyncio
async def test_case_insensitive_sibling_and_path_conflicts() -> None:
    service, _repo, _uow = _service()
    await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="Notes")

    with pytest.raises(MemoryEntryConflictError):
        await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="notes")

    await service.put_file_by_path(
        user_id="user-1",
        path="profile.md",
        content="one",
        expected_version=0,
    )
    with pytest.raises(MemoryEntryConflictError):
        await service.put_file_by_path(
            user_id="user-1",
            path="PROFILE.md",
            content="two",
            expected_version=0,
        )


@pytest.mark.asyncio
async def test_repository_conflict_becomes_service_conflict_and_rolls_back_when_committing() -> None:
    service, repo, uow = _service()
    repo.raise_next_repository_conflict("uq_memory_entries_user_path")

    with pytest.raises(MemoryEntryConflictError) as conflict:
        await service.create_entry(
            user_id="user-1",
            type=MEMORY_ENTRY_TYPE_FILE,
            name="profile.md",
            content="Profile",
        )

    assert conflict.value.detail == "Memory entry already exists"
    assert uow.rollback_calls == 1
    assert uow.commit_calls == 0


@pytest.mark.asyncio
async def test_repository_version_conflict_uses_stable_service_message() -> None:
    service, repo, uow = _service()
    repo.raise_next_repository_conflict("uq_memory_entry_versions_entry_version")

    with pytest.raises(MemoryEntryConflictError) as conflict:
        await service.create_entry(
            user_id="user-1",
            type=MEMORY_ENTRY_TYPE_FILE,
            name="profile.md",
            content="Profile",
        )

    assert conflict.value.detail == "Memory entry version conflict"
    assert uow.rollback_calls == 1


@pytest.mark.asyncio
async def test_repository_conflict_does_not_roll_back_outer_transaction() -> None:
    service, repo, uow = _service(commit_on_write=False)
    repo.raise_next_repository_conflict("uq_memory_entries_user_path")

    with pytest.raises(MemoryEntryConflictError):
        await service.create_entry(
            user_id="user-1",
            type=MEMORY_ENTRY_TYPE_FILE,
            name="profile.md",
            content="Profile",
        )

    assert uow.rollback_calls == 0
    assert uow.commit_calls == 0


@pytest.mark.asyncio
async def test_by_path_lookup_and_listing_root_children_recursive() -> None:
    service, _repo, _uow = _service(animas=_FakeAnimaRepository())
    notes = await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="notes")
    await service.create_entry(
        user_id="user-1",
        parent_id=notes.id,
        type=MEMORY_ENTRY_TYPE_FILE,
        name="prefs.md",
        content="Prefs",
    )
    await service.put_file_by_path(user_id="user-1", path="profile.md", content="Profile", expected_version=0)
    await service.put_file_by_path(
        user_id="user-1",
        anima_id="anima-1",
        path="identity.md",
        content="Identity",
        expected_version=0,
        expected_aggregate_revision=1,
    )

    profile = await service.get_entry_by_path(user_id="user-1", path="PROFILE.md")
    root = await service.list_entries(user_id="user-1")
    recursive = await service.list_entries(user_id="user-1", recursive=True)
    anima_root = await service.list_entries(user_id="user-1", anima_id="anima-1", recursive=True)

    assert profile.path == "profile.md"
    assert [entry.path for entry in root.entries] == ["notes", "profile.md"]
    assert [entry.path for entry in recursive.entries] == ["notes", "notes/prefs.md", "profile.md"]
    assert [entry.path for entry in anima_root.entries] == ["IDENTITY.md"]


@pytest.mark.asyncio
async def test_header_listing_matches_full_listing_without_content() -> None:
    service, _repo, _uow = _service()
    notes = await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="notes")
    await service.create_entry(
        user_id="user-1",
        parent_id=notes.id,
        type=MEMORY_ENTRY_TYPE_FILE,
        name="prefs.md",
        content="Prefs",
        description="Preferences",
    )
    await service.put_file_by_path(user_id="user-1", path="profile.md", content="Profile", expected_version=0)

    full = await service.list_entries(user_id="user-1", recursive=True)
    headers = await service.list_entry_headers(user_id="user-1", recursive=True)

    assert [entry.path for entry in headers.entries] == [entry.path for entry in full.entries]
    assert [entry.version for entry in headers.entries] == [entry.version for entry in full.entries]
    assert headers.entries[1].description == "Preferences"
    assert not hasattr(headers.entries[1], "content")


@pytest.mark.asyncio
async def test_patch_updates_file_metadata_and_requires_current_version() -> None:
    service, repo, _uow = _service()
    created = await service.put_file_by_path(
        user_id="user-1",
        path="profile.md",
        content="Name: Ray",
        description=" Initial profile ",
        metadata={"source": {"type": "test"}},
        expected_version=0,
    )

    updated = await service.patch_entry(
        user_id="user-1",
        entry_id=created.id,
        expected_version=1,
        content="Name: Ray\nColor: green",
        content_set=True,
        description=" ",
        description_set=True,
        metadata={"reviewed": True},
        metadata_set=True,
    )

    assert updated.version == 2
    assert updated.description is None
    assert updated.metadata == {"reviewed": True}
    assert "Color: green" in (updated.content or "")
    assert [version.version for version in repo.versions] == [1, 2]

    with pytest.raises(MemoryEntryConflictError):
        await service.patch_entry(
            user_id="user-1",
            entry_id=created.id,
            expected_version=1,
            content="stale",
            content_set=True,
        )


@pytest.mark.asyncio
async def test_move_and_rename_update_descendant_path_caches() -> None:
    service, repo, _uow = _service()
    notes = await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="notes")
    project_dir = await service.create_entry(
        user_id="user-1",
        parent_id=notes.id,
        type=MEMORY_ENTRY_TYPE_DIRECTORY,
        name="projects",
    )
    child = await service.put_file_by_path(
        user_id="user-1",
        path="notes/prefs.md",
        content="Prefs",
        create_parents=True,
        expected_version=0,
    )
    nested_child = await service.create_entry(
        user_id="user-1",
        parent_id=project_dir.id,
        type=MEMORY_ENTRY_TYPE_FILE,
        name="roadmap.md",
        content="Roadmap",
    )

    moved = await service.patch_entry(
        user_id="user-1",
        entry_id=notes.id,
        expected_version=1,
        name="archive",
        name_set=True,
    )
    refreshed_child = repo.entries[child.id]
    refreshed_project_dir = repo.entries[project_dir.id]
    refreshed_nested_child = repo.entries[nested_child.id]
    move_versions = {
        version.entry_id: version for version in repo.versions if version.operation == MEMORY_ENTRY_OPERATION_MOVE
    }

    assert moved.path == "archive"
    assert moved.version == 2
    assert refreshed_child.path == "archive/prefs.md"
    assert refreshed_child.normalized_path == "archive/prefs.md"
    assert refreshed_child.version == 2
    assert refreshed_project_dir.path == "archive/projects"
    assert refreshed_project_dir.normalized_path == "archive/projects"
    assert refreshed_project_dir.version == 2
    assert refreshed_nested_child.path == "archive/projects/roadmap.md"
    assert refreshed_nested_child.normalized_path == "archive/projects/roadmap.md"
    assert refreshed_nested_child.version == 2
    assert set(move_versions) == {notes.id, child.id, project_dir.id, nested_child.id}
    assert move_versions[notes.id].path == "archive"
    assert move_versions[child.id].path == "archive/prefs.md"
    assert move_versions[project_dir.id].path == "archive/projects"
    assert move_versions[nested_child.id].path == "archive/projects/roadmap.md"
    assert {version.version for version in move_versions.values()} == {2}
    assert repo.move_live_descendants_calls == 1
    assert repo.update_entries_calls == 0
    assert repo.update_entry_calls[-1:] == [notes.id]


@pytest.mark.asyncio
async def test_move_rejects_cycles_cross_scope_and_parenting_under_files() -> None:
    service, _repo, _uow = _service(animas=_FakeAnimaRepository())
    notes = await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="notes")
    child_dir = await service.create_entry(
        user_id="user-1",
        parent_id=notes.id,
        type=MEMORY_ENTRY_TYPE_DIRECTORY,
        name="child",
    )
    file_entry = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="profile.md",
        content="Profile",
    )
    anima_dir = await service.create_entry(
        user_id="user-1",
        anima_id="anima-1",
        type=MEMORY_ENTRY_TYPE_DIRECTORY,
        name="facts",
    )

    with pytest.raises(MemoryEntryConflictError):
        await service.patch_entry(
            user_id="user-1",
            entry_id=notes.id,
            expected_version=1,
            parent_id=child_dir.id,
            parent_id_set=True,
        )
    with pytest.raises(MemoryEntryValidationError):
        await service.patch_entry(
            user_id="user-1",
            entry_id=notes.id,
            expected_version=1,
            parent_id=file_entry.id,
            parent_id_set=True,
        )
    with pytest.raises(MemoryEntryValidationError):
        await service.patch_entry(
            user_id="user-1",
            entry_id=notes.id,
            expected_version=1,
            parent_id=anima_dir.id,
            parent_id_set=True,
        )


@pytest.mark.asyncio
async def test_soft_delete_hides_entries_and_directory_delete_conflicts_unless_recursive() -> None:
    service, repo, _uow = _service()
    notes = await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="notes")
    child = await service.create_entry(
        user_id="user-1",
        parent_id=notes.id,
        type=MEMORY_ENTRY_TYPE_FILE,
        name="prefs.md",
        content="Prefs",
    )

    with pytest.raises(MemoryEntryConflictError):
        await service.delete_entry(user_id="user-1", entry_id=notes.id, expected_version=1)

    await service.delete_entry(user_id="user-1", entry_id=notes.id, expected_version=1, recursive=True)

    with pytest.raises(MemoryEntryNotFoundError):
        await service.get_entry(user_id="user-1", entry_id=notes.id)
    assert (await service.list_entries(user_id="user-1", recursive=True)).entries == []
    assert repo.entries[notes.id].deleted_at is not None
    assert repo.entries[child.id].deleted_at is not None
    assert [version.operation for version in repo.versions[-2:]] == [
        MEMORY_ENTRY_OPERATION_DELETE,
        MEMORY_ENTRY_OPERATION_DELETE,
    ]
    assert repo.soft_delete_live_descendants_calls == 1
    assert repo.update_entries_calls == 0


@pytest.mark.asyncio
async def test_large_subtree_move_and_delete_use_bulk_repository_paths() -> None:
    service, repo, _uow = _service()
    root = await service.create_entry(user_id="user-1", type=MEMORY_ENTRY_TYPE_DIRECTORY, name="notes")
    created_ids = [root.id]
    for index in range(8):
        directory = await service.create_entry(
            user_id="user-1",
            parent_id=root.id,
            type=MEMORY_ENTRY_TYPE_DIRECTORY,
            name=f"dir-{index}",
        )
        created_ids.append(directory.id)
        for file_index in range(3):
            child = await service.create_entry(
                user_id="user-1",
                parent_id=directory.id,
                type=MEMORY_ENTRY_TYPE_FILE,
                name=f"file-{file_index}.md",
                content=f"content {index}/{file_index}",
            )
            created_ids.append(child.id)

    await service.patch_entry(
        user_id="user-1",
        entry_id=root.id,
        expected_version=1,
        name="archive",
        name_set=True,
    )

    assert repo.move_live_descendants_calls == 1
    assert repo.update_entries_calls == 0
    assert repo.update_entry_calls == [root.id]
    assert all(repo.entries[entry_id].path.startswith("archive") for entry_id in created_ids)
    assert all(repo.entries[entry_id].version == 2 for entry_id in created_ids)
    move_version_ids = {
        version.entry_id for version in repo.versions if version.operation == MEMORY_ENTRY_OPERATION_MOVE
    }
    assert move_version_ids == set(created_ids)

    await service.delete_entry(user_id="user-1", entry_id=root.id, expected_version=2, recursive=True)

    assert repo.soft_delete_live_descendants_calls == 1
    assert repo.update_entries_calls == 0
    assert repo.update_entry_calls == [root.id, root.id]
    assert all(repo.entries[entry_id].deleted_at is not None for entry_id in created_ids)
    delete_version_ids = {
        version.entry_id for version in repo.versions if version.operation == MEMORY_ENTRY_OPERATION_DELETE
    }
    assert delete_version_ids == set(created_ids)


@pytest.mark.asyncio
async def test_version_history_paginates_newest_first_and_returns_adjacent_changes() -> None:
    service, _repo, _uow = _service()
    profile = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="profile.md",
        content="# Profile\n",
        description="Initial profile",
    )
    profile = await service.patch_entry(
        user_id="user-1",
        entry_id=profile.id,
        expected_version=profile.version,
        description="Durable profile",
        description_set=True,
    )
    profile = await service.patch_entry(
        user_id="user-1",
        entry_id=profile.id,
        expected_version=profile.version,
        content="# Profile\n\nLikes tea.\n",
        content_set=True,
    )
    archive = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_DIRECTORY,
        name="archive",
    )
    profile = await service.patch_entry(
        user_id="user-1",
        entry_id=profile.id,
        expected_version=profile.version,
        parent_id=archive.id,
        parent_id_set=True,
    )

    first_page = await service.list_versions(user_id="user-1", entry_id=profile.id, limit=2)
    second_page = await service.list_versions(
        user_id="user-1",
        entry_id=profile.id,
        before_version=first_page.next_before_version,
        limit=2,
    )
    created = await service.get_version_detail(user_id="user-1", entry_id=profile.id, version=1)
    described = await service.get_version_detail(user_id="user-1", entry_id=profile.id, version=2)
    updated = await service.get_version_detail(user_id="user-1", entry_id=profile.id, version=3)
    moved = await service.get_version_detail(user_id="user-1", entry_id=profile.id, version=4)

    assert [version.version for version in first_page.versions] == [4, 3]
    assert first_page.next_before_version == 3
    assert [version.version for version in second_page.versions] == [2, 1]
    assert second_page.next_before_version is None

    assert created.previous_version == 0
    assert created.path_change is not None
    assert created.path_change.old is None
    assert created.path_change.new == "profile.md"
    assert "--- /dev/null" in created.unified_diff
    assert "+# Profile" in created.unified_diff

    assert described.previous_version == 1
    assert described.unified_diff == ""
    assert described.description_change is not None
    assert described.description_change.old == "Initial profile"
    assert described.description_change.new == "Durable profile"

    assert updated.previous_version == 2
    assert "+Likes tea." in updated.unified_diff
    assert updated.path_change is None

    assert moved.previous_version == 3
    assert moved.unified_diff == ""
    assert moved.path_change is not None
    assert moved.path_change.old == "profile.md"
    assert moved.path_change.new == "archive/profile.md"


@pytest.mark.asyncio
async def test_version_history_authorizes_deleted_generated_and_owned_entries() -> None:
    service, _repo, _uow = _service()
    editable = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="editable.md",
        content="Editable",
    )
    generated = await service.put_file_by_path(
        user_id="user-1",
        path="episodes/2026/07/2026-07-16.md",
        content="# Episodes",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        expected_version=0,
        create_parents=True,
        allow_system_managed=True,
    )
    foreign = await service.create_entry(
        user_id="user-2",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="foreign.md",
        content="Foreign",
    )
    await service.delete_entry(
        user_id="user-1",
        entry_id=editable.id,
        expected_version=editable.version,
    )

    deleted_history = await service.list_versions(user_id="user-1", entry_id=editable.id)
    generated_history = await service.get_version_detail(
        user_id="user-1",
        entry_id=generated.id,
        version=1,
    )

    assert [version.operation for version in deleted_history.versions] == ["delete", "create"]
    assert deleted_history.versions[0].deleted_at is not None
    assert generated_history.entry.kind == MEMORY_EPISODE_LOG_ENTRY_KIND
    with pytest.raises(MemoryEntryNotFoundError):
        await service.list_versions(user_id="user-1", entry_id=foreign.id)


@pytest.mark.asyncio
async def test_version_detail_rejects_missing_selected_or_predecessor_snapshot() -> None:
    service, repo, _uow = _service()
    entry = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="profile.md",
        content="One",
    )
    entry = await service.patch_entry(
        user_id="user-1",
        entry_id=entry.id,
        expected_version=entry.version,
        content="Two",
        content_set=True,
    )
    entry = await service.patch_entry(
        user_id="user-1",
        entry_id=entry.id,
        expected_version=entry.version,
        content="Three",
        content_set=True,
    )

    with pytest.raises(MemoryEntryNotFoundError):
        await service.get_version_detail(user_id="user-1", entry_id=entry.id, version=99)

    repo.versions = [version for version in repo.versions if version.version != 2]
    with pytest.raises(MemoryEntryConflictError, match="incomplete"):
        await service.get_version_detail(user_id="user-1", entry_id=entry.id, version=3)


@pytest.mark.asyncio
async def test_revert_restores_only_content_and_description_as_new_version() -> None:
    service, repo, _uow = _service()
    profile = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="profile.md",
        content="Original profile",
        description="Original description",
        metadata={"stable": True},
    )
    profile = await service.patch_entry(
        user_id="user-1",
        entry_id=profile.id,
        expected_version=profile.version,
        content="Current profile",
        content_set=True,
        description="Current description",
        description_set=True,
    )
    archive = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_DIRECTORY,
        name="archive",
    )
    profile = await service.patch_entry(
        user_id="user-1",
        entry_id=profile.id,
        expected_version=profile.version,
        parent_id=archive.id,
        parent_id_set=True,
    )

    reverted = await service.revert_entry(
        user_id="user-1",
        entry_id=profile.id,
        target_version=1,
        expected_version=3,
    )

    assert reverted.version == 4
    assert reverted.content == "Original profile"
    assert reverted.description == "Original description"
    assert reverted.path == "archive/profile.md"
    assert reverted.parent_id == archive.id
    assert reverted.metadata == {"stable": True}
    assert repo.versions[-1].operation == MEMORY_ENTRY_OPERATION_REVERT
    assert repo.versions[-1].change_metadata == {
        "source_type": "memory_entry_revert",
        "source_id": profile.id,
        "target_version": 1,
    }

    with pytest.raises(MemoryEntryValidationError, match="already matches"):
        await service.revert_entry(
            user_id="user-1",
            entry_id=profile.id,
            target_version=1,
            expected_version=4,
        )
    with pytest.raises(MemoryEntryConflictError, match="version conflict"):
        await service.revert_entry(
            user_id="user-1",
            entry_id=profile.id,
            target_version=2,
            expected_version=3,
        )


@pytest.mark.asyncio
async def test_revert_rejects_noneditable_and_invalid_targets() -> None:
    service, _repo, _uow = _service()
    directory = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_DIRECTORY,
        name="notes",
    )
    generated = await service.put_file_by_path(
        user_id="user-1",
        path="episodes/2026/07/2026-07-16.md",
        content="# Episodes",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        expected_version=0,
        create_parents=True,
        allow_system_managed=True,
    )
    editable = await service.create_entry(
        user_id="user-1",
        type=MEMORY_ENTRY_TYPE_FILE,
        name="editable.md",
        content="Version one",
    )
    editable = await service.patch_entry(
        user_id="user-1",
        entry_id=editable.id,
        expected_version=1,
        content="Version two",
        content_set=True,
    )

    with pytest.raises(MemoryEntryValidationError, match="Only memory files"):
        await service.revert_entry(
            user_id="user-1",
            entry_id=directory.id,
            target_version=1,
            expected_version=1,
        )
    with pytest.raises(MemoryEntryValidationError, match="read-only"):
        await service.revert_entry(
            user_id="user-1",
            entry_id=generated.id,
            target_version=1,
            expected_version=generated.version,
        )
    with pytest.raises(MemoryEntryValidationError, match="older"):
        await service.revert_entry(
            user_id="user-1",
            entry_id=editable.id,
            target_version=editable.version,
            expected_version=editable.version,
        )
    with pytest.raises(MemoryEntryNotFoundError):
        await service.revert_entry(
            user_id="user-2",
            entry_id=editable.id,
            target_version=1,
            expected_version=editable.version,
        )
    await service.delete_entry(
        user_id="user-1",
        entry_id=editable.id,
        expected_version=editable.version,
    )
    with pytest.raises(MemoryEntryValidationError, match="Deleted"):
        await service.revert_entry(
            user_id="user-1",
            entry_id=editable.id,
            target_version=1,
            expected_version=editable.version + 1,
        )
