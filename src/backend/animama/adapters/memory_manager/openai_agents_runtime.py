"""Live OpenAI Agents SDK runtime for the memory manager."""

from __future__ import annotations

import json
from collections.abc import Mapping
from hashlib import sha256
from typing import TYPE_CHECKING, Any

from openai import APIStatusError, AsyncOpenAI

from animama.adapters.openai_agents import OpenAIAgentsRunner, OpenAIAgentsRunOutput
from animama.app.chat.memory_tools import (
    MEMORY_TOOL_LIST_FILES,
    MEMORY_TOOL_READ_FILES,
    MEMORY_TOOL_SEARCH_MEMORY_FILES,
)
from animama.app.ports.anima_port import AnimaRepository
from animama.app.ports.memory_episode_port import MemoryEpisodeRepository
from animama.app.ports.memory_manager_runtime import (
    MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED,
    MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
    MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL,
    MemoryManagerPreviousResponseUnresolvableError,
    MemoryManagerRuntimeApprovalRequest,
    MemoryManagerRuntimeConfigurationError,
    MemoryManagerRuntimeResult,
)
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.user_memory_read_tools import UserMemoryReadToolService
from animama.domain.memory_manager import (
    MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING,
    MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING,
    MemoryManagerApproval,
    MemoryManagerEpisodeTaskState,
    MemoryManagerMessage,
    MemoryManagerRun,
)
from animama.logging import get_logger

from .episode_processing import load_episode_processing_batch, render_episode_processing_instructions
from .workspace import MemoryManagerPatchRejected, MemoryManagerVirtualWorkspace

if TYPE_CHECKING:
    from agents import Agent, RunConfig
    from agents.editor import ApplyPatchEditor

_MAX_MANAGER_TURNS = 8
_MAX_INVALID_PATCH_RESUMES = 2
_TRACE_WORKFLOW_NAME = "Animama memory manager"


