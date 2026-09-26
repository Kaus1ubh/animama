from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from fastapi import HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_chat_profile_repo import SQLAlchemyAnimaChatProfileRepository
from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_file_processing_repo import SQLAlchemyUserFileProcessingRepository
from animama.app.chat import (
    DirectChatAttachmentContext,
    DirectChatMemoryContextService,
    DirectChatTurnExecutor,
    DirectChatTurnRequest,
    DirectChatTurnSetupError,
    ModelClientNotFoundError,
    PreparedDirectChatTurn,
    RuntimeGestureDescriptor,
)
from animama.app.chat.memory_search import validate_searchable_attached_files
from animama.app.model_clients import ModelClientRegistry
from animama.app.services.anima_chat_profile_service import AnimaChatProfileService
from animama.app.services.anima_runtime_service import AnimaRuntimeService
from animama.app.services.chat_manager import ChatApiStandardConflictError
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.user_file_overview import deserialize_user_file_overview
from animama.domain.emotions import normalize_emotional_state
from animama.domain.request_principal import RequestPrincipal
from animama.domain.user_file import UserFile
from animama.logging_config import get_logger
from animama.orm import ORMAnima
from animama.server.chat_options import DirectChatOptions, resolve_chat_request_options
from animama.server.config import Settings, settings
from animama.server.deps import get_embedder
from animama.server.schemas.chat import PyAnimaChatRequest

from .safety import TurnSafety, prepare_turn_safety
from .session_services import (
    SessionBackedChatTurnRecorder,
    SessionBackedMemoryEpisodeRecorder,
    SessionBackedMemoryToolService,
)
from .setup_helpers import chat_manager

_log = get_logger("server.routers.chat.turn_setup")


@dataclass(slots=True)
class DirectChatTurnSetup:
    """Route-owned state needed by the SSE generator after setup finishes."""

    emotional_state: dict[str, int] | None
    chat_options: DirectChatOptions
    executor: DirectChatTurnExecutor
    prepared_turn: PreparedDirectChatTurn
    safety: TurnSafety


def _attachment_prompt_context(user_file: UserFile, *, chunk_count: int) -> DirectChatAttachmentContext:
    """Convert one validated upload row to safe, provider-neutral prompt data."""

    try:
        overview = deserialize_user_file_overview((user_file.metadata or {}).get("overview"))
    except Exception:
        # Stored JSON is untrusted historical data. A malformed overview must
        # never make an otherwise searchable attachment reject the chat turn.
        overview = None
    if overview is None:
        return DirectChatAttachmentContext(
            filename=user_file.original_filename,
            chunk_count=chunk_count,
        )
    return DirectChatAttachmentContext(
        filename=user_file.original_filename,
        chunk_count=chunk_count,
        description=overview.description,
        outline=overview.outline,
        outline_truncated=overview.outline_truncated,
    )


