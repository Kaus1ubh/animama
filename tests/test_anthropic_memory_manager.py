"""The Anthropic Memory Manager runtime through the service, with a fake Anthropic transport (plan Phase 7, R8).

``AnthropicMemoryManagerRuntime`` drives a duck-typed fake SDK client
(``tests/anthropic_fakes.py``) whose scripted responses call the memory tool.
Runs, approvals and memory files are real database rows; no key or network
is used.
"""

from __future__ import annotations

import json
import uuid
from dataclasses import replace
from datetime import UTC, date, datetime
from typing import Any, cast

import pytest
import pytest_asyncio
from sqlalchemy import delete

from animama.adapters.memory_manager import (
    AnthropicMemoryManagerRuntime,
    MemoryManagerRuntimeSelector,
    OpenAIAgentsMemoryManagerRuntime,
)
from animama.adapters.memory_manager.anthropic_runtime import AnthropicManagerState
from animama.adapters.repositories.sqlalchemy.anima_memory_reflection_repo import (
    SQLAlchemyAnimaMemoryReflectionRepository,
)
from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.memory_episode_repo import SQLAlchemyMemoryEpisodeRepository
from animama.adapters.repositories.sqlalchemy.memory_manager_repo import SQLAlchemyMemoryManagerRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.model_clients.credentials import builtin_anthropic_connection, static_credential_resolver
from animama.app.ports.memory_manager_runtime import MemoryManagerPinnedModelUnavailableError
from animama.app.ports.model_provider_port import ModelProviderRepository
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.memory_episode_service import MemoryEpisodeService
from animama.app.services.memory_manager_service import MemoryManagerConflictError, MemoryManagerService
from animama.domain import ModelProvider, ModelProviderCapabilities
from animama.domain.memory_manager import MemoryManagerRun, new_memory_manager_run_id
from animama.orm import (
    ORMAnimaMemoryReflection,
    ORMMemoryEntry,
    ORMMemoryEntryVersion,
    ORMMemoryEpisodeItem,
    ORMMemoryManagerApproval,
    ORMMemoryManagerMessage,
    ORMMemoryManagerRun,
)
from tests.anthropic_fakes import (
    SENTINEL_KEY,
    THINKING_SIGNATURE,
    FakeAnthropicClient,
    FakeClientFactory,
    captured_anima_log_records,
    message_events,
    status_error,
    text_block,
    thinking_block,
    tool_use_block,
)
from tests.test_memory_manager_reflection import _START, _add_turns, _anima, _chat

ANTHROPIC = "AnthropicMessagesHTTPAgent"
HAIKU_ID = f"{ANTHROPIC}:claude-haiku-5-5"
PROFILE = "# Profile\n\n- Prefers coffee in the morning.\n- Lives in Toronto.\n"
MEMORY_TOOL = {"type": "memory_20250818", "name": "memory"}


def _haiku(model: str = "claude-haiku-5-5", *, efforts: list[str] | None = None) -> ModelProvider:
    return ModelProvider(
        id=f"{ANTHROPIC}:{model}",
        provider_type=ANTHROPIC,
        model=model,
        model_label=model,
        provider_label="Anthropic",
        connection_id="anthropic",
        connection=builtin_anthropic_connection(),
        context_window_tokens=1_000_000,
        max_output_tokens=128_000,
        capabilities=ModelProviderCapabilities(
            supports_tools=True,
            supports_streaming=True,
            supports_reasoning=True,
            supported_reasoning_efforts=(
                efforts if efforts is not None else ["none", "low", "medium", "high", "xhigh", "max"]
            ),
        ),
    )


def _openai_row(model: str = "gpt-6-luna") -> ModelProvider:
    return ModelProvider(
        id=f"OpenAIResponsesHTTPAgent:{model}",
        provider_type="OpenAIResponsesHTTPAgent",
        model=model,
        model_label=model,
        provider_label="OpenAI",
        connection_id="openai",
        capabilities=ModelProviderCapabilities(supports_tools=True, supports_streaming=True),
    )


class _Rows:
    def __init__(self, *rows: ModelProvider) -> None:
        self._rows = {row.id: row for row in rows}

    async def get(self, model_provider_id: str) -> ModelProvider | None:
        return self._rows.get(model_provider_id)


@pytest_asyncio.fixture
async def clean_rows(async_session):
    async def _clean() -> None:
        await async_session.execute(delete(ORMMemoryManagerApproval))
        await async_session.execute(delete(ORMMemoryManagerMessage))
        await async_session.execute(delete(ORMMemoryManagerRun))
        await async_session.execute(delete(ORMMemoryEpisodeItem))
        await async_session.execute(delete(ORMAnimaMemoryReflection))
        await async_session.execute(delete(ORMMemoryEntryVersion))
        await async_session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.parent_id.is_not(None)))
        await async_session.execute(delete(ORMMemoryEntry))
        await async_session.commit()

    await _clean()
    yield
    await _clean()


def _entries(async_session, *, commit_on_write: bool = True) -> MemoryEntryService:  # noqa: ANN001
    return MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
        animas=SQLAlchemyAnimaRepository(async_session),
        commit_on_write=commit_on_write,
    )


