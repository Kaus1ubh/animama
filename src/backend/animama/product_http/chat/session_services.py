"""Chat-turn collaborators that work in their own short-lived owner sessions."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Mapping
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any

from animama.adapters.memory_patch import AgentsSDKV4AMemoryPatchPlanner
from animama.app.chat import DirectChatMemoryToolService, memory_tool_specs
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.memory_episode_service import MemoryEpisodeService
from animama.domain.settings import preferred_time_zone
from animama.product_http.ports import ProductRepositories

from .setup_helpers import TurnSessions, chat_manager, with_short_lived_session


class SessionBackedChatTurnRecorder:
    """Records final direct chat turns through fresh short-lived sessions.

    A save that has begun completes even if the turn is cancelled meanwhile (a stop
    or a disconnect), and ``on_recorded`` runs once it has, so the stream always
    knows whether the reply was saved.
    """

    def __init__(
        self,
        sessions: TurnSessions,
        *,
        chat_manager_factory: Callable[[ProductRepositories], Any] = chat_manager,
        on_recorded: Callable[[], None] | None = None,
    ) -> None:
        self._sessions = sessions
        self._chat_manager_factory = chat_manager_factory
        self._on_recorded = on_recorded

    async def record_turn(self, **kwargs: Any) -> Any:
        async def _record(repositories: ProductRepositories) -> Any:
            return await self._chat_manager_factory(repositories).record_turn(**kwargs)

        saving = asyncio.create_task(with_short_lived_session(self._sessions, _record), name="direct-chat-save")
        try:
            result = await asyncio.shield(saving)
        except asyncio.CancelledError:
            with suppress(Exception):
                await saving
                self._recorded()
            raise
        self._recorded()
        return result

    def _recorded(self) -> None:
        if self._on_recorded is not None:
            self._on_recorded()


class SessionBackedMemoryEpisodeRecorder:
    """Records episodic memory capture through fresh short-lived sessions."""

    def __init__(self, sessions: TurnSessions) -> None:
        self._sessions = sessions

    async def record_episode_item(
        self,
        *,
        user_id: str,
        text: str,
        source_anima_id: str | None = None,
        source_chat_id: str | None = None,
        source_run_id: str | None = None,
        source_message_id: str | None = None,
    ) -> Any:
        async def _record(repositories: ProductRepositories) -> Any:
            user_settings = await repositories.user_settings.get(user_id)
            local_zone, local_timezone = preferred_time_zone(getattr(user_settings, "preferences", None))
            occurred_at = datetime.now(UTC)
            local_date = occurred_at.astimezone(local_zone).date()
            uow = repositories.unit_of_work
            service = MemoryEpisodeService(
                memory_episodes=repositories.memory_episodes,
                memory_entries=MemoryEntryService(
                    memory_entries=repositories.memory_entries,
                    uow=uow,
                    commit_on_write=False,
                ),
                uow=uow,
                commit_on_write=True,
            )
            return await service.create_episode_item(
                user_id=user_id,
                source_anima_id=source_anima_id,
                source_chat_id=source_chat_id,
                source_run_id=source_run_id,
                source_message_id=source_message_id,
                text=text,
                occurred_at=occurred_at,
                local_date=local_date,
                local_timezone=local_timezone,
            )

        return await with_short_lived_session(self._sessions, _record)


def _chat_tool_memory_entries(repositories: ProductRepositories, *, max_file_bytes: int) -> MemoryEntryService:
    """Build the committed memory service used by chat tools.

    The Anima repository lets a turn reach its own ``MEMORIES.md`` (whose size
    limit the service enforces), and the file limit matches the memory API.
    """

    return MemoryEntryService(
        memory_entries=repositories.memory_entries,
        uow=repositories.unit_of_work,
        animas=repositories.animas,
        max_file_bytes=max_file_bytes,
        commit_on_write=True,
    )


class SessionBackedMemoryToolService:
    """Executes direct-chat memory tools through fresh short-lived sessions."""

    def __init__(
        self,
        sessions: TurnSessions,
        *,
        max_file_bytes: int,
        embedder_factory: Callable[[], Any] | None = None,
        allowed_uploaded_files: Mapping[str, str] | None = None,
    ) -> None:
        self._sessions = sessions
        self._max_file_bytes = max_file_bytes
        self._embedder_factory = embedder_factory
        self._allowed_uploaded_files = dict(allowed_uploaded_files or {})

    def tool_specs(
        self,
        *,
        allow_reads: bool,
        allow_writes: bool,
        allow_uploaded_file_tools: bool = False,
    ) -> tuple[dict[str, Any], ...]:
        return memory_tool_specs(
            allow_reads=allow_reads,
            allow_writes=allow_writes,
            allow_uploaded_file_tools=allow_uploaded_file_tools,
        )

    async def execute(self, **kwargs: Any) -> str:
        async def _execute(repositories: ProductRepositories) -> str:
            memory_entries = _chat_tool_memory_entries(repositories, max_file_bytes=self._max_file_bytes)
            service = DirectChatMemoryToolService(
                memory_entries=memory_entries,
                user_file_processing=repositories.user_file_processing,
                user_file_embedder_factory=self._embedder_factory,
                allowed_uploaded_files=self._allowed_uploaded_files,
                patch_planner=AgentsSDKV4AMemoryPatchPlanner(memory_entries=memory_entries),
            )
            return await service.execute(**kwargs)

        return await with_short_lived_session(self._sessions, _execute)

    async def execute_native_patch(self, **kwargs: Any) -> str:
        """Execute one native Apply Patch call in a fresh committed session."""

        async def _execute(repositories: ProductRepositories) -> str:
            memory_entries = _chat_tool_memory_entries(repositories, max_file_bytes=self._max_file_bytes)
            service = DirectChatMemoryToolService(
                memory_entries=memory_entries,
                patch_planner=AgentsSDKV4AMemoryPatchPlanner(memory_entries=memory_entries),
            )
            return await service.execute_native_patch(**kwargs)

        return await with_short_lived_session(self._sessions, _execute)


__all__ = [
    "SessionBackedChatTurnRecorder",
    "SessionBackedMemoryEpisodeRecorder",
    "SessionBackedMemoryToolService",
]
