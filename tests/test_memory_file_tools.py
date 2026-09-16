from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from typing import Any, cast

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from animama.adapters.memory_patch import AgentsSDKV4AMemoryPatchPlanner
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_file_processing_repo import SQLAlchemyUserFileProcessingRepository
from animama.app.chat import memory_tools as memory_tools_module
from animama.app.chat.memory_tools import (
    MEMORY_TOOL_APPLY_PATCH,
    MEMORY_TOOL_LIST_FILES,
    MEMORY_TOOL_READ_FILES,
    MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
    MEMORY_TOOL_SEARCH_MEMORY_FILES,
    MEMORY_TOOL_SEARCH_UPLOADED_FILES,
    MEMORY_TOOL_WRITE_FILE,
    DirectChatMemoryToolService,
    MemoryToolExecutionContext,
    memory_tool_specs,
)
from animama.app.ports.anima_port import AnimaRepository
from animama.app.services.memory_entry_service import (
    MemoryEntryConflictError,
    MemoryEntryNotFoundError,
    MemoryEntryService,
)
from animama.domain.memory_episode import MEMORY_EPISODE_LOG_ENTRY_KIND
from animama.domain.user_file import STATUS_READY, STATUS_UPLOADED
from animama.orm import ORMMemoryEntry, ORMMemoryEntryVersion
from animama.orm.user_file import ORMUserFile
from animama.orm.user_file_chunk import ORMUserFileChunk


@pytest_asyncio.fixture(autouse=True)
async def clean_memory_file_rows(async_session):
    await async_session.execute(delete(ORMUserFileChunk))
    await async_session.execute(delete(ORMUserFile))
    await async_session.execute(delete(ORMMemoryEntryVersion))
    await async_session.execute(delete(ORMMemoryEntry))
    await async_session.commit()
    yield
    await async_session.execute(delete(ORMUserFileChunk))
    await async_session.execute(delete(ORMUserFile))
    await async_session.execute(delete(ORMMemoryEntryVersion))
    await async_session.execute(delete(ORMMemoryEntry))
    await async_session.commit()


def _context() -> MemoryToolExecutionContext:
    return MemoryToolExecutionContext(
        user_id="user-1",
        anima_id="anima-1",
        chat_id="chat-1",
        run_id="run-1",
        provider_type="OpenAIHTTPAgent",
        model_provider_id="OpenAIHTTPAgent:gpt-test",
        model="gpt-test",
    )


def _native_context() -> MemoryToolExecutionContext:
    return MemoryToolExecutionContext(
        user_id="user-1",
        anima_id="anima-1",
        chat_id="chat-1",
        run_id="run-1",
        provider_type="OpenAIResponsesHTTPAgent",
        model_provider_id="OpenAIResponsesHTTPAgent:gpt-5.4-nano",
        model="gpt-5.4-nano",
        native_memory_patch_enabled=True,
    )


class _AllowAnimaRepository:
    def __init__(self):
        from animama.domain.anima import Anima

        self.anima = Anima(id="anima-1", display_name="Fixture Anima", aggregate_revision=1)

    async def is_owned_by_user(self, *, user_id: str, anima_id: str) -> bool:
        return True

    async def get(self, anima_id: str):
        return self.anima

    async def lock_definition(self, *, user_id: str, anima_id: str, expected_revision: int | None = None):
        assert expected_revision is None or expected_revision == self.anima.aggregate_revision
        return self.anima

    async def record_definition_revision(self, *, user_id: str, anima_id: str, expected_revision: int, reason: str):
        await self.lock_definition(user_id=user_id, anima_id=anima_id, expected_revision=expected_revision)
        self.anima.aggregate_revision += 1
        return self.anima


def _memory_service(async_session, *, animas: _AllowAnimaRepository | None = None) -> MemoryEntryService:  # noqa: ANN001
    return MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
        # This fixture implements only the Anima reads exercised by this service.
        animas=cast(AnimaRepository | None, animas),
    )


class _FakeEmbedder:
    async def embed_texts(self, texts: list[str]) -> list[list[float]]:
        return [[1.0, 0.0, 0.0] for _ in texts]


def _tool_service(
    async_session,  # noqa: ANN001
    *,
    include_user_files: bool = False,
    include_embedder: bool = False,
    allowed_uploaded_files: dict[str, str] | None = None,
) -> DirectChatMemoryToolService:
    return DirectChatMemoryToolService(
        memory_entries=_memory_service(async_session),
        user_file_processing=SQLAlchemyUserFileProcessingRepository(async_session) if include_user_files else None,
        user_file_embedder_factory=(lambda: _FakeEmbedder()) if include_embedder else None,
        allowed_uploaded_files=allowed_uploaded_files,
    )


def _native_tool_service(async_session) -> DirectChatMemoryToolService:  # noqa: ANN001
    memory_entries = _memory_service(async_session)
    return DirectChatMemoryToolService(
        memory_entries=memory_entries,
        patch_planner=AgentsSDKV4AMemoryPatchPlanner(memory_entries=memory_entries),
    )


