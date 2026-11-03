"""Memory Manager runs for each catalog row (spec R7).

The Memory Manager runtimes take no reasoning effort from chat: the Anthropic
runtime applies its role default (``medium``, adaptive thinking) when the row
offers it, and the OpenAI runtime sends none, leaving the provider's default.
A row's configurations would repeat the same run, so each row runs once, under
its first configuration's price, and records the effort the runtime applied.

Each run gets a fresh store in the benchmark database, seeded from its
fixture, plus pending episode items for an episode-processing run or the
Anima's chat turns for a Reflection. It then runs through chat's own
``MemoryManagerService``, composed as ``server/memory_manager.py`` composes it
but on the configuration's row, with ``auto_approve_diffs`` on. Approving every
proposal is the benchmark's fixed policy for every configuration: the service
records each proposal and applies it to the run's store, so the run can
continue. With ``ANIMAMA_LLM_SKIP`` set the composition uses chat's
deterministic runtime, as the app does.

Memory Manager calls do not go through chat's model clients: the OpenAI Agents
runtime uses its own SDK model and the Anthropic runtime its own SDK client.
Both are wrapped, through the runtimes' ``model_wrapper`` and
``client_factory`` hooks, so every call counts against the run's shared budget
and its usage is recorded. The ``run`` command turns Agents SDK tracing off
for its process; that changes no request the model sees.
"""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Callable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from agents import Model

from animama.adapters.memory_manager import (
    AnthropicMemoryManagerRuntime,
    DeterministicMemoryManagerRuntime,
    MemoryManagerRuntimeSelector,
    OpenAIAgentsMemoryManagerRuntime,
)
from animama.adapters.model_clients.anthropic_messages.final import usage_from_anthropic
from animama.adapters.model_clients.anthropic_messages.request import (
    DEFAULT_ANTHROPIC_MEMORY_MANAGER_EFFORT,
    effort_and_thinking,
)
from animama.adapters.model_clients.anthropic_messages.support import anthropic_sdk_client
from animama.adapters.repositories.sqlalchemy.anima_memory_reflection_repo import (
    SQLAlchemyAnimaMemoryReflectionRepository,
)
from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.memory_episode_repo import SQLAlchemyMemoryEpisodeRepository
from animama.adapters.repositories.sqlalchemy.memory_manager_repo import SQLAlchemyMemoryManagerRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.chat.api_standard import ANTHROPIC_MESSAGES_PROVIDER_TYPE
from animama.app.ports.memory_manager_runtime import MemoryManagerRuntime
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.memory_episode_service import MemoryEpisodeService
from animama.app.services.memory_manager_service import MemoryManagerService
from animama.domain import ModelProvider
from animama.domain.chat import ChatMessage, MessageRole
from animama.domain.memory_manager import MEMORY_MANAGER_RUN_STATUS_FAILED, MemoryManagerRun, MemoryManagerRunSnapshot
from animama.domain.usage import Usage, UsageInputDetails, UsageOutputDetails
from animama.product_http.chat.setup_helpers import chat_manager
from animama.server.config import Settings
from animama.server.model_clients import build_model_credential_resolver, openai_base_url
from scripts.evals.core.catalog import llm_skip
from scripts.evals.core.chat import SelectedModelProvider
from scripts.evals.core.model_calls import CallBudget, CallPrice, CallRecord, Clock, call_latency, seconds
from scripts.evals.core.pricing import usage_json

from .configs import Configuration, first_per_row
from .memory_runner import BenchmarkSessions, Store, seed_store, snapshot_store, store_for
from .prompt_set import ManagerRun, PromptSet
from .retry import Selection, manager_key

__all__ = ["ManagerBudgetSpent", "ManagerCalls", "applied_effort", "run_memory_manager"]

ManagerSink = Callable[[dict[str, Any]], None]


class ManagerBudgetSpent(RuntimeError):
    """The run's budget refused a Memory Manager call before it was sent."""


@dataclass(slots=True)
class ManagerCalls:
    """One configuration's Memory Manager calls against the run's shared budget."""

    budget: CallBudget
    price: CallPrice | None
    clock: Clock
    calls: list[CallRecord] = field(default_factory=list)
    refused: bool = False
    failure: str | None = None
    """The last call's exception class when it failed. The runtimes record a failed run rather than raise, so
    this is what tells a dropped connection apart from the model's own failure."""

    def admit(self) -> CallRecord:
        if not self.budget.admit():
            self.refused = True
            raise ManagerBudgetSpent("The evaluation call budget is spent")
        record = CallRecord(started=self.clock())
        self.calls.append(record)
        return record

    def finish(
        self, record: CallRecord, usage: Usage | None, served_model: object = None, error: BaseException | None = None
    ) -> None:
        # Only an exception counts: a consumer that stops a stream early closes it with GeneratorExit.
        self.failure = error.__class__.__name__ if isinstance(error, Exception) else None
        record.finished = self.clock()
        record.final_text = ""
        record.served_model = served_model if isinstance(served_model, str) and served_model else None
        if usage is not None:
            self.budget.settle(record, usage, self.price)


