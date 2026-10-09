"""Live Anthropic Memory Manager runtime: a Client SDK loop over the native memory tool (D2, D11).

The runtime drives Anthropic's Messages API itself rather than the SDK's beta
tool runner, because a proposed memory change pauses the run until the owner
decides, possibly after a restart:

- Each request offers Anthropic's memory tool (``memory_20250818``) plus
  ``search_memory_files`` and, in a Reflection, ``read_reflection_turns`` as
  strict function tools. A response may make several calls; reads run
  immediately through ``AnthropicMemoryToolHandler``.
- The first ``create``, ``str_replace`` or ``insert`` in a response becomes an
  approval and ends the step with ``waiting_approval``; a later edit in the
  same response is answered with a tool error asking for one change at a
  time. The run's ``serialized_agent_state`` keeps
  ``{schema, system, messages, pending_tool_use_id, turns_used}``: the system
  prompt and every message exactly as sent and returned, signed thinking
  blocks included, so the conversation stays append-only and its thinking
  stays valid when the run resumes.
- Resuming appends the pending ``tool_result`` (the memory tool's success
  text when approved, or the shared rejection text with the owner's feedback)
  and continues the loop. Each start and each resume gets the run's full turn
  budget (D24); ``turns_used`` records what the paused step spent.
- Requests use adaptive thinking at effort ``medium`` unless set (D16), never
  server-side compaction, and only the built-in Anthropic connection's key.
- A refusal or API error ends the step ``failed`` with its neutral error
  category; nothing is written to memory.
"""

from __future__ import annotations

import json
from collections.abc import Mapping, Sequence
from copy import copy
from dataclasses import dataclass, field
from typing import Any

import anthropic

from animama.adapters.model_clients.anthropic_messages.errors import (
    classify_anthropic_exception,
    should_retry_anthropic_error,
    sleep_before_anthropic_retry,
)
from animama.adapters.model_clients.anthropic_messages.final import (
    STOP_REASON_MAX_TOKENS,
    STOP_REASON_REFUSAL,
    content_block_param,
    usage_from_anthropic,
)
from animama.adapters.model_clients.anthropic_messages.probe import AnthropicClientFactory
from animama.adapters.model_clients.anthropic_messages.request import (
    CACHE_CONTROL,
    DEFAULT_ANTHROPIC_MEMORY_MANAGER_EFFORT,
    anthropic_tools,
    effort_and_thinking,
    request_max_tokens,
)
from animama.adapters.model_clients.anthropic_messages.support import (
    ANTHROPIC_STREAM_INCOMPLETE_CODE,
    MODEL_REFUSED_CODE,
    anthropic_sdk_client,
    clean_str,
)
from animama.app.chat.api_standard import ANTHROPIC_MESSAGES_PROVIDER_TYPE
from animama.app.chat.memory_tools import MEMORY_TOOL_SEARCH_MEMORY_FILES, memory_tool_specs
from animama.app.model_clients.credentials import ModelCredentialResolver, connection_for_model_provider
from animama.app.model_clients.error_categories import model_error_category
from animama.app.ports.anima_port import AnimaRepository
from animama.app.ports.chat_message_port import ChatMessageRepository
from animama.app.ports.memory_episode_port import MemoryEpisodeRepository
from animama.app.ports.memory_manager_runtime import (
    MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
    MEMORY_MANAGER_RUNTIME_OUTCOME_FAILED,
    MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL,
    MemoryManagerPinnedModelUnavailableError,
    MemoryManagerRuntimeApprovalRequest,
    MemoryManagerRuntimeConfigurationError,
    MemoryManagerRuntimeError,
    MemoryManagerRuntimeResult,
)
from animama.app.ports.model_provider_port import ModelProviderRepository
from animama.app.safety.prompts import SENSITIVE_MEMORY_RULE
from animama.app.services.anima_identity_memory import ManagerFileAccess, manager_file_access_for_run
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.model_role_resolver import ROLE_MEMORY_MANAGER, usable_for_role
from animama.app.services.user_memory_read_tools import (
    UserMemoryFileReference,
    UserMemoryReadToolService,
    render_memory_file_references,
)
from animama.domain import ModelProvider
from animama.domain.memory_manager import (
    MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING,
    MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING,
    MemoryManagerApproval,
    MemoryManagerEpisodeTaskState,
    MemoryManagerMessage,
    MemoryManagerReflectionTaskState,
    MemoryManagerRun,
)
from animama.domain.model_connection import BUILTIN_ANTHROPIC_CONNECTION_ID
from animama.domain.usage import Usage
from animama.logging import get_logger

