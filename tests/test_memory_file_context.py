from __future__ import annotations

import hashlib
from dataclasses import replace
from typing import Any, cast

import pytest

from animama.adapters.repositories.sqlalchemy.chat_compaction_repo import SQLAlchemyChatCompactionRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.chat.memory_context import (
    ANIMA_MEMORIES_GUIDANCE,
    STATUS_CURRENT,
    STATUS_MISSING,
    STATUS_OPENED,
    STATUS_REFRESHED,
    DirectChatMemoryContextError,
    DirectChatMemoryContextService,
    anima_identity_path,
    render_memory_filesystem_map,
)
from animama.app.chat.openai_prompt import DirectChatPromptAssembler
from animama.app.ports.anima_port import AnimaRepository
from animama.app.ports.memory_entry_port import MemoryEntryRepository
from animama.app.services.chat_manager import ChatManager
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.domain.anima import Anima
from animama.domain.avatar import Avatar
from animama.domain.chat import ChatMessage, MessageRole
from animama.domain.memory_entry import (
    MEMORY_ENTRY_TYPE_DIRECTORY,
    MEMORY_ENTRY_TYPE_FILE,
    MemoryEntry,
    MemoryEntryHeader,
    MemoryEntrySearchResult,
    MemoryEntryVersion,
)
from animama.orm import ORMAnima, ORMChat


class _Uow:
    async def commit(self) -> None:
        return None

    async def rollback(self) -> None:
        return None