async def _put_user_file(
    async_session,  # noqa: ANN001
    relative_path: str,
    content: str,
    *,
    kind: str | None = None,
    description: str | None = None,
    user_id: str = "user-1",
    allow_system_managed: bool = False,
) -> None:
    await _memory_service(async_session).put_file_by_path(
        user_id=user_id,
        anima_id=None,
        path=relative_path,
        content=content,
        kind=kind,
        description=description,
        expected_version=0,
        create_parents=True,
        allow_system_managed=allow_system_managed,
    )


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _insert_uploaded_file_chunk(
    async_session,  # noqa: ANN001
    *,
    file_id: str,
    text: str | list[str],
    user_id: str = "user-1",
    status: str = STATUS_READY,
    extension: str = ".txt",
    original_filename: str | None = None,
) -> None:
    chunk_texts = [text] if isinstance(text, str) else text
    async_session.add(
        ORMUserFile(
            id=file_id,
            user_id=user_id,
            storage_locator=f"users/{user_id}/files/{file_id}/secret-object-key{extension}",
            original_filename=original_filename or f"{file_id}{extension}",
            normalized_extension=extension,
            declared_content_type="text/plain",
            declared_size_bytes=64,
            stored_size_bytes=64,
            status=status,
            upload_expires_at=_now() + timedelta(minutes=10),
            metadata_={"storage_debug": "must-not-leak"},
        )
    )
    for chunk_index, chunk_text in enumerate(chunk_texts):
        async_session.add(
            ORMUserFileChunk(
                id=f"chunk-{file_id}-{chunk_index:06d}",
                file_id=file_id,
                user_id=user_id,
                chunk_index=chunk_index,
                text=chunk_text,
                embedding=[1.0, 0.0, 0.0],
                char_count=len(chunk_text),
                token_estimate=max(1, len(chunk_text) // 4),
                metadata_={"chunk_debug": "must-not-leak"},
            )
        )
    await async_session.commit()


def _loads(output: str) -> dict[str, Any]:
    payload = json.loads(output)
    assert isinstance(payload, dict)
    return payload


class _ConflictOnWriteMemoryService:
    async def get_entry_by_path(self, **_: Any) -> Any:
        raise MemoryEntryNotFoundError("Memory entry not found")

    async def put_file_by_path(self, **_: Any) -> Any:
        raise MemoryEntryConflictError("Memory entry already exists")


def test_memory_tool_schemas_are_strict_and_do_not_expose_expected_version() -> None:
    tools = memory_tool_specs(allow_reads=True, allow_writes=True)

    assert [tool["function"]["name"] for tool in tools] == [
        MEMORY_TOOL_LIST_FILES,
        MEMORY_TOOL_READ_FILES,
        MEMORY_TOOL_SEARCH_MEMORY_FILES,
        MEMORY_TOOL_APPLY_PATCH,
        MEMORY_TOOL_WRITE_FILE,
    ]
    tools_with_uploads = memory_tool_specs(
        allow_reads=True,
        allow_writes=True,
        allow_uploaded_file_tools=True,
    )
    assert [tool["function"]["name"] for tool in tools_with_uploads] == [
        MEMORY_TOOL_LIST_FILES,
        MEMORY_TOOL_READ_FILES,
        MEMORY_TOOL_SEARCH_MEMORY_FILES,
        MEMORY_TOOL_SEARCH_UPLOADED_FILES,
        MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
        MEMORY_TOOL_APPLY_PATCH,
        MEMORY_TOOL_WRITE_FILE,
    ]
    serialized = json.dumps(tools)
    assert "expected_version" not in serialized
    read_tool = next(tool for tool in tools if tool["function"]["name"] == MEMORY_TOOL_READ_FILES)
    assert read_tool["function"]["parameters"]["properties"]["paths"] == {
        "description": "One user-root-relative markdown path, or a list of up to 10 paths.",
        "anyOf": [
            {"type": "string"},
            {
                "type": "array",
                "items": {"type": "string"},
                "minItems": 1,
                "maxItems": 10,
            },
        ],
    }
    assert read_tool["function"]["parameters"]["required"] == ["paths"]
    search_tool = next(tool for tool in tools if tool["function"]["name"] == MEMORY_TOOL_SEARCH_MEMORY_FILES)
    assert search_tool["function"]["parameters"]["properties"] == {
        "query": {
            "type": "string",
            "description": "Search text using PostgreSQL web-search syntax when useful.",
        },
        "include_episodic_memory": {
            "type": "boolean",
            "description": "Whether generated episode logs are included. Defaults to true for callers.",
        },
    }
    assert search_tool["function"]["parameters"]["required"] == ["query", "include_episodic_memory"]
    upload_tool = next(
        tool for tool in tools_with_uploads if tool["function"]["name"] == MEMORY_TOOL_SEARCH_UPLOADED_FILES
    )
    assert upload_tool["function"]["parameters"]["properties"] == {
        "query": {
            "type": "string",
            "description": (
                "Search text used for both retrieval modes. PostgreSQL web-search syntax applies to keyword retrieval."
            ),
        },
        "file_names": {
            "description": (
                "One attached filename, a list of attached filenames, or null to search every attachment. "
                "If any supplied name is invalid, every attachment is searched."
            ),
            "anyOf": [
                {"type": "string"},
                {
                    "type": "array",
                    "items": {"type": "string"},
                    "minItems": 1,
                    "maxItems": 50,
                },
                {"type": "null"},
            ],
        },
    }
    assert "quoted phrases, OR, and -term exclusions" in search_tool["function"]["description"]
    assert "quoted phrases, OR, and -term exclusions" in upload_tool["function"]["description"]
    upload_description = upload_tool["function"]["description"]
    assert "accessible through uploaded-file tools" in upload_description
    assert "relevance lookup, exact phrases, or locating a chunk" in upload_description
    assert "Do not substitute durable personal memory" in upload_description
    assert "ground document claims in the returned snippets" in upload_description
    assert upload_tool["function"]["parameters"]["required"] == ["query", "file_names"]
    read_upload_tool = next(
        tool for tool in tools_with_uploads if tool["function"]["name"] == MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS
    )
    assert read_upload_tool["function"]["parameters"] == {
        "type": "object",
        "properties": {
            "file_name": {
                "type": "string",
                "description": "One exact filename from the attached-file list.",
            },
            "start_chunk": {
                "type": "integer",
                "minimum": 0,
                "description": "Zero-based chunk index at which to begin reading.",
            },
            "chunk_count": {
                "type": "integer",
                "minimum": 1,
                "maximum": 5,
                "description": "Maximum number of consecutive chunks to return.",
            },
        },
        "required": ["file_name", "start_chunk", "chunk_count"],
        "additionalProperties": False,
    }
    read_upload_description = read_upload_tool["function"]["description"]
    assert "whole-document synthesis" in read_upload_description
    assert "continue from next_start_chunk while has_more is true" in read_upload_description
    assert "unknown filename never reads other attachments" in read_upload_description
    assert "path_prefix" not in serialized
    assert "limit" not in serialized
    assert "context_chars" not in serialized
    assert "semantic_search_uploads" not in json.dumps(tools_with_uploads)
    for tool in tools_with_uploads:
        function = tool["function"]
        assert function["strict"] is True
        assert function["parameters"]["additionalProperties"] is False


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "path",
    [
        "/profile.md",
        "../profile.md",
        "[user-1]/profile.md",
        "animas/anima-1/identity.md",
        "profile.txt",
    ],
)
async def test_memory_tools_reject_paths_outside_user_root(async_session, path: str) -> None:
    result = _loads(
        await _tool_service(async_session).execute(
            tool_name=MEMORY_TOOL_READ_FILES,
            arguments={"paths": path},
            context=_context(),
            tool_call_id="call-1",
        )
    )

    assert result["ok"] is True
    assert result["files"] == []
    assert result["errors"][0]["path"] == path
    assert result["errors"][0]["code"] == "invalid_path"
    assert result["errors"][0]["retryable"] is False


