"""A composition can account for every actual model dispatch without local imports."""

import asyncio
from dataclasses import replace

import pytest

from animama.app.model_clients import (
    DirectChatPrompt,
    ModelClientDelta,
    ModelClientError,
    ModelClientFinal,
    ModelClientRequest,
    ModelClientTimeoutError,
    uses_native_context_compaction,
)
from animama.app.model_clients.call_boundary import AccountedModelClient, AdmittedModelCall, ModelCallLimits
from animama.domain import ModelProvider
from animama.domain.usage import Usage


def request():
    return ModelClientRequest(
        model_provider=ModelProvider(id="m", model="m", provider_type="openai", model_label="M", provider_label="P"),
        prompt=DirectChatPrompt(messages=()),
    )


class Boundary:
    def __init__(self, denied=False, timeout_seconds=1):
        self.calls = []
        self.outcomes = []
        self.denied = denied
        self.timeout_seconds = timeout_seconds

    async def admit(self, value):
        if self.denied:
            raise ValueError("budget exhausted")
        call = AdmittedModelCall(
            owner_id="owner",
            operation_id="root",
            call_id=str(len(self.calls)),
            request=replace(value, limits=ModelCallLimits(max_output_tokens=100, timeout_seconds=self.timeout_seconds)),
        )
        self.calls.append(call)
        return call

    async def finish(self, call, outcome):
        self.outcomes.append((call, outcome))


class Client:
    def __init__(self, final=None, error=None):
        self.requests = []
        self.closed = 0
        self.final = final
        self.error = error

    async def stream(self, value):
        self.requests.append(value)
        try:
            yield ModelClientDelta(kind="text_delta", text="hello")
            if self.error:
                raise self.error
            if self.final:
                yield ModelClientDelta(kind="final", final=self.final)
        finally:
            self.closed += 1

    async def aclose(self):
        pass


@pytest.mark.asyncio
async def test_admission_is_before_dispatch_and_every_nested_invocation_has_a_receipt():
    boundary = Boundary()
    client = Client(final=ModelClientFinal(text="hello", usage=Usage(input_tokens=4), usage_reported=True))
    wrapped = AccountedModelClient(client, boundary)
    for _ in range(2):
        assert [delta async for delta in wrapped.stream(request())][-1].kind == "final"
    assert [call.call_id for call in boundary.calls] == ["0", "1"]
    assert all(value.limits.max_output_tokens == 100 for value in client.requests)
    assert all(outcome.status == "completed" and outcome.usage.input_tokens == 4 for _, outcome in boundary.outcomes)
    assert client.closed == 2


def test_accounting_reports_the_wrapped_clients_native_compaction():
    # Accounting never compacts; the executor fits prompts unless the wrapped provider does.
    class NativeCompactionClient(Client):
        native_context_compaction = True

    assert uses_native_context_compaction(AccountedModelClient(NativeCompactionClient(), Boundary())) is True
    assert uses_native_context_compaction(AccountedModelClient(Client(), Boundary())) is False


@pytest.mark.asyncio
async def test_denial_does_not_dispatch_or_claim_a_billable_outcome():
    boundary, client = Boundary(denied=True), Client()
    with pytest.raises(ValueError, match="budget"):
        _ = [delta async for delta in AccountedModelClient(client, boundary).stream(request())]
    assert not client.requests and not boundary.outcomes


@pytest.mark.asyncio
@pytest.mark.parametrize("final", [None, ModelClientFinal(text="hello", usage=Usage(input_tokens=9))])
async def test_missing_or_estimated_usage_never_becomes_measured_zero(final):
    boundary, client = Boundary(), Client(final=final)
    _ = [delta async for delta in AccountedModelClient(client, boundary).stream(request())]
    outcome = boundary.outcomes[0][1]
    assert outcome.usage is None
    assert outcome.status == ("completed" if final else "incomplete")


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "error,status", [(RuntimeError("disconnect"), "failed"), (asyncio.CancelledError(), "cancelled")]
)
async def test_failure_and_cancellation_keep_unknown_liability(error, status):
    boundary, client = Boundary(), Client(error=error)
    with pytest.raises(type(error)):
        _ = [delta async for delta in AccountedModelClient(client, boundary).stream(request())]
    assert boundary.outcomes[0][1].status == status
    assert boundary.outcomes[0][1].usage is None
    assert client.closed == 1