class _MemoryEntries:
    def __init__(self, entries: list[MemoryEntry] | None = None) -> None:
        self.entries = {entry.id: entry for entry in entries or []}
        self.create_calls: list[MemoryEntry] = []
        self.update_calls: list[MemoryEntry] = []
        self.version_calls: list[MemoryEntryVersion] = []
        self.list_entries_calls = 0
        self.list_entry_headers_calls = 0

    async def create_entry(self, entry: MemoryEntry) -> MemoryEntry:
        self.create_calls.append(entry)
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
        self.list_entries_calls += 1
        candidates = [
            entry
            for entry in self.entries.values()
            if entry.user_id == user_id and entry.anima_id == anima_id and entry.deleted_at is None
        ]
        if parent_id is None:
            entries = candidates if recursive else [entry for entry in candidates if entry.parent_id is None]
        elif recursive:
            parent = self.entries[parent_id]
            prefix = f"{parent.normalized_path}/"
            entries = [entry for entry in candidates if entry.normalized_path.startswith(prefix)]
        else:
            entries = [entry for entry in candidates if entry.parent_id == parent_id]
        return sorted(entries, key=lambda entry: entry.path)

    async def list_entry_headers(
        self,
        *,
        user_id: str,
        anima_id: str | None,
        parent_id: str | None,
        recursive: bool,
    ) -> list[MemoryEntryHeader]:
        self.list_entry_headers_calls += 1
        entries = await self.list_entries(
            user_id=user_id,
            anima_id=anima_id,
            parent_id=parent_id,
            recursive=recursive,
        )
        return [
            MemoryEntryHeader(
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
            for entry in entries
        ]

    async def list_live_children(self, *, user_id: str, parent_id: str) -> list[MemoryEntry]:
        return [
            entry
            for entry in self.entries.values()
            if entry.user_id == user_id and entry.parent_id == parent_id and entry.deleted_at is None
        ]

    async def list_live_descendants(self, *, user_id: str, entry: MemoryEntry) -> list[MemoryEntry]:
        prefix = f"{entry.normalized_path}/"
        return [
            candidate
            for candidate in self.entries.values()
            if candidate.user_id == user_id
            and candidate.anima_id == entry.anima_id
            and candidate.normalized_path.startswith(prefix)
            and candidate.deleted_at is None
        ]

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
        return []

    async def update_entry(self, entry: MemoryEntry) -> MemoryEntry:
        self.update_calls.append(entry)
        self.entries[entry.id] = entry
        return entry

    async def update_entries(self, entries: list[MemoryEntry]) -> list[MemoryEntry]:
        for entry in entries:
            await self.update_entry(entry)
        return entries

    async def append_version(self, version: MemoryEntryVersion) -> MemoryEntryVersion:
        self.version_calls.append(version)
        return replace(version, id=len(self.version_calls))


class _Animas:
    def __init__(self, identity: str = "Avatar fallback identity", name: str = "Avatar") -> None:
        self.identity = identity
        self.name = name
        self.ownership_checks: list[tuple[str, str]] = []

    async def get(self, anima_id: str) -> Anima:
        return Anima(
            id=anima_id,
            display_name=self.name,
            avatar=Avatar(
                id="avatar-1",
                name=self.name,
                file_path="/avatar.vrm",
                identity=self.identity,
            ),
        )

    async def is_owned_by_user(self, *, user_id: str, anima_id: str) -> bool:
        self.ownership_checks.append((user_id, anima_id))
        return True


def _sha(content: str) -> str:
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _memory_entry(
    path: str,
    content: str,
    *,
    anima_id: str | None = None,
    version: int = 1,
    kind: str | None = None,
    description: str | None = None,
    user_id: str = "user-1",
) -> MemoryEntry:
    return MemoryEntry(
        id=f"entry-{anima_id or 'user'}-{path}",
        user_id=user_id,
        anima_id=anima_id,
        parent_id=None,
        type=MEMORY_ENTRY_TYPE_FILE,
        name=path.rsplit("/", 1)[-1],
        normalized_name=path.rsplit("/", 1)[-1].casefold(),
        path=path,
        normalized_path=path.casefold(),
        content=content,
        content_sha256=_sha(content),
        version=version,
        size_bytes=len(content.encode("utf-8")),
        kind=kind,
        description=description,
        metadata={},
    )


def _service(
    entries: list[MemoryEntry] | None = None,
    *,
    avatar_identity: str = "Avatar fallback identity",
    avatar_name: str = "Avatar",
) -> tuple[DirectChatMemoryContextService, _MemoryEntries]:
    repo = _MemoryEntries(entries)
    animas = _Animas(identity=avatar_identity, name=avatar_name)
    return (
        DirectChatMemoryContextService(
            # These fixture repositories implement only the reads exercised here.
            memory_entries=MemoryEntryService(
                memory_entries=cast(MemoryEntryRepository, repo), uow=_Uow(), animas=cast(AnimaRepository, animas)
            ),
            animas=cast(AnimaRepository, animas),
        ),
        repo,
    )


@pytest.mark.asyncio
async def test_identity_file_content_enters_memory_context_from_anima_scope() -> None:
    identity_path = anima_identity_path("anima-1")
    service, _repo = _service(
        [_memory_entry(identity_path, "Identity from memory entry", anima_id="anima-1", kind="anima_identity")]
    )

    context = await service.build_context(user_id="user-1", anima_id="anima-1")

    assert identity_path == "IDENTITY.md"
    assert context.anima_identity == "Identity from memory entry"
    assert context.anima_name == "Avatar"
    assert context.manifest["opened_files"][0] == {
        "anima_id": "anima-1",
        "path": "IDENTITY.md",
        "status": STATUS_OPENED,
        "version": 1,
        "sha256": _sha("Identity from memory entry"),
        "kind": "anima_identity",
    }


@pytest.mark.asyncio
async def test_missing_identity_file_requires_repair_without_avatar_fallback_or_writes() -> None:
    service, repo = _service([], avatar_identity="Avatar fallback for this turn")

    with pytest.raises(DirectChatMemoryContextError, match="owner must repair"):
        await service.build_context(user_id="user-1", anima_id="anima-1")
    assert repo.create_calls == []
    assert repo.update_calls == []
    assert repo.version_calls == []


@pytest.mark.asyncio
async def test_blank_missing_identity_fails_setup() -> None:
    service, _repo = _service([], avatar_identity=" ")

    with pytest.raises(DirectChatMemoryContextError, match="identity file .* missing"):
        await service.build_context(user_id="user-1", anima_id="anima-1")


@pytest.mark.asyncio
async def test_memory_instruction_sections_assemble_into_single_system_message() -> None:
    service, _repo = _service([_memory_entry("identity.md", "Identity", anima_id="anima-1", kind="anima_identity")])

    memory_context = await service.build_context(user_id="user-1", anima_id="anima-1")
    prompt = DirectChatPromptAssembler().assemble(
        user_message="hello",
        anima_identity=memory_context.anima_identity,
        anima_name=memory_context.anima_name,
    )

    system_messages = [message for message in prompt.messages if message["role"] == "system"]
    assert len(system_messages) == 1
    system_content = system_messages[0]["content"]
    assert isinstance(system_content, str)
    assert "# Core Instructions" in system_content
    assert "You are an Anima hosted by Animama AI:" in system_content
    assert "# Anima Identity\n\nYour name is Avatar.\n\nIdentity" in system_content
    assert "# Memory Guidance" in system_content
    assert "# Response Guidance" in system_content


@pytest.mark.asyncio
async def test_native_patch_prompt_explains_description_aware_synthetic_documents() -> None:
    service, _repo = _service([_memory_entry("identity.md", "Identity", anima_id="anima-1", kind="anima_identity")])
    memory_context = await service.build_context(user_id="user-1", anima_id="anima-1")

    native_prompt = DirectChatPromptAssembler().assemble(
        user_message="remember this",
        anima_identity=memory_context.anima_identity,
        anima_name=memory_context.anima_name,
        native_memory_patch_enabled=True,
    )
    legacy_prompt = DirectChatPromptAssembler().assemble(
        user_message="remember this",
        anima_identity=memory_context.anima_identity,
        anima_name=memory_context.anima_name,
    )

    native_instruction = str(native_prompt.messages[0]["content"])
    legacy_instruction = str(legacy_prompt.messages[0]["content"])
    assert "Native Apply Patch edits a patch document" in native_instruction
    assert "update it when the file's scope or durable contents change materially" in native_instruction
    assert 'description: "Concise overview of the file."' in native_instruction
    assert "never copy it into the Markdown body" in native_instruction
    assert "Native Apply Patch" not in legacy_instruction


@pytest.mark.asyncio
async def test_prompt_messages_do_not_include_fingerprint_values() -> None:
    service, _repo = _service([_memory_entry("identity.md", "Identity", anima_id="anima-1", kind="anima_identity")])

    context = await service.build_context(user_id="user-1", anima_id="anima-1")

    prompt = DirectChatPromptAssembler().assemble(
        user_message="hello",
        anima_identity=context.anima_identity,
        anima_name=context.anima_name,
        memory_map=context.memory_map,
        metadata={"memory_context": context.manifest},
    )
    instruction_text = "\n\n".join(str(message.get("content", "")) for message in prompt.messages)
    assert "sha256" not in instruction_text.lower()
    assert "sha-256" not in instruction_text.lower()
    assert "version" not in instruction_text.lower()


@pytest.mark.asyncio
async def test_optional_profile_is_not_injected_into_context_yet() -> None:
    service, _repo = _service(
        [
            _memory_entry("identity.md", "Identity", anima_id="anima-1", kind="anima_identity"),
            _memory_entry("profile.md", "User likes concise replies.", kind="user_profile"),
        ]
    )

    context = await service.build_context(user_id="user-1", anima_id="anima-1")

    prompt = DirectChatPromptAssembler().assemble(
        user_message="hello",
        anima_identity=context.anima_identity,
        anima_name=context.anima_name,
        memory_map=context.memory_map,
        metadata={"memory_context": context.manifest},
    )
    instruction_text = "\n\n".join(str(message.get("content", "")) for message in prompt.messages)
    assert "User likes concise replies." not in instruction_text
    assert [opened["path"] for opened in context.manifest["opened_files"]] == ["identity.md", "MEMORIES.md"]


@pytest.mark.asyncio
async def test_disable_memory_influence_keeps_identity_only() -> None:
    service, _repo = _service(
        [
            _memory_entry("identity.md", "Identity", anima_id="anima-1", kind="anima_identity"),
            _memory_entry("profile.md", "Profile should be omitted.", kind="user_profile"),
        ]
    )

    context = await service.build_context(
        user_id="user-1",
        anima_id="anima-1",
        request_options={"disable_memory_influence": True},
    )

    assert [opened["path"] for opened in context.manifest["opened_files"]] == ["identity.md"]
    assert context.anima_identity == "Identity"
    assert context.memory_map is None
    assert context.anima_memories is None


@pytest.mark.asyncio
async def test_memory_file_list_omits_anima_entries_and_uses_cached_user_paths() -> None:
    service, repo = _service(
        [
            _memory_entry(
                "profile.md",
                "User likes concise replies.",
                kind="user_profile",
                description="Initial profile of Ray",
            ),
            _memory_entry(
                "identity.md",
                "Identity",
                anima_id="anima-1",
                kind="anima_identity",
                description="Astra's identity",
            ),
        ]
    )

    context = await service.build_context(user_id="user-1", anima_id="anima-1")

    assert context.memory_map == "\n".join(
        [
            "# List of memory files",
            "",
            "files:",
            "  - path: profile.md",
            "    description: Initial profile of Ray",
        ]
    )
    assert "tree:" not in context.memory_map
    assert "animas/" not in context.memory_map
    assert "[user-1]" not in context.memory_map
    assert repo.list_entry_headers_calls == 1


@pytest.mark.asyncio
async def test_memory_filesystem_map_omits_prompt_only_status_flags() -> None:
    service, _repo = _service(
        [
            _memory_entry("identity.md", "Identity v2", anima_id="anima-1", version=2, kind="anima_identity"),
            _memory_entry("profile.md", "Profile v2", version=2, kind="user_profile"),
        ]
    )
    prior = {
        "memory_context": {
            "opened_files": [
                {
                    "anima_id": "anima-1",
                    "path": "identity.md",
                    "version": 1,
                    "sha256": _sha("Identity v1"),
                    "kind": "anima_identity",
                },
                {
                    "anima_id": None,
                    "path": "profile.md",
                    "version": 1,
                    "sha256": _sha("Profile v1"),
                    "kind": "user_profile",
                },
            ]
        }
    }

    context = await service.build_context(user_id="user-1", anima_id="anima-1", chat_metadata=prior)

    assert context.memory_map is not None
    assert "identity.md" not in context.memory_map
    assert '  - path: profile.md\n    description: ""' in context.memory_map
    assert "opened:" not in context.memory_map
    assert "stale:" not in context.memory_map


def test_empty_memory_file_list_is_still_deterministic() -> None:
    rendered = render_memory_filesystem_map([])

    assert rendered == "\n".join(
        [
            "# List of memory files",
            "",
            "files: []",
        ]
    )


def test_memory_file_list_uses_canonical_user_navigation_projection() -> None:
    rendered = render_memory_filesystem_map(
        [
            _memory_entry("zeta.md", "Zeta", description="Last file"),
            _memory_entry("profile.md", "Profile", kind="user_profile", description="User profile"),
            _memory_entry(
                "episodes/2026/07/2026-07-07.md",
                "# Episodes",
                description="Generated episodic memory log for 2026-07-07.",
            ),
            _memory_entry(
                "identity.md",
                "Identity",
                anima_id="anima-1",
                kind="anima_identity",
            ),
            replace(
                _memory_entry("notes.md", ""),
                type=MEMORY_ENTRY_TYPE_DIRECTORY,
                name="notes",
                normalized_name="notes",
                path="notes",
                normalized_path="notes",
            ),
        ]
    )

    assert rendered == "\n".join(
        [
            "# List of memory files",
            "",
            "files:",
            "  - path: profile.md",
            "    description: User profile",
            "  - path: zeta.md",
            "    description: Last file",
        ]
    )
    assert "episodes/2026/07/2026-07-07.md" not in rendered
    assert "identity.md" not in rendered
    assert "notes" not in rendered


@pytest.mark.asyncio
async def test_stale_versions_are_marked_refreshed_on_next_turn() -> None:
    service, _repo = _service(
        [_memory_entry("identity.md", "Identity v2", anima_id="anima-1", version=2, kind="anima_identity")]
    )
    prior = {
        "memory_context": {
            "opened_files": [
                {
                    "anima_id": "anima-1",
                    "path": "identity.md",
                    "version": 1,
                    "sha256": _sha("Identity v1"),
                    "kind": "anima_identity",
                },
            ]
        }
    }

    context = await service.build_context(user_id="user-1", anima_id="anima-1", chat_metadata=prior)

    statuses = {opened["path"]: opened["status"] for opened in context.manifest["opened_files"]}
    assert statuses["identity.md"] == STATUS_REFRESHED


@pytest.mark.asyncio
async def test_current_versions_are_marked_current_on_next_turn() -> None:
    service, _repo = _service([_memory_entry("identity.md", "Identity", anima_id="anima-1", kind="anima_identity")])
    prior = {
        "memory_context": {
            "opened_files": [
                {
                    "anima_id": "anima-1",
                    "path": "identity.md",
                    "version": 1,
                    "sha256": _sha("Identity"),
                    "kind": "anima_identity",
                }
            ]
        }
    }

    context = await service.build_context(user_id="user-1", anima_id="anima-1", chat_metadata=prior)

    assert context.manifest["opened_files"][0]["status"] == STATUS_CURRENT


@pytest.mark.asyncio
async def test_chat_metadata_manifest_records_latest_fingerprints(async_session) -> None:
    async_session.add(ORMAnima(id="anima-memory-context-meta", user_id="user-1"))
    await async_session.commit()
    manager = ChatManager(
        chats=SQLAlchemyChatRepository(async_session),
        messages=SQLAlchemyChatMessageRepository(async_session),
        compactions=SQLAlchemyChatCompactionRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
    )
    await manager.ensure_owned_chat(
        anima_id="anima-memory-context-meta",
        chat_id="chat-memory-context-meta",
        user_id="user-1",
    )
    manifest: dict[str, Any] = {
        "memory_context": {
            "version": 1,
            "opened_files": [
                {
                    "anima_id": "anima-memory-context-meta",
                    "path": "identity.md",
                    "status": STATUS_OPENED,
                    "version": 3,
                    "sha256": "sha-3",
                    "kind": "anima_identity",
                }
            ],
            "last_run": {"run_id": "run-1"},
        }
    }

    await manager.record_turn(
        anima_id="anima-memory-context-meta",
        chat_id="chat-memory-context-meta",
        user_msg=ChatMessage(
            id=None,
            chat_id="chat-memory-context-meta",
            run_id="run-1",
            message_type="message",
            role=MessageRole.USER,
            content="hello",
            data=None,
            usage=None,
            turn=None,
            created_at=None,
        ),
        assistant_msg=ChatMessage(
            id=None,
            chat_id="chat-memory-context-meta",
            run_id="run-1",
            message_type="message",
            role=MessageRole.ASSISTANT,
            content="hi",
            data=None,
            usage=None,
            turn=None,
            created_at=None,
        ),
        chat_metadata_patch=manifest,
    )

    stored = await async_session.get(ORMChat, "chat-memory-context-meta")
    assert stored is not None
    assert stored.metadata_["memory_context"]["opened_files"][0]["anima_id"] == "anima-memory-context-meta"
    assert stored.metadata_["memory_context"]["opened_files"][0]["path"] == "identity.md"


@pytest.mark.asyncio
async def test_identity_capitalization_preserves_prior_context_fingerprint() -> None:
    identity = _memory_entry("IDENTITY.md", "Same identity", anima_id="anima-1", kind="anima_identity")
    service, _repo = _service([identity])
    context = await service.build_context(
        user_id="user-1",
        anima_id="anima-1",
        chat_metadata={
            "memory_context": {
                "opened_files": [
                    {
                        "anima_id": "anima-1",
                        "path": "identity.md",
                        "version": identity.version,
                        "sha256": identity.content_sha256,
                        "kind": "anima_identity",
                    }
                ]
            }
        },
    )
    assert context.manifest["opened_files"][0]["path"] == "IDENTITY.md"
    assert context.manifest["opened_files"][0]["status"] == STATUS_CURRENT


@pytest.mark.asyncio
async def test_anima_memories_follow_identity_when_memory_influence_is_on() -> None:
    memories = "# Memories\n\n## Our story\nWe met on a rainy Tuesday."
    service, _repo = _service(
        [
            _memory_entry("IDENTITY.md", "Identity", anima_id="anima-1", kind="anima_identity"),
            _memory_entry("MEMORIES.md", memories, anima_id="anima-1", kind="anima_memories"),
            _memory_entry("MEMORIES.md", "Another Anima's history", anima_id="anima-2", kind="anima_memories"),
        ]
    )

    context = await service.build_context(user_id="user-1", anima_id="anima-1")
    prompt = DirectChatPromptAssembler().assemble(
        user_message="hello",
        anima_identity=context.anima_identity,
        anima_memories=context.anima_memories,
    )

    assert context.anima_memories == memories
    assert context.anima_memories_version == 1
    assert context.manifest["opened_files"][1] == {
        "anima_id": "anima-1",
        "path": "MEMORIES.md",
        "status": STATUS_OPENED,
        "version": 1,
        "sha256": _sha(memories),
        "kind": "anima_memories",
    }
    system = str(prompt.messages[0]["content"])
    assert f"# Anima Identity\n\nIdentity\n\n# Anima Memories\n\n{ANIMA_MEMORIES_GUIDANCE}\n\n{memories}" in system
    assert system.index(memories) < system.index("# Memory Guidance")
    assert "Another Anima's history" not in system


@pytest.mark.asyncio
async def test_anima_memories_are_omitted_when_memory_influence_is_off() -> None:
    service, _repo = _service(
        [
            _memory_entry("IDENTITY.md", "Identity", anima_id="anima-1", kind="anima_identity"),
            _memory_entry("MEMORIES.md", "We met today.", anima_id="anima-1", kind="anima_memories"),
        ]
    )

    context = await service.build_context(
        user_id="user-1", anima_id="anima-1", request_options={"disable_memory_influence": True}
    )
    prompt = DirectChatPromptAssembler().assemble(
        user_message="hello",
        anima_identity=context.anima_identity,
        anima_memories=context.anima_memories,
    )

    assert context.anima_memories is None
    assert context.anima_memories_version is None
    assert [opened["path"] for opened in context.manifest["opened_files"]] == ["IDENTITY.md"]
    assert "# Anima Memories" not in str(prompt.messages[0]["content"])


@pytest.mark.asyncio
@pytest.mark.parametrize("memories", [None, "", " \n\t"])
async def test_missing_or_blank_anima_memories_are_omitted_without_failing_the_turn(memories: str | None) -> None:
    entries = [_memory_entry("IDENTITY.md", "Identity", anima_id="anima-1", kind="anima_identity")]
    if memories is not None:
        entries.append(_memory_entry("MEMORIES.md", memories, anima_id="anima-1", kind="anima_memories"))
    service, repo = _service(entries)

    context = await service.build_context(user_id="user-1", anima_id="anima-1")
    prompt = DirectChatPromptAssembler().assemble(
        user_message="hello",
        anima_identity=context.anima_identity,
        anima_memories=context.anima_memories,
    )

    assert context.anima_memories is None
    # A blank file is still editable, so its version is kept; a missing one has none.
    assert context.anima_memories_version == (None if memories is None else 1)
    assert "# Anima Memories" not in str(prompt.messages[0]["content"])
    opened = context.manifest["opened_files"][1]
    if memories is None:
        assert opened == {
            "anima_id": "anima-1",
            "path": "MEMORIES.md",
            "status": STATUS_MISSING,
            "version": None,
            "sha256": None,
            "kind": "anima_memories",
        }
    else:
        assert (opened["status"], opened["sha256"]) == (STATUS_OPENED, _sha(memories))
    # Reading context never repairs the file.
    assert repo.create_calls == [] and repo.version_calls == []