class OpenAIAgentsMemoryManagerRuntime:
    """OpenAI Agents SDK runtime over Animama's virtual memory workspace."""

    name = "openai_agents"

    def __init__(
        self,
        *,
        user_id: str,
        memory_entries: MemoryEntryService,
        memory_episodes: MemoryEpisodeRepository | None = None,
        animas: AnimaRepository | None = None,
        api_key: str | None,
        base_url: str | None,
        model: str,
        timeout_seconds: float,
    ) -> None:
        self._user_id = user_id
        self._memory_entries = memory_entries
        self._memory_episodes = memory_episodes
        self._animas = animas
        self._api_key = (api_key or "").strip()
        self._base_url = (base_url or "").strip().rstrip("/") or None
        self._model = model.strip() or "gpt-5.4-mini"
        self._timeout_seconds = max(0.1, float(timeout_seconds))
        self._runner = OpenAIAgentsRunner()
        self._log = get_logger("adapters.memory_manager.openai_agents")

    async def run_user_message(
        self,
        *,
        run: MemoryManagerRun,
        user_message: MemoryManagerMessage,
    ) -> MemoryManagerRuntimeResult:
        """Run the live memory manager for a new user message."""

        self._require_api_key()
        workspace = self._workspace_for_run(run)
        client = self._client()
        try:
            agent, run_config = await self._build_agent(
                run=run,
                workspace=workspace,
                client=client,
                editor=_approval_required_patch_editor(),
            )
            output = await self._runner.run(
                agent=agent,
                input_value=user_message.content,
                context=_context_for_run(run),
                run_config=run_config,
                max_turns=_MAX_MANAGER_TURNS,
                previous_response_id=run.openai_previous_response_id,
                auto_previous_response_id=True,
            )
            return await self._runtime_result_from_sdk_output(
                run=run,
                agent=agent,
                run_config=run_config,
                workspace=workspace,
                output=output,
            )
        except APIStatusError as exc:
            if run.openai_previous_response_id and _is_unresolvable_previous_response_error(exc):
                raise MemoryManagerPreviousResponseUnresolvableError() from exc
            raise MemoryManagerRuntimeConfigurationError("The OpenAI Memory Manager request failed.") from exc
        except Exception as exc:
            if _is_max_turns_exceeded(exc):
                return _blocked_result(
                    "The Memory Manager reached its turn limit before completing the review.",
                    runtime=self.name,
                )
            if isinstance(exc, MemoryManagerRuntimeConfigurationError):
                raise
            raise MemoryManagerRuntimeConfigurationError("The OpenAI Memory Manager runtime failed.") from exc
        finally:
            await client.close()

    async def resume_approval_decision(
        self,
        *,
        run: MemoryManagerRun,
        approval: MemoryManagerApproval,
        decision: str,
        feedback: str | None = None,
    ) -> MemoryManagerRuntimeResult:
        """Best-effort resume of the SDK state after an approval decision."""

        if not run.serialized_agent_state:
            return _blocked_result(
                "The Memory Manager approval state is missing and cannot be resumed.",
                runtime=self.name,
                serialized_agent_state=None,
                metadata={"resume": "skipped_missing_state"},
            )

        self._require_api_key()
        workspace = self._workspace_for_run(run)
        client = self._client()
        try:
            editor = _committed_approval_patch_editor(approval=approval if decision == "approve" else None)
            agent, run_config = await self._build_agent(
                run=run,
                workspace=workspace,
                client=client,
                editor=editor,
            )
            state = await self._runner.load_state(
                agent=agent,
                serialized_state=run.serialized_agent_state,
                context=_context_for_run(run),
            )
            interruption = _find_interruption_for_approval(state.get_interruptions(), approval)
            if interruption is None:
                return _blocked_result(
                    "The Memory Manager approval interruption is missing and cannot be resumed.",
                    runtime=self.name,
                    serialized_agent_state=run.serialized_agent_state,
                    metadata={"resume": "skipped_missing_interruption"},
                )

            if decision == "approve":
                state.approve(interruption)
            else:
                rejection_message = f"The user rejected the proposed change to `{approval.target_path}`."
                if feedback:
                    rejection_message = f"{rejection_message} User feedback: {feedback}"
                state.reject(
                    interruption,
                    rejection_message=rejection_message,
                )
            output = await self._runner.resume_state(
                agent=agent,
                state=state,
                max_turns=_MAX_MANAGER_TURNS,
                run_config=run_config,
            )
            return await self._runtime_result_from_sdk_output(
                run=run,
                agent=agent,
                run_config=run_config,
                workspace=workspace,
                output=output,
            )
        except APIStatusError as exc:
            if run.openai_previous_response_id and _is_unresolvable_previous_response_error(exc):
                raise MemoryManagerPreviousResponseUnresolvableError() from exc
            raise MemoryManagerRuntimeConfigurationError("The OpenAI Memory Manager request failed.") from exc
        except Exception as exc:
            if _is_max_turns_exceeded(exc):
                return _blocked_result(
                    "The Memory Manager reached its turn limit before completing the review.",
                    runtime=self.name,
                )
            if isinstance(exc, MemoryManagerRuntimeConfigurationError):
                raise
            raise MemoryManagerRuntimeConfigurationError("The OpenAI Memory Manager runtime failed.") from exc
        finally:
            await client.close()

    def _workspace_for_run(self, run: MemoryManagerRun) -> MemoryManagerVirtualWorkspace:
        return MemoryManagerVirtualWorkspace(
            user_id=self._user_id,
            memory_entries=self._memory_entries,
            allow_anima_identities=_allows_anima_identities(run),
        )

    def _require_api_key(self) -> None:
        if not self._api_key:
            raise MemoryManagerRuntimeConfigurationError("OPENAI_API_KEY is required for the memory manager")

    def _client(self) -> AsyncOpenAI:
        kwargs: dict[str, Any] = {
            "api_key": self._api_key,
            "timeout": self._timeout_seconds,
        }
        if self._base_url:
            kwargs["base_url"] = self._base_url
        return AsyncOpenAI(**kwargs)

    async def _build_agent(
        self,
        *,
        run: MemoryManagerRun,
        workspace: MemoryManagerVirtualWorkspace,
        client: AsyncOpenAI,
        editor: ApplyPatchEditor,
    ) -> tuple[Agent[Any], RunConfig]:
        from agents import Agent, ApplyPatchTool, ModelSettings, OpenAIResponsesModel, RunConfig, function_tool

        user_memory_reads = UserMemoryReadToolService(
            memory_entries=self._memory_entries,
            include_anima_identities=_allows_anima_identities(run),
        )
        memory_map = await user_memory_reads.render_memory_map(user_id=self._user_id)

        @function_tool(name_override=MEMORY_TOOL_LIST_FILES)
        async def memory_list_files() -> dict[str, Any]:
            """List user memory files."""

            return await user_memory_reads.list_files(user_id=self._user_id)

        @function_tool(name_override=MEMORY_TOOL_READ_FILES)
        async def memory_read_files(paths: str | list[str]) -> dict[str, Any]:
            """Read patchable user memory documents by relative markdown path."""

            return await user_memory_reads.read_files(
                user_id=self._user_id,
                paths=paths,
                native_patch_mode=True,
            )

        @function_tool(name_override=MEMORY_TOOL_SEARCH_MEMORY_FILES)
        async def search_memory_files(
            query: str,
            include_episodic_memory: bool,
        ) -> dict[str, Any]:
            """Search user memory files with PostgreSQL web-search syntax.

            Episode logs may optionally be excluded.
            """

            return await user_memory_reads.search_files(
                user_id=self._user_id,
                query=query,
                include_episodic_memory=include_episodic_memory,
            )

        instructions = await self._instructions_for_run(run=run, memory_map=memory_map)
        agent = Agent(
            name="Animama Memory Manager",
            instructions=instructions,
            model=OpenAIResponsesModel(self._model, client),
            model_settings=ModelSettings(
                store=True,
                extra_args={
                    "prompt_cache_key": _memory_manager_prompt_cache_key(
                        run_id=run.id,
                        model=self._model,
                    )
                },
            ),
            tools=[
                memory_list_files,
                memory_read_files,
                search_memory_files,
                ApplyPatchTool(editor=editor, needs_approval=True),
            ],
        )
        run_config = RunConfig(
            tracing_disabled=False,
            trace_include_sensitive_data=False,
            workflow_name=_TRACE_WORKFLOW_NAME,
            group_id=run.id,
            trace_metadata={
                "memory_manager_run_id": run.id,
                "runtime": self.name,
                "model": self._model,
            },
        )
        return agent, run_config

    async def _instructions_for_run(self, *, run: MemoryManagerRun, memory_map: str) -> str:
        general = _instructions(memory_map=memory_map, anima_identities=_allows_anima_identities(run))
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
        specialized = render_episode_processing_instructions(batch=batch)
        return f"{general}\n\n{specialized}"

    async def _runtime_result_from_sdk_output(
        self,
        *,
        run: MemoryManagerRun,
        agent: Agent[Any],
        run_config: RunConfig,
        workspace: MemoryManagerVirtualWorkspace,
        output: OpenAIAgentsRunOutput,
        invalid_resume_count: int = 0,
        latest_response_id: str | None = None,
    ) -> MemoryManagerRuntimeResult:
        latest_response_id = output.last_response_id or latest_response_id
        interruptions = output.interruptions
        metadata = {
            "runtime": self.name,
            "model": self._model,
            **output.metadata,
            "interruption_count": len(interruptions),
        }
        if not interruptions:
            final_output = output.final_output.strip() if output.final_output is not None else ""
            if not final_output:
                return _blocked_result(
                    "The Memory Manager ended without a final response.",
                    runtime=self.name,
                    openai_previous_response_id=latest_response_id,
                    usage_metadata=output.usage_metadata,
                    metadata=metadata,
                )
            return MemoryManagerRuntimeResult(
                assistant_message=final_output,
                serialized_agent_state=None,
                openai_previous_response_id=latest_response_id,
                usage_metadata=output.usage_metadata,
                metadata=metadata,
                summary="Live OpenAI Agents memory-manager run",
                outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
            )

        state = output.state
        if state is None:
            return _blocked_result(
                "I could not prepare a memory preview: the SDK did not return resumable state.",
                runtime=self.name,
                serialized_agent_state=None,
                openai_previous_response_id=latest_response_id,
                usage_metadata=output.usage_metadata,
                metadata=metadata,
                summary="Live OpenAI Agents memory-manager run",
            )
        approvals: list[MemoryManagerRuntimeApprovalRequest] = []
        invalid_messages: list[str] = []
        for interruption in interruptions:
            try:
                approval = await self._approval_from_interruption(workspace=workspace, interruption=interruption)
            except MemoryManagerPatchRejected as exc:
                invalid_messages.append(exc.detail)
                state.reject(interruption, rejection_message=exc.detail)
                continue
            approvals.append(approval)

        if approvals:
            if invalid_messages:
                metadata["auto_rejected_invalid_patch_count"] = len(invalid_messages)
            return MemoryManagerRuntimeResult(
                assistant_message="I prepared a memory file preview. Review the diff before approving it.",
                approvals=approvals,
                serialized_agent_state=state.to_string(),
                openai_previous_response_id=latest_response_id,
                usage_metadata=output.usage_metadata,
                metadata=metadata,
                summary="Live OpenAI Agents memory-manager run",
                outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL,
            )

        if invalid_messages and invalid_resume_count < _MAX_INVALID_PATCH_RESUMES:
            resumed = await self._runner.resume_state(
                agent=agent,
                state=state,
                max_turns=_MAX_MANAGER_TURNS,
                run_config=run_config,
            )
            return await self._runtime_result_from_sdk_output(
                run=run,
                agent=agent,
                run_config=run_config,
                workspace=workspace,
                output=resumed,
                invalid_resume_count=invalid_resume_count + 1,
                latest_response_id=latest_response_id,
            )

        message = (
            "I could not prepare a memory preview: "
            f"{invalid_messages[0] if invalid_messages else 'the patch request was invalid'}."
        )
        return _blocked_result(
            message,
            runtime=self.name,
            serialized_agent_state=None,
            openai_previous_response_id=latest_response_id,
            usage_metadata=output.usage_metadata,
            metadata={**metadata, "invalid_patch_messages": invalid_messages},
            summary="Live OpenAI Agents memory-manager run",
        )

    async def _approval_from_interruption(
        self,
        *,
        workspace: MemoryManagerVirtualWorkspace,
        interruption: Any,
    ) -> MemoryManagerRuntimeApprovalRequest:
        call_id = _interruption_call_id(interruption)
        if not isinstance(call_id, str) or not call_id:
            raise MemoryManagerPatchRejected("Patch approval is missing a tool call id")
        payload = _apply_patch_payload(interruption)
        operations = _operations_from_payload(payload)
        if len(operations) != 1:
            raise MemoryManagerPatchRejected("Submit exactly one memory file operation per approval")
        operation = operations[0]
        operation_type = str(_get_value(operation, "type") or "")
        path = _get_value(operation, "path")
        diff = _get_value(operation, "diff")
        if not isinstance(path, str):
            raise MemoryManagerPatchRejected("Patch operation is missing a path")
        return await workspace.plan_v4a_operation(
            operation_type=operation_type,
            path=path,
            diff=diff if isinstance(diff, str) else None,
            metadata={
                "runtime": self.name,
                "sdk_call_id": call_id,
                "sdk_tool_name": _interruption_tool_name(interruption),
                "sdk_operation_type": operation_type,
                "v4a_diff": diff if isinstance(diff, str) else None,
            },
        )


