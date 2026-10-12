"""Speech for a chat reply: an ElevenLabs realtime session, or finalized audio pushed in the stream.

Finalized audio comes from ElevenLabs ``eleven_v3`` through the composition's
speech port, or from Gemini through its optional Gemini speech port. The
composition's ports make every provider call. This module decides when speech
starts, batches the reply's prepared speech segments and resolves the Anima's
voice from the owner's settings (an Anima the caller does not own, including an
unowned one, is not found).
"""

from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncIterator, Mapping
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any, Literal

from fastapi import HTTPException, status

from animama.app.chat.options import (
    DEFAULT_FINALIZED_TTS_CHUNKING,
    DirectChatFinalizedTtsChunking,
    DirectChatOptions,
    DirectChatTtsOptions,
)
from animama.app.contracts.elevenlabs import (
    SUPPORTED_ELEVENLABS_FINALIZED_TTS_MODEL_IDS,
    PyElevenLabsAnimaVoiceProfileInput,
    PyElevenLabsRealtimeTtsSessionResponse,
    PyElevenLabsVoice,
)
from animama.app.contracts.gemini import (
    DEFAULT_GEMINI_TTS_MODEL_ID,
    GEMINI_TTS_MISSING_CREDENTIAL_CODE,
    GEMINI_TTS_MISSING_CREDENTIAL_MESSAGE,
    SUPPORTED_GEMINI_TTS_MODEL_IDS,
    gemini_voice_or_default,
)
from animama.app.voice_emotional_tone import bounded_finalized_tts_previous_text
from animama.logging import get_logger
from animama.product_http.ports import (
    FinalizedSpeechPort,
    ProductRefusal,
    ProductRepositories,
    ProductSpeech,
    VoiceResolver,
)

from .setup_helpers import TurnSessions
from .sse_events import (
    TTS_TEXT_BASIS_GRUUT_TEXT_WITH_WS,
    SsePreparedTtsSpeechSegment,
    SseTextState,
    format_tts_audio_event,
    format_tts_done_event,
    format_tts_error_event,
    format_tts_session_error_event,
    format_tts_session_event,
)

_log = get_logger("product_http.chat.tts")
FINALIZED_TTS_BATCH_TEXT_BASIS_VISIBLE_TEXT = "visible_text"
FINALIZED_TTS_PARAGRAPH_MAX_SEGMENTS = 4
FINALIZED_TTS_PARAGRAPH_MAX_VISIBLE_CHARS = 600
FINALIZED_TTS_PARAGRAPH_LEADING_PAUSE_SEC = 0.4
FINALIZED_TTS_PCM_SAMPLE_RATE = 24000

FinalizedTtsProvider = Literal["elevenlabs", "gemini"]


@dataclass(frozen=True, slots=True)
class _FinalizedProviderText:
    """What a finalized speech provider's frames and errors say about it.

    ``refusal_messages`` gives the browser text for refusal codes the owner can
    act on; other refusals show the generic failure. ``forwards_error_text``
    lets other exceptions' own text reach the browser.
    """

    label: str
    failure_label: str
    setup_failed_code: str
    stream_failed_code: str
    refusal_messages: Mapping[str, str] = field(default_factory=dict)
    forwards_error_text: bool = True


_FINALIZED_PROVIDER_TEXT: dict[str, _FinalizedProviderText] = {
    "elevenlabs": _FinalizedProviderText(
        label="ElevenLabs v3 TTS",
        failure_label="ElevenLabs finalized TTS",
        setup_failed_code="elevenlabs_stream_setup_failed",
        stream_failed_code="elevenlabs_stream_failed",
    ),
    "gemini": _FinalizedProviderText(
        label="Gemini TTS",
        failure_label="Gemini TTS",
        setup_failed_code="gemini_tts_stream_setup_failed",
        stream_failed_code="gemini_tts_stream_failed",
        refusal_messages={GEMINI_TTS_MISSING_CREDENTIAL_CODE: GEMINI_TTS_MISSING_CREDENTIAL_MESSAGE},
        # Gemini errors name at most an HTTP status, never request text.
        forwards_error_text=False,
    ),
}