from .anthropic_memory_tool import (
    MEMORY_TOOL_NAME,
    MEMORY_TOOL_PARAM,
    AnthropicMemoryToolHandler,
    memory_tool_path,
)
from .episode_processing import load_episode_processing_batch, render_episode_processing_instructions
from .reflection import (
    MEMORY_TOOL_READ_REFLECTION_TURNS,
    ReflectionTurnReader,
    reflection_task_or_none,
    render_reflection_instructions,
)
from .runtime_support import blocked_result, max_turns_for_run, rejection_message

STATE_SCHEMA = 1
"""Version of the JSON this runtime stores in ``memory_manager_runs.serialized_agent_state``."""
_SUMMARY = "Live Anthropic memory-manager run"
_WAITING_MESSAGE = "I prepared a memory file preview. Review the diff before approving it."
_HISTORY_ROLES = frozenset({"user", "assistant"})
_READ_REFLECTION_TURNS_TOOL: dict[str, Any] = {
    "type": "function",
    "function": {
        "name": MEMORY_TOOL_READ_REFLECTION_TURNS,
        "description": (
            "Read one page of this Reflection's chat turns, oldest first, starting at page 1. "
            "Follow next_page until has_more is false."
        ),
        "parameters": {
            "type": "object",
            "properties": {"page": {"type": "integer", "description": "Page number, starting at 1."}},
            "required": ["page"],
            "additionalProperties": False,
        },
    },
}


@dataclass(slots=True)
class AnthropicManagerState:
    """A paused run: the conversation exactly as sent and returned, and the tool call awaiting the owner.

    ``turns_used`` is the number of requests the paused step made, kept for
    diagnostics; a resume starts a new budget.
    """

    system: str
    messages: list[dict[str, Any]]
    pending_tool_use_id: str
    turns_used: int

    def to_json(self) -> str:
        return json.dumps(
            {
                "schema": STATE_SCHEMA,
                "system": self.system,
                "messages": self.messages,
                "pending_tool_use_id": self.pending_tool_use_id,
                "turns_used": self.turns_used,
            },
            ensure_ascii=False,
            separators=(",", ":"),
        )

    @classmethod
    def from_json(cls, value: str) -> AnthropicManagerState:
        """Parse stored state, raising ``ValueError`` for anything this runtime did not write."""

        data = json.loads(value)
        if not isinstance(data, dict) or data.get("schema") != STATE_SCHEMA:
            raise ValueError("Unsupported Anthropic Memory Manager state")
        system, messages = data.get("system"), data.get("messages")
        pending, turns_used = data.get("pending_tool_use_id"), data.get("turns_used")
        if (
            not isinstance(system, str)
            or not isinstance(messages, list)
            or not all(isinstance(message, dict) for message in messages)
            or not isinstance(pending, str)
            or isinstance(turns_used, bool)
            or not isinstance(turns_used, int)
        ):
            raise ValueError("Invalid Anthropic Memory Manager state")
        return cls(system=system, messages=messages, pending_tool_use_id=pending, turns_used=turns_used)


@dataclass(slots=True)
class _RunTools:
    """One run's tool definitions and the executors behind them."""

    definitions: list[dict[str, Any]]
    memory: AnthropicMemoryToolHandler
    reads: UserMemoryReadToolService
    turn_reader: ReflectionTurnReader | None = None


class _StepFailed(Exception):
    """A request failed or was refused; ``result`` is the step's ``failed`` result."""

    def __init__(self, result: MemoryManagerRuntimeResult) -> None:
        super().__init__(result.error)
        self.result = result


@dataclass(slots=True)
class _Progress:
    """Counters for one invocation: requests sent and the usage they reported."""

    usage: Usage = field(default_factory=Usage)
    requests: int = 0
    last_stop_reason: str | None = None
    last_message_id: str | None = None