@pytest.mark.asyncio
async def test_memory_tools_read_and_fts_search_user_root_files(async_session) -> None:
    await _put_user_file(async_session, "profile.md", "Ray likes obsidian notebooks.", description="User profile")
    await _put_user_file(async_session, "notes/projects.md", "Release notes mention avatar memory tools.")
    await _memory_service(async_session, animas=_AllowAnimaRepository()).put_file_by_path(
        user_id="user-1",
        anima_id="anima-1",
        path="identity.md",
        expected_aggregate_revision=1,
        content="Identity should not be listed.",
        expected_version=0,
    )
    tools = _tool_service(async_session)

    listed = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_LIST_FILES,
            arguments={},
            context=_context(),
            tool_call_id="call-list",
        )
    )
    assert listed == {
        "ok": True,
        "files": [
            {"path": "notes/projects.md", "description": None},
            {"path": "profile.md", "description": "User profile"},
        ],
    }

    read = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_READ_FILES,
            arguments={"paths": ["notes/projects.md", "profile.md", "notes/projects.md", "missing.md"]},
            context=_context(),
            tool_call_id="call-read",
        )
    )
    assert read["ok"] is True
    assert [item["path"] for item in read["files"]] == ["notes/projects.md", "profile.md"]
    assert read["files"][1]["description"] == "User profile"
    assert read["files"][1]["content"] == "Ray likes obsidian notebooks."
    assert read["errors"] == [
        {
            "path": "missing.md",
            "code": "not_found",
            "message": "Memory file not found",
            "retryable": True,
        }
    ]
    assert "version" not in read
    assert "content_sha256" not in read

    search = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_SEARCH_MEMORY_FILES,
            arguments={"query": "obsidian"},
            context=_context(),
            tool_call_id="call-search",
        )
    )
    assert search["ok"] is True
    assert [result["path"] for result in search["memory_results"]] == ["profile.md"]
    assert search["memory_results"][0]["description"] == "User profile"
    assert "obsidian" in search["memory_results"][0]["snippet"].lower()
    assert "uploaded_file_results" not in search
    assert "score" not in search["memory_results"][0]


@pytest.mark.asyncio
async def test_memory_tools_omit_episode_logs_from_list_but_allow_read_and_search(async_session) -> None:
    await _put_user_file(async_session, "profile.md", "Ray likes obsidian notebooks.", description="User profile")
    await _put_user_file(
        async_session,
        "episodes/2026/07/2026-07-07.md",
        "# Episodes\n\n- [ ] The user is planning Project Amaryllis.",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        description="Generated episodic memory log for 2026-07-07.",
        allow_system_managed=True,
    )
    tools = _tool_service(async_session)

    listed = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_LIST_FILES,
            arguments={},
            context=_context(),
            tool_call_id="call-list",
        )
    )
    read = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_READ_FILES,
            arguments={"paths": "episodes/2026/07/2026-07-07.md"},
            context=_context(),
            tool_call_id="call-read",
        )
    )
    search = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_SEARCH_MEMORY_FILES,
            arguments={"query": "Amaryllis"},
            context=_context(),
            tool_call_id="call-search",
        )
    )

    assert listed == {"ok": True, "files": [{"path": "profile.md", "description": "User profile"}]}
    assert read["ok"] is True
    assert read["files"][0]["path"] == "episodes/2026/07/2026-07-07.md"
    assert "Project Amaryllis" in read["files"][0]["content"]
    assert read["errors"] == []
    assert [result["path"] for result in search["memory_results"]] == ["episodes/2026/07/2026-07-07.md"]


@pytest.mark.asyncio
async def test_memory_search_can_exclude_episodes_before_result_limit(async_session) -> None:
    keyword = "Amaryllis"
    await _put_user_file(async_session, "profile.md", f"Curated {keyword} preference.")
    await _put_user_file(
        async_session,
        "archive/generated.md",
        f"Kind-only {keyword} episode.",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        allow_system_managed=True,
    )
    for index in range(11):
        await _put_user_file(
            async_session,
            f"episodes/2026/07/episode-{index:02d}.md",
            f"Namespace-only {keyword} episode {index}.",
            allow_system_managed=True,
        )
    await _put_user_file(
        async_session,
        "other.md",
        f"Another user's {keyword} fact.",
        user_id="user-2",
    )
    tools = _tool_service(async_session)

    default_search = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_SEARCH_MEMORY_FILES,
            arguments={"query": keyword},
            context=_context(),
            tool_call_id="call-search-default",
        )
    )
    curated_only = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_SEARCH_MEMORY_FILES,
            arguments={"query": keyword, "include_episodic_memory": False},
            context=_context(),
            tool_call_id="call-search-curated",
        )
    )

    assert default_search["ok"] is True
    assert any(result["path"].startswith("episodes/") for result in default_search["memory_results"])
    assert curated_only == {
        "ok": True,
        "memory_results": [
            {
                "path": "profile.md",
                "description": None,
                "snippet": "profile.md Curated Amaryllis preference.",
            }
        ],
    }


@pytest.mark.asyncio
async def test_memory_read_files_enforces_path_and_content_budgets_with_partial_success(async_session) -> None:
    content = "x" * (32 * 1024)
    for index in range(5):
        await _put_user_file(async_session, f"notes/{index}.md", content)
    tools = _tool_service(async_session)

    content_limited = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_READ_FILES,
            arguments={"paths": [f"notes/{index}.md" for index in range(5)]},
            context=_context(),
            tool_call_id="call-content-limit",
        )
    )
    path_limited = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_READ_FILES,
            arguments={"paths": [f"missing-{index}.md" for index in range(11)]},
            context=_context(),
            tool_call_id="call-path-limit",
        )
    )

    assert [item["path"] for item in content_limited["files"]] == [f"notes/{index}.md" for index in range(4)]
    assert content_limited["errors"][0]["path"] == "notes/4.md"
    assert content_limited["errors"][0]["code"] == "content_limit_exceeded"
    assert [error["code"] for error in path_limited["errors"][:10]] == ["not_found"] * 10
    assert path_limited["errors"][10]["code"] == "path_limit_exceeded"


@pytest.mark.asyncio
async def test_memory_read_files_uses_synthetic_documents_only_for_native_patch_mode(
    async_session,
) -> None:
    await _put_user_file(
        async_session,
        "profile.md",
        "# Profile\n\nFavorite color: blue\n",
        description="Current user profile",
    )
    tools = _native_tool_service(async_session)

    legacy = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_READ_FILES,
            arguments={"paths": ["profile.md"]},
            context=_context(),
            tool_call_id="call-read-legacy",
        )
    )
    native = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_READ_FILES,
            arguments={"paths": ["profile.md"]},
            context=_native_context(),
            tool_call_id="call-read-native",
        )
    )

    assert legacy["files"][0]["content"] == "# Profile\n\nFavorite color: blue\n"
    assert native["files"][0]["content"] == (
        '---\ndescription: "Current user profile"\n---\n# Profile\n\nFavorite color: blue\n'
    )


