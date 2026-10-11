from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from contextlib import suppress
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse

from animama.app.chat.completion import complete_successful_turn
from animama.app.model_clients import ModelClientRegistry
from animama.app.services.chat_title_generation_service import ChatTitleGenerationResult
from animama.domain.events import EventType
from animama.domain.request_principal import RequestPrincipal
from animama.logging_config import get_logger
from animama.server.config import settings
from animama.server.deps import get_async_session_factory
from animama.server.model_roles import ModelRoleSettings
from animama.server.schemas.chat import PyAnimaChatRequest
from animama.server.sse_events import (
    GruutSseTextBuilder,
    SseTextState,
    format_error_event,
)
from animama.server.web_search import composition_web_search_enabled

from .compaction import (
    compact_chat_after_success as _compact_chat_after_success,
)
from .safety import ai_notice_frame, attach_crisis_resources
from .setup_helpers import chat_manager as _chat_manager
from .sse_runtime import (
    DirectChatEventBridge,
    direct_run_completed_frame,
    drain_events_while_task_runs,
    drain_pending_events,
    fallback_run_completed_frame,
    run_prepared_direct_turn,
    unexpected_error_event,
)
from .title import (
    cancel_chat_title_task as _cancel_chat_title_task,
    chat_title_generation_skip_reason as _chat_title_generation_skip_reason,
    chat_title_updated_frame as _chat_title_updated_frame,
    generate_chat_title_for_stream as _generate_chat_title_for_stream,
    should_generate_chat_title as _should_generate_chat_title,
)
from .tts import (
    FinalizedTtsStreamBootstrap as _FinalizedTtsStreamBootstrap,
    TtsSessionBootstrap as _TtsSessionBootstrap,
    tts_speech_payload_enabled as _tts_speech_payload_enabled,
)
from .turn_setup import DirectChatTurnSetup, prepare_direct_chat_turn

_log = get_logger("server.routers.chat.chat_sse")

__all__ = [
    "DirectChatEventBridge",
    "_chat_manager",
    "stream_direct_chat_sse",
]