def _approval_required_patch_editor() -> ApplyPatchEditor:
    """Build an SDK editor that should only run if approval pausing fails."""

    from agents.editor import ApplyPatchEditor, ApplyPatchOperation, ApplyPatchResult

    class ApprovalRequiredPatchEditor(ApplyPatchEditor):
        async def create_file(self, operation: ApplyPatchOperation) -> ApplyPatchResult:
            return ApplyPatchResult(status="failed", output=f"Patch for `{operation.path}` requires approval.")

        async def update_file(self, operation: ApplyPatchOperation) -> ApplyPatchResult:
            return ApplyPatchResult(status="failed", output=f"Patch for `{operation.path}` requires approval.")

        async def delete_file(self, operation: ApplyPatchOperation) -> ApplyPatchResult:
            return ApplyPatchResult(status="failed", output=f"Deleting `{operation.path}` is not allowed.")

    return ApprovalRequiredPatchEditor()


def _committed_approval_patch_editor(*, approval: MemoryManagerApproval | None) -> ApplyPatchEditor:
    """Build an SDK editor that acknowledges one already-committed approval."""

    from agents.editor import ApplyPatchEditor, ApplyPatchOperation, ApplyPatchResult

    class CommittedApprovalPatchEditor(ApplyPatchEditor):
        def __init__(self, *, approval: MemoryManagerApproval | None) -> None:
            self._approval = approval

        async def create_file(self, operation: ApplyPatchOperation) -> ApplyPatchResult:
            return self._result_for(operation)

        async def update_file(self, operation: ApplyPatchOperation) -> ApplyPatchResult:
            return self._result_for(operation)

        async def delete_file(self, operation: ApplyPatchOperation) -> ApplyPatchResult:
            return ApplyPatchResult(status="failed", output=f"Deleting `{operation.path}` is not allowed.")

        def _result_for(self, operation: ApplyPatchOperation) -> ApplyPatchResult:
            if self._approval is None:
                return ApplyPatchResult(status="failed", output=f"Patch for `{operation.path}` was not approved.")
            metadata = dict(self._approval.operation_metadata or {})
            if (
                # Stored paths compare case-insensitively; identity targets are canonicalized.
                operation.path.casefold() == self._approval.target_path.casefold()
                and operation.type == metadata.get("sdk_operation_type")
                and operation.diff == metadata.get("v4a_diff")
            ):
                return ApplyPatchResult(
                    status="completed",
                    output=f"Committed approved memory change for `{operation.path}`.",
                )
            return ApplyPatchResult(
                status="failed",
                output=f"Patch for `{operation.path}` does not match the approved operation.",
            )

    return CommittedApprovalPatchEditor(approval=approval)


