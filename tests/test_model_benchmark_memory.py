"""The model benchmark's memory runs on a disposable benchmark database (scripts/evals/benchmark, spec R6).

The model is a fake: on the first turn it writes PROFILE.md (and calls a tool
chat never offers), then patches MEMORIES.md, then replies with a `remember`
note; it answers the recall probe.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.app.model_clients import (
    ModelClientDelta,
    ModelClientFinal,
    ModelClientRequest,
    ModelClientToolCall,
    StaticModelClientRegistry,
)
from animama.app.model_clients.credentials import static_credential_resolver
from animama.domain.usage import Usage
from animama.server.config import Settings
from scripts.evals.benchmark import cli, configs, manager_runner, memory_db, planner, prompt_set, runner
from scripts.evals.benchmark.memory_runner import (
    ARM_BOTH,
    ARM_MEMORIES_MD_ONLY,
    ARM_REMEMBER_ONLY,
    BenchmarkSessions,
    Store,
    memory_changes,
)
from scripts.evals.core.inputs import EvalInputError
from scripts.evals.core.model_calls import CallBudget
from tests.anthropic_fakes import SENTINEL_KEY, FakeAnthropicClient, message_events, text_block, tool_use_block

MEMORY_PROMPTS = Path(__file__).parent / "fixtures" / "model_benchmark" / "memory_prompts.json"
FIRST_TURN = "Big news: I'm moving to Kyoto next month!"
_PRICE = "input=0.10,cached_input=0.01,cache_write=0.125,output=0.50"


def _latest_user_text(request: ModelClientRequest) -> str:
    for message in reversed(request.prompt.messages):
        if message.get("role") == "user" and isinstance(message.get("content"), str):
            return str(message["content"])
    return ""


def _final(payload: dict[str, Any], *, tool_calls: tuple[ModelClientToolCall, ...] = ()) -> ModelClientFinal:
    return ModelClientFinal(
        text=json.dumps(payload) if payload else "",
        usage=Usage(requests=1, input_tokens=500, output_tokens=40, total_tokens=540),
        usage_reported=True,
        tool_calls=tool_calls,
    )


def _reply(speech: str, remember: str | None = None) -> dict[str, Any]:
    return {
        "emotional_tone": "happy",
        "emotional_intensity": 5,
        "gesture": "wave",
        "speech": speech,
        "display": None,
        "remember": remember,
    }


class _MemoryClient:
    """On the first turn: write PROFILE.md and call an unknown tool, then patch MEMORIES.md, then reply."""

    def __init__(self) -> None:
        self.requests: list[ModelClientRequest] = []

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        self.requests.append(request)
        sent = json.dumps(request.prompt.messages, default=str)
        user = _latest_user_text(request)
        if user == FIRST_TURN and "call-memories" not in sent.split(FIRST_TURN)[-1]:
            if "call-profile" not in sent.split(FIRST_TURN)[-1]:
                calls: tuple[ModelClientToolCall, ...] = (
                    ModelClientToolCall(
                        id="call-profile",
                        name="memory_write_file",
                        arguments=json.dumps(
                            {
                                "path": "PROFILE.md",
                                "mode": "replace",
                                "content": "# Profile\n\n- Likes tea.\n- Moving to Kyoto next month.\n",
                                "description": "The user's durable facts",
                            }
                        ),
                    ),
                    # Chat rejects a tool it did not offer; the rejection is still a recorded call.
                    ModelClientToolCall(id="call-search", name="web_search", arguments="{}"),
                )
            else:
                calls = (
                    ModelClientToolCall(
                        id="call-memories",
                        name="memory_apply_patch",
                        arguments=json.dumps(
                            {
                                "path": "[self]/MEMORIES.md",
                                "replacements": [
                                    {
                                        "old_text": "- We met on a rainy Tuesday.",
                                        "new_text": "- We met on a rainy Tuesday.\n- They told me about Kyoto.",
                                        "replace_all": False,
                                    }
                                ],
                                "update_description": False,
                                "description": None,
                            }
                        ),
                    ),
                )
            final = _final({}, tool_calls=calls)
        elif user == FIRST_TURN:
            final = _final(_reply("Kyoto, wow! Congratulations.", "The user is moving to Kyoto next month."))
        elif "moving" in user:
            final = _final(_reply("You're moving to Kyoto!"))
        else:
            final = _final(_reply("I'm doing well, thanks!"))
        if final.text:
            yield ModelClientDelta(kind="text_delta", text=final.text)
        yield ModelClientDelta(kind="final", final=final)
        yield ModelClientDelta(kind="done")

    async def aclose(self) -> None:
        return None


async def _database_exists(application_url: str, name: str) -> bool:
    engine = create_async_engine(
        memory_db._admin_url(application_url), poolclass=NullPool, isolation_level="AUTOCOMMIT"
    )
    try:
        async with engine.connect() as connection:
            found = await connection.execute(text("SELECT 1 FROM pg_database WHERE datname = :name"), {"name": name})
            return found.scalar_one_or_none() is not None
    finally:
        await engine.dispose()


def test_memory_changes_diff_the_stored_files_line_by_line() -> None:
    def snapshot(**files: str) -> dict[str, Any]:
        return {"files": [{"path": path.replace("_", "."), "anima": path == "MEMORIES_md", "content": text}
                          for path, text in files.items()]}  # fmt: skip

    before = snapshot(MEMORIES_md="# Memories\n---\n- We met.\n", PROFILE_md="# Profile")
    after = snapshot(MEMORIES_md="# Memories\n- We met.", NOTES_md="- Kyoto")

    assert memory_changes(before, after) == [
        {"path": "NOTES.md", "diff": "@@ -0,0 +1 @@\n+- Kyoto", "created": True},
        {"path": "PROFILE.md", "diff": "@@ -1 +0,0 @@\n-# Profile", "deleted": True},
        # A removed Markdown divider stays in the diff; the trailing newline alone is no change.
        {"path": "[self]/MEMORIES.md", "diff": "@@ -2 +1,0 @@\n----"},
    ]


def test_benchmark_database_names_are_fresh_and_guarded() -> None:
    now = datetime(2026, 10, 25, 21, 0, tzinfo=UTC)
    first = memory_db.benchmark_database_name("2026-10-25 standard run, the long label", now=now)

    assert re.fullmatch(r"animama_benchmark_2026_10_25_stand_20261025t210000_[0-9a-f]{6}", first), first
    assert memory_db.benchmark_database_name("2026-10-25 standard run, the long label", now=now) != first
    with pytest.raises(EvalInputError, match="Refusing database"):
        memory_db._require_benchmark_name("animama")


_APPLICATION_TABLES = (
    "anima",
    "chats",
    "chat_messages",
    "memory_entries",
    "memory_episode_items",
    "memory_manager_runs",
    "memory_manager_approvals",
)


async def _row_counts(database_url: str) -> dict[str, int]:
    engine = create_async_engine(database_url, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            return {
                table: (await connection.execute(text(f"SELECT count(*) FROM {table}"))).scalar_one()
                for table in _APPLICATION_TABLES
            }
    finally:
        await engine.dispose()


def _no_application_engine() -> None:
    raise AssertionError("memory work must not open the application database")


async def test_memory_chats_run_every_arm_on_a_database_that_is_dropped_afterwards(
    db_ready: str, db_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Memory Manager runs use chat's deterministic runtime, as the app does under ANIMAMA_LLM_SKIP.
    monkeypatch.setenv("ANIMAMA_LLM_SKIP", "1")
    name = memory_db.benchmark_database_name("test")
    prompts = prompt_set.load_prompt_set(MEMORY_PROMPTS)
    haiku = next(c for c in configs.standard_configurations(configs.builtin_chat_rows()) if "haiku" in c.label)
    client = _MemoryClient()
    turns: list[dict[str, Any]] = []
    before = await _row_counts(db_url)

    async with memory_db.benchmark_database(db_url, name) as factory:
        assert await _database_exists(db_url, name)
        # Everything the run writes goes to the benchmark database; the application's engine is never opened.
        monkeypatch.setattr("animama.local.database.get_engine", _no_application_engine)
        outcome = await runner.run_benchmark(
            prompts,
            [haiku],
            registry=StaticModelClientRegistry({haiku.model_provider.provider_type: client}),
            caps=runner.RunCaps(max_calls=100),
            prices={},
            sink=turns.append,
            memory_sessions=BenchmarkSessions(factory),
        )
        async with factory() as session:
            probe = await memory_db.japanese_search_probe(session)

    assert not await _database_exists(db_url, name)
    assert await _row_counts(db_url) == before
    assert outcome.aborted is None
    by_arm: dict[str, dict[str, list[dict[str, Any]]]] = {}
    for turn in turns:
        if turn.get("arm"):
            by_arm.setdefault(turn["arm"], {}).setdefault(turn["kind"], []).append(turn)
    assert list(by_arm) == [ARM_REMEMBER_ONLY, ARM_MEMORIES_MD_ONLY, ARM_BOTH]

    def outcomes(arm: str) -> dict[str, tuple[bool, Any]]:
        first = by_arm[arm]["memory"][0]
        return {call["tool"]: (call["ok"], call["code"]) for call in first["tool_calls"]}

    # (a) remember only: shared files stay writable, MEMORIES.md is read-only, the note becomes an episode.
    assert outcomes(ARM_REMEMBER_ONLY) == {
        "memory_write_file": (True, None),
        "web_search": (False, "unsupported_tool"),
        "memory_apply_patch": (False, "read_only"),
    }
    # (b) and (c) may edit MEMORIES.md.
    assert outcomes(ARM_MEMORIES_MD_ONLY)["memory_apply_patch"] == (True, None)
    assert outcomes(ARM_BOTH)["memory_apply_patch"] == (True, None)

    def snapshot(arm: str) -> dict[str, Any]:
        [capture] = by_arm[arm]["capture"]
        return cast(dict[str, Any], capture["snapshot"])

    def memories(arm: str) -> str:
        return str(next(f["content"] for f in snapshot(arm)["files"] if f["anima"] and f["path"] == "MEMORIES.md"))

    assert [episode["text"] for episode in snapshot(ARM_REMEMBER_ONLY)["episodes"]] == [
        "The user is moving to Kyoto next month."
    ]
    assert snapshot(ARM_MEMORIES_MD_ONLY)["episodes"] == []  # No `remember` field in this arm.
    assert len(snapshot(ARM_BOTH)["episodes"]) == 1
    assert "Kyoto" not in memories(ARM_REMEMBER_ONLY)
    assert "Kyoto" in memories(ARM_MEMORIES_MD_ONLY) and "Kyoto" in memories(ARM_BOTH)
    for arm in by_arm:
        first = by_arm[arm]["memory"][0]
        # Three calls, two of them tool rounds: the reply validated as sent, so nothing was repaired. Arm (b)'s
        # schema has no `remember`, so the fake's extra field passes only chat's lenient recovery.
        assert first["calls"] == 3, first
        # The store diff around the turn: PROFILE.md gains the move in every arm; MEMORIES.md only where writable.
        changes = {change["path"]: change["diff"] for change in first["memory_changes"]}
        assert "+- Moving to Kyoto next month." in changes["PROFILE.md"], changes
        if arm == ARM_REMEMBER_ONLY:
            assert "[self]/MEMORIES.md" not in changes
        else:
            assert changes["[self]/MEMORIES.md"].splitlines()[1:] == ["+- They told me about Kyoto."], changes
        assert first["recovery"] == ("lenient" if arm == ARM_MEMORIES_MD_ONLY else "strict"), first
        # Every arm offers the same memory tools (no web search); arm (a) refuses MEMORIES.md writes when called.
        assert {"memory_write_file", "memory_apply_patch"} <= set(first["offered_tools"])
        assert first["offered_tools"] == by_arm[ARM_BOTH]["memory"][0]["offered_tools"]
        assert "web_search" not in first["offered_tools"]
        profile = next(f for f in snapshot(arm)["files"] if f["path"] == "PROFILE.md")
        assert "Kyoto" in profile["content"]
        [recall] = by_arm[arm]["recall"]
        assert recall["recall_match"] is True and recall["checklist"] == ["kyoto"]
        assert by_arm[arm]["capture"][0]["checklist"][0]["kind"] == "keep"
    # Each arm's MEMORIES.md-only replies have no `remember` in their schema, so the fake's note is dropped.
    assert all(turn["remember"] is None for turn in by_arm[ARM_MEMORIES_MD_ONLY]["memory"])
    # Chat's english full-text search does not segment Japanese.
    assert cast(dict[str, bool], probe["matches"])["京都"] is False

    # Incognito core turns offer no tools at all.
    assert all(turn["offered_tools"] == [] for turn in turns if turn["kind"] in {"warmup", "single", "chat"})
    managers = {turn["unit_id"]: turn for turn in turns if turn["kind"] == "memory_manager"}
    assert set(managers) == {"tidy", "episodes", "reflect"}
    for turn in managers.values():
        assert turn["error"] is None and turn["result"]["kind"] == turn["manager_kind"], turn

    def approvals(unit: str) -> list[tuple[str, str, str | None]]:
        result = managers[unit]["result"]
        return [(a["status"], a["operation"], a["target_path"]) for a in result["approvals"]]

    # The benchmark approves every proposal, and each one is applied to the run's own store.
    assert approvals("tidy") == []
    assert approvals("episodes") == [("approved", "create", "notes/episodic-memory.md")]
    [(status, operation, target)] = approvals("reflect")
    assert (status, operation) == ("approved", "update") and re.fullmatch(r"animas/[^/]+/MEMORIES\.md", target or "")


class _NativePatchClient:
    """An OpenAI Responses model: on the first turn it edits PROFILE.md through native ``apply_patch``."""

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        sent = json.dumps(request.prompt.messages, default=str)
        if _latest_user_text(request) == FIRST_TURN and "call-native" not in sent.split(FIRST_TURN)[-1]:
            operation = {
                "type": "update_file",
                "path": "PROFILE.md",
                "diff": "@@\n # Profile\n \n-- Likes tea.\n+- Likes tea.\n+- Moving to Kyoto.\n",
            }
            call = ModelClientToolCall(
                id="call-native", name="apply_patch", arguments=json.dumps(operation), tool_type="apply_patch"
            )
            final = _final({}, tool_calls=(call,))
        else:
            final = _final(_reply("Kyoto!"))
            yield ModelClientDelta(kind="text_delta", text=final.text)
        yield ModelClientDelta(kind="final", final=final)
        yield ModelClientDelta(kind="done")

    async def aclose(self) -> None:
        return None


async def test_an_openai_responses_row_writes_memory_through_native_apply_patch(
    db_ready: str, db_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANIMAMA_LLM_SKIP", "1")
    prompts = replace(prompt_set.load_prompt_set(MEMORY_PROMPTS), manager_runs=())
    luna = next(c for c in configs.standard_configurations(configs.builtin_chat_rows()) if "luna" in c.label)
    turns: list[dict[str, Any]] = []

    async with memory_db.benchmark_database(db_url, memory_db.benchmark_database_name("luna")) as factory:
        await runner.run_benchmark(
            prompts,
            [luna],
            registry=StaticModelClientRegistry({luna.model_provider.provider_type: _NativePatchClient()}),
            caps=runner.RunCaps(max_calls=100),
            prices={},
            sink=turns.append,
            memory_sessions=BenchmarkSessions(factory),
        )

    firsts = {turn["arm"]: turn for turn in turns if turn["kind"] == "memory" and turn["turn"] == 1}
    assert list(firsts) == [ARM_REMEMBER_ONLY, ARM_MEMORIES_MD_ONLY, ARM_BOTH]
    for arm, turn in firsts.items():
        # Responses rows write memory through native apply_patch instead of the function write tools.
        assert turn["offered_tools"] == ["apply_patch", "memory_list_files", "memory_read_files", "search_memory_files"]
        [call] = turn["tool_calls"]
        assert {key: call[key] for key in ("tool", "path", "ok", "code")} == {
            "tool": "apply_patch",
            "path": "PROFILE.md",
            "ok": True,
            "code": None,
        }
        # The model rewrote "- Likes tea." in its patch, but the store's own diff shows only the line it added.
        assert call["arguments"]["type"] == "update_file"
        [change] = turn["memory_changes"]
        assert change["path"] == "PROFILE.md" and change["diff"].splitlines()[1:] == ["+- Moving to Kyoto."]
        assert turn["calls"] == 2 and turn["recovery"] == ("lenient" if arm == ARM_MEMORIES_MD_ONLY else "strict")


class _Clock:
    def __init__(self) -> None:
        self.now = 0.0

    def __call__(self) -> float:
        self.now += 0.5
        return self.now


def _manager_calls(max_calls: int) -> manager_runner.ManagerCalls:
    return manager_runner.ManagerCalls(
        budget=CallBudget(max_calls=max_calls), price=lambda usage: Decimal("0.001"), clock=_Clock()
    )


async def test_the_agents_model_wrapper_counts_each_call_against_the_budget() -> None:
    class _Model:
        async def get_response(self, *args: Any, **kwargs: Any) -> Any:
            return SimpleNamespace(
                usage=SimpleNamespace(
                    requests=1,
                    input_tokens=300,
                    output_tokens=20,
                    total_tokens=320,
                    input_tokens_details=SimpleNamespace(cached_tokens=100),
                    output_tokens_details=SimpleNamespace(reasoning_tokens=5),
                )
            )

    calls = _manager_calls(1)
    model = manager_runner._BudgetedAgentsModel(_Model(), calls)  # type: ignore[arg-type]

    await model.get_response()
    with pytest.raises(manager_runner.ManagerBudgetSpent):
        await model.get_response()

    [call] = calls.calls
    assert call.usage is not None and (call.usage.input_tokens, call.usage.input_tokens_details.cached_tokens) == (
        300,
        100,
    )
    assert call.cost_usd == Decimal("0.001") and calls.budget.spent_usd == Decimal("0.001")
    assert calls.refused is True and calls.budget.refused == "max_calls"


async def test_the_anthropic_client_wrapper_counts_each_streamed_request() -> None:
    class _Stream:
        async def __aenter__(self) -> _Stream:
            return self

        async def __aexit__(self, *exc: Any) -> None:
            return None

        async def get_final_message(self) -> Any:
            return SimpleNamespace(
                usage=SimpleNamespace(
                    input_tokens=200, output_tokens=30, cache_read_input_tokens=50, cache_creation_input_tokens=0
                )
            )

    class _Client:
        def __init__(self) -> None:
            self.messages = SimpleNamespace(stream=lambda **params: _Stream())
            self.closed = False

        async def close(self) -> None:
            self.closed = True

    calls = _manager_calls(1)
    inner = _Client()
    client = manager_runner._BudgetedAnthropicClient(inner, calls)

    async with client.messages.stream(model="claude") as stream:
        await stream.get_final_message()
    with pytest.raises(manager_runner.ManagerBudgetSpent):
        async with client.messages.stream(model="claude"):
            pass
    await client.close()

    [call] = calls.calls
    assert call.usage is not None and call.usage.output_tokens == 30
    assert inner.closed is True and calls.refused is True


async def test_the_run_command_runs_memory_work_on_the_mock_client_and_drops_its_database(
    async_session: AsyncSession, db_url: str, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    # ANIMAMA_LLM_SKIP makes chat's registry serve the mock client and the Memory Manager its deterministic runtime.
    monkeypatch.setenv("ANIMAMA_LLM_SKIP", "1")
    await SQLAlchemyModelProviderRepository(async_session).upsert_many(configs.builtin_chat_rows())
    await async_session.commit()
    out = tmp_path / "run"
    args = cli._parse_args(
        ["run", "--prompts", str(MEMORY_PROMPTS), "--config", "AnthropicMessagesHTTPAgent:claude-haiku-5-5@none",
         "--max-calls", "200", "--max-usd", "1", "--price", _PRICE, "--output-dir", str(out)]
    )  # fmt: skip

    code = await cli._run(args)

    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    turns = [json.loads(line) for line in (out / "turns.jsonl").read_text(encoding="utf-8").splitlines()]
    assert code == 0 and manifest["aborted"] is None
    assert manifest["benchmark_database"].startswith(memory_db.BENCHMARK_DATABASE_PREFIX)
    assert not await _database_exists(db_url, manifest["benchmark_database"])
    assert manifest["japanese_search_probe"]["matches"]["京都"] is False
    assert manifest["options"]["memory_arms"] == [ARM_REMEMBER_ONLY, ARM_MEMORIES_MD_ONLY, ARM_BOTH]
    kinds = {turn["kind"] for turn in turns}
    assert kinds == {"warmup", "memory", "capture", "recall", "memory_manager"}
    assert all(turn.get("error") is None for turn in turns)


async def _create_database(application_url: str, name: str) -> None:
    engine = create_async_engine(
        memory_db._admin_url(application_url), poolclass=NullPool, isolation_level="AUTOCOMMIT"
    )
    try:
        async with engine.connect() as connection:
            await connection.execute(text(f'CREATE DATABASE "{name}"'))
    finally:
        await engine.dispose()


async def test_cleanup_drops_leftovers_but_keeps_a_running_benchmarks_database(db_ready: str, db_url: str) -> None:
    # A prefix of this test's own keeps it from touching another xdist worker's benchmark database.
    prefix = f"{memory_db.BENCHMARK_DATABASE_PREFIX}cleanup_{uuid.uuid4().hex[:8]}_"
    leftover, running = f"{prefix}leftover", f"{prefix}running"
    await _create_database(db_url, leftover)
    async with memory_db.benchmark_database(db_url, running) as factory:
        # Between sessions a run holds no session of its own; its database must still count as in use.
        async with factory() as session:
            await session.execute(text("SELECT 1"))
        dropped, in_use = await memory_db.drop_leftover_databases(db_url, prefix=prefix)
        assert await _database_exists(db_url, running)

    assert (dropped, in_use) == ([leftover], [running])
    assert not await _database_exists(db_url, leftover) and not await _database_exists(db_url, running)
    assert await _database_exists(db_url, make_url(db_url).database or "")
    with pytest.raises(EvalInputError, match="Refusing prefix"):
        await memory_db.drop_leftover_databases(db_url, prefix="animama")


async def test_the_benchmark_database_is_dropped_on_error_and_on_cancellation(db_ready: str, db_url: str) -> None:
    failed = memory_db.benchmark_database_name("failed")
    with pytest.raises(RuntimeError, match="boom"):
        async with memory_db.benchmark_database(db_url, failed):
            raise RuntimeError("boom")
    assert not await _database_exists(db_url, failed)

    cancelled = memory_db.benchmark_database_name("cancelled")
    entered = asyncio.Event()

    async def hold() -> None:
        async with memory_db.benchmark_database(db_url, cancelled):
            entered.set()
            await asyncio.Event().wait()

    task = asyncio.create_task(hold())
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not await _database_exists(db_url, cancelled)


async def test_an_existing_benchmark_database_is_a_clear_input_error(db_ready: str, db_url: str) -> None:
    name = memory_db.benchmark_database_name("taken")
    async with memory_db.benchmark_database(db_url, name):
        with pytest.raises(EvalInputError, match=f"Could not create the benchmark database {name}"):
            async with memory_db.benchmark_database(db_url, name):
                pass
    assert not await _database_exists(db_url, name)


def _manager_only(*unit_ids: str) -> prompt_set.PromptSet:
    prompts = prompt_set.load_prompt_set(MEMORY_PROMPTS)
    runs = tuple(run for run in prompts.manager_runs if run.id in unit_ids)
    return replace(prompts, memory_chats=(), manager_runs=runs)


async def test_the_memory_manager_runs_once_per_row_at_the_runtime_effort(
    db_ready: str, db_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("ANIMAMA_LLM_SKIP", "1")
    haikus = [c for c in configs.standard_configurations(configs.builtin_chat_rows()) if "haiku" in c.label]
    records: list[dict[str, Any]] = []

    async with memory_db.benchmark_database(db_url, memory_db.benchmark_database_name("per-row")) as factory:
        finished = await manager_runner.run_memory_manager(
            _manager_only("tidy", "episodes"),
            [(configuration, None) for configuration in haikus],
            budget=CallBudget(max_calls=10),
            sessions=BenchmarkSessions(factory),
            sink=records.append,
        )

    assert finished and len(haikus) == 2
    row = haikus[0].model_provider
    assert [(r["unit_id"], r["configuration"], r["effort"]) for r in records] == [
        ("tidy", row.id, "medium"),
        ("episodes", row.id, "medium"),
    ]
    luna = next(r for r in configs.builtin_chat_rows() if r.provider_type == "OpenAIResponsesHTTPAgent")
    assert manager_runner.applied_effort(luna) is None


def _anthropic_reply(*blocks: dict[str, Any], message_id: str, stop_reason: str = "end_turn") -> list[dict[str, Any]]:
    return message_events(*blocks, message_id=message_id, stop_reason=stop_reason)


@pytest.mark.parametrize(("max_calls", "finished"), [(5, True), (1, False)])
async def test_the_anthropic_runtime_calls_through_the_run_budget(
    db_ready: str, db_url: str, monkeypatch: pytest.MonkeyPatch, max_calls: int, finished: bool
) -> None:
    monkeypatch.delenv("ANIMAMA_LLM_SKIP", raising=False)
    fake = FakeAnthropicClient(
        [
            _anthropic_reply(
                tool_use_block("toolu_view", "memory", {"command": "view", "path": "/memories"}),
                message_id="msg_view",
                stop_reason="tool_use",
            ),
            _anthropic_reply(text_block("Your profile already says you like green tea."), message_id="msg_done"),
        ]
    )
    monkeypatch.setattr(manager_runner, "anthropic_sdk_client", lambda **kwargs: fake)
    monkeypatch.setattr(
        manager_runner,
        "build_model_credential_resolver",
        lambda: static_credential_resolver({"ANTHROPIC_API_KEY": SENTINEL_KEY}),
    )
    haiku = next(c for c in configs.standard_configurations(configs.builtin_chat_rows()) if "haiku" in c.label)
    budget = CallBudget(max_calls=max_calls)
    records: list[dict[str, Any]] = []

    async with memory_db.benchmark_database(db_url, memory_db.benchmark_database_name("anthropic")) as factory:
        result = await manager_runner.run_memory_manager(
            _manager_only("tidy"),
            [(haiku, lambda usage: Decimal("0.002"))],
            budget=budget,
            sessions=BenchmarkSessions(factory),
            sink=records.append,
        )

    assert result is finished
    if finished:
        [record] = records
        assert record["error"] is None and record["calls"] == 2, record
        assert record["served_models"] == ["claude-haiku-5-5"] and record["effort"] == "medium"
        assert record["usage"]["output_tokens"] == 50 and record["estimated_cost_usd"] == pytest.approx(0.004)
        assert budget.calls == 2 and budget.spent_usd == Decimal("0.004")
    else:
        # The second call is refused before it is sent, and the run stops without a record.
        assert records == [] and len(fake.requests) == 1
        assert budget.refused == "max_calls"


async def test_the_openai_runtime_gets_the_budgeted_model_wrapper(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANIMAMA_LLM_SKIP", raising=False)
    built: dict[str, Any] = {}

    class _Runtime:
        name = "openai_agents"
        model_provider_id = None

        def __init__(self, **kwargs: Any) -> None:
            built.update(kwargs)

    class _Model:
        closed = False

        async def get_response(self, *args: Any, **kwargs: Any) -> Any:
            return SimpleNamespace(usage=None)

        def get_retry_advice(self, request: Any) -> Any:
            return "advice"

        def _supports_default_prompt_cache_key(self) -> bool:
            return True

        async def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(manager_runner, "OpenAIAgentsMemoryManagerRuntime", _Runtime)
    luna = next(c for c in configs.standard_configurations(configs.builtin_chat_rows()) if "luna" in c.label)
    calls = _manager_calls(1)
    manager_runner._service(SimpleNamespace(), Store("u", "a"), luna, calls, Settings())
    inner = _Model()
    model = built["model_wrapper"](inner, None)

    await model.get_response()
    assert len(calls.calls) == 1 and calls.budget.calls == 1
    assert model.get_retry_advice(None) == "advice" and model._supports_default_prompt_cache_key() is True
    await model.close()
    assert inner.closed is True


def _write_memory_set(tmp_path: Path, mutate: Callable[[dict[str, Any]], None]) -> Path:
    fixtures = MEMORY_PROMPTS.parent
    for name in ("loadout.json", "episodic-guidance.md"):
        (tmp_path / name).write_bytes((fixtures / name).read_bytes())
    data = json.loads(MEMORY_PROMPTS.read_text(encoding="utf-8"))
    mutate(data)
    path = tmp_path / "memory_prompts.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def _guidance_without_alias(data: dict[str, Any]) -> None:
    # Written next to the set by _write_memory_set's caller; pinned correctly, but it never names the file.
    data["episodic_guidance"] = {"path": "plain-guidance.md", "sha256": hashlib.sha256(b"Keep notes.").hexdigest()}


@pytest.mark.parametrize(
    ("mutate", "message"),
    [
        (lambda data: data["episodic_guidance"].update(sha256="0" * 64), "pinned sha256"),
        (_guidance_without_alias, "must name \\[self\\]/MEMORIES.md"),
        (lambda data: data.pop("episodic_guidance"), "need 'episodic_guidance'"),
        (lambda data: data["memory_chats"][0].update(fixture="nowhere"), "unknown memory fixture"),
        (lambda data: data["memory_chats"][0]["recall"][0].update(checklist=["ghost"]), "does not plant"),
        (lambda data: data["memory_chats"][0].update({"held-out": True}), "unknown keys 'held-out'"),
        (lambda data: data["memory_manager"][1].pop("episodes"), "needs 'episodes'"),
    ],
)
def test_the_memory_sections_reject_invalid_entries(
    tmp_path: Path, mutate: Callable[[dict[str, Any]], None], message: str
) -> None:
    (tmp_path / "plain-guidance.md").write_bytes(b"Keep notes.")
    with pytest.raises(EvalInputError, match=message):
        prompt_set.load_prompt_set(_write_memory_set(tmp_path, mutate))


def test_the_plan_counts_memory_work_per_configuration_and_the_memory_manager_once_per_row() -> None:
    prompts = prompt_set.load_prompt_set(MEMORY_PROMPTS)
    plan = planner.BenchmarkPlan(
        prompt_set=prompts,
        configurations=tuple(configs.standard_configurations(configs.builtin_chat_rows())),
        tier="full",
    )
    rows = len({configuration.model_provider.id for configuration in plan.runnable})
    memory_turns = 3 * sum(len(chat.turns) + len(chat.recall) for chat in prompts.memory_chats)

    assert len(plan.runnable) == 2 * rows and plan.memory_turns_per_configuration == memory_turns
    assert plan.calls_per_configuration == plan.turns_per_configuration + planner.MEMORY_TURN_CALLS * memory_turns
    assert plan.estimated_calls == (
        len(plan.runnable) * plan.calls_per_configuration + rows * planner.MANAGER_RUN_CALLS * len(prompts.manager_runs)
    )