class AnthropicMemoryManagerRuntime:
    """Memory Manager runtime for rows on the built-in Anthropic connection."""

    name = "anthropic_messages"

    def __init__(
        self,
        *,
        user_id: str,
        memory_entries: MemoryEntryService,
        memory_episodes: MemoryEpisodeRepository | None = None,
        animas: AnimaRepository | None = None,
        chat_messages: ChatMessageRepository | None = None,
        model_provider: ModelProvider | None,
        model_providers: ModelProviderRepository | None = None,
        credential_resolver: ModelCredentialResolver,
        timeout_seconds: float,
        client_factory: AnthropicClientFactory | None = None,
    ) -> None:
        """Run the manager on an Anthropic row; ``model_providers`` finds the row a run is pinned to.

        ``client_factory`` is a test hook that builds a fake SDK client.
        """

        self._user_id = user_id
        self._memory_entries = memory_entries
        self._memory_episodes = memory_episodes
        self._animas = animas
        self._chat_messages = chat_messages
        self._model_provider = model_provider
        self._model_providers = model_providers
        self._credentials = credential_resolver
        self._timeout_seconds = max(0.1, float(timeout_seconds))
        self._client_factory = client_factory or anthropic_sdk_client
        self._log = get_logger("adapters.memory_manager.anthropic")

    @property
    def model_provider_id(self) -> str | None:
        return self._model_provider.id if self._model_provider is not None else None

    async def for_run(self, run: MemoryManagerRun) -> AnthropicMemoryManagerRuntime:
        """Return a runtime on the row that ran ``run``'s latest step (runs without one use this row)."""

        pinned_id = run.model_provider_id
        if pinned_id is None or pinned_id == self.model_provider_id:
            return self
        row = await self._model_providers.get(pinned_id) if self._model_providers is not None else None
        if row is None or not usable_for_role(ROLE_MEMORY_MANAGER, row):
            raise MemoryManagerPinnedModelUnavailableError()
        pinned = copy(self)
        pinned._model_provider = row
        try:
            # Fail before the decision is applied, not after an approved write commits.
            pinned._require_key()
        except MemoryManagerRuntimeConfigurationError as exc:
            raise MemoryManagerPinnedModelUnavailableError() from exc
        return pinned

    async def run_user_message(
        self,
        *,
        run: MemoryManagerRun,
        user_message: MemoryManagerMessage,
        history: Sequence[MemoryManagerMessage] = (),
    ) -> MemoryManagerRuntimeResult:
        """Start a step for a new user message, replaying the run's visible messages as text.

        A new message starts a fresh conversation with current instructions;
        only a paused step resumes its stored conversation.
        """

        api_key = self._require_key()
        tools = self._run_tools(run)
        system = await self._system_prompt(run, tools)
        return await self._loop(
            run=run,
            api_key=api_key,
            tools=tools,
            system=system,
            messages=_replayed_messages(history, user_message),
        )

    async def resume_approval_decision(
        self,
        *,
        run: MemoryManagerRun,
        approval: MemoryManagerApproval,
        decision: str,
        feedback: str | None = None,
    ) -> MemoryManagerRuntimeResult:
        """Answer the pending memory-tool call with the owner's decision and continue the stored step."""

        if not run.serialized_agent_state:
            return blocked_result(
                "The Memory Manager approval state is missing and cannot be resumed.",
                runtime=self.name,
                metadata={"resume": "skipped_missing_state"},
            )
        try:
            state = AnthropicManagerState.from_json(run.serialized_agent_state)
        except ValueError:
            return blocked_result(
                "The Memory Manager approval state is invalid and cannot be resumed.",
                runtime=self.name,
                metadata={"resume": "skipped_invalid_state"},
            )
        operation_metadata = dict(approval.operation_metadata or {})
        if operation_metadata.get("sdk_call_id") != state.pending_tool_use_id:
            return blocked_result(
                "The Memory Manager approval interruption is missing and cannot be resumed.",
                runtime=self.name,
                serialized_agent_state=run.serialized_agent_state,
                metadata={"resume": "skipped_missing_interruption"},
            )
        api_key = self._require_key()
        tool_path = str(operation_metadata.get("memory_tool_path") or memory_tool_path(approval.target_path))
        if decision == "approve":
            result = _tool_result(
                state.pending_tool_use_id,
                str(operation_metadata.get("memory_tool_result") or f"The file {tool_path} has been edited."),
            )
        else:
            result = _tool_result(state.pending_tool_use_id, rejection_message(tool_path, feedback), is_error=True)
        return await self._loop(
            run=run,
            api_key=api_key,
            tools=self._run_tools(run),
            system=state.system,
            messages=_with_tool_result(state.messages, result),
        )

    # ------------------------------------------------------------------ loop

    async def _loop(
        self,
        *,
        run: MemoryManagerRun,
        api_key: str,
        tools: _RunTools,
        system: str,
        messages: list[dict[str, Any]],
    ) -> MemoryManagerRuntimeResult:
        """Request, run tools and repeat until a final reply, a proposed change or the step's turn budget."""

        progress = _Progress()
        client = self._client_factory(api_key=api_key, timeout=self._request_timeout())
        try:
            return await self._steps(
                client,
                tools=tools,
                system=system,
                messages=messages,
                max_turns=max_turns_for_run(run),
                progress=progress,
            )
        except _StepFailed as failed:
            return failed.result
        except MemoryManagerRuntimeError:
            raise
        except Exception as exc:
            raise MemoryManagerRuntimeConfigurationError("The Memory Manager runtime failed.") from exc
        finally:
            await client.close()

    async def _steps(
        self,
        client: Any,
        *,
        tools: _RunTools,
        system: str,
        messages: list[dict[str, Any]],
        max_turns: int,
        progress: _Progress,
    ) -> MemoryManagerRuntimeResult:
        turns_used = 0
        while True:
            if turns_used >= max_turns:
                return self._blocked(
                    "The Memory Manager reached its turn limit before completing the review.", progress
                )
            turns_used += 1
            message = await self._request(client, system=system, messages=messages, tools=tools, progress=progress)
            content = [content_block_param(block) for block in getattr(message, "content", None) or ()]
            # Kept exactly as returned: signed thinking must be resent unchanged.
            messages.append({"role": "assistant", "content": content})
            if progress.last_stop_reason == STOP_REASON_REFUSAL:
                raise _StepFailed(self._refused(message, progress))
            if progress.last_stop_reason == STOP_REASON_MAX_TOKENS:
                # A cut-off reply may hold an incomplete tool call; nothing from it is used.
                return self._blocked(
                    "The Memory Manager's reply exceeded the output limit before it finished.", progress
                )
            tool_uses = [block for block in content if block.get("type") == "tool_use"]
            if not tool_uses:
                return self._completed(content, progress)
            results, pending = await self._run_tool_uses(tool_uses, tools)
            if pending is None:
                messages.append({"role": "user", "content": results})
                continue
            tool_use_id, approval = pending
            if results:
                # The response's other calls are answered; the pending result joins them on resume.
                messages.append({"role": "user", "content": results})
            state = AnthropicManagerState(
                system=system,
                messages=messages,
                pending_tool_use_id=tool_use_id,
                turns_used=turns_used,
            )
            return MemoryManagerRuntimeResult(
                assistant_message=_WAITING_MESSAGE,
                approvals=[approval],
                serialized_agent_state=state.to_json(),
                usage_metadata=_usage_metadata(progress),
                metadata={**self._metadata(progress), "interruption_count": 1},
                summary=_SUMMARY,
                outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL,
            )

    async def _request(
        self,
        client: Any,
        *,
        system: str,
        messages: list[dict[str, Any]],
        tools: _RunTools,
        progress: _Progress,
    ) -> Any:
        """Send one streamed request and return the completed message, retrying a transient failure once."""

        row = self._row()
        params = self._request_params(system=system, messages=messages, tools=tools)
        attempt = 0
        while True:
            try:
                async with client.messages.stream(**params) as stream:
                    message = await stream.get_final_message()
                break
            except anthropic.AnthropicError as exc:
                info = classify_anthropic_exception(exc, model=row.model)
                if should_retry_anthropic_error(info, attempt=attempt, output_started=False):
                    attempt += 1
                    await sleep_before_anthropic_retry(info)
                    continue
                self._log.warning(
                    "Anthropic Memory Manager request failed",
                    model=row.model,
                    attempt=attempt,
                    code=info.code,
                    status_code=info.metadata.get("status_code"),
                    provider_error_type=info.metadata.get("provider_error_type"),
                )
                safe_details = {
                    key: info.metadata[key]
                    for key in ("status_code", "provider_error_type", "request_id")
                    if key in info.metadata
                }
                raise _StepFailed(
                    self._failed(info.message, code=info.code, progress=progress, details=safe_details)
                ) from exc
        stop_reason = clean_str(getattr(message, "stop_reason", None))
        usage = usage_from_anthropic(getattr(message, "usage", None))
        progress.requests += 1
        progress.last_stop_reason = stop_reason
        progress.last_message_id = clean_str(getattr(message, "id", None))
        progress.usage.add(usage)
        self._log.info(
            "Anthropic Memory Manager request completed",
            model=row.model,
            message_id=progress.last_message_id,
            stop_reason=stop_reason,
            attempt=attempt,
            block_types=[getattr(block, "type", None) for block in getattr(message, "content", None) or ()],
            input_tokens=usage.input_tokens,
            cached_input_tokens=usage.input_tokens_details.cached_tokens,
            output_tokens=usage.output_tokens,
        )
        if stop_reason is None:
            # The stream closed before the message finished: nothing partial is used.
            raise _StepFailed(
                self._failed(
                    "Anthropic stream ended before the message completed",
                    code=ANTHROPIC_STREAM_INCOMPLETE_CODE,
                    progress=progress,
                )
            )
        return message

    def _request_params(self, *, system: str, messages: list[dict[str, Any]], tools: _RunTools) -> dict[str, Any]:
        """Messages API parameters: no compaction and no sampling parameters."""

        row = self._row()
        params: dict[str, Any] = {
            "model": row.model,
            "max_tokens": request_max_tokens(row),
            "system": [{"type": "text", "text": system, "cache_control": dict(CACHE_CONTROL)}],
            "messages": messages,
            "tools": tools.definitions,
            # Parallel calls let one request read several files, like OpenAI's batched memory_read_files.
            "tool_choice": {"type": "auto"},
            # Caches the conversation so far; it moves forward with each request.
            "cache_control": dict(CACHE_CONTROL),
        }
        effort, thinking = effort_and_thinking(None, row, default=DEFAULT_ANTHROPIC_MEMORY_MANAGER_EFFORT)
        if effort is not None:
            params["output_config"] = {"effort": effort}
        if thinking is not None:
            params["thinking"] = thinking
        return params

    async def _run_tool_uses(
        self,
        tool_uses: list[dict[str, Any]],
        tools: _RunTools,
    ) -> tuple[list[dict[str, Any]], tuple[str, MemoryManagerRuntimeApprovalRequest] | None]:
        """Run a response's tool calls in order; the first proposed change becomes the pending one."""

        results: list[dict[str, Any]] = []
        pending: tuple[str, MemoryManagerRuntimeApprovalRequest] | None = None
        for block in tool_uses:
            tool_use_id = str(block.get("id") or "")
            name = block.get("name")
            raw_input = block.get("input")
            tool_input: Mapping[str, Any] = raw_input if isinstance(raw_input, Mapping) else {}
            if name == MEMORY_TOOL_NAME:
                outcome = await tools.memory.execute(tool_input, tool_use_id=tool_use_id, edits_allowed=pending is None)
                if outcome.approval is not None:
                    pending = (tool_use_id, outcome.approval)
                    continue
                results.append(_tool_result(tool_use_id, outcome.content, is_error=outcome.is_error))
            elif name == MEMORY_TOOL_SEARCH_MEMORY_FILES:
                results.append(_tool_result(tool_use_id, await self._search(tools, tool_input)))
            elif name == MEMORY_TOOL_READ_REFLECTION_TURNS and tools.turn_reader is not None:
                page = await tools.turn_reader.read_page(tool_input.get("page"))
                results.append(_tool_result(tool_use_id, json.dumps(page, ensure_ascii=False)))
            else:
                results.append(_tool_result(tool_use_id, f"Error: Unknown tool {name!r}.", is_error=True))
        return results, pending

    async def _search(self, tools: _RunTools, tool_input: Mapping[str, Any]) -> str:
        """Search memory files; hits use the memory tool's ``/memories`` paths."""

        query = tool_input.get("query")
        include = tool_input.get("include_episodic_memory")
        payload = await tools.reads.search_files(
            user_id=self._user_id,
            query=query if isinstance(query, str) else "",
            include_episodic_memory=include if isinstance(include, bool) else True,
        )
        for hit in payload.get("memory_results") or ():
            if isinstance(hit, dict) and isinstance(hit.get("path"), str):
                hit["path"] = memory_tool_path(hit["path"])
        return json.dumps(payload, ensure_ascii=False)

    # --------------------------------------------------------------- results

    def _completed(self, content: list[dict[str, Any]], progress: _Progress) -> MemoryManagerRuntimeResult:
        text = "".join(
            block["text"] for block in content if block.get("type") == "text" and isinstance(block.get("text"), str)
        ).strip()
        if not text:
            return self._blocked("The Memory Manager ended without a final response.", progress)
        return MemoryManagerRuntimeResult(
            assistant_message=text,
            serialized_agent_state=None,
            usage_metadata=_usage_metadata(progress),
            metadata={**self._metadata(progress), "interruption_count": 0},
            summary=_SUMMARY,
            outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
        )

    def _blocked(self, message: str, progress: _Progress) -> MemoryManagerRuntimeResult:
        """An incomplete step: the run fails and any fixed batch stays pending."""

        return blocked_result(
            message,
            runtime=self.name,
            usage_metadata=_usage_metadata(progress),
            metadata=self._metadata(progress),
            summary=_SUMMARY,
        )

    def _refused(self, message: Any, progress: _Progress) -> MemoryManagerRuntimeResult:
        """The model declined the step (``stop_reason: refusal``): fail it without using its output (D12)."""

        details = getattr(message, "stop_details", None)
        category = clean_str(getattr(details, "category", None) if details is not None else None)
        self._log.warning(
            "Anthropic Memory Manager request refused",
            model=self._row().model,
            message_id=progress.last_message_id,
            stop_details_category=category,
        )
        return self._failed(
            "Claude declined to continue this memory review",
            code=MODEL_REFUSED_CODE,
            progress=progress,
            details={"stop_details_category": category} if category else None,
        )

    def _failed(
        self,
        message: str,
        *,
        code: str,
        progress: _Progress,
        details: Mapping[str, Any] | None = None,
    ) -> MemoryManagerRuntimeResult:
        """A ``failed`` step with the neutral error category, like other Memory Manager failures."""

        return MemoryManagerRuntimeResult(
            assistant_message=f"Memory manager runtime failed: {message}",
            serialized_agent_state=None,
            usage_metadata=_usage_metadata(progress),
            metadata={
                **self._metadata(progress),
                "runtime_error_code": code,
                "error_category": model_error_category(code, details),
                **dict(details or {}),
            },
            summary=_SUMMARY,
            error=message,
            outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_FAILED,
        )

    def _metadata(self, progress: _Progress) -> dict[str, Any]:
        """Identify the row that ran (so the run records and pins it) and the step's request facts."""

        row = self._row()
        return {
            "runtime": self.name,
            "model": row.model,
            "model_provider": row.provider_type,
            "model_provider_id": row.id,
            "connection_id": row.connection_id,
            "request_count": progress.requests,
            "stop_reason": progress.last_stop_reason,
        }

    # ------------------------------------------------------------- set-up

    def _row(self) -> ModelProvider:
        if self._model_provider is None:
            raise MemoryManagerRuntimeConfigurationError(
                "No model with tool calling is available for the Memory Manager. Choose one in App Settings."
            )
        return self._model_provider

    def _require_key(self) -> str:
        """Return the built-in Anthropic connection's key, the only credential this runtime sends."""

        row = self._row()
        if (
            row.provider_type != ANTHROPIC_MESSAGES_PROVIDER_TYPE
            or row.connection_id != BUILTIN_ANTHROPIC_CONNECTION_ID
        ):
            raise MemoryManagerRuntimeConfigurationError(
                "The Anthropic Memory Manager runs only Anthropic models on the built-in Anthropic connection."
            )
        connection = connection_for_model_provider(row)
        credential = self._credentials.resolve(connection)
        if not credential.api_key:
            raise MemoryManagerRuntimeConfigurationError(f"No key is configured for {connection.name}.")
        return credential.api_key

    def _request_timeout(self) -> float:
        connection = connection_for_model_provider(self._row())
        return connection.timeout_seconds if connection.timeout_seconds is not None else self._timeout_seconds

    def _run_tools(self, run: MemoryManagerRun) -> _RunTools:
        """The run's tools: the memory tool, memory search and, in a Reflection, its turn reader."""

        access = manager_file_access_for_run(run)
        reflection = self._reflection_task(run)
        function_tools: list[dict[str, Any]] = [
            spec
            for spec in memory_tool_specs(allow_reads=True, allow_writes=False)
            if spec["function"]["name"] == MEMORY_TOOL_SEARCH_MEMORY_FILES
        ]
        turn_reader: ReflectionTurnReader | None = None
        if reflection is not None:
            if self._chat_messages is None:
                raise MemoryManagerRuntimeConfigurationError("Reflection is not configured")
            turn_reader = ReflectionTurnReader(
                chat_messages=self._chat_messages, user_id=self._user_id, task=reflection
            )
            function_tools.append(_READ_REFLECTION_TURNS_TOOL)
        return _RunTools(
            definitions=[dict(MEMORY_TOOL_PARAM), *anthropic_tools(function_tools)],
            memory=AnthropicMemoryToolHandler(
                user_id=self._user_id,
                memory_entries=self._memory_entries,
                access=access,
                runtime_name=self.name,
            ),
            reads=UserMemoryReadToolService(memory_entries=self._memory_entries, manager_access=access),
            turn_reader=turn_reader,
        )

    def _reflection_task(self, run: MemoryManagerRun) -> MemoryManagerReflectionTaskState | None:
        try:
            return reflection_task_or_none(run)
        except ValueError as exc:
            raise MemoryManagerRuntimeConfigurationError(str(exc)) from exc

    async def _system_prompt(self, run: MemoryManagerRun, tools: _RunTools) -> str:
        """General instructions and the memory map, then the Reflection or episode-batch mandate."""

        access = manager_file_access_for_run(run)
        references = await tools.reads.file_references(user_id=self._user_id)
        memory_map = render_memory_file_references(
            UserMemoryFileReference(
                path=memory_tool_path(reference.path),
                description=reference.description,
                anima_name=reference.anima_name,
            )
            for reference in references
        )
        general = manager_instructions(memory_map=memory_map, access=access, reflection=tools.turn_reader is not None)
        reflection = self._reflection_task(run)
        if reflection is not None:
            return f"{general}\n\n{render_reflection_instructions(task=reflection, memory_tool=True)}"
        if run.kind != MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING:
            return general
        try:
            task = MemoryManagerEpisodeTaskState.from_dict(run.task_state)
        except ValueError as exc:
            raise MemoryManagerRuntimeConfigurationError(str(exc)) from exc
        if task.status != MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING:
            return general
        if self._memory_episodes is None:
            raise MemoryManagerRuntimeConfigurationError("Episode processing is not configured")
        try:
            _task, batch = await load_episode_processing_batch(
                run=run,
                memory_episodes=self._memory_episodes,
                animas=self._animas,
            )
        except ValueError as exc:
            raise MemoryManagerRuntimeConfigurationError(str(exc)) from exc
        return f"{general}\n\n{render_episode_processing_instructions(batch=batch, memory_tool=True)}"


