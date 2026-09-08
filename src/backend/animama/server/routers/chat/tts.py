from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncIterator
from contextlib import suppress
from dataclasses import dataclass, field
from typing import Any

from animama.app.chat.options import (
    DEFAULT_FINALIZED_TTS_CHUNKING,
    DirectChatFinalizedTtsChunking,
    DirectChatOptions,
    DirectChatTtsOptions,
)
from animama.logging_config import get_logger
from animama.server.elevenlabs_service import (
    bounded_finalized_tts_previous_text,
    prepare_finalized_tts_stream_from_text,
    resolve_realtime_tts_session,
    stream_finalized_tts_chunks,
)
from animama.server.schemas.elevenlabs import SUPPORTED_ELEVENLABS_FINALIZED_TTS_MODEL_IDS
from animama.server.sse_events import (
    TTS_TEXT_BASIS_GRUUT_TEXT_WITH_WS,
    SsePreparedTtsSpeechSegment,
    SseTextState,
    format_tts_audio_event,
    format_tts_done_event,
    format_tts_error_event,
    format_tts_session_error_event,
    format_tts_session_event,
)

_log = get_logger("server.routers.chat.tts")
FINALIZED_TTS_BATCH_TEXT_BASIS_VISIBLE_TEXT = "visible_text"
FINALIZED_TTS_PARAGRAPH_MAX_SEGMENTS = 4
FINALIZED_TTS_PARAGRAPH_MAX_VISIBLE_CHARS = 600
FINALIZED_TTS_PARAGRAPH_LEADING_PAUSE_SEC = 0.4
FINALIZED_TTS_PCM_SAMPLE_RATE = 24000


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
    session_factory: Any,
    user_id: str,
    anima_id: str,
    run_id: str,
    language_code: str | None,
    model_id: str | None,
) -> Any:
    tts_session = session_factory()
    try:
        return await resolve_realtime_tts_session(
            session=tts_session,
            user_id=user_id,
            anima_id=anima_id,
            emotion_label=None,
            emotion_intensity=None,
            language_code=language_code,
            model_id=model_id,
        )
    finally:
        try:
            await tts_session.close()
        except Exception as exc:
            _log.warning(
                "HTTP Anima Direct Chat SSE TTS Session Close Failed",
                anima_id=anima_id,
                run_id=run_id,
                error=str(exc),
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
        session_factory: Any,
        user_id: str,
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
                session_factory=session_factory,
                user_id=user_id,
                anima_id=anima_id,
                run_id=run_id,
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
        if self.task is None:
            return
        task = self.task
        self.task = None
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            return
        with suppress(Exception):
            task.result()

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
    """Starts and drains backend-pushed finalized ElevenLabs TTS for one run."""

    chat_options: DirectChatOptions
    session_factory: Any
    user_id: str
    anima_id: str
    run_id: str
    model_id: str | None
    finalized_chunking: DirectChatFinalizedTtsChunking = DEFAULT_FINALIZED_TTS_CHUNKING
    task: asyncio.Task[None] | None = None
    completed: bool = False
    resolved_voice_id: str | None = None
    queue: asyncio.Queue[str | None] = field(default_factory=asyncio.Queue)

    @classmethod
    def start_if_requested(
        cls,
        *,
        chat_options: DirectChatOptions,
        session_factory: Any,
        user_id: str,
        anima_id: str,
        run_id: str,
    ) -> FinalizedTtsStreamBootstrap:
        return cls(
            chat_options=chat_options,
            session_factory=session_factory,
            user_id=user_id,
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
                    error="ElevenLabs v3 TTS did not receive prepared speech text for this response.",
                    code="missing_tts_text",
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
        if self.task is None:
            return
        task = self.task
        self.task = None
        self.completed = True
        if not task.done():
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
            return
        with suppress(Exception):
            task.result()

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
                                previous_text=previous_text if self.model_id != "eleven_v3" else None,
                                apply_emotional_prefix=(self.finalized_chunking == "paragraph" or not streamed_any),
                            )
                            if not ok:
                                return
                            streamed_any = True
                            if self.model_id != "eleven_v3":
                                previous_text = self._append_previous_text(previous_text, batch.text)
                        if streamed_any:
                            await self.queue.put(
                                format_tts_done_event(
                                    run_id=self.run_id,
                                    payload={
                                        "model_id": self.model_id or "eleven_v3",
                                        "output_format": "pcm_24000",
                                    },
                                )
                            )
                        else:
                            await self.queue.put(
                                format_tts_error_event(
                                    run_id=self.run_id,
                                    model_id=self.model_id or "eleven_v3",
                                    error=("ElevenLabs v3 TTS did not receive prepared speech text for this response."),
                                    code="missing_tts_text",
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
                        previous_text=previous_text if self.model_id != "eleven_v3" else None,
                        apply_emotional_prefix=(self.finalized_chunking == "paragraph" or not streamed_any),
                    )
                    if not ok:
                        return
                    streamed_any = True
                    if self.model_id != "eleven_v3":
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
                    error=str(exc) or "ElevenLabs finalized TTS failed.",
                    code="elevenlabs_stream_failed",
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
        tts_session = self.session_factory() if self.resolved_voice_id is None else None
        try:
            prepare_kwargs: dict[str, Any] = {
                "user_id": self.user_id,
                "anima_id": self.anima_id,
                "run_id": self.run_id,
                "text": batch.text,
                "model_id": self.model_id,
                "language_code": self._language_code(),
                "text_basis": batch.text_basis,
                "emotional_tone": emotional_tone,
                "emotional_state": emotional_state,
                "previous_text": previous_text,
                "apply_emotional_prefix": apply_emotional_prefix,
            }
            if tts_session is not None:
                prepare_kwargs["session"] = tts_session
            if self.resolved_voice_id is not None:
                prepare_kwargs["voice_id"] = self.resolved_voice_id

            prepared = await prepare_finalized_tts_stream_from_text(**prepare_kwargs)
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
                    error=str(exc) or "ElevenLabs finalized TTS setup failed.",
                    code="elevenlabs_stream_setup_failed",
                )
            )
            return False
        finally:
            if tts_session is not None and (close := getattr(tts_session, "close", None)) is not None:
                with suppress(Exception):
                    await close()

        async for payload in stream_finalized_tts_chunks(prepared):
            payload_type = payload.get("type")
            if payload_type == "audio":
                frame = format_tts_audio_event(run_id=self.run_id, payload=payload)
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
                        error=(error if isinstance(error, str) and error else "ElevenLabs finalized TTS failed."),
                        code=code if isinstance(code, str) and code else "elevenlabs_stream_failed",
                    )
                )
                return False
        return True

    def _language_code(self) -> str | None:
        tts_options = elevenlabs_tts_options(self.chat_options)
        return tts_options.language_code if tts_options is not None else None

    @staticmethod
    def _append_previous_text(previous_text: str | None, text: str) -> str | None:
        return bounded_finalized_tts_previous_text(previous_text, text)

    def _mark_completed(self) -> None:
        self.completed = True
        if self.task is not None and self.task.done():
            with suppress(Exception):
                self.task.result()
            self.task = None