@pytest.mark.asyncio
async def test_memory_write_tools_reject_episode_logs(async_session) -> None:
    await _put_user_file(
        async_session,
        "episodes/2026/07/2026-07-07.md",
        "# Episodes\n\n- [ ] The user is planning Project Amaryllis.",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        allow_system_managed=True,
    )
    tools = _tool_service(async_session)

    patch = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_APPLY_PATCH,
            arguments={
                "path": "episodes/2026/07/2026-07-07.md",
                "replacements": [{"old_text": "Project Amaryllis", "new_text": "Project Iris", "replace_all": False}],
                "update_description": False,
                "description": None,
            },
            context=_context(),
            tool_call_id="call-patch",
        )
    )
    replace = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_WRITE_FILE,
            arguments={
                "path": "episodes/2026/07/2026-07-07.md",
                "mode": "replace",
                "content": "# Hacked",
                "description": None,
            },
            context=_context(),
            tool_call_id="call-replace",
        )
    )
    create = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_WRITE_FILE,
            arguments={
                "path": "episodes/2026/07/new.md",
                "mode": "create",
                "content": "# Hacked",
                "description": None,
            },
            context=_context(),
            tool_call_id="call-create",
        )
    )

    assert patch["ok"] is False
    assert patch["code"] == "protected_memory_file"
    assert patch["path"] == "episodes/2026/07/2026-07-07.md"
    assert patch["retryable"] is False
    assert replace["code"] == "protected_memory_file"
    assert create["code"] == "protected_memory_file"


@pytest.mark.asyncio
async def test_search_uploaded_files_reads_only_attached_processed_chunks_without_private_state(async_session) -> None:
    await _put_user_file(async_session, "profile.md", "Project Atlas lives in markdown memory.")
    await _memory_service(async_session, animas=_AllowAnimaRepository()).put_file_by_path(
        user_id="user-1",
        anima_id="anima-1",
        path="identity.md",
        expected_aggregate_revision=1,
        content="Atlas in anima identity should not be searched.",
        expected_version=0,
    )
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-ready",
        text="The uploaded Atlas dossier mentions orbital design and launch windows.",
    )
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-unattached",
        text="The unattached Atlas dossier must not appear.",
    )
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-foreign",
        user_id="user-2",
        text="The foreign Atlas dossier must not appear.",
    )
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-unprocessed",
        status=STATUS_UPLOADED,
        text="The unprocessed Atlas dossier must not appear.",
    )

    memory_search = _loads(
        await _tool_service(
            async_session,
            include_user_files=True,
            allowed_uploaded_files={"file-ready": "file-ready.txt"},
        ).execute(
            tool_name=MEMORY_TOOL_SEARCH_MEMORY_FILES,
            arguments={"query": "Atlas"},
            context=_context(),
            tool_call_id="call-memory-search",
        )
    )

    assert memory_search["ok"] is True
    assert memory_search["memory_results"] == [
        {
            "path": "profile.md",
            "description": None,
            "snippet": "profile.md Project Atlas lives in markdown memory.",
        }
    ]
    assert "uploaded_file_results" not in memory_search

    search = _loads(
        await _tool_service(
            async_session,
            include_user_files=True,
            allowed_uploaded_files={"file-ready": "file-ready.txt"},
        ).execute(
            tool_name=MEMORY_TOOL_SEARCH_UPLOADED_FILES,
            arguments={"query": "Atlas", "file_names": None},
            context=_context(),
            tool_call_id="call-upload-search",
        )
    )

    assert search["ok"] is True
    assert search["uploaded_file_results"] == [
        {
            "filename": "file-ready.txt",
            "chunk_index": 0,
            "snippet": "The uploaded Atlas dossier mentions orbital design and launch windows.",
        }
    ]
    serialized = json.dumps(search)
    for forbidden in (
        "file_id",
        "original_filename",
        "normalized_extension",
        "chunk_id",
        "storage_locator",
        "secret-object-key",
        "user_id",
        "embedding",
        "metadata",
        "version",
        "content_sha256",
        "created_at",
        "updated_at",
        "score",
        "match_type",
        "file-unattached",
    ):
        assert forbidden not in serialized


@pytest.mark.asyncio
async def test_search_uploaded_files_uses_hybrid_search_for_attached_uploads(async_session) -> None:
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-semantic",
        text="The uploaded dossier describes lunar habitat recycling systems.",
    )

    search = _loads(
        await _tool_service(
            async_session,
            include_user_files=True,
            include_embedder=True,
            allowed_uploaded_files={"file-semantic": "file-semantic.txt"},
        ).execute(
            tool_name=MEMORY_TOOL_SEARCH_UPLOADED_FILES,
            arguments={"query": "closed loop moon base supplies", "file_names": "file-semantic.txt"},
            context=_context(),
            tool_call_id="call-search",
        )
    )

    assert search["ok"] is True
    assert search["uploaded_file_results"] == [
        {
            "filename": "file-semantic.txt",
            "chunk_index": 0,
            "snippet": "The uploaded dossier describes lunar habitat recycling systems.",
        }
    ]
    assert "score" not in json.dumps(search)
    assert "match_type" not in json.dumps(search)


@pytest.mark.asyncio
async def test_search_uploaded_files_filters_by_filename_and_invalid_names_search_all(async_session) -> None:
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-alpha",
        original_filename="alpha-notes.md",
        text="Atlas details from the alpha attachment.",
    )
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-beta",
        original_filename="beta-notes.md",
        text="Atlas details from the beta attachment.",
    )
    service = _tool_service(
        async_session,
        include_user_files=True,
        allowed_uploaded_files={
            "file-alpha": "alpha-notes.md",
            "file-beta": "beta-notes.md",
        },
    )

    filtered = _loads(
        await service.execute(
            tool_name=MEMORY_TOOL_SEARCH_UPLOADED_FILES,
            arguments={"query": "Atlas", "file_names": "BETA-NOTES.MD"},
            context=_context(),
            tool_call_id="call-filtered-search",
        )
    )
    invalid = _loads(
        await service.execute(
            tool_name=MEMORY_TOOL_SEARCH_UPLOADED_FILES,
            arguments={"query": "Atlas", "file_names": ["beta-notes.md", "missing.md"]},
            context=_context(),
            tool_call_id="call-invalid-filter-search",
        )
    )

    assert [result["filename"] for result in filtered["uploaded_file_results"]] == ["beta-notes.md"]
    assert {result["filename"] for result in invalid["uploaded_file_results"]} == {
        "alpha-notes.md",
        "beta-notes.md",
    }