_ANIMA_FILES_INSTRUCTIONS = (
    "Files under /memories/animas/<anima_id>/ belong to one Anima; the map's anima field names it. Entries are in "
    "Anima creation order; when names repeat, the workspace labels the second and later ones Name (2), Name (3), and "
    "so on. Never create an Anima file or add other files under /memories/animas/.\n"
)
_ANIMA_IDENTITY_INSTRUCTIONS = (
    "/memories/animas/<anima_id>/IDENTITY.md is that Anima's required identity. Read it when the user asks about an "
    "Anima. Propose a change to an identity only when the user's request is about that Anima's identity or "
    "personality, and never empty it.\n"
)
_ANIMA_MEMORIES_INSTRUCTIONS = (
    "/memories/animas/<anima_id>/MEMORIES.md is that Anima's own first-person record of its relationship with the "
    "user, which the Anima and Reflection maintain. Propose a change to it only when the user explicitly asks to "
    f"change that Anima's MEMORIES.md. {SENSITIVE_MEMORY_RULE} Never record or frame the relationship as the Anima "
    "missing the user or feeling lonely without them, as jealousy, or in a way that discourages the user's other "
    "relationships.\n"
)


def _anima_file_instructions(access: ManagerFileAccess) -> str:
    """Describe the Anima files a general run may reach; Reflection mode supplies its own mandate."""

    if access.anima_id is not None or not access.anima_files:
        return ""
    return "".join(
        (
            _ANIMA_FILES_INSTRUCTIONS,
            _ANIMA_IDENTITY_INSTRUCTIONS if access.anima_identities else "",
            _ANIMA_MEMORIES_INSTRUCTIONS if access.anima_memories else "",
        )
    )