async def stream_finalized_tts_frames(
    *,
    chat_options: DirectChatOptions,
    session_factory: Any,
    user_id: str,
    anima_id: str,
    run_id: str,
    text: str | None = None,
    text_basis: str | None = None,
    emotional_tone: str | None = None,
    emotional_state: dict[str, int] | None = None,
) -> AsyncIterator[str]:
    model_id = elevenlabs_finalized_tts_model_id(chat_options)
    if model_id is None:
        return

    tts_options = elevenlabs_tts_options(chat_options)
    language_code = tts_options.language_code if tts_options is not None else None
    if text_basis != TTS_TEXT_BASIS_GRUUT_TEXT_WITH_WS or not isinstance(text, str) or not text.strip():
        yield format_tts_error_event(
            run_id=run_id,
            model_id=model_id,
            error="ElevenLabs v3 TTS did not receive prepared speech text for this response.",
            code="missing_tts_text",
        )
        return

    tts_session = session_factory()
    try:
        prepared = await prepare_finalized_tts_stream_from_text(
            session=tts_session,
            user_id=user_id,
            anima_id=anima_id,
            run_id=run_id,
            text=text,
            model_id=model_id,
            language_code=language_code,
            text_basis=text_basis,
            emotional_tone=emotional_tone,
            emotional_state=emotional_state,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        _log.warning(
            "HTTP Anima Direct Chat SSE finalized TTS setup failed",
            anima_id=anima_id,
            run_id=run_id,
            error=str(exc),
        )
        yield format_tts_error_event(
            run_id=run_id,
            model_id=model_id,
            error=str(exc) or "ElevenLabs finalized TTS setup failed.",
            code="elevenlabs_stream_setup_failed",
        )
        return
    finally:
        close = getattr(tts_session, "close", None)
        if close is not None:
            with suppress(Exception):
                await close()

    async for payload in stream_finalized_tts_chunks(prepared):
        payload_type = payload.get("type")
        if payload_type == "audio":
            frame = format_tts_audio_event(run_id=run_id, payload=payload)
            if frame is not None:
                yield frame
        elif payload_type == "done":
            yield format_tts_done_event(run_id=run_id, payload=payload)
        elif payload_type == "error":
            error = payload.get("error")
            code = payload.get("code")
            yield format_tts_error_event(
                run_id=run_id,
                model_id=prepared.model_id,
                output_format=prepared.output_format,
                error=error if isinstance(error, str) and error else "ElevenLabs finalized TTS failed.",
                code=code if isinstance(code, str) and code else "elevenlabs_stream_failed",
            )


def _finalized_tts_silence_audio_base64(*, duration_sec: float, sample_rate: int) -> str:
    sample_count = max(0, round(duration_sec * sample_rate))
    return base64.b64encode(b"\x00\x00" * sample_count).decode("ascii")


__all__ = [
    "FinalizedTtsSegmentBatcher",
    "FinalizedTtsStreamBootstrap",
    "TtsSessionBootstrap",
    "elevenlabs_finalized_tts_chunking",
    "elevenlabs_finalized_tts_model_id",
    "elevenlabs_tts_options",
    "resolve_realtime_tts_session",
    "stream_finalized_tts_chunks",
    "stream_finalized_tts_frames",
    "tts_speech_payload_enabled",
]
