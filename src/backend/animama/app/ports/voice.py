from __future__ import annotations

import math
from collections.abc import AsyncIterator, Mapping
from dataclasses import dataclass
from typing import Literal, Protocol

from animama.domain.audio import AudioChunk, SynthesisChunk, TranscriptSegment


class SpeechToTextProvider(Protocol):
    """Streaming speech-to-text provider."""

    def stream(
        self, chunks: AsyncIterator[AudioChunk]
    ) -> AsyncIterator[TranscriptSegment]:  # pragma: no cover - protocol
        ...

    async def aclose(self) -> None:  # pragma: no cover - protocol
        ...


class TextToSpeechProvider(Protocol):
    """Streaming text-to-speech provider."""

    def synthesize(
        self, text: str, *, voice_id: str | None = None, lang: str | None = None, speed: float | None = None
    ) -> AsyncIterator[SynthesisChunk]:  # pragma: no cover - protocol
        ...

    async def synthesize_full(
        self, text: str, *, voice_id: str | None = None, lang: str | None = None, speed: float | None = None
    ) -> SynthesisChunk:  # pragma: no cover - protocol
        ...

    async def aclose(self) -> None:  # pragma: no cover - protocol
        ...


# Hosted compositions proxy paid audio through this server-owned boundary; the
# legacy provider interfaces above remain usable by local installations.


@dataclass(frozen=True, slots=True)
class SpeechLimits:
    """Finite limits for one audio invocation, selected by the composition."""

    max_input_bytes: int
    max_input_audio_seconds: float
    max_input_characters: int
    max_output_bytes: int
    timeout_seconds: float
    cleanup_timeout_seconds: float = 5.0

    def __post_init__(self) -> None:
        for value in (self.max_input_bytes, self.max_input_characters, self.max_output_bytes):
            if type(value) is not int or value <= 0:
                raise ValueError("Speech byte/text limits must be positive integers")
        for duration in (self.max_input_audio_seconds, self.timeout_seconds, self.cleanup_timeout_seconds):
            if not math.isfinite(duration) or duration <= 0:
                raise ValueError("Speech time limits must be positive and finite")


@dataclass(frozen=True, slots=True)
class SpeechCall:
    """Authenticated, composition-owned identity; never accepted from the browser."""

    owner_id: str
    operation_id: str
    call_id: str
    limits: SpeechLimits
    voice_id: str | None = None
    language: str | None = None
    speed: float | None = None


@dataclass(frozen=True, slots=True)
class SpeechCallOutcome:
    """Observed transport units and optional *provider-reported* billable units.

    A cancelled or disconnected call can still be billed. Transport bytes and
    input text length are not proof of the provider's eventual charge.
    """

    status: Literal["completed", "failed", "cancelled"]
    input_characters: int = 0
    input_audio_seconds: float = 0
    output_bytes: int = 0
    provider_usage: Mapping[str, float] | None = None


class SpeechCallBoundary(Protocol):
    async def admit(self, call: SpeechCall, *, kind: Literal["stt", "tts"]) -> None:
        """Authenticate/authorize voice ownership and reserve before dispatch."""
        ...

    async def finish(self, call: SpeechCall, outcome: SpeechCallOutcome) -> None:
        """Settle idempotently or retain uncertainty for recovery."""
        ...


@dataclass(frozen=True, slots=True)
class OwnerVoice:
    """Opaque provider/voice identity, without credentials or filesystem paths."""

    provider_id: str
    voice_id: str
    name: str
    is_clone: bool = False


@dataclass(frozen=True, slots=True)
class VoiceCloneSample:
    name: str
    content_type: str
    data: bytes


class OwnerVoiceCatalog(Protocol):
    """Catalog and cloning are owner-scoped, including every sample byte.

    Implementations validate sample count/size/duration and content before
    dispatch, reserve the clone operation, and never expose provider tokens.
    Browser-local engines may persist a clone as owned content instead.
    """

    async def list_voices(self, *, owner_id: str, provider_id: str) -> list[OwnerVoice]: ...

    async def clone_voice(
        self, *, call: SpeechCall, provider_id: str, name: str, samples: tuple[VoiceCloneSample, ...]
    ) -> OwnerVoice: ...

    async def delete_voice(self, *, owner_id: str, provider_id: str, voice_id: str) -> None: ...