def manager_instructions(*, memory_map: str, access: ManagerFileAccess, reflection: bool = False) -> str:
    """The Anthropic runtime's general Memory Manager instructions, ending with the memory map.

    They counter the memory tool's built-in prompt, which asks the model to
    record its progress in the memory directory (Phase 1 check 8): these files
    hold only curated facts.
    """

    search_tools = "search_memory_files" + (f" and {MEMORY_TOOL_READ_REFLECTION_TURNS}" if reflection else "")
    return (
        "You are Animama's user memory manager. You help the user keep their long-term memory files accurate, "
        "concise and well organized.\n\n"
        "# Workspace\n"
        "The memory tool works on the user's memory files under /memories; it is the only file access you have, "
        f"together with {search_tools}. There is no shell. Viewing a directory lists its files; viewing a file "
        "shows it with line numbers. The memory map at the end lists every file with its description, and "
        "search_memory_files finds text inside files.\n\n"
        "# What the memory files hold\n"
        "They hold curated, durable facts about the user and their world for future conversations: preferences, "
        "people, projects, plans and decisions. They are not your notes. Never create or change a file to record "
        "your own progress, status, task lists or scratch thoughts, whatever the memory tool's own guidance says: "
        "this conversation keeps its own state, and every change you propose interrupts the user for review. Make "
        "only the changes the user's request calls for, in the most relevant existing file, and create a file only "
        "when no existing file fits.\n\n"
        "# File format\n"
        "Every file starts with a reserved three-line header holding its description, followed by the Markdown "
        "body:\n"
        "---\n"
        'description: "Concise overview of the file."\n'
        "---\n"
        "Descriptions are the birds-eye index shown in the memory map. Give a new file a useful description in "
        "the header of its create file_text. When content changes, review the description on line 2: keep it "
        "verbatim while it is accurate, and update it when the file's scope or durable contents materially change. "
        "Never copy the header into the body or into your replies.\n\n"
        "# Proposing changes\n"
        "Each create, str_replace or insert is a proposal. The user approves or rejects it before it takes effect, "
        "and the tool result tells you which. Propose one change at a time and wait for its result. Prefer "
        "str_replace or insert for edits; use create for a new file, or with a file's complete new content to "
        "rewrite it. Files can be neither deleted nor renamed. Use paths under /memories ending in .md. Files under "
        "/memories/episodes/ are generated logs and read-only. When the user rejects a change, follow their "
        "feedback or finish without that change. When you are done, reply with a short summary for the user.\n"
        f"{_anima_file_instructions(access)}"
        f"\n{memory_map}"
    )