def _agents_usage(usage: Any) -> Usage | None:
    if usage is None:
        return None
    input_details = getattr(usage, "input_tokens_details", None)
    output_details = getattr(usage, "output_tokens_details", None)
    return Usage(
        requests=int(getattr(usage, "requests", 1) or 1),
        input_tokens=int(getattr(usage, "input_tokens", 0) or 0),
        output_tokens=int(getattr(usage, "output_tokens", 0) or 0),
        total_tokens=int(getattr(usage, "total_tokens", 0) or 0),
        input_tokens_details=UsageInputDetails(cached_tokens=int(getattr(input_details, "cached_tokens", 0) or 0)),
        output_tokens_details=UsageOutputDetails(
            reasoning_tokens=int(getattr(output_details, "reasoning_tokens", 0) or 0)
        ),
    )


class _BudgetedAgentsModel(Model):
    """The OpenAI Agents runtime's SDK model, admitted by the budget call by call.

    The SDK's optional model hooks (retry advice, its default prompt cache
    key, closing) answer as the wrapped model does, so requests are unchanged.
    """

    def __init__(self, model: Model, calls: ManagerCalls) -> None:
        self._model = model
        self._calls = calls

    async def get_response(self, *args: Any, **kwargs: Any) -> Any:
        record = self._calls.admit()
        try:
            response = await self._model.get_response(*args, **kwargs)
        except BaseException as exc:
            self._calls.finish(record, None, error=exc)
            raise
        self._calls.finish(record, _agents_usage(getattr(response, "usage", None)))
        return response

    def stream_response(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        return self._stream(*args, **kwargs)

    async def _stream(self, *args: Any, **kwargs: Any) -> AsyncIterator[Any]:
        record = self._calls.admit()
        usage: Usage | None = None
        served: object = None
        error: BaseException | None = None
        try:
            async for event in self._model.stream_response(*args, **kwargs):
                response = getattr(event, "response", None)
                if getattr(event, "type", None) == "response.completed" and response is not None:
                    usage = _agents_usage(getattr(response, "usage", None))
                    served = getattr(response, "model", None)
                yield event
        except BaseException as exc:
            error = exc
            raise
        finally:
            self._calls.finish(record, usage, served, error=error)

    def get_retry_advice(self, request: Any) -> Any:
        return self._model.get_retry_advice(request)

    def _supports_default_prompt_cache_key(self) -> bool:
        supports = getattr(self._model, "_supports_default_prompt_cache_key", None)
        return bool(supports()) if callable(supports) else False

    async def close(self) -> None:
        await self._model.close()


class _BudgetedAnthropicStream:
    """One ``messages.stream`` request, admitted by the budget before the SDK builds or sends it."""

    def __init__(self, client: Any, params: dict[str, Any], calls: ManagerCalls) -> None:
        self._client = client
        self._params = params
        self._calls = calls
        self._record: CallRecord | None = None
        self._manager: Any = None
        self._stream: Any = None

    async def __aenter__(self) -> Any:
        self._record = self._calls.admit()
        self._manager = self._client.messages.stream(**self._params)
        try:
            self._stream = await self._manager.__aenter__()
        except BaseException as exc:
            # ``async with`` never exits a manager whose entry failed, so the call ends here.
            self._calls.finish(self._record, None, error=exc)
            self._record = self._manager = None
            raise
        return self

    async def get_final_message(self) -> Any:
        try:
            message = await self._stream.get_final_message()
        except BaseException as exc:
            assert self._record is not None
            self._calls.finish(self._record, None, error=exc)
            self._record = None
            raise
        assert self._record is not None
        self._calls.finish(
            self._record, usage_from_anthropic(getattr(message, "usage", None)), getattr(message, "model", None)
        )
        self._record = None
        return message

    async def __aexit__(self, *exc: Any) -> Any:
        if self._record is not None:
            self._calls.finish(self._record, None, error=exc[1])
        return await self._manager.__aexit__(*exc) if self._manager is not None else None


class _BudgetedAnthropicClient:
    """The Anthropic runtime's SDK client, admitting each streamed request through the budget."""

    def __init__(self, client: Any, calls: ManagerCalls) -> None:
        self._client = client
        self._calls = calls
        self.messages = self

    def stream(self, **params: Any) -> _BudgetedAnthropicStream:
        return _BudgetedAnthropicStream(self._client, params, self._calls)

    async def close(self) -> None:
        await self._client.close()


def applied_effort(row: ModelProvider) -> str | None:
    """The reasoning effort the Memory Manager runtime sends for ``row``; ``None`` leaves the provider's default."""

    if row.provider_type != ANTHROPIC_MESSAGES_PROVIDER_TYPE:
        return None
    effort, _thinking = effort_and_thinking(None, row, default=DEFAULT_ANTHROPIC_MEMORY_MANAGER_EFFORT)
    return effort


def _service(
    session: Any, store: Store, configuration: Configuration, calls: ManagerCalls, settings: Settings
) -> MemoryManagerService:
    """``server/memory_manager.py``'s composition on the configuration's row, with the budget hooks."""

    memory_entries = MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        animas=SQLAlchemyAnimaRepository(session),
        max_file_bytes=settings.anima_memory_file_max_bytes,
        commit_on_write=False,
    )
    uow = SQLAlchemyUnitOfWork(session)
    episodes = SQLAlchemyMemoryEpisodeRepository(session)
    animas = SQLAlchemyAnimaRepository(session)
    chat_messages = SQLAlchemyChatMessageRepository(session)
    row = configuration.model_provider
    runtime: MemoryManagerRuntime
    if llm_skip():
        runtime = DeterministicMemoryManagerRuntime(
            user_id=store.user_id,
            memory_entries=memory_entries,
            memory_episodes=episodes,
            animas=animas,
            chat_messages=chat_messages,
        )
    else:
        credentials = build_model_credential_resolver()
        timeout = settings.anima_model_client_timeout_seconds
        runtime = MemoryManagerRuntimeSelector(
            model_provider=row,
            model_providers=SelectedModelProvider(row),  # type: ignore[arg-type]
            openai_agents=lambda selected: OpenAIAgentsMemoryManagerRuntime(
                user_id=store.user_id,
                memory_entries=memory_entries,
                memory_episodes=episodes,
                animas=animas,
                chat_messages=chat_messages,
                model_provider=selected,
                model_providers=SelectedModelProvider(row),  # type: ignore[arg-type]
                credential_resolver=credentials,
                openai_base_url=openai_base_url(),
                timeout_seconds=timeout,
                model_wrapper=lambda model, _run: _BudgetedAgentsModel(model, calls),
            ),
            anthropic=lambda selected: AnthropicMemoryManagerRuntime(
                user_id=store.user_id,
                memory_entries=memory_entries,
                memory_episodes=episodes,
                animas=animas,
                chat_messages=chat_messages,
                model_provider=selected,
                model_providers=SelectedModelProvider(row),  # type: ignore[arg-type]
                credential_resolver=credentials,
                timeout_seconds=timeout,
                client_factory=lambda **kwargs: _BudgetedAnthropicClient(anthropic_sdk_client(**kwargs), calls),
            ),
        )
    return MemoryManagerService(
        memory_manager=SQLAlchemyMemoryManagerRepository(session),
        memory_entries=memory_entries,
        memory_episodes=MemoryEpisodeService(
            memory_episodes=episodes, memory_entries=memory_entries, uow=uow, commit_on_write=False
        ),
        chat_messages=chat_messages,
        anima_reflections=SQLAlchemyAnimaMemoryReflectionRepository(session),
        runtime=runtime,
        uow=uow,
    )


