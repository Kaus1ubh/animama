"""Deterministic memory-manager runtime for tests and local LLM-skip mode."""

from __future__ import annotations

import re
from collections.abc import Sequence

from animama.app.ports.anima_port import AnimaRepository
from animama.app.ports.chat_message_port import ChatMessageRepository
from animama.app.ports.memory_episode_port import MemoryEpisodeRepository
from animama.app.ports.memory_manager_runtime import (
    MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED,
    MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
    MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL,
    MemoryManagerRuntimeResult,
)
from animama.app.services.anima_identity_memory import anima_memories_manager_path, manager_file_access_for_run
from animama.app.services.memory_entry_service import MemoryEntryNotFoundError, MemoryEntryService
from animama.domain.memory_entry import MemoryEntry
from animama.domain.memory_manager import (
    MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING,
    MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING,
    MemoryManagerApproval,
    MemoryManagerEpisodeTaskState,
    MemoryManagerMessage,
    MemoryManagerReflectionTaskState,
    MemoryManagerRun,
    format_turn_count,
)

from .episode_processing import EpisodeProcessingBatchItem, load_episode_processing_batch
from .reflection import ReflectionTurnReader, reflection_task_or_none
from .workspace import MemoryManagerPatchRejected, MemoryManagerVirtualWorkspace

_MARKDOWN_PATH_RE = re.compile(r"(?P<path>[A-Za-z0-9._{}\\/-]+\.md)")
_SISTER_RE = re.compile(r"\bsister\s+(?P<name>[A-Za-z][A-Za-z0-9_-]{0,63})\b", re.IGNORECASE)
_DETERMINISTIC_NOTE_MAX_CHARS = 500
_DETERMINISTIC_EPISODE_PATH = "notes/episodic-memory.md"
_DETERMINISTIC_REFLECTION_EXCERPT_MAX_CHARS = 200
_OUR_STORY_HEADING = "## Our story"