@pytest.mark.asyncio
async def test_search_uploaded_files_falls_back_to_keyword(async_session) -> None:
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-keyword",
        text="Atlas keyword retrieval still works when semantic embeddings are unavailable.",
    )

    search = _loads(
        await _tool_service(
            async_session,
            include_user_files=True,
            allowed_uploaded_files={"file-keyword": "file-keyword.txt"},
        ).execute(
            tool_name=MEMORY_TOOL_SEARCH_UPLOADED_FILES,
            arguments={"query": "Atlas", "file_names": ["file-keyword.txt"]},
            context=_context(),
            tool_call_id="call-search",
        )
    )

    assert search["ok"] is True
    assert search["uploaded_file_results"] == [
        {
            "filename": "file-keyword.txt",
            "chunk_index": 0,
            "snippet": "Atlas keyword retrieval still works when semantic embeddings are unavailable.",
        }
    ]


@pytest.mark.asyncio
async def test_read_uploaded_file_chunks_returns_ordered_paginated_content_without_private_state(
    async_session,
) -> None:
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-reader",
        original_filename="Project-Notes.md",
        text=["First source chunk.", "Second source chunk.", "Third source chunk."],
    )
    service = _tool_service(
        async_session,
        include_user_files=True,
        allowed_uploaded_files={"file-reader": "Project-Notes.md"},
    )

    first = _loads(
        await service.execute(
            tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
            arguments={"file_name": "project-notes.MD", "start_chunk": 0, "chunk_count": 2},
            context=_context(),
            tool_call_id="call-read-first",
        )
    )
    final = _loads(
        await service.execute(
            tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
            arguments={"file_name": "Project-Notes.md", "start_chunk": 2, "chunk_count": 2},
            context=_context(),
            tool_call_id="call-read-final",
        )
    )

    assert first == {
        "ok": True,
        "files": [
            {
                "filename": "Project-Notes.md",
                "start_chunk": 0,
                "chunks": [
                    {"chunk_index": 0, "text": "First source chunk."},
                    {"chunk_index": 1, "text": "Second source chunk."},
                ],
                "next_start_chunk": 2,
                "has_more": True,
            }
        ],
        "response_truncated": False,
    }
    assert final == {
        "ok": True,
        "files": [
            {
                "filename": "Project-Notes.md",
                "start_chunk": 2,
                "chunks": [{"chunk_index": 2, "text": "Third source chunk."}],
                "next_start_chunk": None,
                "has_more": False,
            }
        ],
        "response_truncated": False,
    }
    serialized = json.dumps((first, final))
    for forbidden in (
        "file-reader",
        "file_id",
        "chunk_id",
        "embedding",
        "metadata",
        "storage_locator",
        "secret-object-key",
        "storage_debug",
        "chunk_debug",
        "user_id",
    ):
        assert forbidden not in serialized


@pytest.mark.asyncio
async def test_read_uploaded_file_chunks_groups_duplicate_names_in_attachment_order(async_session) -> None:
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-first",
        original_filename="notes.txt",
        text=["First attachment, chunk zero.", "First attachment, chunk one."],
    )
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-second",
        original_filename="notes.txt",
        text=["Second attachment, chunk zero.", "Second attachment, chunk one."],
    )

    result = _loads(
        await _tool_service(
            async_session,
            include_user_files=True,
            allowed_uploaded_files={"file-second": "notes.txt", "file-first": "notes.txt"},
        ).execute(
            tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
            arguments={"file_name": "NOTES.TXT", "start_chunk": 0, "chunk_count": 1},
            context=_context(),
            tool_call_id="call-read-duplicates",
        )
    )

    assert [group["chunks"][0]["text"] for group in result["files"]] == [
        "Second attachment, chunk zero.",
        "First attachment, chunk zero.",
    ]
    assert all(group["filename"] == "notes.txt" for group in result["files"])
    assert all(group["next_start_chunk"] == 1 for group in result["files"])
    assert all(group["has_more"] is True for group in result["files"])


@pytest.mark.asyncio
async def test_read_uploaded_file_chunks_rejects_unknown_names_and_invalid_ranges(async_session) -> None:
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-only",
        original_filename="only.txt",
        text="Only attachment content must not leak through an invalid name.",
    )
    service = _tool_service(
        async_session,
        include_user_files=True,
        allowed_uploaded_files={"file-only": "only.txt"},
    )

    unknown = _loads(
        await service.execute(
            tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
            arguments={"file_name": "missing.txt", "start_chunk": 0, "chunk_count": 1},
            context=_context(),
            tool_call_id="call-read-unknown",
        )
    )
    assert unknown == {
        "ok": False,
        "code": "attached_file_not_found",
        "message": "The requested filename is not attached and readable for this turn",
        "retryable": False,
    }
    assert "Only attachment content" not in json.dumps(unknown)

    blank = _loads(
        await service.execute(
            tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
            arguments={"file_name": "   ", "start_chunk": 0, "chunk_count": 1},
            context=_context(),
            tool_call_id="call-read-blank",
        )
    )
    assert blank == unknown

    invalid_arguments = (
        {"file_name": "only.txt", "start_chunk": True, "chunk_count": 1},
        {"file_name": "only.txt", "start_chunk": -1, "chunk_count": 1},
        {"file_name": "only.txt", "start_chunk": 0, "chunk_count": 0},
        {"file_name": "only.txt", "start_chunk": 0, "chunk_count": 6},
        {"file_name": "only.txt", "start_chunk": 0, "chunk_count": "1"},
    )
    for index, arguments in enumerate(invalid_arguments):
        invalid = _loads(
            await service.execute(
                tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
                arguments=arguments,
                context=_context(),
                tool_call_id=f"call-read-invalid-{index}",
            )
        )
        assert invalid["ok"] is False
        assert invalid["code"] == "invalid_request"
        assert invalid["retryable"] is False


@pytest.mark.asyncio
async def test_read_uploaded_file_chunks_is_unavailable_without_validated_attachments(async_session) -> None:
    result = _loads(
        await _tool_service(async_session).execute(
            tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
            arguments={"file_name": "missing.txt", "start_chunk": 0, "chunk_count": 1},
            context=_context(),
            tool_call_id="call-read-unavailable",
        )
    )

    assert result == {
        "ok": False,
        "code": "upload_read_unavailable",
        "message": "Uploaded-file reading is not available for this turn",
        "retryable": False,
    }


