"""Opt-in live smoke of the Anthropic Memory Manager runtime through the service.

Runs ``MemoryManagerService`` with the real ``AnthropicMemoryManagerRuntime``
on Claude Haiku 5.5 over a small seeded memory workspace in the test database:
a request to record a preference must become an approval with a sensible diff,
approving it (from a freshly built service, as after a restart) must commit
the change and resume to completion, the outdated preference line must be
corrected or removed so the files never contradict each other, and no
progress, status or scratch file may be proposed.

Paid requests: run only with ``ANIMAMA_RUN_LIVE_TESTS=1`` and a real
``ANTHROPIC_API_KEY``. Run with ``-s`` to see the measurements; no request,
response or memory content is printed.
"""

from __future__ import annotations

import json
import os
import re
import uuid
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import delete

from animama.adapters.memory_manager import AnthropicMemoryManagerRuntime
from animama.adapters.memory_manager.anthropic_runtime import AnthropicManagerState
from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.memory_manager_repo import SQLAlchemyMemoryManagerRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.model_clients.credentials import builtin_anthropic_connection, static_credential_resolver
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.memory_manager_service import MemoryManagerService
from animama.domain import ModelProvider, ModelProviderCapabilities
from animama.domain.memory_manager import MemoryManagerRunSnapshot
from animama.orm import (
    ORMMemoryEntry,
    ORMMemoryEntryVersion,
    ORMMemoryManagerApproval,
    ORMMemoryManagerMessage,
    ORMMemoryManagerRun,
)

PROFILE = (
    "# Profile\n\n"
    "- Name: Sam.\n"
    "- Prefers coffee in the morning.\n"
    "- Works as a landscape architect.\n"
    "- Enjoys long walks along the river on weekends.\n"
)
PREFERENCES = "# Preferences\n\n- Likes quiet music while working.\n- Prefers paper books to e-readers.\n"
_PROGRESS_LIKE = re.compile(r"progress|status|scratch|todo|task|session|log", re.IGNORECASE)
_MAX_APPROVALS = 3


def _api_key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "").strip()


pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(
        os.getenv("ANIMAMA_RUN_LIVE_TESTS") != "1" or _api_key() in {"", "test-key"},
        reason="requires ANIMAMA_RUN_LIVE_TESTS=1 and ANTHROPIC_API_KEY",
    ),
]


def _record(check: str, **values: Any) -> None:
    print(f"[anthropic-memory-manager] {check}: {json.dumps(values, sort_keys=True, default=str)}")


@pytest_asyncio.fixture
async def clean_rows(async_session):
    async def _clean() -> None:
        await async_session.execute(delete(ORMMemoryManagerApproval))
        await async_session.execute(delete(ORMMemoryManagerMessage))
        await async_session.execute(delete(ORMMemoryManagerRun))
        await async_session.execute(delete(ORMMemoryEntryVersion))
        await async_session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.parent_id.is_not(None)))
        await async_session.execute(delete(ORMMemoryEntry))
        await async_session.commit()

    await _clean()
    yield
    await _clean()


def _haiku() -> ModelProvider:
    return ModelProvider(
        id="AnthropicMessagesHTTPAgent:claude-haiku-5-5",
        provider_type="AnthropicMessagesHTTPAgent",
        model="claude-haiku-5-5",
        model_label="Claude Haiku 5.5",
        provider_label="Anthropic",
        connection_id="anthropic",
        connection=builtin_anthropic_connection(),
        context_window_tokens=1_000_000,
        max_output_tokens=128_000,
        capabilities=ModelProviderCapabilities(
            supports_tools=True,
            supports_streaming=True,
            supports_reasoning=True,
            supported_reasoning_efforts=["none", "low", "medium", "high", "xhigh", "max"],
        ),
    )


def _entries(async_session, *, commit_on_write: bool = True) -> MemoryEntryService:
    return MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
        animas=SQLAlchemyAnimaRepository(async_session),
        commit_on_write=commit_on_write,
    )


