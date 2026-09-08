from __future__ import annotations

from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass, field
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, Protocol, runtime_checkable

from animama.domain.model_provider import ModelProvider
from animama.domain.usage import Usage

from .event_types import MCEvent

if TYPE_CHECKING:
    from .prompt import DirectChatPrompt

MODEL_CLIENT_TOOL_CALL_ITEM_TYPE = "model_client_tool_call"
MODEL_CLIENT_TOOL_RESULT_ITEM_TYPE = "model_client_tool_result"


def _freeze_value(value: Any) -> Any:
    """Recursively freeze provider metadata so stream consumers cannot mutate it."""

    if isinstance(value, Mapping):
        return MappingProxyType({str(key): _freeze_value(item) for key, item in value.items()})
    if isinstance(value, list | tuple):
        return tuple(_freeze_value(item) for item in value)
    if isinstance(value, set | frozenset):
        return frozenset(_freeze_value(item) for item in value)
    return value


def _frozen_mapping(value: Mapping[str, Any] | None) -> Mapping[str, Any]:
    """Return an immutable mapping for provider metadata fields."""

    if value is None:
        return MappingProxyType({})
    frozen = _freeze_value(value)
    if not isinstance(frozen, Mapping):
        return MappingProxyType({})
    return frozen


def _string_tuple(value: object) -> tuple[str, ...]:
    if not isinstance(value, list | tuple | set | frozenset):
        return ()
    seen: set[str] = set()
    result: list[str] = []
    for item in value:
        if item is None:
            continue
        text = str(item).strip()
        if not text or text in seen:
            continue
        seen.add(text)
        result.append(text)
    return tuple(result)


@dataclass(frozen=True, slots=True)
class ModelClientToolCall:
    """Provider-neutral tool call requested by a model."""

    id: str
    name: str
    arguments: str
    tool_type: str = "function"

    def __post_init__(self) -> None:
        object.__setattr__(self, "id", str(self.id or "").strip())
        object.__setattr__(self, "name", str(self.name or "").strip())
        object.__setattr__(self, "arguments", str(self.arguments or ""))
        object.__setattr__(self, "tool_type", str(self.tool_type or "function").strip() or "function")


@dataclass(frozen=True, slots=True)
class ModelClientToolResult:
    """Provider-neutral result for one model-requested tool call."""

    call_id: str
    tool_type: str
    status: str
    output: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "call_id", str(self.call_id or "").strip())
        object.__setattr__(self, "tool_type", str(self.tool_type or "function").strip() or "function")
        object.__setattr__(self, "status", str(self.status or "failed").strip() or "failed")
        object.__setattr__(self, "output", str(self.output or ""))


@dataclass(frozen=True, slots=True)
class ModelClientFinal:
    """Final assistant result for one direct chat turn.

    Provider adapters should emit this only after seeing the provider-specific
    terminal signal they trust. For OpenAI Chat Completions that is the streamed
    finish_reason path; for OpenAI Responses that is response.completed.
    """

    text: str
    usage: Usage = field(default_factory=Usage)
    raw_provider_metadata: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))
    structured_payload: Mapping[str, Any] | None = None
    tool_calls: tuple[ModelClientToolCall, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "raw_provider_metadata", _frozen_mapping(self.raw_provider_metadata))
        structured = None if self.structured_payload is None else _frozen_mapping(self.structured_payload)
        object.__setattr__(self, "structured_payload", structured)
        object.__setattr__(
            self,
            "tool_calls",
            tuple(call for call in self.tool_calls if call.id and call.name),
        )


@dataclass(frozen=True, slots=True)
class ModelClientDelta:
    """Streaming item emitted by a provider-neutral model client.

    `text_delta` carries public assistant text, `event` carries sanitized
    provider observations for logs/metadata, `final` carries the authoritative
    assistant output, and `error` carries stream-level provider failure.
    """

    kind: str
    text: str | None = None
    final: ModelClientFinal | None = None
    error: str | None = None
    stream_event: MCEvent | None = None
    raw_metadata: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))

    def __post_init__(self) -> None:
        object.__setattr__(self, "raw_metadata", _frozen_mapping(self.raw_metadata))


def model_client_event_delta(event: MCEvent) -> ModelClientDelta:
    """Build a streaming delta for an ordered provider observation."""

    return ModelClientDelta(kind="event", stream_event=event)


