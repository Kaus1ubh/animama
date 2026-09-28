"""Application layer ports (Stage 2).

These protocols define the repository and provider interfaces the
application/runtime depend on. Implementations should live under
`animama.adapters.*` and return domain objects only.
"""

from .anima_chat_profile_port import AnimaChatProfileRepository
from .anima_memory_reflection_port import AnimaMemoryReflectionRepository
from .anima_port import AnimaRepository
from .anima_presentation_port import AnimaPresentationRepository
from .archive_port import ArchiveRepository
from .avatar_port import AvatarRepository
from .chat_compaction_port import ChatCompactionRepository
from .chat_message_port import ChatMessageRepository
from .chat_port import ChatRepository
from .memory_entry_port import MemoryEntryRepository, MemoryEntryRepositoryConflictError
from .memory_episode_port import MemoryEpisodeRepository, MemoryEpisodeRepositoryConflictError
from .memory_manager_port import MemoryManagerRepository, MemoryManagerRepositoryConflictError
from .memory_patch_port import MemoryPatchCandidate, MemoryPatchPlanError, MemoryPatchPlanner
from .model_connection_port import ModelConnectionRepository
from .model_provider_port import ModelProviderRepository
from .owner_profile_bootstrap_port import OwnerProfileBootstrapPort, OwnerProfileBootstrapResult
from .settings_port import AnimaSettingsRepository, UserSettingsRepository
from .uow_port import UnitOfWork
from .user_file_port import UserFileRepository
from .user_profile_port import (
    UserProfileRepository,
    UserProfileRepositoryConflictError,
    UserProfileRepositoryConsistencyError,
)

__all__ = [
    "ModelConnectionRepository",
    "ModelProviderRepository",
    "AnimaChatProfileRepository",
    "AnimaMemoryReflectionRepository",
    "AnimaPresentationRepository",
    "AvatarRepository",
    "AnimaRepository",
    "UnitOfWork",
    "ChatRepository",
    "OwnerProfileBootstrapPort",
    "OwnerProfileBootstrapResult",
    "ChatMessageRepository",
    "MemoryEntryRepository",
    "MemoryEntryRepositoryConflictError",
    "MemoryEpisodeRepository",
    "MemoryEpisodeRepositoryConflictError",
    "MemoryManagerRepository",
    "MemoryManagerRepositoryConflictError",
    "MemoryPatchCandidate",
    "MemoryPatchPlanError",
    "MemoryPatchPlanner",
    "ChatCompactionRepository",
    "ArchiveRepository",
    "UserSettingsRepository",
    "AnimaSettingsRepository",
    "UserFileRepository",
    "UserProfileRepository",
    "UserProfileRepositoryConflictError",
    "UserProfileRepositoryConsistencyError",
]