def _service(async_session, user_id: str) -> MemoryManagerService:
    """A request-scoped service on the real runtime, as the router builds it for an Anthropic row."""

    memory_entries = _entries(async_session, commit_on_write=False)
    runtime = AnthropicMemoryManagerRuntime(
        user_id=user_id,
        memory_entries=memory_entries,
        model_provider=_haiku(),
        credential_resolver=static_credential_resolver({"ANTHROPIC_API_KEY": _api_key()}),
        timeout_seconds=120.0,
    )
    return MemoryManagerService(
        memory_manager=SQLAlchemyMemoryManagerRepository(async_session),
        memory_entries=memory_entries,
        runtime=runtime,
        uow=SQLAlchemyUnitOfWork(async_session),
    )


async def _commands(async_session, user_id: str, run_id: str) -> list[str]:
    """The memory-tool commands of the paused step, without their content."""

    run = await SQLAlchemyMemoryManagerRepository(async_session).get_run(user_id=user_id, run_id=run_id)
    if run is None or not run.serialized_agent_state:
        return []
    state = AnthropicManagerState.from_json(run.serialized_agent_state)
    return [
        str(block["input"].get("command") or block["name"])
        for message in state.messages
        if message["role"] == "assistant"
        for block in message["content"]
        if block.get("type") == "tool_use"
    ]


def _step(snapshot: MemoryManagerRunSnapshot) -> dict[str, Any]:
    usage = dict(snapshot.run.usage_metadata or {})
    return {
        "status": snapshot.run.status,
        "requests": usage.get("requests"),
        "input_tokens": usage.get("input_tokens"),
        "output_tokens": usage.get("output_tokens"),
        "approvals": [(item.operation, item.target_path, item.status) for item in snapshot.approvals],
        "error": snapshot.run.error,
    }


async def test_a_preference_becomes_an_approval_that_commits_and_completes(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    seed = _entries(async_session)
    await seed.put_file_by_path(
        user_id=user_id, path="PROFILE.md", content=PROFILE, kind="user_memory", description="Who Sam is"
    )
    await seed.put_file_by_path(
        user_id=user_id,
        path="notes/preferences.md",
        content=PREFERENCES,
        kind="user_memory",
        description="Sam's everyday preferences",
        create_parents=True,
    )

    started = await _service(async_session, user_id).create_run(
        user_id=user_id,
        initial_message="I've switched from coffee to green tea in the mornings. Please record that.",
    )
    _record("start", commands=await _commands(async_session, user_id, started.run.id), **_step(started))

    assert started.run.status == "waiting_approval", started.run.error
    [first] = started.approvals
    added = [line for line in first.unified_diff.splitlines() if line.startswith("+") and not line.startswith("+++")]
    assert any("tea" in line.lower() for line in added), "the diff should record the tea preference"
    assert first.target_path in {"PROFILE.md", "notes/preferences.md"}
    assert first.expected_version == 1

    snapshot = started
    approved = 0
    while snapshot.run.status == "waiting_approval" and approved < _MAX_APPROVALS:
        pending = next(item for item in snapshot.approvals if item.status == "pending")
        # A fresh service per decision, as after a backend restart.
        service = _service(async_session, user_id)
        await service.decide_approval(user_id=user_id, approval_id=pending.id, decision="approve")
        approved += 1
        snapshot = await service.get_run_snapshot(user_id=user_id, run_id=started.run.id)
        _record(f"after_approval_{approved}", **_step(snapshot))

    assert snapshot.run.status == "active", snapshot.run.error
    assert all(item.status == "approved" for item in snapshot.approvals)
    assert not any(_PROGRESS_LIKE.search(item.target_path) for item in snapshot.approvals)
    assert snapshot.messages[-1].role == "assistant" and snapshot.messages[-1].content.strip()
    changed = await _entries(async_session).get_entry_by_path(user_id=user_id, path=first.target_path)
    assert "tea" in (changed.content or "").lower()
    # The older coffee line is corrected too, so the files never contradict each other.
    profile = await _entries(async_session).get_entry_by_path(user_id=user_id, path="PROFILE.md")
    coffee_line_removed = "prefers coffee in the morning" not in (profile.content or "").lower()
    _record("profile", coffee_line_removed=coffee_line_removed)
    assert coffee_line_removed
    listing = await _entries(async_session).list_entry_headers(user_id=user_id, recursive=True)
    created = sorted(entry.path for entry in listing.entries if entry.type == "file")
    assert not any(_PROGRESS_LIKE.search(path) for path in created)
    _record(
        "files",
        count=len(created),
        new_files=[path for path in created if path not in {"PROFILE.md", "notes/preferences.md"}],
    )