class ModelClientError(Exception):
    """Base error raised by provider-neutral model clients."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        raw_metadata: Mapping[str, Any] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.code = code
        self.raw_metadata = _frozen_mapping(raw_metadata)


class ModelClientProviderError(ModelClientError):
    """Raised when an upstream provider rejects or fails a model-client request."""


class ModelClientTimeoutError(ModelClientError):
    """Raised when an upstream provider request times out."""


@dataclass(frozen=True, slots=True)
class ModelClientContinuation:
    """Provider-scoped continuation cursor for one request-local model turn.

    Responses adapters use this to pass `previous_response_id`; providers that
    rely on explicit chat history should leave it unset.
    """

    provider_type: str
    cursor: str
    metadata: Mapping[str, Any] = field(default_factory=lambda: MappingProxyType({}))

    def __post_init__(self) -> None:
        object.__setattr__(self, "provider_type", str(self.provider_type or "").strip())
        object.__setattr__(self, "cursor", str(self.cursor or "").strip())
        object.__setattr__(self, "metadata", _frozen_mapping(self.metadata))


@dataclass(frozen=True, slots=True)
class ModelClientProviderOptions:
    """Provider-adapter options that are not part of prompt messages."""

    native_tools: tuple[str, ...] = ()
    store: bool | None = None
    memory_apply_patch_enabled: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "native_tools", _string_tuple(self.native_tools))
        object.__setattr__(self, "store", self.store if isinstance(self.store, bool) else None)
        object.__setattr__(
            self,
            "memory_apply_patch_enabled",
            self.memory_apply_patch_enabled if isinstance(self.memory_apply_patch_enabled, bool) else False,
        )

    @classmethod
    def from_value(
        cls,
        value: ModelClientProviderOptions | Mapping[str, Any] | None,
    ) -> ModelClientProviderOptions:
        if isinstance(value, ModelClientProviderOptions):
            return value
        if not isinstance(value, Mapping):
            return cls()
        store = value.get("store")
        return cls(
            native_tools=_string_tuple(value.get("native_tools")),
            store=store if isinstance(store, bool) else None,
            memory_apply_patch_enabled=value.get("memory_apply_patch_enabled") is True,
        )

    def get(self, key: str, default: object = None) -> object:
        if key == "native_tools":
            return self.native_tools
        if key == "store":
            return self.store
        if key == "memory_apply_patch_enabled":
            return self.memory_apply_patch_enabled
        return default

    def __getitem__(self, key: str) -> object:
        if key == "native_tools":
            return self.native_tools
        if key == "store":
            return self.store
        if key == "memory_apply_patch_enabled":
            return self.memory_apply_patch_enabled
        raise KeyError(key)


@dataclass(frozen=True, slots=True)
class ModelClientRequest:
    """Provider invocation request passed to a shared model client.

    The request is immutable enough to cross async boundaries safely: route and
    app-layer code build it once, then the adapter translates it into SDK-specific
    request parameters.
    """

    model_provider: ModelProvider
    prompt: DirectChatPrompt
    provider_options: ModelClientProviderOptions = field(default_factory=ModelClientProviderOptions)
    continuation: ModelClientContinuation | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "provider_options", ModelClientProviderOptions.from_value(self.provider_options))


@runtime_checkable
class ModelClient(Protocol):
    """Concurrency-safe provider-family client.

    Implementations may hold reusable SDK or HTTP resources, but all anima,
    Provider, prompt, continuation, and provider-specific option state must come
    from ``ModelClientRequest``.
    """

    def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        raise NotImplementedError

    async def aclose(self) -> None:
        raise NotImplementedError


class ModelClientWithComplete(ModelClient, Protocol):
    """Optional non-streaming extension for model clients that support it."""

    async def complete(self, request: ModelClientRequest) -> ModelClientFinal:
        raise NotImplementedError


class ModelClientRegistry(Protocol):
    """Resolve shared model clients by persisted provider type."""

    def get(self, provider_type: str) -> ModelClient | None:
        raise NotImplementedError


class StaticModelClientRegistry(ModelClientRegistry):
    """Small in-memory registry used by tests and future startup wiring."""

    def __init__(self, clients: Mapping[str, ModelClient] | None = None) -> None:
        self._clients: dict[str, ModelClient] = dict(clients or {})

    def register(self, provider_type: str, client: ModelClient) -> None:
        self._clients[provider_type] = client

    def get(self, provider_type: str) -> ModelClient | None:
        return self._clients.get(provider_type)

    async def aclose(self) -> None:
        """Close each unique registered client once."""

        seen: set[int] = set()
        for client in self._clients.values():
            identity = id(client)
            if identity in seen:
                continue
            seen.add(identity)
            await client.aclose()


__all__ = [
    "ModelClient",
    "MODEL_CLIENT_TOOL_CALL_ITEM_TYPE",
    "MODEL_CLIENT_TOOL_RESULT_ITEM_TYPE",
    "ModelClientContinuation",
    "ModelClientDelta",
    "ModelClientError",
    "ModelClientFinal",
    "ModelClientProviderError",
    "ModelClientProviderOptions",
    "ModelClientRequest",
    "ModelClientRegistry",
    "ModelClientTimeoutError",
    "ModelClientToolCall",
    "ModelClientToolResult",
    "ModelClientWithComplete",
    "StaticModelClientRegistry",
    "model_client_event_delta",
]