@pytest.mark.asyncio
async def test_consumer_close_closes_upstream_and_records_cancelled():
    boundary, client = Boundary(), Client()
    stream = AccountedModelClient(client, boundary).stream(request())
    await anext(stream)
    await stream.aclose()
    assert boundary.outcomes[0][1].status == "cancelled"
    assert client.closed == 1


@pytest.mark.asyncio
@pytest.mark.parametrize("resume", ["pull", "close"])
async def test_provider_deadline_never_cancels_slow_model_consumers(resume):
    boundary, client = Boundary(timeout_seconds=0.02), Client()
    stream = AccountedModelClient(client, boundary).stream(request())
    task = asyncio.current_task()
    assert task is not None
    cancellations_before = task.cancelling()
    try:
        assert (await anext(stream)).text == "hello"
        try:
            await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            pytest.fail("The provider deadline cancelled unrelated consumer work")
        if resume == "pull":
            with pytest.raises(ModelClientTimeoutError) as deadline:
                await anext(stream)
            assert deadline.value.code == "model_deadline_exceeded"
        else:
            await stream.aclose()
    finally:
        await stream.aclose()
    assert task.cancelling() == cancellations_before
    assert client.closed == 1 and len(boundary.outcomes) == 1
    assert boundary.outcomes[0][1].status == ("failed" if resume == "pull" else "cancelled")
    assert boundary.outcomes[0][1].usage is None


@pytest.mark.asyncio
async def test_completed_model_outcome_is_not_revised_while_consumer_handles_final_delta():
    boundary = Boundary(timeout_seconds=0.02)
    client = Client(final=ModelClientFinal(text="hello", usage=Usage(input_tokens=4), usage_reported=True))
    stream = AccountedModelClient(client, boundary).stream(request())
    task = asyncio.current_task()
    assert task is not None
    cancellations_before = task.cancelling()
    try:
        await anext(stream)
        assert (await anext(stream)).kind == "final"
        assert len(boundary.outcomes) == 1 and boundary.outcomes[0][1].status == "completed"
        try:
            await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            pytest.fail("The provider deadline remained active after its final delta")
    finally:
        await stream.aclose()
    assert task.cancelling() == cancellations_before
    assert client.closed == 1 and len(boundary.outcomes) == 1
    assert boundary.outcomes[0][1].usage.input_tokens == 4


@pytest.mark.asyncio
async def test_model_provider_pull_timeout_closes_once_and_retains_unknown_usage():
    class StalledClient(Client):
        async def stream(self, value):
            self.requests.append(value)
            try:
                await asyncio.Event().wait()
                yield ModelClientDelta(kind="text_delta", text="unreachable")
            finally:
                self.closed += 1

    boundary, client = Boundary(timeout_seconds=0.02), StalledClient()
    with pytest.raises(ModelClientTimeoutError) as deadline:
        _ = [delta async for delta in AccountedModelClient(client, boundary).stream(request())]
    assert deadline.value.code == "model_deadline_exceeded"
    assert client.closed == 1 and len(boundary.outcomes) == 1
    assert boundary.outcomes[0][1].status == "failed" and boundary.outcomes[0][1].usage is None


@pytest.mark.asyncio
async def test_final_outcome_persistence_has_its_own_deadline_and_one_attempt():
    attempts = []

    class StalledBoundary(Boundary):
        async def admit(self, value):
            call = await super().admit(value)
            bounded = replace(call.request, limits=replace(call.request.limits, cleanup_timeout_seconds=0.02))
            return replace(call, request=bounded)

        async def finish(self, call, outcome):
            attempts.append(outcome)
            await asyncio.Event().wait()

    boundary = StalledBoundary()
    client = Client(final=ModelClientFinal(text="hello", usage=Usage(input_tokens=4), usage_reported=True))
    async with asyncio.timeout(0.5):
        with pytest.raises(TimeoutError):
            _ = [delta async for delta in AccountedModelClient(client, boundary).stream(request())]
    assert client.closed == 1 and len(attempts) == 1
    assert attempts[0].status == "completed" and not boundary.outcomes