def _replayed_messages(
    history: Sequence[MemoryManagerMessage],
    user_message: MemoryManagerMessage,
) -> list[dict[str, Any]]:
    """Rebuild the run's visible conversation as text, starting with a user turn and ending with the new message."""

    messages: list[dict[str, Any]] = []
    for message in [*(item for item in history if item.id != user_message.id), user_message]:
        if message.role not in _HISTORY_ROLES or not message.content:
            continue
        if not messages and message.role != "user":
            continue
        block = {"type": "text", "text": message.content}
        if messages and messages[-1]["role"] == message.role:
            messages[-1]["content"].append(block)
        else:
            messages.append({"role": message.role, "content": [block]})
    return messages


def _tool_result(tool_use_id: str, content: str, *, is_error: bool = False) -> dict[str, Any]:
    result: dict[str, Any] = {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
    if is_error:
        result["is_error"] = True
    return result


def _with_tool_result(messages: list[dict[str, Any]], result: dict[str, Any]) -> list[dict[str, Any]]:
    """Append the pending call's result, keeping a response's results in the order of its calls."""

    if not messages or messages[-1].get("role") != "user":
        return [*messages, {"role": "user", "content": [result]}]
    # The paused response's other calls were answered already, in the same user turn.
    calls = messages[-2].get("content") if len(messages) >= 2 else None
    order = [block.get("id") for block in calls or () if isinstance(block, dict) and block.get("type") == "tool_use"]

    def position(block: dict[str, Any]) -> int:
        tool_use_id = block.get("tool_use_id")
        return order.index(tool_use_id) if tool_use_id in order else len(order)

    return [*messages[:-1], {"role": "user", "content": sorted([*messages[-1]["content"], result], key=position)}]


def _usage_metadata(progress: _Progress) -> dict[str, Any]:
    usage = progress.usage
    return {
        "requests": usage.requests,
        "input_tokens": usage.input_tokens,
        "output_tokens": usage.output_tokens,
        "total_tokens": usage.total_tokens,
    }


__all__ = [
    "STATE_SCHEMA",
    "AnthropicManagerState",
    "AnthropicMemoryManagerRuntime",
    "manager_instructions",
]