@pytest.mark.asyncio
async def test_read_uploaded_file_chunks_rechecks_owner_and_searchable_status(async_session) -> None:
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-foreign-read",
        user_id="user-2",
        original_filename="foreign.txt",
        text="Foreign content must not be read.",
    )
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-unprocessed-read",
        status=STATUS_UPLOADED,
        original_filename="unprocessed.txt",
        text="Unprocessed content must not be read.",
    )
    service = _tool_service(
        async_session,
        include_user_files=True,
        allowed_uploaded_files={
            "file-foreign-read": "foreign.txt",
            "file-unprocessed-read": "unprocessed.txt",
        },
    )

    foreign = _loads(
        await service.execute(
            tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
            arguments={"file_name": "foreign.txt", "start_chunk": 0, "chunk_count": 1},
            context=_context(),
            tool_call_id="call-read-foreign",
        )
    )
    unprocessed = _loads(
        await service.execute(
            tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
            arguments={"file_name": "unprocessed.txt", "start_chunk": 0, "chunk_count": 1},
            context=_context(),
            tool_call_id="call-read-unprocessed",
        )
    )

    assert foreign["files"][0]["chunks"] == []
    assert unprocessed["files"][0]["chunks"] == []
    assert "must not be read" not in json.dumps((foreign, unprocessed))


@pytest.mark.asyncio
async def test_read_uploaded_file_chunks_applies_deterministic_response_bound(
    async_session,
    monkeypatch,
) -> None:
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-bounded",
        original_filename="bounded.txt",
        text=["a" * 300, "b" * 300, "c" * 300],
    )
    service = _tool_service(
        async_session,
        include_user_files=True,
        allowed_uploaded_files={"file-bounded": "bounded.txt"},
    )
    monkeypatch.setattr(memory_tools_module, "MAX_UPLOADED_FILE_READ_RESPONSE_CHARS", 650)
    arguments = {"file_name": "bounded.txt", "start_chunk": 0, "chunk_count": 3}

    first = await service.execute(
        tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
        arguments=arguments,
        context=_context(),
        tool_call_id="call-read-bounded-1",
    )
    second = await service.execute(
        tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
        arguments=arguments,
        context=_context(),
        tool_call_id="call-read-bounded-2",
    )
    result = _loads(first)

    assert first == second
    assert len(first) <= 650
    assert result["response_truncated"] is True
    assert len(result["files"][0]["chunks"]) == 1
    assert result["files"][0]["next_start_chunk"] == 1
    assert result["files"][0]["has_more"] is True


@pytest.mark.asyncio
async def test_read_uploaded_file_chunks_rejects_one_oversized_legacy_chunk(async_session, monkeypatch) -> None:
    await _insert_uploaded_file_chunk(
        async_session,
        file_id="file-oversized",
        original_filename="oversized.txt",
        text="x" * 2_000,
    )
    service = _tool_service(
        async_session,
        include_user_files=True,
        allowed_uploaded_files={"file-oversized": "oversized.txt"},
    )
    monkeypatch.setattr(memory_tools_module, "MAX_UPLOADED_FILE_READ_RESPONSE_CHARS", 1_000)

    result = _loads(
        await service.execute(
            tool_name=MEMORY_TOOL_READ_UPLOADED_FILE_CHUNKS,
            arguments={"file_name": "oversized.txt", "start_chunk": 0, "chunk_count": 1},
            context=_context(),
            tool_call_id="call-read-oversized",
        )
    )

    assert result == {
        "ok": False,
        "code": "chunk_exceeds_read_limit",
        "message": "A stored chunk exceeds the bounded read response limit",
        "retryable": False,
    }


@pytest.mark.asyncio
async def test_memory_apply_patch_uses_current_version_internally_and_audits_ai_metadata(async_session) -> None:
    await _put_user_file(async_session, "profile.md", "Name: Ray\nFavorite color: blue\n")

    result = _loads(
        await _tool_service(async_session).execute(
            tool_name=MEMORY_TOOL_APPLY_PATCH,
            arguments={
                "path": "profile.md",
                "replacements": [
                    {"old_text": "Favorite color: blue", "new_text": "Favorite color: green", "replace_all": False}
                ],
                "update_description": True,
                "description": "Current user profile",
            },
            context=_context(),
            tool_call_id="call-patch",
        )
    )

    assert result["ok"] is True
    assert result == {"ok": True, "path": "profile.md", "replacements_applied": 1}
    stored = await async_session.scalar(
        select(ORMMemoryEntry).where(
            ORMMemoryEntry.user_id == "user-1",
            ORMMemoryEntry.anima_id.is_(None),
            ORMMemoryEntry.path == "profile.md",
        )
    )
    assert stored is not None
    assert "Favorite color: green" in stored.content
    assert stored.description == "Current user profile"
    assert stored.version == 2
    version = await async_session.scalar(
        select(ORMMemoryEntryVersion).where(
            ORMMemoryEntryVersion.entry_id == stored.id,
            ORMMemoryEntryVersion.version == 2,
        )
    )
    assert version is not None
    assert version.metadata_["last_ai_write"] == {
        "actor_type": "ai",
        "anima_id": "anima-1",
        "chat_id": "chat-1",
        "run_id": "run-1",
        "provider": "OpenAIHTTPAgent",
        "model_provider_id": "OpenAIHTTPAgent:gpt-test",
        "model": "gpt-test",
        "tool_name": MEMORY_TOOL_APPLY_PATCH,
        "tool_call_id": "call-patch",
    }
    assert version.change_metadata_ == {
        "source_type": "ai_write",
        **version.metadata_["last_ai_write"],
    }


@pytest.mark.asyncio
async def test_memory_apply_patch_reports_missing_and_ambiguous_exact_text(async_session) -> None:
    await _put_user_file(async_session, "profile.md", "alpha beta alpha")
    tools = _tool_service(async_session)

    missing = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_APPLY_PATCH,
            arguments={
                "path": "profile.md",
                "replacements": [{"old_text": "gamma", "new_text": "delta", "replace_all": False}],
                "update_description": False,
                "description": None,
            },
            context=_context(),
            tool_call_id="call-missing",
        )
    )
    ambiguous = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_APPLY_PATCH,
            arguments={
                "path": "profile.md",
                "replacements": [{"old_text": "alpha", "new_text": "omega", "replace_all": False}],
                "update_description": False,
                "description": None,
            },
            context=_context(),
            tool_call_id="call-ambiguous",
        )
    )

    assert missing["ok"] is False
    assert missing["code"] == "text_not_found"
    assert missing["path"] == "profile.md"
    assert "current_version" not in missing
    assert "current_sha256" not in missing
    assert ambiguous["ok"] is False
    assert ambiguous["code"] == "ambiguous_replacement"
    assert ambiguous["matches"] == 2