async def _seed_inputs(sessions: BenchmarkSessions, store: Store, run: ManagerRun) -> None:
    """Record the run's pending episode items, or its Anima's chat turns for a Reflection."""

    async with sessions.write() as session:
        repositories = sessions.repositories(session)
        if run.episodes:
            uow = repositories.unit_of_work
            service = MemoryEpisodeService(
                memory_episodes=repositories.memory_episodes,
                memory_entries=MemoryEntryService(
                    memory_entries=repositories.memory_entries, uow=uow, commit_on_write=False
                ),
                uow=uow,
                commit_on_write=True,
            )
            for index, text in enumerate(run.episodes):
                occurred = datetime.now(UTC)
                await service.create_episode_item(
                    user_id=store.user_id,
                    source_anima_id=store.anima_id,
                    source_chat_id=None,
                    source_run_id=f"{run.id}/episode-{index}",
                    source_message_id=None,
                    text=text,
                    occurred_at=occurred,
                    local_date=occurred.date(),
                    local_timezone="UTC",
                )
        if run.turns:
            chats = chat_manager(repositories)
            chat_id = f"{store.anima_id}/reflection"
            await chats.ensure_owned_chat(anima_id=store.anima_id, chat_id=chat_id, user_id=store.user_id)
            for index, (user_text, assistant_text) in enumerate(run.turns, start=1):
                await chats.record_turn(
                    anima_id=store.anima_id,
                    chat_id=chat_id,
                    user_msg=_message(chat_id, f"{run.id}/t{index}", MessageRole.USER, user_text),
                    assistant_msg=_message(chat_id, f"{run.id}/t{index}", MessageRole.ASSISTANT, assistant_text),
                )


