from enum import Enum


class AgentInstructionProfile(str, Enum):
    """Profiles describing common Agent animas."""

    DEFAULT = "default"
    CHAT_WITH_SUPERVISOR = "chat_with_supervisor"
    SUPERVISOR = "supervisor"
    MEMORY_MANAGER = "memory_manager"
    SUMMARIZER = "summarizer"
    EMOTIONAL_ANALYST = "emotional_analyst"
