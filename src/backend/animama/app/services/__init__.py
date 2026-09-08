"""Application services using domain + ports (Stage 4).

These services accept and return domain types exclusively and delegate
to repositories via the port interfaces defined in `animama.app.ports`.
No schemas or ORM imports are allowed here.
"""

from .anima_chat_profile_service import AnimaChatProfileService
from .anima_presentation_service import AnimaPresentationService
from .anima_service import AnimaService
from .chat_compaction_service import ChatCompactionResult, ChatCompactionService, ChatCompactionSettings
from .chat_manager import ChatApiStandardConflictError, ChatManager
from .chat_service import ChatService
from .chat_title_generation_service import (
    ChatTitleGenerationResult,
    ChatTitleGenerationService,
    ChatTitleGenerationSettings,
)
from .memory_entry_service import MemoryEntryService
from .memory_episode_service import MemoryEpisodeService
from .model_provider_catalog_service import ModelProviderCatalogService
from .settings_service import SettingsService

__all__ = [
    "ModelProviderCatalogService",
    "AnimaChatProfileService",
    "AnimaPresentationService",
    "ChatService",
    "ChatApiStandardConflictError",
    "ChatManager",
    "ChatCompactionResult",
    "ChatCompactionService",
    "ChatCompactionSettings",
    "ChatTitleGenerationResult",
    "ChatTitleGenerationService",
    "ChatTitleGenerationSettings",
    "MemoryEntryService",
    "MemoryEpisodeService",
    "AnimaService",
    "SettingsService",
]