def _context_for_run(run: MemoryManagerRun) -> dict[str, Any]:
    return {
        "runtime": "memory_manager",
        "run_id": run.id,
        "user_id": run.user_id,
    }


def _allows_anima_identities(run: MemoryManagerRun) -> bool:
    """Only general runs may see or change Anima identities; episode processing may not."""

    return run.kind != MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING


_ANIMA_IDENTITY_INSTRUCTIONS = (
    "Entries whose path is animas/<anima_id>/IDENTITY.md are each Anima's required identity; the map's "
    "anima field names that Anima. Entries are in Anima creation order; when names repeat, the workspace "
    "labels the second and later ones Name (2), Name (3), and so on. Read them when the user asks about an "
    "Anima. Propose an update_file change "
    "to an identity only when the user's request is about that Anima's identity or personality. Never create, "
    "delete or empty an identity, and never add other files under animas/.\n"
)


def _instructions(*, memory_map: str, anima_identities: bool = False) -> str:
    identity_guidance = _ANIMA_IDENTITY_INSTRUCTIONS if anima_identities else ""
    return (
        "You are Animama's user memory manager. Help the user maintain durable markdown memory files.\n"
        "You work only in the virtual user memory workspace. Do not ask for or assume shell access.\n"
        "Use memory_list_files, memory_read_files, and search_memory_files to inspect memory.\n"
        "Descriptions in the memory map are a concise birds-eye index of each file without reading it. "
        "Give new files useful descriptions. Whenever content changes, review the description too. Preserve the "
        "description verbatim when it remains accurate, and update it when the file's scope or durable contents "
        "materially change.\n"
        "memory_read_files returns a synthetic patch document in each file's content field. Its first three lines "
        "are a reserved header in exactly this form:\n"
        "`---\n"
        'description: "Concise overview of the file."\n'
        "---`\n"
        "The remaining text is the stored Markdown body. Calculate apply_patch diffs against the entire returned "
        "content. "
        "For create_file, create both the reserved header with a suitable description and body. "
        "Never copy the synthetic header into "
        "the Markdown body or user-facing text.\n"
        "Similarly, for update_file operations, "
        "keep the descriptions up to date through the reserved description header."
        "When proposing a memory edit, use apply_patch with exactly one create_file or update_file operation. "
        "Never request delete_file. Only use relative POSIX paths ending in .md.\n"
        "The user must approve apply_patch changes before they become durable.\n"
        f"{identity_guidance}"
        f"\n{memory_map}"
    )