def test_limits_fail_closed_for_invalid_bounds():
    with pytest.raises(ValueError):
        ModelCallLimits(max_output_tokens=0, timeout_seconds=1)
    with pytest.raises(ValueError):
        ModelCallLimits(max_output_tokens=1, timeout_seconds=float("inf"))


def test_provider_request_limits_reach_the_sdk_without_changing_unbounded_local_requests():
    from animama.adapters.model_clients.openai_chat_completions.request import create_chat_completion_kwargs
    from animama.adapters.model_clients.openai_responses.request import create_response_kwargs

    original = request()
    bounded = replace(
        original, limits=ModelCallLimits(max_output_tokens=77, timeout_seconds=1, max_native_tool_calls=2)
    )
    assert "max_completion_tokens" not in create_chat_completion_kwargs(original, timeout=1)
    assert create_chat_completion_kwargs(bounded, timeout=1)["max_completion_tokens"] == 77
    response = create_response_kwargs(bounded, None, timeout=1)
    assert response["max_output_tokens"] == 77 and response["max_tool_calls"] == 2


@pytest.mark.asyncio
async def test_native_tools_are_explicitly_unmeasured_even_when_token_usage_is_known():
    from animama.app.model_clients import ModelClientProviderOptions

    class ToolBoundary(Boundary):
        async def admit(self, value):
            call = await super().admit(value)
            return replace(
                call,
                request=replace(
                    call.request,
                    limits=ModelCallLimits(max_output_tokens=100, timeout_seconds=1, max_native_tool_calls=1),
                ),
            )

    boundary = ToolBoundary()
    client = Client(final=ModelClientFinal(text="done", usage=Usage(input_tokens=3), usage_reported=True))
    value = replace(request(), provider_options=ModelClientProviderOptions(native_tools=("web_search",)))
    _ = [delta async for delta in AccountedModelClient(client, boundary).stream(value)]
    assert boundary.outcomes[0][1].usage.input_tokens == 3
    assert boundary.outcomes[0][1].unmeasured_native_tools == ("web_search",)


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_type", ["openai", "openai_responses"])
async def test_memory_manager_wraps_the_actual_sdk_model_and_caps_all_runner_paths(monkeypatch, provider_type):
    from unittest.mock import AsyncMock, MagicMock

    from agents import Model

    import animama.adapters.memory_manager.openai_agents_runtime as module
    from animama.adapters.memory_manager.openai_agents_runtime import (
        OpenAIAgentsMemoryManagerRuntime,
        _approval_required_patch_editor,
    )
    from animama.app.model_clients.credentials import static_credential_resolver
    from animama.domain.memory_manager import MemoryManagerRun

    class Guarded(Model):
        async def get_response(self, *args, **kwargs):
            raise AssertionError("no provider call in this fixture")

        def stream_response(self, *args, **kwargs):
            raise AssertionError("no provider call in this fixture")

    guarded = Guarded()
    seen = []

    def wrap(model, run):
        seen.append((model, run))
        return guarded

    reads = MagicMock()
    reads.render_memory_map = AsyncMock(return_value="")
    monkeypatch.setattr(module, "UserMemoryReadToolService", lambda **kwargs: reads)
    runtime = OpenAIAgentsMemoryManagerRuntime(
        user_id="owner",
        memory_entries=MagicMock(),
        model_provider=replace(request().model_provider, provider_type=provider_type),
        credential_resolver=static_credential_resolver({"OPENAI_API_KEY": "fixture-only"}),
        timeout_seconds=1,
        model_wrapper=wrap,
        model_limits=ModelCallLimits(max_output_tokens=90, timeout_seconds=1),
        max_model_turns=2,
    )
    run = MemoryManagerRun(id="run", user_id="owner", status="active")
    monkeypatch.setattr(runtime, "_instructions_for_run", AsyncMock(return_value="instructions"))
    connection, credential = runtime._require_model()
    client = runtime._client(connection, credential)
    try:
        assert client.max_retries == 0
        agent, _ = await runtime._build_agent(
            run=run,
            workspace=MagicMock(),
            client=client,
            credential=credential,
            editor=_approval_required_patch_editor(),
        )
        assert agent.model is guarded and seen[0][1] is run
        assert agent.model_settings.max_tokens == 90
        assert runtime._turn_limit(run) == 2
    finally:
        await client.close()