async def stream_direct_chat_sse(
    *,
    app: FastAPI,
    anima_id: str,
    req: PyAnimaChatRequest,
    user: RequestPrincipal,
    model_client_registry: ModelClientRegistry | None,
    build_gruut_sse_text: GruutSseTextBuilder,
) -> StreamingResponse:
    """Prepare and stream one `POST /chat:sse` direct avatar companion turn.

    The HTTP handler does only route-level work: allocate request identifiers,
    prepare the app-layer turn while the request DB session is open, then return
    a StreamingResponse whose generator owns the long-running model call and all
    downstream SSE side effects.
    """

    _log.info("HTTP Anima Direct Chat SSE Start", anima_id=anima_id)
    if model_client_registry is None:
        raise HTTPException(status_code=503, detail="Model client registry is unavailable")

    # The setup session is intentionally short lived. The stream itself can run
    # for a long time, so later persistence work opens request-local sessions
    # through the factory instead of holding this setup session open.
    session_factory = get_async_session_factory(app)
    session = session_factory()
    session_closed = False
    cleanup_done = False
    turn: DirectChatTurnSetup | None = None
    run_id = req.run_id or f"run-{uuid.uuid4().hex}"
    chat_id = req.chat_id or f"chat-{uuid.uuid4().hex}"
    model_roles = ModelRoleSettings.for_app(app)

    async def _close_session() -> None:
        """Close the setup session exactly once across setup and stream cleanup."""

        nonlocal session_closed
        if session_closed:
            return
        session_closed = True
        try:
            await session.close()
            _log.info("HTTP Anima Direct Chat SSE Session Closed", anima_id=anima_id)
        except Exception as exc:
            _log.warning("HTTP Anima Direct Chat SSE Session Close Failed", anima_id=anima_id, error=str(exc))

    async def _cleanup() -> None:
        """Run idempotent request cleanup shared by setup failure and stream exit."""

        nonlocal cleanup_done
        if cleanup_done:
            return
        cleanup_done = True
        await _close_session()

    try:
        turn = await prepare_direct_chat_turn(
            session=session,
            session_factory=session_factory,
            anima_id=anima_id,
            req=req,
            user=user,
            run_id=run_id,
            chat_id=chat_id,
            model_client_registry=model_client_registry,
            runtime_settings=getattr(app.state, "runtime_settings", settings),
            model_roles=model_roles,
            web_search_enabled=composition_web_search_enabled(app),
        )
    except Exception:
        await _cleanup()
        raise

    # `PreparedDirectChatTurn` contains immutable domain/app state and provider
    # request data, so the route can release the setup session before opening
    # the client-facing SSE stream.
    await _cleanup()

    bridge = DirectChatEventBridge(anima_id=anima_id)
    chat = turn.prepared_turn.chat

    async def _event_stream() -> AsyncIterator[str]:
        """Bridge app-domain turn events, TTS/title side work, and final SSE frames."""

        frame: str | None
        state = SseTextState(
            emotional_state=turn.emotional_state,
            tts_speech_payload_enabled=_tts_speech_payload_enabled(turn.chat_options),
        )
        active_task: asyncio.Task[Any] | None = None
        title_task: asyncio.Task[ChatTitleGenerationResult] | None = None
        tts_bootstrap = _TtsSessionBootstrap(run_id=run_id, anima_id=anima_id)
        finalized_tts = _FinalizedTtsStreamBootstrap.start_if_requested(
            chat_options=turn.chat_options,
            session_factory=session_factory,
            user_id=user.id,
            anima_id=anima_id,
            run_id=run_id,
        )
        completed_emitted = False
        attach_crisis_resources(turn.safety, state)
        _log.info(
            "HTTP Anima Direct Chat SSE Stream Open",
            anima_id=anima_id,
            run_id=run_id,
            chat_id=chat_id,
        )
        try:
            # Title generation is independent from the main assistant response.
            # It runs in parallel and is only surfaced after the direct turn has
            # succeeded so title failures do not corrupt the model stream.
            if _should_generate_chat_title(chat, chat_options=turn.chat_options):
                title_task = asyncio.create_task(
                    _generate_chat_title_for_stream(
                        session_factory=session_factory,
                        model_client_registry=model_client_registry,
                        anima_id=anima_id,
                        user_id=user.id,
                        chat_id=chat_id,
                        run_id=run_id,
                        message=req.message,
                        model_roles=model_roles,
                    ),
                    name=f"direct-chat-title-{run_id}",
                )
            else:
                _log.info(
                    "Direct chat title generation skipped",
                    anima_id=anima_id,
                    chat_id=chat_id,
                    run_id=run_id,
                    reason=_chat_title_generation_skip_reason(chat, chat_options=turn.chat_options),
                    chat_has_title=bool(getattr(chat, "title", None)),
                    chat_next_turn=getattr(chat, "next_turn", None),
                )
            # TTS setup may produce early SSE frames before the model completes,
            # while finalized TTS waits until the final assistant text is known.
            tts_bootstrap = _TtsSessionBootstrap.start_if_requested(
                chat_options=turn.chat_options,
                session_factory=session_factory,
                user_id=user.id,
                anima_id=anima_id,
                run_id=run_id,
            )

            def _poll_tts_frame() -> str | None:
                finalized_tts.start_if_ready(state)
                frame = finalized_tts.pop_ready_frame()
                if frame is not None:
                    return frame
                return tts_bootstrap.pop_ready_frame()

            # The app-layer turn publishes domain events into `bridge`; this
            # route generator drains the bridge into wire-level SSE frames.
            active_task = asyncio.create_task(
                run_prepared_direct_turn(turn.executor, turn.prepared_turn, bridge),
                name=f"direct-chat-model-client-{run_id}",
            )
            _log.info(
                "Direct chat model turn task scheduled",
                anima_id=anima_id,
                chat_id=chat_id,
                run_id=run_id,
                task_name=active_task.get_name(),
            )
            # The AI notice (spec R2) precedes any provider output. The provider
            # task is already running, so recording notice state adds no time to
            # first text; its events wait in the bridge until drained.
            notice = await ai_notice_frame(
                turn.safety,
                session_factory=session_factory,
                user_id=user.id,
                run_id=run_id,
                anima_name=turn.prepared_turn.memory_context.anima_name,
            )
            if notice is not None:
                yield notice
            async for frame in drain_events_while_task_runs(
                active_task,
                bridge,
                run_id=run_id,
                anima_id=anima_id,
                session_factory=session_factory,
                state=state,
                build_gruut_sse_text=build_gruut_sse_text,
                stream_user_response=True,
                stream_emotion_update=True,
                poll_extra_frame=_poll_tts_frame,
            ):
                yield frame

            turn_events = await active_task
            active_task = None
            _log.info(
                "Direct chat model turn task joined",
                anima_id=anima_id,
                chat_id=chat_id,
                run_id=run_id,
                event_count=len(turn_events),
                error_count=sum(1 for event in turn_events if event.type == EventType.ERROR),
            )
            async for frame in drain_pending_events(
                bridge,
                run_id=run_id,
                anima_id=anima_id,
                session_factory=session_factory,
                state=state,
                build_gruut_sse_text=build_gruut_sse_text,
                stream_user_response=True,
                stream_emotion_update=True,
            ):
                yield frame

            # App-layer errors are already formatted and streamed as ERROR
            # events. Emit the public completion concept once, then stop any
            # optional side work that should not run after a failed turn.
            if any(event.type == EventType.ERROR for event in turn_events):
                _log.info(
                    "Direct chat model turn completed with app-layer error",
                    anima_id=anima_id,
                    chat_id=chat_id,
                    run_id=run_id,
                )
                await _cancel_chat_title_task(title_task)
                title_task = None
                await tts_bootstrap.cancel()
                await finalized_tts.cancel()
                frame = direct_run_completed_frame(
                    anima_id=anima_id,
                    chat_id=chat_id,
                    user_id=user.id,
                    run_id=run_id,
                    state=state,
                    build_gruut_sse_text=build_gruut_sse_text,
                )
                if frame is not None:
                    completed_emitted = True
                    _log.info(
                        "Direct chat run.completed emitted after app-layer error",
                        anima_id=anima_id,
                        chat_id=chat_id,
                        run_id=run_id,
                    )
                    yield frame
                return

            # The model turn succeeded. Flush remaining non-text events before
            # optional post-turn side effects so the user-visible response order
            # remains assistant text/emotion first, then TTS/title/compaction.
            _log.info(
                "Direct chat post-model side effects started",
                anima_id=anima_id,
                chat_id=chat_id,
                run_id=run_id,
            )
            finalized_tts.start_if_ready(state)

            async def finish_title() -> str | None:
                nonlocal title_task
                frame = await _chat_title_updated_frame(
                    title_task=title_task,
                    session_factory=session_factory,
                    anima_id=anima_id,
                    user_id=user.id,
                    chat_id=chat_id,
                    run_id=run_id,
                )
                title_task = None
                return frame

            def completed_frame() -> str | None:
                nonlocal completed_emitted
                frame = direct_run_completed_frame(
                    anima_id=anima_id,
                    chat_id=chat_id,
                    user_id=user.id,
                    run_id=run_id,
                    state=state,
                    build_gruut_sse_text=build_gruut_sse_text,
                )
                if frame is not None:
                    completed_emitted = True
                return frame

            async for frame in complete_successful_turn(
                options=turn.chat_options,
                pending_events=drain_pending_events(
                    bridge,
                    run_id=run_id,
                    anima_id=anima_id,
                    session_factory=session_factory,
                    state=state,
                    build_gruut_sse_text=build_gruut_sse_text,
                    stream_user_response=False,
                    stream_emotion_update=True,
                ),
                finish_session=tts_bootstrap.finish_frame,
                speech_events=finalized_tts.finish_frames(state),
                finish_title=finish_title,
                compact=lambda: _compact_chat_after_success(
                    session_factory=session_factory,
                    model_client_registry=model_client_registry,
                    chat_id=chat_id,
                    user_id=user.id,
                    anima_id=anima_id,
                    run_id=run_id,
                    chat_options=turn.chat_options,
                    model_roles=model_roles,
                    model_provider=turn.prepared_turn.model_request.model_provider,
                ),
                completed=completed_frame,
            ):
                yield frame
        except asyncio.CancelledError:
            await _cancel_chat_title_task(title_task)
            title_task = None
            _log.info("HTTP Anima Direct Chat SSE Stream Cancelled", anima_id=anima_id, run_id=run_id)
            raise
        except GeneratorExit:
            _log.info("HTTP Anima Direct Chat SSE Stream Closed", anima_id=anima_id, run_id=run_id)
            raise
        except Exception as exc:
            await _cancel_chat_title_task(title_task)
            title_task = None
            _log.error(
                "HTTP Anima Direct Chat SSE Stream Error",
                anima_id=anima_id,
                run_id=run_id,
                error=str(exc),
            )
            if active_task is not None and not active_task.done():
                active_task.cancel()
                with suppress(asyncio.CancelledError):
                    await active_task
                active_task = None
            await tts_bootstrap.cancel()
            await finalized_tts.cancel()
            error_event = unexpected_error_event(
                exc,
                anima_id=anima_id,
                chat_id=chat_id,
                user_id=user.id,
                run_id=run_id,
            )
            frame = format_error_event(error_event, run_id=run_id)
            if frame is not None:
                yield frame
            async for frame in drain_pending_events(
                bridge,
                run_id=run_id,
                anima_id=anima_id,
                session_factory=session_factory,
                state=state,
                build_gruut_sse_text=build_gruut_sse_text,
                stream_user_response=False,
                stream_emotion_update=True,
            ):
                yield frame
            if not completed_emitted:
                yield fallback_run_completed_frame(run_id=run_id, chat_id=chat_id)
        finally:
            # Client disconnects, generator errors, and normal completion all
            # converge here so background title/TTS/model tasks cannot outlive
            # the request that created them.
            await _cancel_chat_title_task(title_task)
            if active_task is not None and not active_task.done():
                active_task.cancel()
                with suppress(asyncio.CancelledError):
                    await active_task
            await tts_bootstrap.cancel()
            await finalized_tts.cancel()
            await _cleanup()
            _log.info(
                "HTTP Anima Direct Chat SSE Stream Cleanup Complete",
                anima_id=anima_id,
                chat_id=chat_id,
                run_id=run_id,
                completed_emitted=completed_emitted,
            )

    headers = {
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(_event_stream(), media_type="text/event-stream", headers=headers)