def _blocked_result(
    message: str,
    *,
    runtime: str,
    serialized_agent_state: str | None = None,
    openai_previous_response_id: str | None = None,
    usage_metadata: dict[str, Any] | None = None,
    metadata: dict[str, Any] | None = None,
    summary: str | None = None,
) -> MemoryManagerRuntimeResult:
    """Return a typed incomplete result that can never finalize episodes."""

    return MemoryManagerRuntimeResult(
        assistant_message=message,
        serialized_agent_state=serialized_agent_state,
        openai_previous_response_id=openai_previous_response_id,
        usage_metadata=usage_metadata,
        metadata={"runtime": runtime, **dict(metadata or {})},
        summary=summary,
        error=message,
        outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED,
    )


def _is_max_turns_exceeded(exc: Exception) -> bool:
    """Avoid importing the optional SDK exception at module import time."""

    from agents import MaxTurnsExceeded

    return isinstance(exc, MaxTurnsExceeded)


def _memory_manager_prompt_cache_key(*, run_id: str, model: str) -> str:
    """Return a private stable cache bucket for one manager run and model."""

    return sha256(f"memory_manager\x1f{run_id}\x1f{model}".encode()).hexdigest()


def _is_unresolvable_previous_response_error(exc: APIStatusError) -> bool:
    """Recognize OpenAI errors that specifically reject a stored response cursor."""

    if exc.status_code not in {400, 404}:
        return False
    body = exc.body if isinstance(exc.body, Mapping) else {}
    nested_error = body.get("error")
    if isinstance(nested_error, Mapping):
        body = nested_error
    param = body.get("param")
    if param == "previous_response_id":
        return True
    code = str(body.get("code") or "").lower()
    message = str(body.get("message") or exc).lower()
    mentions_previous_response = "previous_response_id" in message or "previous response" in message
    cannot_resolve = any(token in f"{code} {message}" for token in ("not found", "expired", "unresolvable"))
    return mentions_previous_response and cannot_resolve