@pytest.mark.asyncio
@pytest.mark.parametrize("api", ["chat", "responses"])
async def test_bounded_sdk_calls_do_not_retry_http_errors(api):
    import httpx
    from openai import AsyncOpenAI

    from animama.adapters.model_clients import OpenAIChatCompletionsModelClient, OpenAIResponsesModelClient

    sent = []

    def handle(value):
        sent.append(value)
        return httpx.Response(
            429, json={"error": {"message": "rate limited", "type": "rate_limit_error", "code": "rate_limit_exceeded"}}
        )

    sdk = AsyncOpenAI(api_key="fixture-only", http_client=httpx.AsyncClient(transport=httpx.MockTransport(handle)))
    cls = OpenAIChatCompletionsModelClient if api == "chat" else OpenAIResponsesModelClient
    client = cls(client=sdk)
    boundary = Boundary()
    try:
        with pytest.raises(ModelClientError):
            _ = [delta async for delta in AccountedModelClient(client, boundary).stream(request())]
        assert len(sent) == 1
        assert boundary.outcomes[0][1].status == "failed"
        assert boundary.outcomes[0][1].usage is None
    finally:
        await sdk.close()


@pytest.mark.asyncio
async def test_title_and_compaction_each_enter_the_same_admitted_registry():
    from types import SimpleNamespace
    from typing import cast

    from animama.app.model_clients import StaticModelClientRegistry
    from animama.app.services.direct_model_prompt_runner import DirectModelPromptRequest, DirectModelPromptRunner
    from animama.app.services.model_role_resolver import ModelRoleResolver

    provider = request().model_provider

    class Roles:
        async def resolve(self, owner_id, role):
            return SimpleNamespace(model_provider=provider)

    boundary = Boundary()
    client = AccountedModelClient(Client(final=ModelClientFinal(text="done")), boundary)
    registry = StaticModelClientRegistry({provider.provider_type: client})
    runner = DirectModelPromptRunner(registry=registry, role_resolver=cast(ModelRoleResolver, Roles()))
    for task in ("chat-title", "chat-compaction"):
        await runner.run_prompt(
            DirectModelPromptRequest(anima_id="a", user_id="owner", chat_id="chat", prompt="fixture", task=task)
        )
    assert [call.request.prompt.metadata["task"] for call in boundary.calls] == ["chat-title", "chat-compaction"]
    assert len(boundary.outcomes) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize("stall", ["close", "finish"])
async def test_cleanup_and_outcome_persistence_have_finite_deadlines(stall):
    class BoundedBoundary(Boundary):
        async def admit(self, value):
            call = await super().admit(value)
            return replace(
                call,
                request=replace(
                    call.request,
                    limits=ModelCallLimits(max_output_tokens=50, timeout_seconds=1, cleanup_timeout_seconds=0.01),
                ),
            )

        async def finish(self, call, outcome):
            if stall == "finish":
                await asyncio.Event().wait()
            await super().finish(call, outcome)

    class Stream:
        def __aiter__(self):
            return self

        async def __anext__(self):
            raise StopAsyncIteration

        async def aclose(self):
            if stall == "close":
                await asyncio.Event().wait()

    class StalledClient(Client):
        def stream(self, value):
            return Stream()

    boundary = BoundedBoundary()
    async with asyncio.timeout(0.5):
        with pytest.raises(TimeoutError):
            _ = [delta async for delta in AccountedModelClient(StalledClient(), boundary).stream(request())]
    if stall == "close":
        assert boundary.outcomes[0][1].status == "incomplete"
    else:
        assert not boundary.outcomes  # reservation remains recoverable; never a zero settlement


@pytest.mark.asyncio
async def test_invalid_admitted_limits_report_known_non_dispatch():
    class UnboundedBoundary(Boundary):
        async def admit(self, value):
            return AdmittedModelCall(owner_id="owner", operation_id="root", call_id="call", request=value)

    boundary, client = UnboundedBoundary(), Client()
    with pytest.raises(ValueError, match="limits"):
        _ = [delta async for delta in AccountedModelClient(client, boundary).stream(request())]
    assert not client.requests and boundary.outcomes[0][1].status == "not_dispatched"