@pytest.mark.asyncio
async def test_memory_write_file_create_and_replace_modes(async_session) -> None:
    tools = _tool_service(async_session)

    created = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_WRITE_FILE,
            arguments={
                "path": "facts.md",
                "mode": "create",
                "content": "Initial facts.",
                "description": "Facts",
            },
            context=_context(),
            tool_call_id="call-create",
        )
    )
    duplicate = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_WRITE_FILE,
            arguments={
                "path": "facts.md",
                "mode": "create",
                "content": "Duplicate.",
                "description": None,
            },
            context=_context(),
            tool_call_id="call-duplicate",
        )
    )
    replaced = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_WRITE_FILE,
            arguments={
                "path": "facts.md",
                "mode": "replace",
                "content": "Replacement facts.",
                "description": None,
            },
            context=_context(),
            tool_call_id="call-replace",
        )
    )
    missing = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_WRITE_FILE,
            arguments={
                "path": "missing.md",
                "mode": "replace",
                "content": "No file.",
                "description": None,
            },
            context=_context(),
            tool_call_id="call-missing",
        )
    )

    assert created["ok"] is True
    assert created == {"ok": True, "path": "facts.md", "mode": "create"}
    assert duplicate["ok"] is False
    assert duplicate["code"] == "file_exists"
    assert duplicate["path"] == "facts.md"
    assert "current_version" not in duplicate
    assert replaced["ok"] is True
    assert replaced == {"ok": True, "path": "facts.md", "mode": "replace"}
    assert missing["ok"] is False
    assert missing["code"] == "file_missing"
    stored = await async_session.scalar(
        select(ORMMemoryEntry).where(
            ORMMemoryEntry.user_id == "user-1",
            ORMMemoryEntry.anima_id.is_(None),
            ORMMemoryEntry.path == "facts.md",
        )
    )
    assert stored is not None
    assert stored.version == 2
    assert stored.content == "Replacement facts."


@pytest.mark.asyncio
async def test_memory_write_file_reports_compact_conflict_without_version_metadata() -> None:
    tools = DirectChatMemoryToolService(memory_entries=_ConflictOnWriteMemoryService())  # type: ignore[arg-type]

    result = _loads(
        await tools.execute(
            tool_name=MEMORY_TOOL_WRITE_FILE,
            arguments={
                "path": "race.md",
                "mode": "create",
                "content": "Racing write.",
                "description": None,
            },
            context=_context(),
            tool_call_id="call-race",
        )
    )

    assert result["ok"] is False
    assert result["code"] == "conflict"
    assert result["message"] == "Memory entry already exists"
    assert result["retryable"] is True
    assert "current_version" not in result
    assert "current_sha256" not in result


@pytest.mark.asyncio
async def test_native_apply_patch_creates_memory_with_ai_version_metadata(async_session) -> None:
    result = _loads(
        await _native_tool_service(async_session).execute_native_patch(
            operation={
                "type": "create_file",
                "path": "notes/native.md",
                "diff": (
                    "+---\n"
                    '+description: "Notes created with native Apply Patch."\n'
                    "+---\n"
                    "+# Native notes\n"
                    "+\n"
                    "+Created with Apply Patch.\n"
                ),
            },
            context=_native_context(),
            tool_call_id="call-native-create",
        )
    )

    assert result == {
        "ok": True,
        "path": "notes/native.md",
        "operation": "create",
        "version": 1,
    }
    stored = await async_session.scalar(
        select(ORMMemoryEntry).where(
            ORMMemoryEntry.user_id == "user-1",
            ORMMemoryEntry.anima_id.is_(None),
            ORMMemoryEntry.path == "notes/native.md",
        )
    )
    assert stored is not None
    assert stored.content == "# Native notes\n\nCreated with Apply Patch."
    assert stored.description == "Notes created with native Apply Patch."
    assert stored.version == 1
    version = await async_session.scalar(
        select(ORMMemoryEntryVersion).where(
            ORMMemoryEntryVersion.entry_id == stored.id,
            ORMMemoryEntryVersion.version == 1,
        )
    )
    assert version is not None
    assert version.content == "# Native notes\n\nCreated with Apply Patch."
    assert version.description == "Notes created with native Apply Patch."
    assert not version.content.startswith("---\ndescription:")
    assert version.metadata_["last_ai_write"] == {
        "actor_type": "ai",
        "anima_id": "anima-1",
        "chat_id": "chat-1",
        "run_id": "run-1",
        "provider": "OpenAIResponsesHTTPAgent",
        "model_provider_id": "OpenAIResponsesHTTPAgent:gpt-5.4-nano",
        "model": "gpt-5.4-nano",
        "tool_name": "apply_patch",
        "tool_call_id": "call-native-create",
        "tool_type": "apply_patch",
        "operation": "create",
    }
    assert version.change_metadata_ == {
        "source_type": "ai_write",
        **version.metadata_["last_ai_write"],
    }


@pytest.mark.asyncio
async def test_native_apply_patch_updates_content_and_description_atomically(async_session) -> None:
    await _put_user_file(
        async_session,
        "profile.md",
        "# Profile\n\nFavorite color: blue\n",
        description="Current user profile",
    )

    result = _loads(
        await _native_tool_service(async_session).execute_native_patch(
            operation={
                "type": "update_file",
                "path": "profile.md",
                "diff": (
                    "@@\n"
                    " ---\n"
                    '-description: "Current user profile"\n'
                    '+description: "Profile and current preferences"\n'
                    " ---\n"
                    " # Profile\n"
                    " \n"
                    "-Favorite color: blue\n"
                    "+Favorite color: green\n"
                ),
            },
            context=_native_context(),
            tool_call_id="call-native-update",
        )
    )

    assert result == {
        "ok": True,
        "path": "profile.md",
        "operation": "update",
        "version": 2,
    }
    stored = await async_session.scalar(
        select(ORMMemoryEntry).where(
            ORMMemoryEntry.user_id == "user-1",
            ORMMemoryEntry.path == "profile.md",
        )
    )
    assert stored is not None
    assert stored.content == "# Profile\n\nFavorite color: green\n"
    assert stored.description == "Profile and current preferences"
    assert stored.version == 2
    assert stored.metadata_["last_ai_write"]["operation"] == "update"
    assert stored.metadata_["last_ai_write"]["tool_type"] == "apply_patch"
    listing = _loads(
        await _native_tool_service(async_session).execute(
            tool_name=MEMORY_TOOL_LIST_FILES,
            arguments={},
            context=_native_context(),
            tool_call_id="call-list-after-native-update",
        )
    )
    assert listing["files"] == [
        {
            "path": "profile.md",
            "description": "Profile and current preferences",
        }
    ]