async def prepare_direct_chat_turn(
    *,
    session: AsyncSession,
    session_factory: Any,
    anima_id: str,
    req: PyAnimaChatRequest,
    user: RequestPrincipal,
    run_id: str,
    chat_id: str,
    model_client_registry: ModelClientRegistry,
    runtime_settings: Settings = settings,
) -> DirectChatTurnSetup:
    """Validate route inputs and build the app-layer direct chat turn.

    This function is the synchronous-feeling setup phase for `chat:sse`: it
    checks anima ownership, resolves request options, wires repositories and
    services around the current session, and asks `DirectChatTurnExecutor` to
    prepare the provider-neutral model request before the stream opens.
    """

    # Ownership is enforced before any model/provider setup so callers cannot
    # infer chat or model state for another user's anima.
    orm_anima = await session.get(ORMAnima, anima_id)
    if orm_anima is None or (orm_anima.user_id is not None and orm_anima.user_id != user.id):
        raise HTTPException(status_code=404, detail="Anima not found")
    emotional_state = (
        normalize_emotional_state(orm_anima.emotional_state) if orm_anima.emotional_state is not None else None
    )

    # Browser chat mounts an immutable runtime revision before sending. Resolve
    # and fence that exact catalog while the setup session is still open and
    # before provider selection, prompt construction, or model invocation.
    if req.runtime_revision is None:
        raise HTTPException(status_code=409, detail={"code": "runtime_remount_required"})
    snapshot = await AnimaRuntimeService(session).get_snapshot(
        user_id=user.id,
        anima_id=anima_id,
        revision=req.runtime_revision,
    )
    if snapshot is None or snapshot.expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=409, detail={"code": "runtime_remount_required"})
    catalog = snapshot.catalog
    resolved_runtime_gesture_ids = tuple(
        str(row["semantic_key"]) for row in catalog.get("gestures", []) if row.get("semantic_key")
    )
    runtime_gesture_descriptors = tuple(
        RuntimeGestureDescriptor(
            selector=str(row["semantic_key"]),
            name=str(row.get("name") or row["semantic_key"]),
            description=str(row.get("description") or row.get("name") or row["semantic_key"]),
        )
        for row in catalog.get("gestures", [])
        if row.get("semantic_key")
    )
    runtime_revision = req.runtime_revision

    # Route request options are merged with persisted user/anima settings before
    # reaching app-layer direct chat code.
    request_options = req.dispatch_options.model_dump(exclude_unset=True) if req.dispatch_options else None
    chat_options = DirectChatOptions.from_value(
        await resolve_chat_request_options(
            session=session,
            user=user,
            anima_id=anima_id,
            request_opts=request_options,
        )
    )
    # Companion safety is resolved before the prompt so a local crisis signal can add
    # the care note. It never blocks the turn.
    safety = await prepare_turn_safety(
        session=session,
        user_id=user.id,
        message=req.message,
        client_context=req.client_context,
        runtime_settings=runtime_settings,
    )
    validated_attachments = await validate_searchable_attached_files(
        user_file_processing=SQLAlchemyUserFileProcessingRepository(session),
        user_id=user.id,
        file_ids=req.attached_file_ids,
    )
    attached_files = tuple(attachment.user_file for attachment in validated_attachments)
    attached_file_ids = tuple(user_file.id for user_file in attached_files)
    attachment_context = tuple(
        _attachment_prompt_context(
            attachment.user_file,
            chunk_count=attachment.chunk_count,
        )
        for attachment in validated_attachments
    )
    _log.info(
        "Direct chat attached upload validation completed",
        anima_id=anima_id,
        requested_attached_file_count=len(req.attached_file_ids or ()),
        searchable_attached_file_count=len(attached_file_ids),
    )

    # The executor itself is app-layer code. The route constructs SQLAlchemy
    # adapters here so dependency direction remains server -> app -> adapters.
    model_providers = SQLAlchemyModelProviderRepository(session)
    executor = DirectChatTurnExecutor(
        registry=model_client_registry,
        profile_service=AnimaChatProfileService(
            profiles=SQLAlchemyAnimaChatProfileRepository(session),
            model_providers=model_providers,
        ),
        model_providers=model_providers,
        chat_manager=chat_manager(session),
        turn_recorder=SessionBackedChatTurnRecorder(session_factory, chat_manager_factory=chat_manager),
        memory_episode_recorder=SessionBackedMemoryEpisodeRecorder(session_factory),
        memory_context_service=DirectChatMemoryContextService(
            memory_entries=MemoryEntryService(
                memory_entries=SQLAlchemyMemoryEntryRepository(session),
                uow=SQLAlchemyUnitOfWork(session),
                animas=SQLAlchemyAnimaRepository(session),
                commit_on_write=False,
            ),
            animas=SQLAlchemyAnimaRepository(session),
        ),
        memory_tool_service=SessionBackedMemoryToolService(
            session_factory,
            embedder_factory=get_embedder,
            allowed_uploaded_files={user_file.id: user_file.original_filename for user_file in attached_files},
        ),
    )
    direct_request = DirectChatTurnRequest(
        anima_id=anima_id,
        user_id=user.id,
        chat_id=chat_id,
        run_id=run_id,
        user_message=req.message,
        model_provider_id=req.model_provider_id,
        attached_file_ids=attached_file_ids,
        attached_files=attachment_context,
        request_options=chat_options,
        emotional_state=emotional_state,
        runtime_revision=runtime_revision,
        runtime_gesture_ids=resolved_runtime_gesture_ids,
        runtime_gesture_descriptors=runtime_gesture_descriptors,
        care_note=safety.care_note,
        provider_moderation=safety.provider_moderation,
    )
    try:
        # `prepare_turn` resolves the selected model provider, compiles memory
        # context, chooses any Responses continuation cursor, and creates the
        # provider-neutral `ModelClientRequest`.
        prepared_turn = await executor.prepare_turn(direct_request)
    except PermissionError as exc:
        raise HTTPException(status_code=404, detail="Chat not found") from exc
    except ChatApiStandardConflictError as exc:
        raise HTTPException(status_code=409, detail=exc.detail) from exc
    except DirectChatTurnSetupError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ModelClientNotFoundError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    model_provider = prepared_turn.model_request.model_provider
    _log.info(
        "Direct chat model provider selected",
        anima_id=anima_id,
        model_provider_id=model_provider.id,
        provider_type=model_provider.provider_type,
        model=model_provider.model,
        request_override=req.model_provider_id is not None,
    )
    return DirectChatTurnSetup(
        emotional_state=emotional_state,
        chat_options=chat_options,
        executor=executor,
        prepared_turn=prepared_turn,
        safety=safety,
    )


__all__ = ["DirectChatTurnSetup", "prepare_direct_chat_turn"]
