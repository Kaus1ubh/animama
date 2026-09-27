from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.chat_message_repo import SQLAlchemyChatMessageRepository
from animama.adapters.repositories.sqlalchemy.chat_repo import SQLAlchemyChatRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services import ChatService
from animama.domain.chat import Chat, ChatMessage, ChatSearchResult
from animama.domain.request_principal import RequestPrincipal
from animama.domain.usage import Usage
from animama.orm import ORMAnima
from animama.server.deps import get_async_session, get_current_principal
from animama.server.schemas.chat_history import (
    PyChatCreate,
    PyChatMessage,
    PyChatMessagesResponse,
    PyChatResponse,
    PyChatSearchRequest,
    PyChatSearchResponse,
    PyChatSearchResult,
    PyChatUpdate,
    PyUsage,
    PyUsageInputDetails,
    PyUsageOutputDetails,
)

router = APIRouter()


def _to_schema(chat: Chat, *, last_message_at: datetime | None = None) -> PyChatResponse:
    return PyChatResponse(
        id=chat.id,
        anima_id=chat.anima_id,
        title=chat.title,
        api_standard=chat.api_standard,
        last_model_client=chat.last_model_client,
        last_model_id=chat.last_model_id,
        last_model_provider_id=chat.last_model_provider_id,
        metadata=chat.metadata or {},
        created_at=chat.created_at,
        updated_at=chat.updated_at,
        last_message_at=last_message_at,
        usage=_usage_to_schema(chat.usage),
        active_context_tokens=int(getattr(chat, "active_context_tokens", 0) or 0),
    )


def _usage_to_schema(usage: Usage | None) -> PyUsage | None:
    if usage is None:
        return None
    return PyUsage(
        requests=getattr(usage, "requests", 0) or 0,
        input_tokens=getattr(usage, "input_tokens", 0) or 0,
        output_tokens=getattr(usage, "output_tokens", 0) or 0,
        total_tokens=getattr(usage, "total_tokens", 0) or 0,
        input_tokens_details=PyUsageInputDetails(
            cached_tokens=getattr(getattr(usage, "input_tokens_details", None), "cached_tokens", 0) or 0,
            audio_tokens=getattr(getattr(usage, "input_tokens_details", None), "audio_tokens", 0) or 0,
        ),
        output_tokens_details=PyUsageOutputDetails(
            reasoning_tokens=getattr(getattr(usage, "output_tokens_details", None), "reasoning_tokens", 0) or 0,
            audio_tokens=getattr(getattr(usage, "output_tokens_details", None), "audio_tokens", 0) or 0,
            accepted_prediction_tokens=getattr(
                getattr(usage, "output_tokens_details", None), "accepted_prediction_tokens", 0
            )
            or 0,
            rejected_prediction_tokens=getattr(
                getattr(usage, "output_tokens_details", None), "rejected_prediction_tokens", 0
            )
            or 0,
        ),
    )


def _public_message_data(data: dict[str, Any] | None) -> dict[str, Any] | None:
    if data is None:
        return None
    public_data = dict(data)
    public_data.pop("raw_response", None)
    return public_data


def _public_message_content(message: ChatMessage) -> str | None:
    data = message.data if isinstance(message.data, Mapping) else {}
    structured = data.get("structured")
    if message.role is not None and message.role.value == "assistant" and isinstance(structured, dict):
        display = structured.get("display")
        if isinstance(display, str) and display.strip():
            return display
        speech = structured.get("speech")
        if isinstance(speech, str) and speech.strip():
            return speech
    return message.content


def _message_to_schema(message: ChatMessage) -> PyChatMessage:
    return PyChatMessage(
        id=message.id,
        chat_id=message.chat_id,
        run_id=message.run_id,
        message_type=message.message_type,
        role=message.role.value if message.role is not None else None,
        content=_public_message_content(message),
        model=message.model,
        model_provider=message.model_provider,
        data=_public_message_data(dict(message.data) if message.data is not None else None),
        usage=_usage_to_schema(message.usage),
        turn=message.turn,
        created_at=message.created_at,
        internal=bool(message.internal),
    )