class DeterministicMemoryManagerRuntime:
    """Draft approvals without model calls for tests and local LLM-skip mode."""

    name = "deterministic_test"

    def __init__(
        self,
        *,
        user_id: str,
        memory_entries: MemoryEntryService,
        memory_episodes: MemoryEpisodeRepository | None = None,
        animas: AnimaRepository | None = None,
        chat_messages: ChatMessageRepository | None = None,
    ) -> None:
        self._user_id = user_id
        self._memory_entries = memory_entries
        self._memory_episodes = memory_episodes
        self._animas = animas
        self._chat_messages = chat_messages
        self._workspace = MemoryManagerVirtualWorkspace(user_id=user_id, memory_entries=memory_entries)

    def _workspace_for(self, run: MemoryManagerRun) -> MemoryManagerVirtualWorkspace:
        """Use the run's file scope, matching the live runtime."""

        return MemoryManagerVirtualWorkspace(
            user_id=self._user_id,
            memory_entries=self._memory_entries,
            access=manager_file_access_for_run(run),
        )

    async def run_user_message(
        self,
        *,
        run: MemoryManagerRun,
        user_message: MemoryManagerMessage,
        history: Sequence[MemoryManagerMessage] = (),
    ) -> MemoryManagerRuntimeResult:
        if self._is_processing_run(run):
            return await self._run_episode_processing(run=run, source_message_id=user_message.id)
        candidate_path = _extract_candidate_path(user_message.content)
        if candidate_path is None:
            # Without a target path, a Reflection reflects on its batch; any other run explains itself.
            try:
                reflection = reflection_task_or_none(run)
            except ValueError as exc:
                return self._blocked_reflection_result(str(exc))
            if reflection is not None:
                return await self._run_reflection(run=run, task=reflection, source_message_id=user_message.id)
            return MemoryManagerRuntimeResult(
                assistant_message=(
                    "I can help maintain memory. Include a target markdown path like `people/beth.md` "
                    "and I will prepare a preview for approval."
                ),
                metadata={"runtime": self.name},
                summary="Deterministic memory-manager test run",
                outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
            )

        workspace = self._workspace_for(run)
        try:
            new_description = await self._candidate_description(
                path=candidate_path,
                created_description=_general_description(candidate_path),
                workspace=workspace,
            )
            approval = await workspace.plan_full_content(
                path=candidate_path,
                new_content=await self._candidate_content(
                    path=candidate_path,
                    user_message=user_message.content,
                    workspace=workspace,
                ),
                new_description=new_description,
                summary=None,
                metadata={
                    "runtime": self.name,
                    "source_message_id": user_message.id,
                },
            )
        except MemoryManagerPatchRejected as exc:
            return MemoryManagerRuntimeResult(
                assistant_message=f"I could not prepare a memory preview: {exc.detail}.",
                metadata={"runtime": self.name, "rejection": exc.detail},
                summary="Deterministic memory-manager test run",
                outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
            )

        return MemoryManagerRuntimeResult(
            assistant_message="I prepared a memory file preview. Review the diff before approving it.",
            approvals=[approval],
            serialized_agent_state=f"deterministic:{run.id}:{user_message.id}",
            metadata={"runtime": self.name},
            summary="Deterministic memory-manager test run",
            outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL,
        )

    async def _candidate_content(
        self,
        *,
        path: str,
        user_message: str,
        workspace: MemoryManagerVirtualWorkspace,
    ) -> str:
        note = " ".join(user_message.strip().split())
        if len(note) > _DETERMINISTIC_NOTE_MAX_CHARS:
            note = f"{note[: _DETERMINISTIC_NOTE_MAX_CHARS - 3].rstrip()}..."
        current = await _current_file_or_none(workspace, path)
        if current is None:
            title = path.rsplit("/", 1)[-1].removesuffix(".md").replace("-", " ").replace("_", " ").title()
            return f"# {title}\n\n- Memory manager draft: {note}\n"
        base = (current.content or "").rstrip()
        prefix = f"{base}\n\n" if base else ""
        return f"{prefix}- Memory manager draft: {note}\n"

    async def _candidate_description(
        self,
        *,
        path: str,
        created_description: str,
        workspace: MemoryManagerVirtualWorkspace,
    ) -> str:
        """Preserve an existing overview or provide one for a deterministic create."""

        current = await _current_file_or_none(workspace, path)
        if current is None:
            return created_description
        return current.description or created_description

    async def resume_approval_decision(
        self,
        *,
        run: MemoryManagerRun,
        approval: MemoryManagerApproval,
        decision: str,
        feedback: str | None = None,
    ) -> MemoryManagerRuntimeResult:
        normalized = decision.strip().lower()
        if self._is_processing_run(run):
            if (
                normalized == "reject"
                and feedback
                and not dict(approval.operation_metadata or {}).get("episode_processing_revision")
            ):
                candidate_path = _extract_candidate_path(feedback)
                if candidate_path is not None:
                    return await self._episode_revision(
                        run=run,
                        path=candidate_path,
                        source_message_id=dict(approval.operation_metadata or {}).get("source_message_id"),
                    )
            verb = "approved" if normalized == "approve" else "rejected"
            return MemoryManagerRuntimeResult(
                assistant_message=f"Episode review complete after the memory change was {verb}.",
                serialized_agent_state=None,
                metadata={"runtime": self.name, "resumed_decision": normalized},
                summary="Deterministic episodic-memory processing run",
                outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
            )
        if normalized == "approve":
            message = f"Approved memory change for `{approval.target_path}`."
        else:
            message = f"Rejected memory change for `{approval.target_path}`."
        return MemoryManagerRuntimeResult(
            assistant_message=message,
            serialized_agent_state=None,
            metadata={"runtime": self.name, "resumed_decision": normalized},
            summary="Deterministic memory-manager test run",
            outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
        )

    async def _run_reflection(
        self,
        *,
        run: MemoryManagerRun,
        task: MemoryManagerReflectionTaskState,
        source_message_id: str,
    ) -> MemoryManagerRuntimeResult:
        """Propose one dated ``Our story`` line for the batch, or nothing when it is already there.

        The line quotes the latest turn, so a batch whose latest turn text is
        already in ``MEMORIES.md`` proposes nothing and leaves the turns uncovered.
        """

        if self._chat_messages is None:
            return self._blocked_reflection_result("Reflection is not configured")
        reader = ReflectionTurnReader(chat_messages=self._chat_messages, user_id=self._user_id, task=task)
        turns = await reader.read_all()
        latest = turns[-1] if turns else None
        excerpt = " ".join((latest.user_text or latest.anima_text or "").split()) if latest is not None else ""
        if len(excerpt) > _DETERMINISTIC_REFLECTION_EXCERPT_MAX_CHARS:
            excerpt = f"{excerpt[: _DETERMINISTIC_REFLECTION_EXCERPT_MAX_CHARS - 3].rstrip()}..."
        path = anima_memories_manager_path(task.anima_id)
        workspace = self._workspace_for(run)
        current = await _current_file_or_none(workspace, path)
        current_content = (current.content or "") if current is not None else ""
        if latest is None or not excerpt or excerpt in current_content:
            return MemoryManagerRuntimeResult(
                assistant_message=f"Nothing new from these turns is worth adding to {task.anima_name}'s MEMORIES.md.",
                metadata={"runtime": self.name},
                summary="Deterministic Reflection run",
                outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
            )
        turn_count = format_turn_count(len(turns))
        note = f"- {reader.local_time(latest.position)[:10]}: {excerpt} ({turn_count} reflected)"
        try:
            approval = await workspace.plan_full_content(
                path=path,
                new_content=_with_our_story_line(current_content, note),
                new_description=current.description if current is not None else None,
                summary=f"Reflect on {turn_count} with {task.anima_name}",
                metadata={"runtime": self.name, "source_message_id": source_message_id},
            )
        except MemoryManagerPatchRejected as exc:
            return self._blocked_reflection_result(exc.detail)
        return MemoryManagerRuntimeResult(
            assistant_message=f"I prepared a reflection for {task.anima_name}'s MEMORIES.md. Review the diff.",
            approvals=[approval],
            serialized_agent_state=f"deterministic:{run.id}:reflection",
            metadata={"runtime": self.name},
            summary="Deterministic Reflection run",
            outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL,
        )

    def _blocked_reflection_result(self, detail: str) -> MemoryManagerRuntimeResult:
        return MemoryManagerRuntimeResult(
            assistant_message=f"I could not reflect on these turns: {detail}.",
            metadata={"runtime": self.name},
            summary="Deterministic Reflection run",
            error=detail,
            outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED,
        )

    def _is_processing_run(self, run: MemoryManagerRun) -> bool:
        if run.kind != MEMORY_MANAGER_RUN_KIND_EPISODE_PROCESSING:
            return False
        try:
            task = MemoryManagerEpisodeTaskState.from_dict(run.task_state)
        except ValueError:
            return True
        return task.status == MEMORY_MANAGER_EPISODE_TASK_STATUS_PROCESSING

    async def _run_episode_processing(
        self,
        *,
        run: MemoryManagerRun,
        source_message_id: str,
    ) -> MemoryManagerRuntimeResult:
        try:
            _task, batch = await self._episode_batch(run)
        except ValueError as exc:
            return self._blocked_episode_result(str(exc))
        try:
            current = await self._memory_entries.get_entry_by_path(
                user_id=self._user_id,
                path=_DETERMINISTIC_EPISODE_PATH,
            )
        except MemoryEntryNotFoundError:
            current = None
        if current is not None and all(item.episode.text in (current.content or "") for item in batch):
            return MemoryManagerRuntimeResult(
                assistant_message="Episode review complete; the fixed batch is already represented in memory.",
                metadata={"runtime": self.name},
                summary="Deterministic episodic-memory processing run",
                outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_COMPLETED,
            )
        return await self._episode_approval(
            run=run,
            path=_DETERMINISTIC_EPISODE_PATH,
            batch=batch,
            source_message_id=source_message_id,
            revision=False,
        )

    async def _episode_revision(
        self,
        *,
        run: MemoryManagerRun,
        path: str,
        source_message_id: object,
    ) -> MemoryManagerRuntimeResult:
        try:
            _task, batch = await self._episode_batch(run)
        except ValueError as exc:
            return self._blocked_episode_result(str(exc))
        return await self._episode_approval(
            run=run,
            path=path,
            batch=batch,
            source_message_id=source_message_id if isinstance(source_message_id, str) else None,
            revision=True,
        )

    async def _episode_batch(
        self,
        run: MemoryManagerRun,
    ) -> tuple[MemoryManagerEpisodeTaskState, tuple[EpisodeProcessingBatchItem, ...]]:
        if self._memory_episodes is None:
            raise ValueError("Episode processing is not configured")
        return await load_episode_processing_batch(
            run=run,
            memory_episodes=self._memory_episodes,
            animas=self._animas,
        )

    async def _episode_approval(
        self,
        *,
        run: MemoryManagerRun,
        path: str,
        batch: tuple[EpisodeProcessingBatchItem, ...],
        source_message_id: str | None,
        revision: bool,
    ) -> MemoryManagerRuntimeResult:
        content = await self._episode_candidate_content(path=path, batch=batch)
        description = await self._candidate_description(
            path=path,
            created_description="Curated durable memories from reviewed episodes.",
            workspace=self._workspace,
        )
        try:
            approval = await self._workspace.plan_full_content(
                path=path,
                new_content=content,
                new_description=description,
                summary="Curate the fixed episodic-memory batch",
                metadata={
                    "runtime": self.name,
                    "source_message_id": source_message_id,
                    "episode_processing_revision": revision,
                },
            )
        except MemoryManagerPatchRejected as exc:
            return self._blocked_episode_result(exc.detail)
        return MemoryManagerRuntimeResult(
            assistant_message="I prepared a memory file preview for the fixed episode batch.",
            approvals=[approval],
            serialized_agent_state=f"deterministic:{run.id}:episode-processing",
            metadata={"runtime": self.name},
            summary="Deterministic episodic-memory processing run",
            outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_WAITING_APPROVAL,
        )

    async def _episode_candidate_content(
        self,
        *,
        path: str,
        batch: tuple[EpisodeProcessingBatchItem, ...],
    ) -> str:
        try:
            current = await self._memory_entries.get_entry_by_path(user_id=self._user_id, path=path)
        except MemoryEntryNotFoundError:
            current = None
        base = (current.content or "").rstrip() if current is not None else ""
        additions = [f"- {item.episode.text}" for item in batch if item.episode.text not in base]
        title = "# Episodic memory"
        prefix = f"{base}\n\n" if base else f"{title}\n\n"
        joined_additions = "\n".join(additions)
        return f"{prefix}{joined_additions}\n"

    def _blocked_episode_result(self, detail: str) -> MemoryManagerRuntimeResult:
        return MemoryManagerRuntimeResult(
            assistant_message=f"I could not process the fixed episode batch: {detail}.",
            metadata={"runtime": self.name},
            summary="Deterministic episodic-memory processing run",
            error=detail,
            outcome=MEMORY_MANAGER_RUNTIME_OUTCOME_BLOCKED,
        )