def _service(
    async_session,  # noqa: ANN001
    user_id: str,
    client: FakeAnthropicClient,
    *,
    role_row: ModelProvider | None = None,
    rows: tuple[ModelProvider, ...] = (),
    keys: dict[str, str] | None = None,
) -> tuple[MemoryManagerService, MemoryManagerRuntimeSelector]:
    """A request-scoped service on the Anthropic runtime, built the way the router builds it."""

    role_row = role_row or _haiku()
    memory_entries = _entries(async_session, commit_on_write=False)
    uow = SQLAlchemyUnitOfWork(async_session)
    episodes = SQLAlchemyMemoryEpisodeRepository(async_session)
    chat_messages = SQLAlchemyChatMessageRepository(async_session)
    model_providers = cast(ModelProviderRepository, _Rows(role_row, *rows))
    credentials = static_credential_resolver({"ANTHROPIC_API_KEY": SENTINEL_KEY} if keys is None else keys)
    selector = MemoryManagerRuntimeSelector(
        model_provider=role_row,
        model_providers=model_providers,
        openai_agents=lambda row: OpenAIAgentsMemoryManagerRuntime(
            user_id=user_id,
            memory_entries=memory_entries,
            model_provider=row,
            model_providers=model_providers,
            credential_resolver=credentials,
            timeout_seconds=1.0,
        ),
        anthropic=lambda row: AnthropicMemoryManagerRuntime(
            user_id=user_id,
            memory_entries=memory_entries,
            memory_episodes=episodes,
            animas=SQLAlchemyAnimaRepository(async_session),
            chat_messages=chat_messages,
            model_provider=row,
            model_providers=model_providers,
            credential_resolver=credentials,
            timeout_seconds=30.0,
            client_factory=FakeClientFactory(client),
        ),
    )
    service = MemoryManagerService(
        memory_manager=SQLAlchemyMemoryManagerRepository(async_session),
        memory_entries=memory_entries,
        memory_episodes=MemoryEpisodeService(
            memory_episodes=episodes, memory_entries=memory_entries, uow=uow, commit_on_write=False
        ),
        chat_messages=chat_messages,
        anima_reflections=SQLAlchemyAnimaMemoryReflectionRepository(async_session),
        runtime=selector,
        uow=uow,
    )
    return service, selector


async def _seed_profile(async_session, user_id: str) -> None:  # noqa: ANN001
    await _entries(async_session).put_file_by_path(
        user_id=user_id, path="PROFILE.md", content=PROFILE, kind="user_memory", description="Who the user is"
    )


async def _profile(async_session, user_id: str):  # noqa: ANN001, ANN202
    return await _entries(async_session).get_entry_by_path(user_id=user_id, path="PROFILE.md")


def _call(call_id: str, tool_input: dict[str, Any], *, thinking: str = "") -> list[dict[str, Any]]:
    """One response that thinks, then calls a tool."""

    return message_events(
        thinking_block(thinking, signature=f"{THINKING_SIGNATURE}{call_id}"),
        tool_use_block(call_id, "memory" if "command" in tool_input else "search_memory_files", tool_input),
        message_id=f"msg_{call_id}",
        stop_reason="tool_use",
    )


def _final(text: str = "Updated your profile: you now prefer tea in the morning.") -> list[dict[str, Any]]:
    return message_events(thinking_block(), text_block(text), message_id="msg_final")


REPLACE_COFFEE = {
    "command": "str_replace",
    "path": "/memories/PROFILE.md",
    "old_str": "Prefers coffee in the morning.",
    "new_str": "Prefers tea in the morning.",
}


def _proposal_script() -> list[Any]:
    return [
        _call("toolu_view_root", {"command": "view", "path": "/memories"}),
        _call("toolu_view_profile", {"command": "view", "path": "/memories/PROFILE.md"}),
        _call("toolu_edit", REPLACE_COFFEE, thinking="The user switched to tea."),
    ]


async def _start(async_session, user_id: str, client: FakeAnthropicClient, **options: Any):  # noqa: ANN001, ANN202
    service, _selector = _service(async_session, user_id, client)
    return await service.create_run(
        user_id=user_id,
        initial_message="I drink tea in the morning now, not coffee. Please update my memory.",
        **options,
    )


def _tool_result(request: dict[str, Any]) -> dict[str, Any]:
    last = request["messages"][-1]
    assert last["role"] == "user"
    [result] = last["content"]
    assert result["type"] == "tool_result"
    return cast(dict[str, Any], result)


# ------------------------------------------------------------------ start