def _apply_patch_payload(interruption: Any) -> dict[str, Any]:
    raw = getattr(interruption, "raw_item", None)
    for source in (_mapping_from_value(interruption), _mapping_from_value(raw)):
        for key in ("arguments", "input", "params"):
            value = source.get(key)
            if isinstance(value, str):
                try:
                    parsed = json.loads(value or "{}")
                except json.JSONDecodeError as exc:
                    raise MemoryManagerPatchRejected(f"Patch arguments are invalid JSON: {exc}") from exc
                if isinstance(parsed, Mapping):
                    return dict(parsed)
            if isinstance(value, Mapping):
                return dict(value)
    raw_mapping = _mapping_from_value(raw)
    return raw_mapping


def _operations_from_payload(payload: Mapping[str, Any]) -> list[Any]:
    operations = payload.get("operations")
    if isinstance(operations, list):
        return operations
    operation = payload.get("operation")
    if operation is not None:
        return [operation]
    raise MemoryManagerPatchRejected("Patch request is missing an operation")


def _mapping_from_value(value: Any) -> dict[str, Any]:
    if isinstance(value, Mapping):
        return dict(value)
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        dumped = model_dump()
        if isinstance(dumped, Mapping):
            return dict(dumped)
    result: dict[str, Any] = {}
    for key in ("type", "name", "call_id", "arguments", "operation", "operations", "input", "params"):
        attr = getattr(value, key, None)
        if attr is not None:
            result[key] = attr
    return result


def _get_value(value: Any, key: str) -> Any:
    if isinstance(value, Mapping):
        return value.get(key)
    return getattr(value, key, None)


def _interruption_call_id(interruption: Any) -> str | None:
    value = getattr(interruption, "call_id", None)
    if isinstance(value, str) and value:
        return value
    raw = getattr(interruption, "raw_item", None)
    value = _get_value(raw, "call_id")
    if isinstance(value, str) and value:
        return value
    return None


def _interruption_tool_name(interruption: Any) -> str | None:
    value = getattr(interruption, "tool_name", None) or getattr(interruption, "name", None)
    if isinstance(value, str) and value:
        return value
    raw = getattr(interruption, "raw_item", None)
    value = _get_value(raw, "name")
    if isinstance(value, str) and value:
        return value
    return None


def _find_interruption_for_approval(interruptions: list[Any], approval: MemoryManagerApproval) -> Any | None:
    expected_call_id = dict(approval.operation_metadata or {}).get("sdk_call_id")
    for interruption in interruptions:
        if _interruption_call_id(interruption) == expected_call_id:
            return interruption
    return None


__all__ = ["OpenAIAgentsMemoryManagerRuntime"]