@pytest.mark.asyncio
async def test_native_apply_patch_supports_description_only_and_clear_changes(async_session) -> None:
    await _put_user_file(
        async_session,
        "profile.md",
        "# Profile\n",
        description="Current user profile",
    )
    tools = _native_tool_service(async_session)

    replaced = _loads(
        await tools.execute_native_patch(
            operation={
                "type": "update_file",
                "path": "profile.md",
                "diff": (
                    '@@\n ---\n-description: "Current user profile"\n+description: "Profile and preferences"\n ---\n'
                ),
            },
            context=_native_context(),
            tool_call_id="call-native-description",
        )
    )
    cleared = _loads(
        await tools.execute_native_patch(
            operation={
                "type": "update_file",
                "path": "profile.md",
                "diff": ('@@\n ---\n-description: "Profile and preferences"\n+description: null\n ---\n'),
            },
            context=_native_context(),
            tool_call_id="call-native-description-clear",
        )
    )

    assert replaced["version"] == 2
    assert cleared["version"] == 3
    stored = await _memory_service(async_session).get_entry_by_path(
        user_id="user-1",
        path="profile.md",
    )
    assert stored.content == "# Profile\n"
    assert stored.description is None
    versions = (
        (
            await async_session.execute(
                select(ORMMemoryEntryVersion)
                .where(ORMMemoryEntryVersion.entry_id == stored.id)
                .order_by(ORMMemoryEntryVersion.version)
            )
        )
        .scalars()
        .all()
    )
    assert [(version.version, version.content, version.description) for version in versions] == [
        (1, "# Profile\n", "Current user profile"),
        (2, "# Profile\n", "Profile and preferences"),
        (3, "# Profile\n", None),
    ]


@pytest.mark.asyncio
async def test_native_apply_patch_rejects_normalized_content_and_description_noop(async_session) -> None:
    await _put_user_file(async_session, "profile.md", "# Profile\n", description="Profile")

    result = _loads(
        await _native_tool_service(async_session).execute_native_patch(
            operation={
                "type": "update_file",
                "path": "profile.md",
                "diff": ('@@\n ---\n-description: "Profile"\n+description: "  Profile  "\n ---\n'),
            },
            context=_native_context(),
            tool_call_id="call-native-noop",
        )
    )

    assert result["ok"] is False
    assert result["code"] == "patch_rejected"
    stored = await _memory_service(async_session).get_entry_by_path(
        user_id="user-1",
        path="profile.md",
    )
    assert stored.version == 1


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "operation",
    [
        {"type": "delete_file", "path": "profile.md"},
        {"type": "create_file", "path": "episodes/2026/07/2026-07-14.md", "diff": "+blocked\n"},
        {"type": "create_file", "path": "animas/anima-1/identity.md", "diff": "+blocked\n"},
        {"type": "create_file", "path": "../escape.md", "diff": "+blocked\n"},
        {"type": "create_file", "path": "notes.txt", "diff": "+blocked\n"},
        {"type": "update_file", "path": "missing.md", "diff": "@@\n-old\n+new\n"},
    ],
)
async def test_native_apply_patch_rejects_delete_protected_invalid_and_missing_paths(
    async_session,
    operation: dict[str, Any],
) -> None:
    await _put_user_file(async_session, "profile.md", "unchanged\n")

    result = _loads(
        await _native_tool_service(async_session).execute_native_patch(
            operation=operation,
            context=_native_context(),
            tool_call_id="call-native-rejected",
        )
    )

    assert result["ok"] is False
    assert result["code"] == "patch_rejected"
    profile = await _memory_service(async_session).get_entry_by_path(
        user_id="user-1",
        anima_id=None,
        path="profile.md",
    )
    assert profile.content == "unchanged\n"
    assert profile.version == 1


@pytest.mark.asyncio
async def test_native_apply_patch_rejects_existing_create_and_oversized_content(async_session) -> None:
    await _put_user_file(async_session, "profile.md", "unchanged\n")
    tools = _native_tool_service(async_session)

    existing = _loads(
        await tools.execute_native_patch(
            operation={"type": "create_file", "path": "profile.md", "diff": "+replacement\n"},
            context=_native_context(),
            tool_call_id="call-native-existing",
        )
    )
    oversized = _loads(
        await tools.execute_native_patch(
            operation={
                "type": "create_file",
                "path": "large.md",
                "diff": "+---\n+description: null\n+---\n+" + ("x" * (32 * 1024 + 1)),
            },
            context=_native_context(),
            tool_call_id="call-native-large",
        )
    )

    assert existing["code"] == "patch_rejected"
    assert oversized["code"] == "invalid_request"
    assert (
        await async_session.scalar(
            select(ORMMemoryEntry.id).where(
                ORMMemoryEntry.user_id == "user-1",
                ORMMemoryEntry.path == "large.md",
            )
        )
        is None
    )


@pytest.mark.asyncio
async def test_native_apply_patch_rejects_stale_planned_version_without_mutation(async_session) -> None:
    await _put_user_file(async_session, "profile.md", "old\n", description="Profile")
    memory_entries = _memory_service(async_session)
    delegate = AgentsSDKV4AMemoryPatchPlanner(memory_entries=memory_entries)

    class _StalePlanner:
        async def plan_v4a_operation(self, **kwargs):  # noqa: ANN003
            candidate = await delegate.plan_v4a_operation(**kwargs)
            assert candidate.target_entry_id is not None
            await memory_entries.patch_entry(
                user_id="user-1",
                entry_id=candidate.target_entry_id,
                expected_version=candidate.expected_version,
                content="external edit\n",
                content_set=True,
            )
            return candidate

    tools = DirectChatMemoryToolService(
        memory_entries=memory_entries,
        patch_planner=_StalePlanner(),
    )

    result = _loads(
        await tools.execute_native_patch(
            operation={
                "type": "update_file",
                "path": "profile.md",
                "diff": '@@\n ---\n description: "Profile"\n ---\n-old\n+native\n',
            },
            context=_native_context(),
            tool_call_id="call-native-stale",
        )
    )

    assert result["ok"] is False
    assert result["code"] == "conflict"
    stored = await memory_entries.get_entry_by_path(user_id="user-1", anima_id=None, path="profile.md")
    assert stored.content == "external edit\n"
    assert stored.description == "Profile"
    assert stored.version == 2
