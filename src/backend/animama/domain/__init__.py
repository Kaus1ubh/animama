"""Anima domain layer (pure business objects).

This package defines framework‑free dataclasses used across services and ports.
Avoid importing Pydantic, SQLAlchemy, FastAPI, or adapter code here.
"""

from .anima import Anima
from .anima_chat_profile import AnimaChatProfile
from .anima_presentation import AnimaPresentation, RuntimeImageReference
from .archive import Archive, ArchivePassage
from .avatar import Avatar
from .chat import Chat, ChatMessage, MessageRole
from .chat_compaction import ChatCompaction
from .events import Event, EventType
from .memory_entry import (
    MemoryEntry,
    MemoryEntryHeader,
    MemoryEntryHeaderListing,
    MemoryEntryListing,
    MemoryEntrySearchResult,
    MemoryEntryVersion,
    MemoryEntryVersionDetail,
    MemoryEntryVersionFieldChange,
    MemoryEntryVersionListing,
)
from .memory_episode import MemoryEpisodeItem
from .model_connection import ModelConnection, ModelConnectionCompatibility
from .model_provider import ModelProvider, ModelProviderCapabilities, ModelProviderPricing
from .request_principal import RequestPrincipal
from .settings import AnimaSettings, UserSettings
from .user_file import UserFile
from .user_profile import UserProfile, UserProfilePatch

__all__ = [
    "Avatar",
    "Chat",
    "ChatCompaction",
    "ChatMessage",
    "Event",
    "EventType",
    "MessageRole",
    "MemoryEntry",
    "MemoryEntryListing",
    "MemoryEntryVersion",
    "MemoryEntryVersionDetail",
    "MemoryEntryVersionFieldChange",
    "MemoryEntryVersionListing",
    "MemoryEntrySearchResult",
    "MemoryEntryHeader",
    "MemoryEntryHeaderListing",
    "MemoryEpisodeItem",
    "ModelProviderCapabilities",
    "ModelConnection",
    "ModelConnectionCompatibility",
    "ModelProvider",
    "ModelProviderPricing",
    "Anima",
    "AnimaChatProfile",
    "AnimaPresentation",
    "RuntimeImageReference",
    "UserSettings",
    "AnimaSettings",
    "RequestPrincipal",
    "UserFile",
    "UserProfile",
    "UserProfilePatch",
    "Archive",
    "ArchivePassage",
]