def _search_result_to_schema(result: ChatSearchResult) -> PyChatSearchResult:
    return PyChatSearchResult(
        message_id=result.message_id,
        chat_id=result.chat_id,
        anima_id=result.anima_id,
        anima_name=result.anima_name,
        anima_profile_picture_url=result.anima_profile_picture_url,
        chat_title=result.chat_title,
        snippet=result.snippet,
        score=result.score,
        turn=result.turn,
        created_at=result.created_at,
    )


async def _require_owned_anima(session: AsyncSession, *, anima_id: str, user_id: str) -> None:
    anima = await session.get(ORMAnima, anima_id)
    if anima is None or anima.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anima not found")


def _chat_service(session: AsyncSession) -> ChatService:
    return ChatService(
        chats=SQLAlchemyChatRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )


@router.post("/v1/chats", response_model=PyChatResponse, status_code=status.HTTP_201_CREATED)
async def create_chat(
    req: PyChatCreate,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyChatResponse:
    await _require_owned_anima(session, anima_id=req.anima_id, user_id=user.id)
    chat = await _chat_service(session).create(
        anima_id=req.anima_id,
        user_id=user.id,
        title=req.title,
        metadata=req.metadata,
    )
    return _to_schema(chat)


@router.get("/v1/chats", response_model=list[PyChatResponse])
async def list_chats(
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    include_last_message_at: Annotated[bool, Query()] = False,
) -> list[PyChatResponse]:
    message_repo = SQLAlchemyChatMessageRepository(session) if include_last_message_at else None
    chats = await _chat_service(session).list_for_user(user_id=user.id)
    if message_repo is None:
        return [_to_schema(chat) for chat in chats]

    out: list[PyChatResponse] = []
    for chat in chats:
        last_message_at: datetime | None = None
        messages = await message_repo.list_by_chat(chat.id, limit=1, offset=0, order="desc")
        if messages:
            last_message_at = messages[0].created_at
        out.append(_to_schema(chat, last_message_at=last_message_at))
    return out


@router.post("/v1/chats/search", response_model=PyChatSearchResponse)
async def search_chat_messages(
    req: PyChatSearchRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyChatSearchResponse:
    results = await SQLAlchemyChatMessageRepository(session).search_for_user(
        user_id=user.id,
        query=req.query,
        limit=req.limit + 1,
        offset=req.offset,
    )
    has_more = len(results) > req.limit
    page = results[: req.limit]
    return PyChatSearchResponse(
        query=req.query,
        limit=req.limit,
        offset=req.offset,
        has_more=has_more,
        results=[_search_result_to_schema(result) for result in page],
    )


@router.get("/v1/chats/{chat_id}", response_model=PyChatResponse)
async def get_chat(
    chat_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyChatResponse:
    chat = await _chat_service(session).get(chat_id)
    if chat is None or chat.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return _to_schema(chat)


@router.patch("/v1/chats/{chat_id}", response_model=PyChatResponse)
async def update_chat(
    chat_id: str,
    req: PyChatUpdate,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyChatResponse:
    chat = await _chat_service(session).update(
        chat_id=chat_id,
        user_id=user.id,
        title=req.title,
        metadata=req.metadata,
    )
    if chat is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return _to_schema(chat)


@router.delete(
    "/v1/chats/{chat_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def delete_chat(
    chat_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> Response:
    ok = await _chat_service(session).delete(chat_id=chat_id, user_id=user.id)
    if not ok:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/v1/chats/{chat_id}/messages", response_model=PyChatMessagesResponse)
async def list_chat_messages(
    chat_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
    order: Annotated[Literal["asc", "desc"], Query()] = "asc",
    include_internal: Annotated[bool, Query()] = False,
) -> PyChatMessagesResponse:
    chat = await _chat_service(session).get(chat_id)
    if chat is None or chat.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Chat not found")

    messages = await SQLAlchemyChatMessageRepository(session).list_by_chat(
        chat_id,
        limit=limit,
        offset=offset,
        order="desc" if order == "desc" else "asc",
        include_internal=include_internal,
    )
    return PyChatMessagesResponse(chat_id=chat_id, messages=[_message_to_schema(message) for message in messages])