async def test_a_memory_edit_becomes_an_approval_and_pauses_the_run(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    client = FakeAnthropicClient(_proposal_script())

    snapshot = await _start(async_session, user_id, client)

    assert snapshot.run.status == "waiting_approval"
    assert snapshot.run.model_provider == ANTHROPIC
    assert snapshot.run.model_name == "claude-haiku-5-5"
    assert snapshot.run.model_provider_id == HAIKU_ID
    [approval] = snapshot.approvals
    assert approval.status == "pending"
    assert approval.operation == "update"
    assert approval.target_path == "PROFILE.md"
    assert approval.expected_version == 1
    assert approval.new_content == PROFILE.replace("coffee", "tea")
    assert "+- Prefers tea in the morning." in approval.unified_diff
    assert approval.operation_metadata is not None
    assert approval.operation_metadata["sdk_call_id"] == "toolu_edit"
    assert approval.operation_metadata["memory_command"] == "str_replace"
    assert snapshot.messages[-1].content == "I prepared a memory file preview. Review the diff before approving it."
    # Nothing is written until the owner approves.
    assert (await _profile(async_session, user_id)).content == PROFILE

    # The reads ran immediately and were answered in order.
    assert len(client.requests) == 3
    assert _tool_result(client.requests[1])["tool_use_id"] == "toolu_view_root"
    root_listing = _tool_result(client.requests[1])["content"]
    assert root_listing.startswith("Here're the files and directories up to 2 levels deep in /memories")
    profile_view = _tool_result(client.requests[2])["content"]
    assert profile_view.startswith("Here's the content of /memories/PROFILE.md with line numbers:")

    run = await SQLAlchemyMemoryManagerRepository(async_session).get_run(user_id=user_id, run_id=snapshot.run.id)
    assert run is not None and run.serialized_agent_state is not None
    state = json.loads(run.serialized_agent_state)
    assert set(state) == {"schema", "system", "messages", "pending_tool_use_id", "turns_used"}
    assert state["schema"] == 1
    assert state["pending_tool_use_id"] == "toolu_edit"
    assert state["turns_used"] == 3
    assert state["messages"][-1]["role"] == "assistant"
    assert state["messages"][-1]["content"][0] == {
        "type": "thinking",
        "thinking": "The user switched to tea.",
        "signature": f"{THINKING_SIGNATURE}toolu_edit",
    }


async def test_requests_use_the_memory_tool_medium_effort_and_no_compaction(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    client = FakeAnthropicClient(_proposal_script())

    await _start(async_session, user_id, client)

    params = client.requests[0]
    assert params["model"] == "claude-haiku-5-5"
    assert params["max_tokens"] == 64_000
    assert params["tools"][0] == MEMORY_TOOL
    assert [tool["name"] for tool in params["tools"]] == ["memory", "search_memory_files"]
    search = params["tools"][1]
    assert search["strict"] is True
    assert search["input_schema"]["additionalProperties"] is False
    assert params["tool_choice"] == {"type": "auto"}
    assert params["output_config"] == {"effort": "medium"}  # D16: Memory Manager default
    assert "thinking" not in params  # adaptive
    assert "context_management" not in params and "betas" not in params
    assert not {"temperature", "top_p", "top_k"} & set(params)
    assert params["cache_control"] == {"type": "ephemeral"}
    [system] = params["system"]
    assert system["cache_control"] == {"type": "ephemeral"}
    instructions = system["text"]
    assert "Never create or change a file to record your own progress" in instructions
    assert "Files can be neither deleted nor renamed" in instructions
    assert "When a new fact replaces an older one, also correct or remove the outdated statement" in instructions
    assert "# List of memory files" in instructions
    assert "  - path: /memories/PROFILE.md" in instructions
    assert params["messages"] == [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "I drink tea in the morning now, not coffee. Please update my memory."}
            ],
        }
    ]
    # Every request in the step keeps the same system prompt and tools, so thinking stays valid.
    assert all(request["system"] == params["system"] for request in client.requests)
    assert all(request["tools"] == params["tools"] for request in client.requests)


