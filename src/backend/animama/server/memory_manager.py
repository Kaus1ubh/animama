"""The local composition's Memory Manager service (ADR 0021).

The shared Memory Manager routes ask the composition's ports for the owner's
service. Locally each step runs on the runtime of its model row's provider type
(OpenAI Agents or Anthropic), or on the deterministic runtime when
``ANIMAMA_LLM_SKIP`` is set.
"""

from __future__ import annotations

import os

from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.memory_manager import (
    AnthropicMemoryManagerRuntime,
    DeterministicMemoryManagerRuntime,
    MemoryManagerRuntimeSelector,
    OpenAIAgentsMemoryManagerRuntime,
)
from animama.adapters.repositories.sqlalchemy.anima_memory_reflection_repo import (
    SQLAlchemyAnimaMemoryReflectionRepository,
)
from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.memory_episode_repo import SQLAlchemyMemoryEpisodeRepository
from animama.adapters.repositories.sqlalchemy.memory_manager_repo import SQLAlchemyMemoryManagerRepository
from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.ports.memory_manager_runtime import MemoryManagerRuntime
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.memory_episode_service import MemoryEpisodeService
from animama.app.services.memory_manager_service import MemoryManagerService
from animama.app.services.model_role_resolver import ROLE_MEMORY_MANAGER, ModelRoleResolver
from animama.server.config import Settings
from animama.server.model_clients import build_model_credential_resolver, openai_base_url


async def local_memory_manager_service(
    session: AsyncSession,
    user_id: str,
    *,
    roles: ModelRoleResolver,
    runtime_settings: Settings,
    llm_skip: bool | None = None,
) -> MemoryManagerService:
    """Build a request-local manager service with the owner's Memory Manager model.

    ``llm_skip`` selects the deterministic runtime; by default ``ANIMAMA_LLM_SKIP``
    decides on every call.
    """

    memory_entries = MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        animas=SQLAlchemyAnimaRepository(session),
        max_file_bytes=runtime_settings.anima_memory_file_max_bytes,
        commit_on_write=False,
    )
    uow = SQLAlchemyUnitOfWork(session)
    memory_episode_repository = SQLAlchemyMemoryEpisodeRepository(session)
    anima_repository = SQLAlchemyAnimaRepository(session)
    chat_message_repository = SQLAlchemyChatMessageRepository(session)
    memory_episodes = MemoryEpisodeService(
        memory_episodes=memory_episode_repository,
        memory_entries=memory_entries,
        uow=uow,
        commit_on_write=False,
    )
    if llm_skip is None:
        llm_skip = _truthy_env(os.getenv("ANIMAMA_LLM_SKIP"))
    runtime: MemoryManagerRuntime
    if llm_skip:
        runtime = DeterministicMemoryManagerRuntime(
            user_id=user_id,
            memory_entries=memory_entries,
            memory_episodes=memory_episode_repository,
            animas=anima_repository,
            chat_messages=chat_message_repository,
        )
    else:
        model_providers = SQLAlchemyModelProviderRepository(session)
        credential_resolver = build_model_credential_resolver()
        timeout_seconds = runtime_settings.anima_model_client_timeout_seconds
        # Each step runs on the runtime of its row's provider type; approvals resume on the pinned row's.
        runtime = MemoryManagerRuntimeSelector(
            model_provider=(await roles.resolve(user_id, ROLE_MEMORY_MANAGER)).model_provider,
            model_providers=model_providers,
            openai_agents=lambda row: OpenAIAgentsMemoryManagerRuntime(
                user_id=user_id,
                memory_entries=memory_entries,
                memory_episodes=memory_episode_repository,
                animas=anima_repository,
                chat_messages=chat_message_repository,
                model_provider=row,
                model_providers=model_providers,
                credential_resolver=credential_resolver,
                openai_base_url=openai_base_url(),
                timeout_seconds=timeout_seconds,
            ),
            anthropic=lambda row: AnthropicMemoryManagerRuntime(
                user_id=user_id,
                memory_entries=memory_entries,
                memory_episodes=memory_episode_repository,
                animas=anima_repository,
                chat_messages=chat_message_repository,
                model_provider=row,
                model_providers=model_providers,
                credential_resolver=credential_resolver,
                timeout_seconds=timeout_seconds,
            ),
        )
    return MemoryManagerService(
        memory_manager=SQLAlchemyMemoryManagerRepository(session),
        memory_entries=memory_entries,
        memory_episodes=memory_episodes,
        chat_messages=chat_message_repository,
        anima_reflections=SQLAlchemyAnimaMemoryReflectionRepository(session),
        runtime=runtime,
        uow=uow,
    )


def _truthy_env(value: str | None) -> bool:
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


__all__ = ["local_memory_manager_service"]
