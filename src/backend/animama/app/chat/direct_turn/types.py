from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from pydantic import BaseModel

from animama.app.model_clients import ModelClientError, ModelClientRequest
from animama.domain.chat import Chat
from animama.domain.user_file_processing import UserFileOutlineItem

from ..memory_context import DirectChatMemoryContext
from ..options import DirectChatOptions
from .constants import DIRECT_CHAT_NODE_ID


class ModelClientNotFoundError(LookupError):
    """Raised when no shared model client is registered for a provider type."""


class DirectChatTurnSetupError(RuntimeError):
    """Raised before a direct turn starts when required setup cannot be resolved."""


@dataclass(frozen=True, slots=True)
class DirectChatAttachmentContext:
    """Safe request-local navigation metadata for one validated upload."""

    filename: str
    chunk_count: int
    description: str | None = None
    outline: tuple[UserFileOutlineItem, ...] = ()
    outline_truncated: bool = False


@dataclass(frozen=True, slots=True)
class RuntimeGestureDescriptor:
    """User-facing meaning for one exact AI-selectable Gesture selector."""

    selector: str
    name: str
    description: str


@dataclass(frozen=True, slots=True)
class DirectChatTurnRequest:
    """Input for one app-layer direct chat model-client turn."""

    anima_id: str
    user_id: str
    chat_id: str
    run_id: str
    user_message: str
    model_provider_id: str | None = None
    attached_file_ids: tuple[str, ...] = ()
    attached_files: tuple[DirectChatAttachmentContext, ...] = ()
    request_options: DirectChatOptions | Mapping[str, Any] = field(default_factory=DirectChatOptions)
    emotional_state: Mapping[str, Any] | None = None
    runtime_revision: str | None = None
    runtime_gesture_ids: tuple[str, ...] | None = None
    runtime_gesture_descriptors: tuple[RuntimeGestureDescriptor, ...] = ()
    node_id: str = DIRECT_CHAT_NODE_ID

    def __post_init__(self) -> None:
        object.__setattr__(self, "request_options", DirectChatOptions.from_value(self.request_options))

    @property
    def options(self) -> DirectChatOptions:
        """Return options normalized by construction, while accepting mapping inputs."""
        assert isinstance(self.request_options, DirectChatOptions)
        return self.request_options


@dataclass(frozen=True, slots=True)
class PreparedDirectChatTurn:
    """Validated direct chat turn state that is ready for model invocation."""

    request: DirectChatTurnRequest
    chat: Chat
    model_request: ModelClientRequest
    output_type: type[BaseModel]
    response_format: str
    memory_context: DirectChatMemoryContext
    memory_tool_specs: tuple[dict[str, Any], ...] = ()
    context_loaded: bool = True
    runtime_revision: str | None = None
    runtime_gesture_ids: tuple[str, ...] = ()


class DirectChatTurnStreamError(RuntimeError):
    """Wraps a provider failure that occurred after direct-turn setup."""

    def __init__(self, *, request: DirectChatTurnRequest, error: ModelClientError) -> None:
        super().__init__(error.message)
        self.request = request
        self.error = error


__all__ = [
    "DirectChatAttachmentContext",
    "DirectChatTurnRequest",
    "DirectChatTurnSetupError",
    "DirectChatTurnStreamError",
    "ModelClientNotFoundError",
    "PreparedDirectChatTurn",
    "RuntimeGestureDescriptor",
]