def resolve_realtime_voice_from_preferences(preferences: dict[str, Any] | None) -> PyElevenLabsVoice:
    """The ElevenLabs voice an Anima's settings name, or 409 when they name none."""

    speech = preferences.get("speech") if isinstance(preferences, dict) else None
    elevenlabs = speech.get("elevenlabs") if isinstance(speech, dict) else None
    if not isinstance(elevenlabs, dict):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Anima does not have an ElevenLabs voice profile",
        )

    try:
        profile = PyElevenLabsAnimaVoiceProfileInput.model_validate(elevenlabs)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Anima does not have a usable ElevenLabs voice profile",
        ) from exc

    primary_voice = profile.primary_voice
    if primary_voice.voice_id.strip():
        return primary_voice

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="Anima does not have a usable ElevenLabs voice profile",
    )


async def anima_elevenlabs_voice(
    repositories: ProductRepositories, *, user_id: str, anima_id: str
) -> PyElevenLabsVoice:
    """The owned Anima's ElevenLabs voice; any other Anima is not found."""

    if not await repositories.animas.is_owned_by_user(user_id=user_id, anima_id=anima_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anima not found")
    anima_settings = await repositories.anima_settings.get(user_id=user_id, anima_id=anima_id)
    return resolve_realtime_voice_from_preferences(anima_settings.preferences if anima_settings is not None else {})


def anima_voice_resolver(sessions: TurnSessions, anima_id: str) -> VoiceResolver:
    """Resolve the Anima's voice in a short read session when the speech port asks for it."""

    async def resolve() -> PyElevenLabsVoice:
        async with sessions.read() as session:
            return await anima_elevenlabs_voice(
                sessions.repositories(session), user_id=sessions.principal.id, anima_id=anima_id
            )

    return resolve


async def anima_gemini_voice(repositories: ProductRepositories, *, user_id: str, anima_id: str) -> str:
    """The owned Anima's Gemini prebuilt voice, or the default; any other Anima is not found."""

    if not await repositories.animas.is_owned_by_user(user_id=user_id, anima_id=anima_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anima not found")
    anima_settings = await repositories.anima_settings.get(user_id=user_id, anima_id=anima_id)
    preferences = anima_settings.preferences if anima_settings is not None else {}
    speech = preferences.get("speech") if isinstance(preferences, dict) else None
    gemini = speech.get("gemini") if isinstance(speech, dict) else None
    return gemini_voice_or_default(gemini.get("voice") if isinstance(gemini, dict) else None)


def gemini_finalized_tts_model_id(chat_options: DirectChatOptions) -> str:
    """The requested Gemini TTS model, or the default."""

    model_id = chat_options.tts.model_id if chat_options.tts is not None else None
    return model_id if model_id in SUPPORTED_GEMINI_TTS_MODEL_IDS else DEFAULT_GEMINI_TTS_MODEL_ID


def gemini_finalized_tts_requested(chat_options: DirectChatOptions) -> bool:
    """Whether the reply asks for Gemini speech, so the turn reads its Gemini speech port."""

    tts_options = chat_options.tts
    return tts_options is not None and tts_options.enabled is True and tts_options.provider == "gemini"


def elevenlabs_tts_options(chat_options: DirectChatOptions) -> DirectChatTtsOptions | None:
    tts_options = chat_options.tts
    if tts_options is None:
        return None
    if tts_options.enabled is not True:
        return None
    if tts_options.provider != "elevenlabs":
        return None
    return tts_options


def tts_speech_payload_enabled(chat_options: DirectChatOptions) -> bool:
    return chat_options.tts is not None and chat_options.tts.enabled is True


def elevenlabs_finalized_tts_model_id(chat_options: DirectChatOptions) -> str | None:
    tts_options = elevenlabs_tts_options(chat_options)
    if tts_options is None:
        return None
    model_id = tts_options.model_id
    return model_id if model_id in SUPPORTED_ELEVENLABS_FINALIZED_TTS_MODEL_IDS else None


def elevenlabs_finalized_tts_chunking(chat_options: DirectChatOptions) -> DirectChatFinalizedTtsChunking:
    tts_options = elevenlabs_tts_options(chat_options)
    if (
        tts_options is not None
        and tts_options.model_id == "eleven_v3"
        and tts_options.finalized_chunking == "paragraph"
    ):
        return "paragraph"
    return DEFAULT_FINALIZED_TTS_CHUNKING


async def resolve_realtime_tts_session_for_stream(
    *,
    speech: ProductSpeech,
    sessions: TurnSessions,
    anima_id: str,
    language_code: str | None,
    model_id: str | None,
) -> PyElevenLabsRealtimeTtsSessionResponse:
    return await speech.realtime_session(
        sessions.principal,
        voice=anima_voice_resolver(sessions, anima_id),
        language_code=language_code,
        model_id=model_id,
    )


@dataclass(slots=True)
class TtsSessionBootstrap:
    """Owns request-local ElevenLabs realtime session setup for one SSE run."""

    run_id: str
    anima_id: str
    task: asyncio.Task[Any] | None = None

    @classmethod
    def start_if_requested(
        cls,
        *,
        chat_options: DirectChatOptions,
        speech: ProductSpeech,
        sessions: TurnSessions,
        anima_id: str,
        run_id: str,
    ) -> TtsSessionBootstrap:
        tts_options = elevenlabs_tts_options(chat_options)
        if tts_options is None:
            return cls(run_id=run_id, anima_id=anima_id)
        model_id = tts_options.model_id
        if model_id in SUPPORTED_ELEVENLABS_FINALIZED_TTS_MODEL_IDS:
            return cls(run_id=run_id, anima_id=anima_id)

        task = asyncio.create_task(
            resolve_realtime_tts_session_for_stream(
                speech=speech,
                sessions=sessions,
                anima_id=anima_id,
                language_code=tts_options.language_code,
                model_id=model_id,
            ),
            name=f"direct-chat-tts-session-{run_id}",
        )
        return cls(run_id=run_id, anima_id=anima_id, task=task)

    def pop_ready_frame(self) -> str | None:
        if self.task is None or not self.task.done():
            return None
        task = self.task
        self.task = None
        return self._frame_from_completed_task(task)

    async def finish_frame(self) -> str | None:
        if self.task is None:
            return None
        task = self.task
        self.task = None
        try:
            tts_session = await task
        except Exception as exc:
            return self._error_frame(exc)
        return format_tts_session_event(run_id=self.run_id, session=tts_session)

    async def cancel(self) -> None:
        task = self.task
        if task is None:
            return
        task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await task
        # A wait cut short by the caller's own cancellation keeps the task for the next cancel.
        if task.done():
            self.task = None

    def _frame_from_completed_task(self, task: asyncio.Task[Any]) -> str:
        try:
            tts_session = task.result()
        except Exception as exc:
            return self._error_frame(exc)
        return format_tts_session_event(run_id=self.run_id, session=tts_session)

    def _error_frame(self, exc: Exception) -> str:
        _log.warning(
            "HTTP Anima Direct Chat SSE TTS Session Setup Failed",
            anima_id=self.anima_id,
            run_id=self.run_id,
            error=str(exc),
        )
        return format_tts_session_error_event(run_id=self.run_id, exc=exc)


@dataclass(frozen=True, slots=True)
class FinalizedTtsSegmentBatch:
    segments: tuple[SsePreparedTtsSpeechSegment, ...]
    text: str
    text_basis: str

    @property
    def part_index(self) -> int:
        return self.segments[0].part_index if self.segments else 0

    @property
    def starts_new_paragraph(self) -> bool:
        return bool(self.segments and self.segments[0].paragraph_break_before)


class FinalizedTtsSegmentBatcher:
    """Converts sentence-level prepared speech segments into finalized TTS requests."""

    def __init__(self, chunking: DirectChatFinalizedTtsChunking) -> None:
        self._chunking = chunking
        self._pending: list[SsePreparedTtsSpeechSegment] = []
        self._ready: list[FinalizedTtsSegmentBatch] = []
        self._closed = False

    def add_segment(self, segment: SsePreparedTtsSpeechSegment) -> None:
        if self._closed:
            return
        if self._chunking == "sentence":
            self._ready.append(
                FinalizedTtsSegmentBatch(
                    segments=(segment,),
                    text=segment.tts_text,
                    text_basis=segment.text_basis,
                )
            )
            return

        if segment.paragraph_break_before and self._pending:
            self._flush_pending()

        self._pending.append(segment)
        if (
            len(self._pending) >= FINALIZED_TTS_PARAGRAPH_MAX_SEGMENTS
            or self._pending_visible_char_count() >= FINALIZED_TTS_PARAGRAPH_MAX_VISIBLE_CHARS
        ):
            self._flush_pending()

    def close(self) -> None:
        self._closed = True
        self._flush_pending()

    def pop_ready(self) -> FinalizedTtsSegmentBatch | None:
        if not self._ready:
            return None
        return self._ready.pop(0)

    def _flush_pending(self) -> None:
        if not self._pending:
            return
        segments = tuple(self._pending)
        self._pending = []
        text = "".join(segment.visible_text for segment in segments).strip()
        if not text:
            return
        self._ready.append(
            FinalizedTtsSegmentBatch(
                segments=segments,
                text=text,
                text_basis=FINALIZED_TTS_BATCH_TEXT_BASIS_VISIBLE_TEXT,
            )
        )

    def _pending_visible_char_count(self) -> int:
        return len("".join(segment.visible_text for segment in self._pending).strip())


@dataclass(slots=True)
class FinalizedTtsStreamBootstrap:
    """Starts and drains backend-pushed finalized TTS (ElevenLabs or Gemini) for one run."""

    chat_options: DirectChatOptions
    speech: FinalizedSpeechPort
    sessions: TurnSessions
    anima_id: str
    run_id: str
    model_id: str | None
    finalized_chunking: DirectChatFinalizedTtsChunking = DEFAULT_FINALIZED_TTS_CHUNKING
    provider: FinalizedTtsProvider = "elevenlabs"
    task: asyncio.Task[None] | None = None
    completed: bool = False
    resolved_voice_id: str | None = None
    queue: asyncio.Queue[str | None] = field(default_factory=asyncio.Queue)

    @classmethod
    def start_if_requested(
        cls,
        *,
        chat_options: DirectChatOptions,
        speech: ProductSpeech,
        sessions: TurnSessions,
        anima_id: str,
        run_id: str,
        gemini_speech: FinalizedSpeechPort | None = None,
    ) -> FinalizedTtsStreamBootstrap:
        if gemini_finalized_tts_requested(chat_options):
            if gemini_speech is None:
                # The composition does not offer Gemini voice: the reply has no speech.
                return cls(
                    chat_options=chat_options,
                    speech=speech,
                    sessions=sessions,
                    anima_id=anima_id,
                    run_id=run_id,
                    model_id=None,
                    provider="gemini",
                )
            tts_options = chat_options.tts
            return cls(
                chat_options=chat_options,
                speech=gemini_speech,
                sessions=sessions,
                anima_id=anima_id,
                run_id=run_id,
                model_id=gemini_finalized_tts_model_id(chat_options),
                finalized_chunking=(
                    tts_options.finalized_chunking
                    if tts_options is not None and tts_options.finalized_chunking is not None
                    else DEFAULT_FINALIZED_TTS_CHUNKING
                ),
                provider="gemini",
            )
        return cls(
            chat_options=chat_options,
            speech=speech,
            sessions=sessions,
            anima_id=anima_id,
            run_id=run_id,
            model_id=elevenlabs_finalized_tts_model_id(chat_options),
            finalized_chunking=elevenlabs_finalized_tts_chunking(chat_options),
        )

    def start_if_ready(self, state: SseTextState) -> None:
        if self.model_id is None or self.task is not None or self.completed:
            return
        if state.emotional_tone is None:
            return
        if not self._has_prepared_speech(state):
            return
        self._start(state)

    async def finish_frames(self, state: SseTextState) -> AsyncIterator[str]:
        if self.model_id is None:
            return
        state.tts_speech_segments_closed = True
        if self.task is None and not self.completed:
            if not self._has_prepared_speech(state):
                self.completed = True
                yield format_tts_error_event(
                    run_id=self.run_id,
                    model_id=self.model_id,
                    error=self._missing_text_error(),
                    code="missing_tts_text",
                    provider=self.provider,
                )
                return
            self._start(state)

        while not self.completed:
            frame = self.pop_ready_frame()
            if frame is not None:
                yield frame
                continue
            if self.completed:
                break
            item = await self.queue.get()
            if item is None:
                self._mark_completed()
                continue
            yield item

    def pop_ready_frame(self) -> str | None:
        while not self.queue.empty():
            item = self.queue.get_nowait()
            if item is None:
                self._mark_completed()
                continue
            return item
        return None

    async def cancel(self) -> None:
        task = self.task
        if task is None:
            return
        self.completed = True
        task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await task
        # A wait cut short by the caller's own cancellation keeps the task for the next cancel.
        if task.done():
            self.task = None

    @staticmethod
    def _has_prepared_speech(state: SseTextState) -> bool:
        return any(
            segment.text_basis == TTS_TEXT_BASIS_GRUUT_TEXT_WITH_WS and segment.tts_text.strip()
            for segment in state.tts_speech_segments
        )

    def _start(self, state: SseTextState) -> None:
        emotional_state = dict(state.emotional_state) if state.emotional_state is not None else None
        self.task = asyncio.create_task(
            self._run(
                state=state,
                emotional_tone=state.emotional_tone,
                emotional_state=emotional_state,
            ),
            name=f"direct-chat-finalized-tts-{self.run_id}",
        )

    async def _run(
        self,
        *,
        state: SseTextState,
        emotional_tone: str | None,
        emotional_state: dict[str, int] | None,
    ) -> None:
        try:
            next_segment_index = 0
            previous_text: str | None = None
            streamed_any = False
            batcher = FinalizedTtsSegmentBatcher(self.finalized_chunking)
            while True:
                segment = self._segment_at(state, next_segment_index)
                if segment is None:
                    if state.tts_speech_segments_closed:
                        batcher.close()
                        while True:
                            batch = batcher.pop_ready()
                            if batch is None:
                                break
                            if self._should_emit_paragraph_leading_pause(batch, streamed_any):
                                await self._queue_paragraph_leading_pause()
                            ok = await self._stream_batch(
                                batch,
                                emotional_tone=emotional_tone,
                                emotional_state=emotional_state,
                                previous_text=previous_text if self._uses_previous_text else None,
                                apply_emotional_prefix=self._applies_style(streamed_any),
                            )
                            if not ok:
                                return
                            streamed_any = True
                            if self._uses_previous_text:
                                previous_text = self._append_previous_text(previous_text, batch.text)
                        if streamed_any:
                            await self.queue.put(
                                format_tts_done_event(
                                    run_id=self.run_id,
                                    payload={
                                        "model_id": self.model_id or "eleven_v3",
                                        "output_format": "pcm_24000",
                                    },
                                    provider=self.provider,
                                )
                            )
                        else:
                            await self.queue.put(
                                format_tts_error_event(
                                    run_id=self.run_id,
                                    model_id=self.model_id or "eleven_v3",
                                    error=self._missing_text_error(),
                                    code="missing_tts_text",
                                    provider=self.provider,
                                )
                            )
                        return
                    await asyncio.sleep(0.01)
                    continue

                next_segment_index += 1
                batcher.add_segment(segment)
                while True:
                    batch = batcher.pop_ready()
                    if batch is None:
                        break
                    if self._should_emit_paragraph_leading_pause(batch, streamed_any):
                        await self._queue_paragraph_leading_pause()
                    ok = await self._stream_batch(
                        batch,
                        emotional_tone=emotional_tone,
                        emotional_state=emotional_state,
                        previous_text=previous_text if self._uses_previous_text else None,
                        apply_emotional_prefix=self._applies_style(streamed_any),
                    )
                    if not ok:
                        return
                    streamed_any = True
                    if self._uses_previous_text:
                        previous_text = self._append_previous_text(previous_text, batch.text)
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _log.warning(
                "HTTP Anima Direct Chat SSE finalized TTS task failed",
                anima_id=self.anima_id,
                run_id=self.run_id,
                error=str(exc),
            )
            await self.queue.put(
                format_tts_error_event(
                    run_id=self.run_id,
                    model_id=self.model_id or "eleven_v3",
                    error=self._error_text(exc, "failed"),
                    # A composition that declines a streamed segment names why.
                    code=exc.code if isinstance(exc, ProductRefusal) else self._text.stream_failed_code,
                    provider=self.provider,
                )
            )
        finally:
            await self.queue.put(None)

    @staticmethod
    def _segment_at(
        state: SseTextState,
        index: int,
    ) -> SsePreparedTtsSpeechSegment | None:
        if index < len(state.tts_speech_segments):
            return state.tts_speech_segments[index]
        return None

    def _should_emit_paragraph_leading_pause(
        self,
        batch: FinalizedTtsSegmentBatch,
        streamed_any: bool,
    ) -> bool:
        return self.finalized_chunking == "paragraph" and streamed_any and batch.starts_new_paragraph

    async def _queue_paragraph_leading_pause(self) -> None:
        frame = format_tts_audio_event(
            run_id=self.run_id,
            payload={
                "model_id": self.model_id or "eleven_v3",
                "output_format": "pcm_24000",
                "audio_base64": _finalized_tts_silence_audio_base64(
                    duration_sec=FINALIZED_TTS_PARAGRAPH_LEADING_PAUSE_SEC,
                    sample_rate=FINALIZED_TTS_PCM_SAMPLE_RATE,
                ),
            },
            provider=self.provider,
        )
        if frame is not None:
            await self.queue.put(frame)

    async def _stream_batch(
        self,
        batch: FinalizedTtsSegmentBatch,
        *,
        emotional_tone: str | None,
        emotional_state: dict[str, int] | None,
        previous_text: str | None,
        apply_emotional_prefix: bool,
    ) -> bool:
        try:
            if self.provider == "gemini" and self.resolved_voice_id is None:
                self.resolved_voice_id = await self._gemini_voice()
            # Later segments reuse the voice the first one resolved.
            prepared = await self.speech.prepare_finalized(
                self.sessions.principal,
                voice=anima_voice_resolver(self.sessions, self.anima_id) if self.resolved_voice_id is None else None,
                voice_id=self.resolved_voice_id,
                anima_id=self.anima_id,
                run_id=self.run_id,
                text=batch.text,
                model_id=self.model_id,
                language_code=self._language_code(),
                text_basis=batch.text_basis,
                emotional_tone=emotional_tone,
                emotional_state=emotional_state,
                previous_text=previous_text,
                apply_emotional_prefix=apply_emotional_prefix,
            )
            prepared_voice_id = getattr(prepared, "voice_id", None)
            if isinstance(prepared_voice_id, str) and prepared_voice_id.strip():
                self.resolved_voice_id = prepared_voice_id.strip()
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            _log.warning(
                "HTTP Anima Direct Chat SSE finalized TTS segment setup failed",
                anima_id=self.anima_id,
                run_id=self.run_id,
                part_index=batch.part_index,
                error=str(exc),
            )
            await self.queue.put(
                format_tts_error_event(
                    run_id=self.run_id,
                    model_id=self.model_id or "eleven_v3",
                    error=self._error_text(exc, "setup failed"),
                    # A composition that declines this reply's speech names why.
                    code=exc.code if isinstance(exc, ProductRefusal) else self._text.setup_failed_code,
                    provider=self.provider,
                )
            )
            return False

        async for payload in self.speech.stream_finalized(prepared):
            payload_type = payload.get("type")
            if payload_type == "audio":
                frame = format_tts_audio_event(run_id=self.run_id, payload=payload, provider=self.provider)
                if frame is not None:
                    await self.queue.put(frame)
            elif payload_type == "done":
                return True
            elif payload_type == "error":
                error = payload.get("error")
                code = payload.get("code")
                await self.queue.put(
                    format_tts_error_event(
                        run_id=self.run_id,
                        model_id=prepared.model_id,
                        output_format=prepared.output_format,
                        error=(error if isinstance(error, str) and error else self._failure_text("failed")),
                        code=code if isinstance(code, str) and code else self._text.stream_failed_code,
                        provider=self.provider,
                    )
                )
                return False
        return True

    def _language_code(self) -> str | None:
        tts_options = elevenlabs_tts_options(self.chat_options)
        return tts_options.language_code if tts_options is not None else None

    @property
    def _text(self) -> _FinalizedProviderText:
        return _FINALIZED_PROVIDER_TEXT[self.provider]

    @property
    def _uses_previous_text(self) -> bool:
        """ElevenLabs models other than ``eleven_v3`` continue from the previous segment's text."""

        return self.provider == "elevenlabs" and self.model_id != "eleven_v3"

    def _applies_style(self, streamed_any: bool) -> bool:
        """Gemini styles every request alike; ElevenLabs tags each paragraph, or only the first sentence."""

        return self.provider == "gemini" or self.finalized_chunking == "paragraph" or not streamed_any

    def _missing_text_error(self) -> str:
        return f"{self._text.label} did not receive prepared speech text for this response."

    def _failure_text(self, what: str) -> str:
        return f"{self._text.failure_label} {what}."

    def _error_text(self, exc: Exception, what: str) -> str:
        """The browser-facing text for a failed reply's speech."""

        if isinstance(exc, ProductRefusal):
            return self._text.refusal_messages.get(exc.code) or self._failure_text(what)
        return (str(exc) if self._text.forwards_error_text else "") or self._failure_text(what)

    async def _gemini_voice(self) -> str:
        async with self.sessions.read() as session:
            return await anima_gemini_voice(
                self.sessions.repositories(session), user_id=self.sessions.principal.id, anima_id=self.anima_id
            )

    @staticmethod
    def _append_previous_text(previous_text: str | None, text: str) -> str | None:
        return bounded_finalized_tts_previous_text(previous_text, text)

    def _mark_completed(self) -> None:
        self.completed = True
        if self.task is not None and self.task.done():
            with suppress(Exception):
                self.task.result()
            self.task = None


def _finalized_tts_silence_audio_base64(*, duration_sec: float, sample_rate: int) -> str:
    sample_count = max(0, round(duration_sec * sample_rate))
    return base64.b64encode(b"\x00\x00" * sample_count).decode("ascii")


__all__ = [
    "FinalizedTtsSegmentBatcher",
    "FinalizedTtsStreamBootstrap",
    "TtsSessionBootstrap",
    "anima_elevenlabs_voice",
    "anima_gemini_voice",
    "elevenlabs_finalized_tts_chunking",
    "elevenlabs_finalized_tts_model_id",
    "elevenlabs_tts_options",
    "gemini_finalized_tts_requested",
    "resolve_realtime_voice_from_preferences",
    "tts_speech_payload_enabled",
]
