"""Anthropic's memory tool over the database-backed memory files (plan Phase 7, R8).

``AnthropicMemoryToolHandler`` runs each ``memory_20250818`` command against
the virtual memory workspace: reads answer immediately, edits become
version-fenced approval proposals, and delete or rename is refused.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import delete

from animama.adapters.memory_manager.anthropic_memory_tool import (
    VIEW_MAX_CHARS,
    AnthropicMemoryToolHandler,
    MemoryToolOutcome,
)
from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.anima_identity_memory import (
    EPISODE_PROCESSING_MANAGER_FILE_ACCESS,
    GENERAL_MANAGER_FILE_ACCESS,
    ManagerFileAccess,
    reflection_manager_file_access,
)
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.domain.memory_episode import MEMORY_EPISODE_LOG_ENTRY_KIND
from animama.domain.request_principal import RequestPrincipal
from animama.orm import ORMAnima, ORMMemoryEntry, ORMMemoryEntryVersion
from animama.product_http.routes import memory as memory_entries_router
from animama.server.schemas.memory_entry import PyMemoryEntryCreateRequest
from tests.product_http_support import TEST_POLICY

PROFILE = "# Profile\n\n- Prefers coffee in the morning.\n- Lives in Toronto.\n"
PROFILE_DOCUMENT = (
    '---\ndescription: "Who the user is"\n---\n# Profile\n\n- Prefers coffee in the morning.\n- Lives in Toronto.\n'
)


@pytest_asyncio.fixture
async def clean_entries(async_session):
    async def _clean() -> None:
        await async_session.execute(delete(ORMMemoryEntryVersion))
        await async_session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.parent_id.is_not(None)))
        await async_session.execute(delete(ORMMemoryEntry))
        await async_session.commit()

    await _clean()
    yield
    await _clean()


def _entries(async_session) -> MemoryEntryService:
    return MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
        animas=SQLAlchemyAnimaRepository(async_session),
    )


def _handler(async_session, user_id: str, access: ManagerFileAccess = GENERAL_MANAGER_FILE_ACCESS):
    return AnthropicMemoryToolHandler(
        user_id=user_id,
        memory_entries=_entries(async_session),
        access=access,
        runtime_name="anthropic_messages",
    )


async def _seed(async_session, user_id: str) -> None:
    entries = _entries(async_session)
    await entries.put_file_by_path(
        user_id=user_id, path="PROFILE.md", content=PROFILE, kind="user_memory", description="Who the user is"
    )
    await entries.put_file_by_path(
        user_id=user_id,
        path="notes/preferences.md",
        content="# Preferences\n\n- Tea after 3pm.\n- Tea on weekends.\n",
        kind="user_memory",
        description="Food and drink preferences",
        create_parents=True,
    )
    await entries.put_file_by_path(
        user_id=user_id,
        path="notes/deep/nested/far.md",
        content="Far away.\n",
        kind="user_memory",
        create_parents=True,
    )
    await entries.put_file_by_path(
        user_id=user_id,
        path="episodes/2026/07/2026-07-07.md",
        content="# Episodes for 2026-07-07\n\n- [ ] <!-- episode:mei-1 --> Likes tea.\n",
        kind=MEMORY_EPISODE_LOG_ENTRY_KIND,
        create_parents=True,
        allow_system_managed=True,
    )


async def _anima(async_session, user_id: str, name: str) -> str:
    anima_id = f"anima-{uuid.uuid4().hex}"
    async_session.add(ORMAnima(id=anima_id, user_id=user_id, display_name=name))
    await async_session.flush()
    principal = RequestPrincipal(id=user_id)
    await memory_entries_router.create_memory_entry(
        PyMemoryEntryCreateRequest(
            anima_id=anima_id,
            expected_aggregate_revision=1,
            type="file",
            name="IDENTITY.md",
            content=f"# {name}\n\nCalm and curious.\n",
            description=f"Who {name} is",
        ),
        repositories=SQLAlchemyProductRepositories(async_session),
        policy=TEST_POLICY,
        user=principal,
    )
    await memory_entries_router.repair_anima_memories(
        anima_id, repositories=SQLAlchemyProductRepositories(async_session), policy=TEST_POLICY, user=principal
    )
    return anima_id


async def _run(handler: AnthropicMemoryToolHandler, **tool_input: Any) -> MemoryToolOutcome:
    return await handler.execute(tool_input, tool_use_id="toolu_test_1")


def _user() -> str:
    return f"user-{uuid.uuid4()}"


# ------------------------------------------------------------------ paths


@pytest.mark.parametrize(
    "path",
    [
        "/memories/../secrets.env",
        "/memories/notes/../../etc/passwd.md",
        "/memories/%2e%2e/%2e%2e/secrets.md",
        "/memories/..%2fsecrets.md",
        "/memories\\..\\secrets.md",
        "/etc/passwd",
        "/memoriesX/notes.md",
        "notes/preferences.md",
        "/memories/./PROFILE.md",
        "/memories/notes//preferences.md",
    ],
)
async def test_paths_outside_memories_traversal_and_encoded_traversal_are_refused(
    async_session, clean_entries, path: str
) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    handler = _handler(async_session, user_id)

    for tool_input in (
        {"command": "view", "path": path},
        {"command": "create", "path": path, "file_text": '---\ndescription: "x"\n---\nx\n'},
        {"command": "str_replace", "path": path, "old_str": "coffee", "new_str": "tea"},
        {"command": "insert", "path": path, "insert_line": 4, "insert_text": "x"},
    ):
        outcome = await handler.execute(tool_input, tool_use_id="toolu_1")
        assert outcome.is_error is True
        assert outcome.approval is None
        assert f"The path {path.strip()} is outside /memories" in outcome.content


# ------------------------------------------------------------------ view


async def test_viewing_the_root_lists_two_levels_with_sizes(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    anima_id = await _anima(async_session, user_id, "Annie")

    outcome = await _run(_handler(async_session, user_id), command="view", path="/memories")

    assert outcome.is_error is False
    lines = outcome.content.splitlines()
    assert lines[0] == (
        "Here're the files and directories up to 2 levels deep in /memories, excluding hidden items and node_modules:"
    )
    assert lines[1].endswith("\t/memories")
    listed = [line.split("\t")[1] for line in lines[2:]]
    # Generated episode logs are left out, as from the memory map; exact reads still work.
    assert listed == [
        "/memories/animas/",
        f"/memories/animas/{anima_id}/",
        "/memories/notes/",
        "/memories/notes/deep/",
        "/memories/notes/preferences.md",
        "/memories/PROFILE.md",
    ]
    profile_size = len(PROFILE.encode())
    assert f"{profile_size}B\t/memories/PROFILE.md" in lines


async def test_viewing_a_directory_lists_beneath_it(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)

    outcome = await _run(_handler(async_session, user_id), command="view", path="/memories/notes/")

    assert outcome.is_error is False
    listed = [line.split("\t")[1] for line in outcome.content.splitlines()[1:]]
    assert listed == [
        "/memories/notes",
        "/memories/notes/deep/",
        "/memories/notes/deep/nested/",
        "/memories/notes/preferences.md",
    ]


async def test_viewing_a_file_shows_its_description_header_and_body_with_line_numbers(
    async_session, clean_entries
) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    handler = _handler(async_session, user_id)

    whole = await _run(handler, command="view", path="/memories/PROFILE.md")
    ranged = await _run(handler, command="view", path="/memories/PROFILE.md", view_range=[5, -1])
    middle = await _run(handler, command="view", path="/memories/PROFILE.md", view_range=[2, 4])

    assert whole.is_error is False
    assert whole.content == (
        "Here's the content of /memories/PROFILE.md with line numbers:\n"
        '     1\t---\n     2\tdescription: "Who the user is"\n     3\t---\n     4\t# Profile\n     5\t\n'
        "     6\t- Prefers coffee in the morning.\n     7\t- Lives in Toronto."
    )
    assert ranged.content.splitlines()[1:] == [
        "     5\t",
        "     6\t- Prefers coffee in the morning.",
        "     7\t- Lives in Toronto.",
    ]
    assert middle.content.splitlines()[1:] == [
        '     2\tdescription: "Who the user is"',
        "     3\t---",
        "     4\t# Profile",
    ]


async def test_a_file_view_reads_only_that_file(async_session, clean_entries, monkeypatch) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    handler = _handler(async_session, user_id)
    listings: list[str] = []
    entries = handler._memory_entries
    original = entries.list_entry_headers

    async def counted(**kwargs: Any) -> Any:
        listings.append("headers")
        return await original(**kwargs)

    monkeypatch.setattr(entries, "list_entry_headers", counted)

    await _run(handler, command="view", path="/memories/PROFILE.md")
    assert listings == []
    await _run(handler, command="view", path="/memories/notes")
    assert listings == ["headers"]


async def test_view_errors_use_the_documented_strings(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    handler = _handler(async_session, user_id)

    missing = await _run(handler, command="view", path="/memories/missing.md")
    missing_dir = await _run(handler, command="view", path="/memories/nowhere")
    bad_range = await _run(handler, command="view", path="/memories/PROFILE.md", view_range=[9, 10])
    reversed_range = await _run(handler, command="view", path="/memories/PROFILE.md", view_range=[4, 2])

    assert missing.is_error and missing.content == (
        "The path /memories/missing.md does not exist. Please provide a valid path."
    )
    assert missing_dir.is_error and "/memories/nowhere does not exist" in missing_dir.content
    assert bad_range.is_error and "should be within the range of lines of the file: [1, 7]" in bad_range.content
    assert reversed_range.is_error and "Invalid `view_range`" in reversed_range.content


async def test_long_file_views_stop_at_a_line_boundary_and_point_to_view_range(async_session, clean_entries) -> None:
    user_id = _user()
    body = "".join(f"- Fact number {index} about the user's long history.\n" for index in range(1, 600))
    await _entries(async_session).put_file_by_path(user_id=user_id, path="long.md", content=body, kind="user_memory")

    outcome = await _run(_handler(async_session, user_id), command="view", path="/memories/long.md")

    assert outcome.is_error is False
    assert len(outcome.content) < VIEW_MAX_CHARS + 500
    last = outcome.content.splitlines()[-1]
    assert last.startswith("[Showing lines 1-") and "Use view_range [" in last


async def test_episode_logs_are_readable_by_exact_path_but_not_listed(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    handler = _handler(async_session, user_id)

    outcome = await _run(handler, command="view", path="/memories/episodes/2026/07/2026-07-07.md")
    folder = await _run(handler, command="view", path="/memories/episodes")

    assert outcome.is_error is False
    assert "Likes tea." in outcome.content
    assert folder.is_error and "/memories/episodes does not exist" in folder.content


# ------------------------------------------------------------------ edits


async def test_create_proposes_a_new_file_without_writing_it(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)

    outcome = await _run(
        _handler(async_session, user_id),
        command="create",
        path="/memories/people/shirley.md",
        file_text='---\ndescription: "The user\'s sister Shirley"\n---\n# Shirley\n\n- Lives in Ottawa.\n',
    )

    assert outcome.is_error is False
    assert outcome.content == "File created successfully at: /memories/people/shirley.md"
    approval = outcome.approval
    assert approval is not None
    assert approval.operation == "create"
    assert approval.target_path == "people/shirley.md"
    assert approval.expected_version == 0
    assert approval.new_content == "# Shirley\n\n- Lives in Ottawa.\n"
    assert approval.new_description == "The user's sister Shirley"
    assert "+# Shirley" in approval.unified_diff
    assert approval.operation_metadata == {
        "runtime": "anthropic_messages",
        "sdk_call_id": "toolu_test_1",
        "sdk_tool_name": "memory",
        "memory_command": "create",
        "memory_tool_path": "/memories/people/shirley.md",
        "memory_tool_result": "File created successfully at: /memories/people/shirley.md",
    }
    listing = await _run(_handler(async_session, user_id), command="view", path="/memories")
    assert "shirley" not in listing.content


async def test_create_on_an_existing_file_proposes_an_update_fenced_by_its_version(
    async_session, clean_entries
) -> None:
    user_id = _user()
    await _seed(async_session, user_id)

    outcome = await _run(
        _handler(async_session, user_id),
        command="create",
        path="/memories/PROFILE.md",
        file_text='---\ndescription: "Who the user is"\n---\n# Profile\n\n- Prefers tea in the morning.\n',
    )

    assert outcome.is_error is False
    assert outcome.content == "The file /memories/PROFILE.md has been replaced with the new content."
    assert outcome.approval is not None
    assert outcome.approval.operation == "update"
    assert outcome.approval.expected_version == 1
    assert outcome.approval.old_content == PROFILE


async def test_create_needs_the_description_header(async_session, clean_entries) -> None:
    user_id = _user()

    outcome = await _run(
        _handler(async_session, user_id), command="create", path="/memories/notes/new.md", file_text="# New\n"
    )

    assert outcome.is_error is True
    assert outcome.approval is None
    assert "/memories/notes/new.md must begin with its reserved three-line description header" in outcome.content
    assert 'description: "Concise overview of the file."' in outcome.content


async def test_str_replace_proposes_one_unique_change_with_a_snippet(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)

    outcome = await _run(
        _handler(async_session, user_id),
        command="str_replace",
        path="/memories/PROFILE.md",
        old_str="Prefers coffee in the morning.",
        new_str="Prefers tea in the morning.",
    )

    assert outcome.is_error is False
    assert outcome.content == (
        "The memory file has been edited. Here is the snippet showing the change (with line numbers):\n"
        "     4\t# Profile\n     5\t\n     6\t- Prefers tea in the morning.\n     7\t- Lives in Toronto."
    )
    approval = outcome.approval
    assert approval is not None
    assert approval.operation == "update"
    assert approval.target_path == "PROFILE.md"
    assert approval.expected_version == 1
    assert approval.new_content == PROFILE.replace("coffee", "tea")
    assert approval.new_description == "Who the user is"
    assert "-- Prefers coffee in the morning." in approval.unified_diff
    assert "+- Prefers tea in the morning." in approval.unified_diff
    assert approval.operation_metadata is not None
    assert approval.operation_metadata["memory_command"] == "str_replace"


async def test_str_replace_on_the_header_changes_the_description(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)

    outcome = await _run(
        _handler(async_session, user_id),
        command="str_replace",
        path="/memories/PROFILE.md",
        old_str='"Who the user is"',
        new_str='"Who the user is and where they live"',
    )

    assert outcome.approval is not None
    assert outcome.approval.new_description == "Who the user is and where they live"
    assert outcome.approval.new_content == PROFILE


async def test_str_replace_errors_use_the_documented_strings(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    handler = _handler(async_session, user_id)

    missing_text = await _run(handler, command="str_replace", path="/memories/PROFILE.md", old_str="cocoa", new_str="x")
    repeated = await _run(
        handler, command="str_replace", path="/memories/notes/preferences.md", old_str="Tea", new_str="x"
    )
    missing_file = await _run(handler, command="str_replace", path="/memories/nope.md", old_str="a", new_str="b")
    broken_header = await _run(
        handler, command="str_replace", path="/memories/PROFILE.md", old_str="---\n#", new_str="#"
    )

    assert missing_text.is_error and missing_text.content == (
        "No replacement was performed, old_str `cocoa` did not appear verbatim in /memories/PROFILE.md."
    )
    assert repeated.is_error and repeated.content == (
        "No replacement was performed. Multiple occurrences of old_str `Tea` in lines: 6, 7. Please ensure it is unique"
    )
    assert missing_file.is_error and missing_file.content == (
        "The path /memories/nope.md does not exist. Please provide a valid path."
    )
    assert broken_header.is_error and "reserved three-line description header" in broken_header.content
    assert all(outcome.approval is None for outcome in (missing_text, repeated, missing_file, broken_header))


async def test_insert_proposes_text_after_a_line(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)

    outcome = await _run(
        _handler(async_session, user_id),
        command="insert",
        path="/memories/PROFILE.md",
        insert_line=7,
        insert_text="- Has a cat named Miso.\n",
    )

    assert outcome.is_error is False
    assert outcome.content == "The file /memories/PROFILE.md has been edited."
    assert outcome.approval is not None
    assert outcome.approval.new_content == PROFILE + "- Has a cat named Miso.\n"
    assert outcome.approval.expected_version == 1


async def test_insert_errors_use_the_documented_strings(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    handler = _handler(async_session, user_id)

    out_of_range = await _run(handler, command="insert", path="/memories/PROFILE.md", insert_line=8, insert_text="x")
    missing = await _run(handler, command="insert", path="/memories/nope.md", insert_line=0, insert_text="x")
    inside_header = await _run(handler, command="insert", path="/memories/PROFILE.md", insert_line=1, insert_text="x")

    assert out_of_range.is_error and out_of_range.content == (
        "Error: Invalid `insert_line` parameter: 8. It should be within the range of lines of the file: [0, 7]"
    )
    assert missing.is_error and missing.content == "Error: The path /memories/nope.md does not exist"
    assert inside_header.is_error and "reserved three-line description header" in inside_header.content


async def test_episode_logs_are_read_only(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    handler = _handler(async_session, user_id)
    path = "/memories/episodes/2026/07/2026-07-07.md"

    replaced = await _run(handler, command="str_replace", path=path, old_str="Likes tea.", new_str="Likes coffee.")
    created = await _run(
        handler, command="create", path="/memories/episodes/new.md", file_text='---\ndescription: "x"\n---\nx\n'
    )

    for outcome in (replaced, created):
        assert outcome.is_error is True
        assert outcome.approval is None
        assert "Generated episode logs are read-only" in outcome.content


async def test_delete_and_rename_are_refused_with_a_reason(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    handler = _handler(async_session, user_id)

    deleted = await _run(handler, command="delete", path="/memories/PROFILE.md")
    renamed = await _run(handler, command="rename", old_path="/memories/PROFILE.md", new_path="/memories/me.md")
    unknown = await _run(handler, command="truncate", path="/memories/PROFILE.md")

    assert deleted.is_error and "cannot delete memory files" in deleted.content
    assert renamed.is_error and "cannot rename or move memory files" in renamed.content
    assert unknown.is_error and "Unknown memory command" in unknown.content
    view = await _run(handler, command="view", path="/memories/PROFILE.md")
    assert "Prefers coffee" in view.content


async def test_a_second_edit_in_one_response_waits_for_the_first(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)

    outcome = await _handler(async_session, user_id).execute(
        {"command": "insert", "path": "/memories/PROFILE.md", "insert_line": 7, "insert_text": "x"},
        tool_use_id="toolu_2",
        edits_allowed=False,
    )

    assert outcome.is_error and "one memory change at a time" in outcome.content
    assert outcome.approval is None


# --------------------------------------------------------------- file scope


async def test_a_reflection_changes_only_its_own_animas_memories(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    anima_id = await _anima(async_session, user_id, "Annie")
    other_id = await _anima(async_session, user_id, "Caitlyn")
    handler = _handler(async_session, user_id, reflection_manager_file_access(anima_id))
    own = f"/memories/animas/{anima_id}/MEMORIES.md"

    root = await _run(handler, command="view", path="/memories")
    folder = await _run(handler, command="view", path=f"/memories/animas/{anima_id}")
    own_view = await _run(handler, command="view", path=own)
    other_view = await _run(handler, command="view", path=f"/memories/animas/{other_id}/MEMORIES.md")
    identity = await _run(handler, command="view", path=f"/memories/animas/{anima_id}/IDENTITY.md")
    user_edit = await _run(handler, command="str_replace", path="/memories/PROFILE.md", old_str="coffee", new_str="tea")
    own_lines = own_view.content.splitlines()
    own_edit = await _run(handler, command="insert", path=own, insert_line=len(own_lines) - 1, insert_text="- We met.")

    assert f"/memories/animas/{anima_id}/" in root.content and other_id not in root.content
    assert f"/memories/animas/{anima_id}/MEMORIES.md" in folder.content and "IDENTITY.md" not in folder.content
    assert own_view.is_error is False
    assert other_view.is_error and identity.is_error
    assert user_edit.is_error and f"This Reflection can change only animas/{anima_id}/MEMORIES.md" in user_edit.content
    assert own_edit.is_error is False
    assert own_edit.approval is not None
    assert own_edit.approval.target_path == f"animas/{anima_id}/MEMORIES.md"
    assert own_edit.approval.operation == "update"


async def test_episode_processing_reaches_no_anima_files(async_session, clean_entries) -> None:
    user_id = _user()
    await _seed(async_session, user_id)
    anima_id = await _anima(async_session, user_id, "Annie")
    handler = _handler(async_session, user_id, EPISODE_PROCESSING_MANAGER_FILE_ACCESS)

    root = await _run(handler, command="view", path="/memories")
    view = await _run(handler, command="view", path=f"/memories/animas/{anima_id}/MEMORIES.md")
    edit = await _run(
        handler,
        command="create",
        path=f"/memories/animas/{anima_id}/MEMORIES.md",
        file_text='---\ndescription: "x"\n---\nx\n',
    )

    assert "/memories/animas" not in root.content
    assert view.is_error and edit.is_error
    assert edit.approval is None
