from __future__ import annotations

from collections.abc import Awaitable, Callable, Mapping
from contextlib import suppress
from datetime import UTC, datetime
from typing import Any, TypeVar
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from animama.adapters.memory_patch import AgentsSDKV4AMemoryPatchPlanner
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.memory_episode_repo import SQLAlchemyMemoryEpisodeRepository
from animama.adapters.repositories.sqlalchemy.settings_repo import SQLAlchemyUserSettingsRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_file_processing_repo import SQLAlchemyUserFileProcessingRepository
from animama.app.chat import DirectChatMemoryToolService, memory_tool_specs
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.memory_episode_service import MemoryEpisodeService

from .setup_helpers import chat_manager

_T = TypeVar("_T")


async def with_short_lived_session(session_factory: Any, operation: Callable[[Any], Awaitable[_T]]) -> _T:
    session = session_factory()
    try:
        return await operation(session)
    except Exception:
        rollback = getattr(session, "rollback", None)
        if rollback is not None:
            with suppress(Exception):
                await rollback()
        raise
    finally:
        close = getattr(session, "close", None)
        if close is not None:
            with suppress(Exception):
                await close()


class SessionBackedChatTurnRecorder:
    """Records final direct chat turns through fresh short-lived DB sessions."""

    def __init__(self, session_factory: Any, *, chat_manager_factory: Callable[[Any], Any] = chat_manager) -> None:
        self._session_factory = session_factory
        self._chat_manager_factory = chat_manager_factory

    async def record_turn(self, **kwargs: Any) -> Any:
        async def _record(session: Any) -> Any:
            return await self._chat_manager_factory(session).record_turn(**kwargs)

        return await with_short_lived_session(self._session_factory, _record)


def _timezone_from_preferences(preferences: dict[str, Any] | None) -> tuple[ZoneInfo, str]:
    value = preferences.get("timezone") if isinstance(preferences, dict) else None
    if isinstance(value, str):
        name = value.strip()
        if name:
            try:
                return ZoneInfo(name), name
            except ZoneInfoNotFoundError:
                pass
    return ZoneInfo("UTC"), "UTC"


class SessionBackedMemoryEpisodeRecorder:
    """Records episodic memory capture through fresh short-lived DB sessions."""

    def __init__(self, session_factory: Any) -> None:
        self._session_factory = session_factory

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
        async def _record(session: Any) -> Any:
            user_settings = await SQLAlchemyUserSettingsRepository(session).get(user_id)
            local_zone, local_timezone = _timezone_from_preferences(
                dict(getattr(user_settings, "preferences", {}) or {})
            )
            occurred_at = datetime.now(UTC)
            local_date = occurred_at.astimezone(local_zone).date()
            uow = SQLAlchemyUnitOfWork(session)
            service = MemoryEpisodeService(
                memory_episodes=SQLAlchemyMemoryEpisodeRepository(session),
                memory_entries=MemoryEntryService(
                    memory_entries=SQLAlchemyMemoryEntryRepository(session),
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

        return await with_short_lived_session(self._session_factory, _record)


class SessionBackedMemoryToolService:
    """Executes direct-chat memory tools through fresh short-lived DB sessions."""

    def __init__(
        self,
        session_factory: Any,
        *,
        embedder_factory: Callable[[], Any] | None = None,
        allowed_uploaded_files: Mapping[str, str] | None = None,
    ) -> None:
        self._session_factory = session_factory
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
        async def _execute(session: Any) -> str:
            memory_entries = MemoryEntryService(
                memory_entries=SQLAlchemyMemoryEntryRepository(session),
                uow=SQLAlchemyUnitOfWork(session),
                commit_on_write=True,
            )
            service = DirectChatMemoryToolService(
                memory_entries=memory_entries,
                user_file_processing=SQLAlchemyUserFileProcessingRepository(session),
                user_file_embedder_factory=self._embedder_factory,
                allowed_uploaded_files=self._allowed_uploaded_files,
                patch_planner=AgentsSDKV4AMemoryPatchPlanner(memory_entries=memory_entries),
            )
            return await service.execute(**kwargs)

        return await with_short_lived_session(self._session_factory, _execute)

    async def execute_native_patch(self, **kwargs: Any) -> str:
        """Execute one native Apply Patch call in a fresh committed session."""

        async def _execute(session: Any) -> str:
            memory_entries = MemoryEntryService(
                memory_entries=SQLAlchemyMemoryEntryRepository(session),
                uow=SQLAlchemyUnitOfWork(session),
                commit_on_write=True,
            )
            service = DirectChatMemoryToolService(
                memory_entries=memory_entries,
                patch_planner=AgentsSDKV4AMemoryPatchPlanner(memory_entries=memory_entries),
            )
            return await service.execute_native_patch(**kwargs)

        return await with_short_lived_session(self._session_factory, _execute)