def _message(chat_id: str, run_id: str, role: MessageRole, content: str) -> ChatMessage:
    return ChatMessage(
        id=None,
        chat_id=chat_id,
        run_id=run_id,
        message_type="message",
        role=role,
        content=content,
        data=None,
        usage=None,
        turn=None,
        created_at=None,
        raw_provider_message={"role": role.value, "content": content},
    )


async def _start(service: MemoryManagerService, store: Store, run: ManagerRun) -> MemoryManagerRunSnapshot:
    if run.kind == "episode_processing":
        return await service.create_episode_processing_run(user_id=store.user_id, auto_approve_diffs=True)
    if run.kind == "reflection":
        return await service.create_reflection_run(
            user_id=store.user_id, anima_id=store.anima_id, auto_approve_diffs=True
        )
    return await service.create_run(user_id=store.user_id, initial_message=run.message, auto_approve_diffs=True)


def _snapshot_json(snapshot: MemoryManagerRunSnapshot) -> dict[str, Any]:
    run: MemoryManagerRun = snapshot.run
    return {
        "status": run.status,
        "kind": run.kind,
        "messages": [{"role": message.role, "content": message.content} for message in snapshot.messages],
        "approvals": [
            {
                "status": approval.status,
                "operation": approval.operation,
                "target_path": approval.target_path,
                "summary": approval.summary,
                "unified_diff": approval.unified_diff,
                "applied_version": approval.applied_version,
            }
            for approval in snapshot.approvals
        ],
    }


async def run_memory_manager(
    prompt_set: PromptSet,
    contestants: Sequence[tuple[Configuration, CallPrice | None]],
    *,
    budget: CallBudget,
    sessions: BenchmarkSessions,
    sink: ManagerSink,
    clock: Clock = time.monotonic,
    settings: Settings | None = None,
    select: Selection | None = None,
) -> bool:
    """Run each Memory Manager fixture once per catalog row; return ``False`` once the budget refused a call.

    ``contestants`` are the run's configurations with their prices; each row runs as its first configuration.
    With ``select``, a retry runs only the chosen rows' runs.
    """

    runtime_settings = settings or Settings()
    prices = {configuration.label: price for configuration, price in contestants}
    rows = first_per_row(configuration for configuration, _price in contestants)
    for run in prompt_set.manager_runs:
        for configuration in rows:
            if select is not None and not select(configuration.model_provider.id, manager_key(run.id)):
                continue
            price = prices[configuration.label]
            store = store_for(configuration, "memory_manager", run.id)
            await seed_store(sessions, store, prompt_set.persona(run.persona), prompt_set.fixture(run.fixture))
            await _seed_inputs(sessions, store, run)
            calls = ManagerCalls(budget=budget, price=price, clock=clock)
            started = clock()
            error: str | None = None
            result: dict[str, Any] | None = None
            async with sessions.write() as session:
                service = _service(session, store, configuration, calls, runtime_settings)
                try:
                    result = _snapshot_json(await _start(service, store, run))
                except Exception as exc:  # A failed run is recorded and measured, not fatal
                    error = exc.__class__.__name__
            if error is None and result is not None and result["status"] == MEMORY_MANAGER_RUN_STATUS_FAILED:
                # The runtime recorded its failure instead of raising it: name the last call's error, if any,
                # so a dropped connection can be retried and a failed run is neither judged nor counted as run.
                error = calls.failure or "run_failed"
            finished = clock()
            if calls.refused:
                return False
            sink(
                _record(
                    configuration, run, result, error, calls, started, finished, await snapshot_store(sessions, store)
                )
            )
    return True


def _record(
    configuration: Configuration,
    run: ManagerRun,
    result: Mapping[str, Any] | None,
    error: str | None,
    calls: ManagerCalls,
    started: float,
    finished: float,
    store: dict[str, Any],
) -> dict[str, Any]:
    costs = [call.cost_usd for call in calls.calls]
    row = configuration.model_provider
    return {
        # A row runs once at the runtime's own effort, so the record names the row, not a configuration.
        "configuration": row.id,
        "model_provider_id": row.id,
        "effort": applied_effort(row),
        "kind": "memory_manager",
        "area": "memory_manager",
        "manager_kind": run.kind,
        "unit_id": run.id,
        "persona": run.persona,
        "held_out": run.held_out,
        "result": result,
        "error": error,
        "store": store,
        "calls": len(calls.calls),
        "served_models": sorted({call.served_model for call in calls.calls if call.served_model}),
        "usage": usage_json(calls.calls),
        "estimated_cost_usd": (
            float(sum(cost for cost in costs if cost is not None)) if costs and None not in costs else None
        ),
        "latency_seconds": seconds(finished - started),
        "call_latencies": [call_latency(call) for call in calls.calls],
    }