async def test_without_medium_on_the_row_no_effort_is_sent(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    client = FakeAnthropicClient([_final("Nothing to change.")])
    service, _selector = _service(async_session, user_id, client, role_row=_haiku(efforts=["low", "high"]))

    await service.create_run(user_id=user_id, initial_message="Anything to tidy?")

    assert "output_config" not in client.requests[0]


# ---------------------------------------------------------------- resume


async def test_approval_after_a_restart_commits_then_resumes_with_byte_exact_thinking(
    async_session, clean_rows
) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    first_client = FakeAnthropicClient(_proposal_script())
    snapshot = await _start(async_session, user_id, first_client)
    stored = await SQLAlchemyMemoryManagerRepository(async_session).get_run(user_id=user_id, run_id=snapshot.run.id)
    assert stored is not None and stored.serialized_agent_state is not None
    paused = AnthropicManagerState.from_json(stored.serialized_agent_state)

    # A fresh request (as after a backend restart) rebuilds everything from the database.
    resumed_client = FakeAnthropicClient([_final()])
    service, _selector = _service(async_session, user_id, resumed_client)
    decided = await service.decide_approval(user_id=user_id, approval_id=snapshot.approvals[0].id, decision="approve")

    assert decided.status == "approved"
    assert decided.applied_version == 2
    profile = await _profile(async_session, user_id)
    assert profile.content == PROFILE.replace("coffee", "tea")
    assert profile.version == 2
    [request] = resumed_client.requests
    # The stored conversation is resent unchanged, signed thinking included, then the tool result.
    assert request["messages"][:-1] == paused.messages
    assert request["system"] == first_client.requests[0]["system"]
    assistant_blocks = [block for message in request["messages"] for block in message["content"]]
    assert [block["signature"] for block in assistant_blocks if block["type"] == "thinking"] == [
        f"{THINKING_SIGNATURE}toolu_view_root",
        f"{THINKING_SIGNATURE}toolu_view_profile",
        f"{THINKING_SIGNATURE}toolu_edit",
    ]
    result = _tool_result(request)
    assert result["tool_use_id"] == "toolu_edit"
    assert "is_error" not in result
    assert result["content"].startswith("The memory file has been edited. Here is the snippet")
    assert "- Prefers tea in the morning." in result["content"]

    final = await service.get_run_snapshot(user_id=user_id, run_id=snapshot.run.id)
    assert final.run.status == "active"
    assert final.messages[-1].content == "Updated your profile: you now prefer tea in the morning."
    run = await SQLAlchemyMemoryManagerRepository(async_session).get_run(user_id=user_id, run_id=snapshot.run.id)
    assert run is not None and run.serialized_agent_state is None
    assert (final.run.usage_metadata or {})["requests"] == 4


async def test_a_rejection_resumes_with_the_feedback_and_changes_nothing(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    snapshot = await _start(async_session, user_id, FakeAnthropicClient(_proposal_script()))
    client = FakeAnthropicClient([_final("Understood, I left your profile unchanged.")])
    service, _selector = _service(async_session, user_id, client)

    decided = await service.decide_approval(
        user_id=user_id,
        approval_id=snapshot.approvals[0].id,
        decision="reject",
        feedback="Keep coffee; I only drink tea on weekends.",
    )

    assert decided.status == "rejected"
    assert (await _profile(async_session, user_id)).content == PROFILE
    result = _tool_result(client.requests[0])
    assert result == {
        "type": "tool_result",
        "tool_use_id": "toolu_edit",
        "content": "The user rejected the proposed change to `/memories/PROFILE.md`. "
        "User feedback: Keep coffee; I only drink tea on weekends.",
        "is_error": True,
    }
    final = await service.get_run_snapshot(user_id=user_id, run_id=snapshot.run.id)
    assert final.run.status == "active"
    assert final.messages[-1].content == "Understood, I left your profile unchanged."


async def test_a_stale_version_conflicts_and_keeps_the_approval_pending(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    snapshot = await _start(async_session, user_id, FakeAnthropicClient(_proposal_script()))
    profile = await _profile(async_session, user_id)
    await _entries(async_session).patch_entry(
        user_id=user_id,
        entry_id=profile.id,
        expected_version=1,
        content="# Profile\n\nExternal edit.\n",
        content_set=True,
    )
    client = FakeAnthropicClient([_final()])
    service, _selector = _service(async_session, user_id, client)

    with pytest.raises(MemoryManagerConflictError):
        await service.decide_approval(user_id=user_id, approval_id=snapshot.approvals[0].id, decision="approve")

    after = await service.get_run_snapshot(user_id=user_id, run_id=snapshot.run.id)
    assert after.run.status == "waiting_approval"
    assert [approval.status for approval in after.approvals] == ["pending"]
    assert (await _profile(async_session, user_id)).content == "# Profile\n\nExternal edit.\n"
    assert client.requests == []


async def test_a_resume_with_a_mismatched_pending_call_is_blocked(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    snapshot = await _start(async_session, user_id, FakeAnthropicClient(_proposal_script()))
    runtime = AnthropicMemoryManagerRuntime(
        user_id=user_id,
        memory_entries=_entries(async_session),
        model_provider=_haiku(),
        credential_resolver=static_credential_resolver({"ANTHROPIC_API_KEY": SENTINEL_KEY}),
        timeout_seconds=1.0,
        client_factory=FakeClientFactory(FakeAnthropicClient([])),
    )
    run = await SQLAlchemyMemoryManagerRepository(async_session).get_run(user_id=user_id, run_id=snapshot.run.id)
    assert run is not None
    approval = snapshot.approvals[0]
    other = replace(approval, operation_metadata={"sdk_call_id": "toolu_other"})

    mismatched = await runtime.resume_approval_decision(run=run, approval=other, decision="approve")
    missing = await runtime.resume_approval_decision(
        run=MemoryManagerRun(id=run.id, user_id=user_id, status="waiting_approval"),
        approval=approval,
        decision="approve",
    )

    assert mismatched.outcome == "blocked" and "interruption is missing" in (mismatched.error or "")
    assert missing.outcome == "blocked" and "state is missing" in (missing.error or "")


def _response(*blocks: dict[str, Any], signature: str = "parallel") -> list[dict[str, Any]]:
    """One response that thinks, then makes several tool calls in parallel."""

    return message_events(
        thinking_block("Several calls at once.", signature=f"{THINKING_SIGNATURE}{signature}"),
        *blocks,
        message_id=f"msg_{signature}",
        stop_reason="tool_use",
    )


async def _paused_state(async_session, user_id: str, run_id: str) -> AnthropicManagerState:  # noqa: ANN001
    run = await SQLAlchemyMemoryManagerRepository(async_session).get_run(user_id=user_id, run_id=run_id)
    assert run is not None and run.serialized_agent_state is not None
    return AnthropicManagerState.from_json(run.serialized_agent_state)


async def test_parallel_reads_are_answered_and_the_edit_resumes_in_call_order(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    await _entries(async_session).put_file_by_path(
        user_id=user_id,
        path="notes/preferences.md",
        content="# Preferences\n\n- Quiet music while working.\n",
        kind="user_memory",
        description="Everyday preferences",
        create_parents=True,
    )
    client = FakeAnthropicClient(
        [
            _response(
                tool_use_block("toolu_view_profile", "memory", {"command": "view", "path": "/memories/PROFILE.md"}),
                tool_use_block("toolu_edit", "memory", REPLACE_COFFEE),
                tool_use_block(
                    "toolu_view_prefs", "memory", {"command": "view", "path": "/memories/notes/preferences.md"}
                ),
            )
        ]
    )

    snapshot = await _start(async_session, user_id, client)

    assert client.requests[0]["tool_choice"] == {"type": "auto"}
    assert snapshot.run.status == "waiting_approval"
    [approval] = snapshot.approvals
    assert approval.operation_metadata is not None and approval.operation_metadata["sdk_call_id"] == "toolu_edit"
    paused = await _paused_state(async_session, user_id, snapshot.run.id)
    assert paused.pending_tool_use_id == "toolu_edit"
    assert paused.turns_used == 1
    # Both reads were answered at once; the edit's result waits for the owner.
    assert [block["tool_use_id"] for block in paused.messages[-1]["content"]] == [
        "toolu_view_profile",
        "toolu_view_prefs",
    ]

    resumed = FakeAnthropicClient([_final()])
    service, _selector = _service(async_session, user_id, resumed)
    await service.decide_approval(user_id=user_id, approval_id=approval.id, decision="approve")

    [request] = resumed.requests
    # Everything the API has seen is resent unchanged, signed thinking included.
    assert request["messages"][:-1] == paused.messages[:-1]
    assert request["messages"][-2]["content"][0]["signature"] == f"{THINKING_SIGNATURE}parallel"
    results = request["messages"][-1]["content"]
    assert [result["tool_use_id"] for result in results] == ["toolu_view_profile", "toolu_edit", "toolu_view_prefs"]
    assert results[0]["content"].startswith("Here's the content of /memories/PROFILE.md with line numbers:")
    assert results[1]["content"].startswith("The memory file has been edited.")
    assert "is_error" not in results[1]
    assert results[2]["content"].startswith("Here's the content of /memories/notes/preferences.md")
    assert (await _profile(async_session, user_id)).content == PROFILE.replace("coffee", "tea")
    final = await service.get_run_snapshot(user_id=user_id, run_id=snapshot.run.id)
    assert final.run.status == "active"


async def test_a_second_edit_in_one_response_is_refused_until_the_first_is_decided(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    second = {"command": "insert", "path": "/memories/PROFILE.md", "insert_line": 7, "insert_text": "- Has a cat."}
    client = FakeAnthropicClient(
        [
            _response(
                tool_use_block("toolu_first", "memory", REPLACE_COFFEE),
                tool_use_block("toolu_second", "memory", second),
            )
        ]
    )

    snapshot = await _start(async_session, user_id, client)

    [approval] = snapshot.approvals
    assert approval.operation_metadata is not None and approval.operation_metadata["sdk_call_id"] == "toolu_first"
    paused = await _paused_state(async_session, user_id, snapshot.run.id)
    [refused] = paused.messages[-1]["content"]
    assert refused["tool_use_id"] == "toolu_second"
    assert refused["is_error"] is True
    assert "one memory change at a time" in refused["content"]

    resumed = FakeAnthropicClient([_final("Updated the drink; I will add the cat next.")])
    service, _selector = _service(async_session, user_id, resumed)
    await service.decide_approval(user_id=user_id, approval_id=approval.id, decision="approve")

    results = resumed.requests[0]["messages"][-1]["content"]
    assert [result["tool_use_id"] for result in results] == ["toolu_first", "toolu_second"]
    assert results[0]["content"].startswith("The memory file has been edited.") and "is_error" not in results[0]
    assert results[1] == refused
    profile = await _profile(async_session, user_id)
    assert profile.content == PROFILE.replace("coffee", "tea")
    assert "cat" not in (profile.content or "")


async def test_an_approved_anthropic_change_can_be_undone(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    snapshot = await _start(async_session, user_id, FakeAnthropicClient(_proposal_script()))
    service, _selector = _service(async_session, user_id, FakeAnthropicClient([_final()]))
    approved = await service.decide_approval(user_id=user_id, approval_id=snapshot.approvals[0].id, decision="approve")
    assert approved.can_undo is True

    undone = await service.undo_approval(user_id=user_id, approval_id=approved.id)

    assert undone.deleted is False
    assert undone.undo_version == 3
    profile = await _profile(async_session, user_id)
    assert profile.content == PROFILE
    assert profile.description == "Who the user is"


async def test_an_episode_batch_is_curated_through_the_memory_tool_and_processed(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    entries = _entries(async_session)
    episodes = MemoryEpisodeService(
        memory_episodes=SQLAlchemyMemoryEpisodeRepository(async_session),
        memory_entries=entries,
        uow=SQLAlchemyUnitOfWork(async_session),
    )
    episode = await episodes.create_episode_item(
        user_id=user_id,
        text="The user switched from coffee to tea in the mornings.",
        occurred_at=datetime(2026, 9, 1, 8, 0, tzinfo=UTC),
        local_date=date(2026, 9, 1),
    )
    client = FakeAnthropicClient(
        [
            _call("toolu_root", {"command": "view", "path": "/memories"}),
            _call("toolu_edit", REPLACE_COFFEE),
            _final("Reviewed E01: recorded the switch to tea."),
        ]
    )
    service, _selector = _service(async_session, user_id, client)

    started = await service.create_episode_processing_run(user_id=user_id)

    system = client.requests[0]["system"][0]["text"]
    assert "# Episodic memory processing mode" in system
    assert "Use the memory tool's create, str_replace or insert commands" in system
    assert "apply_patch" not in system
    assert "The user switched from coffee to tea in the mornings." in system
    # The listing leaves the generated episode log out.
    assert "/memories/episodes" not in _tool_result(client.requests[1])["content"]
    [approval] = started.approvals
    assert approval.target_path == "PROFILE.md"
    assert [item.status for item in await episodes.list_episode_items(user_id=user_id)] == ["pending"]

    await service.decide_approval(user_id=user_id, approval_id=approval.id, decision="approve")

    done = await service.get_run_snapshot(user_id=user_id, run_id=started.run.id)
    assert done.run.status == "active"
    assert done.run.task_state is not None and done.run.task_state["status"] == "processed"
    processed = await episodes.list_episode_items(user_id=user_id, status="processed")
    assert [item.id for item in processed] == [episode.id]


# ------------------------------------------------------------- automatic


def _insert(call_id: str, line: int, text: str) -> list[dict[str, Any]]:
    return _call(
        call_id, {"command": "insert", "path": "/memories/PROFILE.md", "insert_line": line, "insert_text": text}
    )


async def test_automatic_mode_applies_a_chain_of_changes_and_completes(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    client = FakeAnthropicClient(
        [
            _call("toolu_a", REPLACE_COFFEE),
            _insert("toolu_b", 7, "- Has a cat named Miso."),
            _insert("toolu_c", 8, "- Learning Japanese."),
            _final("Recorded three updates."),
        ]
    )

    snapshot = await _start(async_session, user_id, client, auto_approve_diffs=True)

    assert snapshot.run.status == "active"
    assert [approval.status for approval in snapshot.approvals] == ["approved"] * 3
    assert [approval.applied_version for approval in snapshot.approvals] == [2, 3, 4]
    assert (await _profile(async_session, user_id)).content == (
        PROFILE.replace("coffee", "tea") + "- Has a cat named Miso.\n- Learning Japanese.\n"
    )
    assert snapshot.messages[-1].content == "Recorded three updates."
    assert [_tool_result(request)["tool_use_id"] for request in client.requests[1:]] == [
        "toolu_a",
        "toolu_b",
        "toolu_c",
    ]


async def test_automatic_mode_applies_eight_changes_with_a_fresh_budget_per_resume(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    client = FakeAnthropicClient(
        [
            *(_insert(f"toolu_{index}", 7 + index, f"- Fact {index}.") for index in range(8)),
            _final("Added eight facts."),
        ]
    )

    snapshot = await _start(async_session, user_id, client, auto_approve_diffs=True)

    # Eight proposing steps and the final reply: each approval resume gets the full budget (D24).
    assert [approval.status for approval in snapshot.approvals] == ["approved"] * 8
    assert (await _profile(async_session, user_id)).content == PROFILE + "".join(
        f"- Fact {index}.\n" for index in range(8)
    )
    assert len(client.requests) == 9
    assert snapshot.run.status == "active"
    assert snapshot.messages[-1].content == "Added eight facts."


async def test_a_single_step_past_the_turn_budget_is_blocked(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    client = FakeAnthropicClient(
        [_call(f"toolu_view_{index}", {"command": "view", "path": "/memories/PROFILE.md"}) for index in range(9)]
    )

    snapshot = await _start(async_session, user_id, client)

    assert len(client.requests) == 8
    assert snapshot.approvals == []
    assert snapshot.run.status == "failed"
    assert snapshot.run.error == "The Memory Manager reached its turn limit before completing the review."


# --------------------------------------------------------------- failures


async def test_a_refusal_fails_the_run_and_leaves_memory_unchanged(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    client = FakeAnthropicClient(
        [
            _call("toolu_view_root", {"command": "view", "path": "/memories"}),
            message_events(
                thinking_block(),
                stop_reason="refusal",
                stop_details={"type": "refusal", "category": "cyber", "explanation": "Declined."},
            ),
        ]
    )

    snapshot = await _start(async_session, user_id, client)

    assert snapshot.run.status == "failed"
    assert snapshot.approvals == []
    assert snapshot.run.error == "Claude declined to continue this memory review"
    assert snapshot.run.metadata["runtime_error_code"] == "model_refused"
    assert snapshot.run.metadata["error_category"] == "provider_error"
    assert snapshot.run.metadata["stop_details_category"] == "cyber"
    assert (await _profile(async_session, user_id)).content == PROFILE


async def test_an_api_error_fails_the_run_with_its_category_and_never_logs_the_key(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    client = FakeAnthropicClient(
        [status_error(401, error_type="authentication_error", message=f"invalid x-api-key {SENTINEL_KEY}")]
    )

    with captured_anima_log_records() as records:
        snapshot = await _start(async_session, user_id, client)

    assert snapshot.run.status == "failed"
    assert snapshot.run.error == "Anthropic rejected the API key"
    assert snapshot.run.metadata["runtime_error_code"] == "anthropic_authentication_error"
    assert snapshot.run.metadata["error_category"] == "credential_rejected"
    assert SENTINEL_KEY not in json.dumps(snapshot.run.metadata)
    assert all(
        SENTINEL_KEY not in record.getMessage() and SENTINEL_KEY not in str(record.__dict__) for record in records
    )
    assert (await _profile(async_session, user_id)).content == PROFILE


async def test_a_missing_anthropic_key_fails_clearly_without_a_request(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    client = FakeAnthropicClient([])
    service, _selector = _service(async_session, user_id, client, keys={"OPENAI_API_KEY": "sk-openai"})

    snapshot = await service.create_run(user_id=user_id, initial_message="Remember that I like tea.")

    assert snapshot.run.status == "failed"
    assert snapshot.run.error == "No key is configured for Anthropic."
    assert client.requests == []


async def test_a_resume_failure_records_the_runtime_that_ran(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    snapshot = await _start(async_session, user_id, FakeAnthropicClient(_proposal_script()))
    # The role has since moved to OpenAI; the approval resumes on the pinned Anthropic row, which fails.
    service, selector = _service(
        async_session,
        user_id,
        FakeAnthropicClient([RuntimeError("transport broke")]),
        role_row=_openai_row(),
        rows=(_haiku(),),
        keys={"ANTHROPIC_API_KEY": SENTINEL_KEY, "OPENAI_API_KEY": "sk-openai"},
    )
    assert selector.name == "openai_agents"

    await service.decide_approval(user_id=user_id, approval_id=snapshot.approvals[0].id, decision="approve")

    after = await service.get_run_snapshot(user_id=user_id, run_id=snapshot.run.id)
    assert after.run.status == "failed"
    assert after.run.error == "The Memory Manager runtime failed."
    assert (after.run.metadata or {})["runtime"] == "anthropic_messages"
    assert (after.messages[-1].metadata or {})["runtime"] == "anthropic_messages"


# ---------------------------------------------------------------- scope


async def test_delete_and_rename_requests_come_back_as_tool_errors(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    await _seed_profile(async_session, user_id)
    client = FakeAnthropicClient(
        [
            _call("toolu_delete", {"command": "delete", "path": "/memories/PROFILE.md"}),
            _final("I can't delete files; you can remove PROFILE.md on the Memories page."),
        ]
    )

    snapshot = await _start(async_session, user_id, client)

    result = _tool_result(client.requests[1])
    assert result["is_error"] is True and "cannot delete memory files" in result["content"]
    assert snapshot.run.status == "active" and snapshot.approvals == []
    assert (await _profile(async_session, user_id)).content == PROFILE


async def test_a_reflection_reads_its_turns_and_its_approved_change_covers_them(async_session, clean_rows) -> None:
    user_id = f"user-{uuid.uuid4()}"
    anima_id, memories_id = await _anima(async_session, user_id=user_id)
    chat_id = await _chat(async_session, user_id=user_id, anima_id=anima_id)
    await _add_turns(async_session, chat_id, ["We planned a picnic for Saturday."], start=_START)
    memories = await _entries(async_session).get_entry(user_id=user_id, entry_id=memories_id)
    memories_path = f"/memories/animas/{anima_id}/MEMORIES.md"
    lines = (memories.content or "").count("\n") + 3
    client = FakeAnthropicClient(
        [
            _call("toolu_view", {"command": "view", "path": memories_path}),
            message_events(
                thinking_block(signature=f"{THINKING_SIGNATURE}turns"),
                tool_use_block("toolu_turns", "read_reflection_turns", {"page": 1}),
                stop_reason="tool_use",
            ),
            _call(
                "toolu_reflect",
                {
                    "command": "insert",
                    "path": memories_path,
                    "insert_line": lines,
                    "insert_text": "- We planned a picnic.",
                },
            ),
            _final("I added our picnic plan."),
        ]
    )
    service, _selector = _service(async_session, user_id, client)

    started = await service.create_reflection_run(user_id=user_id, anima_id=anima_id)

    assert [tool["name"] for tool in client.requests[0]["tools"]] == [
        "memory",
        "search_memory_files",
        "read_reflection_turns",
    ]
    system = client.requests[0]["system"][0]["text"]
    assert "# Reflection mode" in system
    assert f"view `{memories_path}` with the memory tool" in system
    turns = json.loads(_tool_result(client.requests[2])["content"])
    assert turns["turns"][0]["user"] == "We planned a picnic for Saturday."
    [approval] = started.approvals
    assert approval.target_path == f"animas/{anima_id}/MEMORIES.md"

    await service.decide_approval(user_id=user_id, approval_id=approval.id, decision="approve")

    coverage = await SQLAlchemyAnimaMemoryReflectionRepository(async_session).get(user_id=user_id, anima_id=anima_id)
    assert coverage is not None and coverage.run_id == started.run.id
    updated = await _entries(async_session).get_entry(user_id=user_id, entry_id=memories_id)
    assert "- We planned a picnic." in (updated.content or "")


# -------------------------------------------------------------- selector


def _selector_for(
    async_session,  # noqa: ANN001
    user_id: str,
    role_row: ModelProvider,
    *rows: ModelProvider,
    keys: dict[str, str] | None = None,
) -> MemoryManagerRuntimeSelector:
    _unused, selector = _service(
        async_session, user_id, FakeAnthropicClient([]), role_row=role_row, rows=rows, keys=keys
    )
    return selector


def _pinned(user_id: str, row_id: str | None) -> MemoryManagerRun:
    return MemoryManagerRun(
        id=new_memory_manager_run_id(), user_id=user_id, status="waiting_approval", model_provider_id=row_id
    )


async def test_the_selector_runs_new_messages_on_the_role_rows_runtime(async_session) -> None:
    user_id = f"user-{uuid.uuid4()}"

    anthropic = _selector_for(async_session, user_id, _haiku())
    openai = _selector_for(async_session, user_id, _openai_row())

    assert isinstance(anthropic.role_runtime, AnthropicMemoryManagerRuntime)
    assert anthropic.name == "anthropic_messages"
    assert anthropic.model_provider_id == HAIKU_ID
    assert isinstance(openai.role_runtime, OpenAIAgentsMemoryManagerRuntime)
    assert openai.name == "openai_agents"


async def test_approvals_resume_on_the_runtime_of_the_pinned_row(async_session) -> None:
    user_id = f"user-{uuid.uuid4()}"
    sonnet = _haiku("claude-sonnet-5-5")
    keys = {"ANTHROPIC_API_KEY": SENTINEL_KEY, "OPENAI_API_KEY": "sk-openai"}

    # The role moved to OpenAI after an Anthropic row proposed the change, and back.
    on_openai_role = _selector_for(async_session, user_id, _openai_row(), _haiku(), keys=keys)
    on_anthropic_role = _selector_for(async_session, user_id, _haiku(), _openai_row(), sonnet, keys=keys)

    resumed_on_anthropic = await on_openai_role.for_run(_pinned(user_id, HAIKU_ID))
    resumed_on_openai = await on_anthropic_role.for_run(_pinned(user_id, _openai_row().id))
    resumed_on_other_claude = await on_anthropic_role.for_run(_pinned(user_id, sonnet.id))
    unpinned = await on_anthropic_role.for_run(_pinned(user_id, None))

    assert isinstance(resumed_on_anthropic, AnthropicMemoryManagerRuntime)
    assert resumed_on_anthropic.model_provider_id == HAIKU_ID
    assert isinstance(resumed_on_openai, OpenAIAgentsMemoryManagerRuntime)
    assert resumed_on_openai.model_provider_id == _openai_row().id
    assert isinstance(resumed_on_other_claude, AnthropicMemoryManagerRuntime)
    assert resumed_on_other_claude.model_provider_id == sonnet.id
    assert unpinned is on_anthropic_role.role_runtime


async def test_a_pinned_anthropic_row_without_a_key_or_removed_is_unavailable(async_session) -> None:
    user_id = f"user-{uuid.uuid4()}"
    selector = _selector_for(async_session, user_id, _openai_row(), _haiku(), keys={"OPENAI_API_KEY": "sk-openai"})

    for row_id in (HAIKU_ID, f"{ANTHROPIC}:removed"):
        with pytest.raises(MemoryManagerPinnedModelUnavailableError):
            await selector.for_run(_pinned(user_id, row_id))


async def test_the_openai_runtime_refuses_anthropic_rows(async_session) -> None:
    user_id = f"user-{uuid.uuid4()}"
    runtime = OpenAIAgentsMemoryManagerRuntime(
        user_id=user_id,
        memory_entries=_entries(async_session),
        model_provider=_openai_row(),
        model_providers=cast(ModelProviderRepository, _Rows(_openai_row(), _haiku())),
        credential_resolver=static_credential_resolver({"ANTHROPIC_API_KEY": SENTINEL_KEY, "OPENAI_API_KEY": "x"}),
        timeout_seconds=1.0,
    )

    with pytest.raises(MemoryManagerPinnedModelUnavailableError):
        await runtime.for_run(_pinned(user_id, HAIKU_ID))