async def _current_file_or_none(workspace: MemoryManagerVirtualWorkspace, path: str) -> MemoryEntry | None:
    """Look up a target for drafting; invalid targets are rejected later by planning."""

    try:
        return await workspace.get_file_or_none(path=path)
    except MemoryManagerPatchRejected:
        return None


def _with_our_story_line(content: str, line: str) -> str:
    """Add ``line`` at the end of the ``## Our story`` section, or at the end of the file without one."""

    lines = content.rstrip("\n").split("\n") if content.strip() else []
    start = next((index for index, value in enumerate(lines) if value.strip() == _OUR_STORY_HEADING), None)
    if start is None:
        return "\n".join([*lines, line]) + "\n"
    end = next(
        (index for index in range(start + 1, len(lines)) if lines[index].startswith("## ")),
        len(lines),
    )
    insert_at = end
    while insert_at > start + 1 and not lines[insert_at - 1].strip():
        insert_at -= 1
    return "\n".join([*lines[:insert_at], line, *lines[insert_at:]]) + "\n"


def _extract_candidate_path(content: str) -> str | None:
    explicit = _MARKDOWN_PATH_RE.search(content)
    if explicit is not None:
        return explicit.group("path").strip(".,;:)")
    sister = _SISTER_RE.search(content)
    if sister is not None:
        name = sister.group("name").lower()
        return f"people/{name}.md"
    return None


def _general_description(path: str) -> str:
    subject = path.rsplit("/", 1)[-1].removesuffix(".md").replace("-", " ").replace("_", " ").strip()
    return f"Durable memory about {subject or 'this topic'}."


__all__ = ["DeterministicMemoryManagerRuntime"]
