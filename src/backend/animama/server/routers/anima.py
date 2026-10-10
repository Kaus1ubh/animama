from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Any, Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import noload, selectinload

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.mappers.anima_map import (
    anima_domain_to_schema,
    anima_update_request_to_domain,
)
from animama.adapters.repositories.sqlalchemy.anima_chat_profile_repo import SQLAlchemyAnimaChatProfileRepository
from animama.adapters.repositories.sqlalchemy.anima_presentation_repo import (
    SQLAlchemyAnimaPresentationRepository,
)
from animama.adapters.repositories.sqlalchemy.anima_repo import SQLAlchemyAnimaRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services import AnimaChatProfileService, AnimaService
from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.app.services.anima_presentation_service import AnimaPresentationService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import definition_for_kind
from animama.app.services.content_save_service import readable_entry_name
from animama.domain.anima import Anima
from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.anima_loadout import AnimaLoadoutError
from animama.domain.content_catalog import (
    ContentConflictError,
    ContentKind,
    ContentSource,
    ContentStatus,
    SavedContent,
)
from animama.domain.emotions import normalize_emotional_state
from animama.domain.request_principal import RequestPrincipal
from animama.logging_config import get_logger
from animama.orm import ORMAnima, ORMAnimaChatProfile
from animama.server.avatar_uploads import (
    STATUS_ABORTED,
    STATUS_CLEANUP_PENDING,
    STATUS_EXPIRED,
    STATUS_FINALIZED,
    STATUS_PENDING,
    create_pending_anima_voice_catalog_upload,
    get_user_anima_voice_catalog_upload,
    set_upload_status,
)
from animama.server.config import settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.gruut_text import build_gruut_sse_text
from animama.server.local_runtime import initialize_local_runtime
from animama.server.local_upload_stream import LocalUploadError, spool_bounded_request
from animama.server.model_clients import get_model_client_registry
from animama.server.pocket_voice_catalog import validate_pocket_voice_catalog_bytes
from animama.server.routers.chat.chat_sse import stream_direct_chat_sse
from animama.server.schemas.content import PyContentSaveResult
from animama.server.user_file_storage import (
    delete_private_file,
    open_bounded_private_file,
    private_upload_expires_at,
    write_private_file_stream,
)

from ..schemas import (
    PyAnimaChatProfileUpdateRequest,
    PyAnimaChatRequest,
    PyAnimaListItem,
    PyAnimaResponse,
    PyAnimaUpdateRequest,
    PyAvatarUploadInitRequest,
    PyAvatarUploadInitResponse,
    PyEmotionalState,
)

router = APIRouter()
_log = get_logger("server.routers.anima")


def _build_anima_payload(dom_anima: Anima) -> dict[str, Any]:
    schema = anima_domain_to_schema(dom_anima)
    return {**schema.model_dump(mode="json")}


def _anima_chat_profile_payload(row: Any | None) -> dict[str, Any] | None:
    if row is None:
        return None
    return {
        "anima_id": row.anima_id,
        "default_model_provider_id": row.default_model_provider_id,
        "metadata": dict(getattr(row, "metadata_", None) or getattr(row, "metadata", None) or {}),
        "created_at": getattr(row, "created_at", None),
        "updated_at": getattr(row, "updated_at", None),
    }


async def _attach_anima_chat_profile_payload(
    session: AsyncSession,
    payload: dict[str, Any],
) -> dict[str, Any]:
    anima_id = payload.get("id")
    if not isinstance(anima_id, str) or not anima_id:
        payload["chat_profile"] = None
        return payload
    payload["chat_profile"] = _anima_chat_profile_payload(await session.get(ORMAnimaChatProfile, anima_id))
    return payload


def _build_gruut_sse_text(
    text: str,
    *,
    lang: str = "en_US",
    tokenized_text_source: Literal["input", "text_with_ws"] = "input",
) -> dict[str, str | list[list[str]]] | None:
    """Expand/tokenize and phonemize text for SSE completion payloads."""

    return build_gruut_sse_text(
        text,
        lang=lang,
        tokenized_text_source=tokenized_text_source,
    )


@router.post(
    "/v1/animas/voice-catalogs/uploads",
    response_model=PyAvatarUploadInitResponse,
    status_code=status.HTTP_200_OK,
)
async def init_anima_voice_catalog_upload(
    req: PyAvatarUploadInitRequest,
    session: AsyncSession = Depends(get_async_session),
    user: RequestPrincipal = Depends(get_current_principal),
) -> PyAvatarUploadInitResponse:
    filename = (req.filename or "").strip()
    if not filename or not filename.lower().endswith(".bin"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only .bin uploads are supported")

    if req.size_bytes > settings.anima_pocket_voice_catalog_max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Pocket voice catalog upload exceeds the "
                f"{settings.anima_pocket_voice_catalog_max_upload_bytes} byte limit"
            ),
        )

    content_type = (req.content_type or "").strip() or "application/octet-stream"
    storage_locator = f"staging/voice-catalogs/{user.id}/{uuid4().hex}.bin"

    expires_at = private_upload_expires_at()
    upload = await create_pending_anima_voice_catalog_upload(
        session,
        user_id=user.id,
        storage_locator=storage_locator,
        original_filename=filename,
        declared_content_type=content_type,
        declared_size_bytes=req.size_bytes,
        expires_at=expires_at,
    )
    await session.commit()

    return PyAvatarUploadInitResponse(
        upload_id=upload.id,
        upload_url=f"/v1/animas/voice-catalogs/uploads/{upload.id}/content",
        method="PUT",
        headers={"Content-Type": content_type},
        expires_at=expires_at,
    )


@router.put(
    "/v1/animas/voice-catalogs/uploads/{upload_id}/content",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def upload_anima_voice_catalog_content(
    upload_id: str,
    request: Request,
    session: AsyncSession = Depends(get_async_session),
    user: RequestPrincipal = Depends(get_current_principal),
) -> Response:
    """Stream one owner-scoped Pocket voice catalog into private staging."""

    upload = await get_user_anima_voice_catalog_upload(session, upload_id=upload_id, user_id=user.id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Voice catalog upload not found")
    if upload.status != STATUS_PENDING:
        raise HTTPException(status_code=409, detail="Voice catalog upload is not pending")
    if upload.expires_at <= datetime.now(UTC):
        raise HTTPException(status_code=410, detail="Voice catalog upload expired")
    try:
        body = await spool_bounded_request(
            request,
            expected_size_bytes=upload.declared_size_bytes,
            max_size_bytes=settings.anima_pocket_voice_catalog_max_upload_bytes,
            staging_directory=initialize_local_runtime(settings).uploads_staging_root,
        )
    except LocalUploadError as exc:
        raise HTTPException(status_code=422, detail={"code": exc.code}) from exc
    try:
        if not write_private_file_stream(
            upload.storage_locator,
            body.stream,
            content_type=upload.declared_content_type or "application/octet-stream",
            content_length=body.size_bytes,
        ):
            raise HTTPException(status_code=507, detail={"code": "voice_catalog_local_write_failed"})
    finally:
        body.close()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/v1/animas/voice-catalogs/uploads/{upload_id}:finalize",
    response_model=PyContentSaveResult,
)
async def finalize_anima_voice_catalog_upload(
    upload_id: str,
    session: AsyncSession = Depends(get_async_session),
    user: RequestPrincipal = Depends(get_current_principal),
) -> PyContentSaveResult:
    """Validate and publish a normal readable ``content/local/voices`` file."""

    upload = await get_user_anima_voice_catalog_upload(session, upload_id=upload_id, user_id=user.id)
    if upload is None:
        raise HTTPException(status_code=404, detail="Voice catalog upload not found")
    logical_key = f"local:voice:{upload.id}"
    paths = initialize_local_runtime(settings)
    store = FilesystemContentStore(
        included_root=paths.included_root,
        included_sources=paths.included_sources,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )
    catalog = SQLAlchemyContentCatalog(session)
    content = ContentCatalogService(
        store=store,
        catalog=catalog,
    )
    await content.rescan(user_id=user.id, include_included=False)
    existing = await catalog.get_by_logical_key(
        source=ContentSource.LOCAL,
        logical_key=logical_key,
    )
    if existing is not None and existing.status is ContentStatus.VALID:
        return PyContentSaveResult.from_domain(SavedContent(upload.id, existing))
    if upload.status != STATUS_PENDING:
        raise HTTPException(status_code=409, detail="Voice catalog upload is not pending")
    try:
        with open_bounded_private_file(
            upload.storage_locator,
            expected_size_bytes=upload.declared_size_bytes,
        ) as staged:
            payload = staged.stream.read()
    except Exception as exc:
        raise HTTPException(status_code=409, detail="Voice catalog bytes are unavailable") from exc
    try:
        parsed = validate_pocket_voice_catalog_bytes(payload)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail={"code": "voice_catalog_invalid", "reason": str(exc)}) from exc
    entry_name = readable_entry_name(PurePosixPath(upload.original_filename).stem)
    relative_locator = f"{definition_for_kind(ContentKind.VOICE).directory}/{entry_name}.bin"
    collision = await catalog.get_by_locator(
        source=ContentSource.LOCAL,
        relative_locator=relative_locator,
    )
    if collision is not None and collision.logical_key != logical_key:
        relative_locator = f"voices/{entry_name}-{upload.id[-8:]}.bin"
    metadata = json.dumps(
        {
            "schema_version": 1,
            "id": logical_key,
            "display_name": PurePosixPath(upload.original_filename).stem,
            "content_type": "voice",
            "voices": sorted(parsed),
        },
        indent=2,
        sort_keys=True,
    ).encode()
    try:
        store.save_standalone(
            kind=ContentKind.VOICE,
            relative_locator=relative_locator,
            payload=payload,
            metadata_sidecar=metadata,
            operation_id=f"voice:{upload.id}",
        )
        await content.rescan(user_id=user.id, include_included=False)
        saved = await catalog.get_by_logical_key(
            source=ContentSource.LOCAL,
            logical_key=logical_key,
        )
        if saved is None or saved.status is not ContentStatus.VALID:
            raise ContentConflictError("saved_voice_catalog_invalid")
        if saved.owner_user_id is None:
            saved = await catalog.assign_creator_owner(item_id=saved.id, user_id=user.id)
    except ContentConflictError as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code}) from exc
    set_upload_status(upload, status=STATUS_FINALIZED)
    await session.commit()
    if not delete_private_file(upload.storage_locator):
        upload.last_error = "cleanup_pending"
        await session.commit()
    return PyContentSaveResult.from_domain(SavedContent(upload.id, saved))


@router.delete(
    "/v1/animas/voice-catalogs/uploads/{upload_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def abort_anima_voice_catalog_upload(
    upload_id: str,
    session: AsyncSession = Depends(get_async_session),
    user: RequestPrincipal = Depends(get_current_principal),
) -> Response:
    upload = await get_user_anima_voice_catalog_upload(
        session,
        upload_id=upload_id,
        user_id=user.id,
    )
    if upload is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voice catalog upload not found")
    if upload.status == STATUS_FINALIZED:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Voice catalog upload already finalized")
    if upload.status in {STATUS_ABORTED, STATUS_EXPIRED}:
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    deleted = delete_private_file(upload.storage_locator)
    set_upload_status(
        upload,
        status=STATUS_ABORTED if deleted else STATUS_CLEANUP_PENDING,
        last_error=None if deleted else "Abort cleanup will retry",
    )
    await session.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/v1/animas", response_model=list[PyAnimaListItem])
async def list_animas(
    session: AsyncSession = Depends(get_async_session),
    user: RequestPrincipal = Depends(get_current_principal),
) -> JSONResponse:
    """List owned Animas in stable creation order (fresh starters begin with Annie)."""
    _log.info("HTTP Anima List")

    res = await session.execute(
        select(ORMAnima)
        .where(ORMAnima.user_id == user.id)
        .order_by(ORMAnima.created_at.asc(), ORMAnima.id.asc())
        .options(
            selectinload(ORMAnima.avatar),
            noload(ORMAnima.archive),
            noload(ORMAnima.chats),
        )
    )
    rows = list(res.scalars())
    anima_ids = tuple(row.id for row in rows)
    chat_profiles = await SQLAlchemyAnimaChatProfileRepository(session).get_many(anima_ids)
    presentations = await AnimaPresentationService(
        presentations=SQLAlchemyAnimaPresentationRepository(session)
    ).list_owned_presentations(user_id=user.id, anima_ids=anima_ids)
    out: list[dict[str, Any]] = []
    from animama.adapters.mappers.anima_map import anima_orm_to_domain as _p2d

    for orm in rows:
        d = _p2d(orm)
        payload = _build_anima_payload(d)
        payload["chat_profile"] = _anima_chat_profile_payload(chat_profiles.get(orm.id))
        presentation = presentations.get(orm.id)
        if presentation is None:  # pragma: no cover - same owner predicate
            raise HTTPException(
                status_code=500,
                detail={"code": "anima_presentation_unavailable"},
            )
        thumbnail = presentation.profile_thumbnail
        payload["presentation"] = {
            "anima_id": presentation.anima_id,
            "presentation_revision": presentation.presentation_revision,
            "display_name": presentation.display_name,
            "profile_thumbnail": (
                {
                    "source_type": thumbnail.source_type,
                    "url": thumbnail.url,
                    "content_type": thumbnail.content_type,
                    "width": thumbnail.width,
                    "height": thumbnail.height,
                    "content_revision": thumbnail.content_revision,
                    "presentation": {
                        "fit": thumbnail.presentation.fit,
                        "focal_x": thumbnail.presentation.focal_x,
                        "focal_y": thumbnail.presentation.focal_y,
                        "zoom": thumbnail.presentation.zoom,
                    },
                }
                if thumbnail is not None
                else None
            ),
        }
        out.append(payload)
    return JSONResponse(content=jsonable_encoder(out))


@router.get("/v1/animas/{anima_id}", response_model=PyAnimaResponse)
async def get_anima(
    anima_id: str,
    session: AsyncSession = Depends(get_async_session),
    user: RequestPrincipal = Depends(get_current_principal),
) -> JSONResponse:
    """Get a anima by id."""
    _log.info("HTTP Anima Get", id=anima_id)
    repo = SQLAlchemyAnimaRepository(session)
    # Ownership check
    orm_check = await session.get(ORMAnima, anima_id)
    if orm_check is None or orm_check.user_id != user.id:
        raise HTTPException(status_code=404, detail="Anima not found")
    dom = await repo.get(anima_id)
    if dom is None:
        raise HTTPException(status_code=404, detail="Anima not found")
    payload = _build_anima_payload(dom)
    payload = await _attach_anima_chat_profile_payload(session, payload)
    _log.info("HTTP Anima Get Complete", id=anima_id, payload=payload)
    return JSONResponse(content=jsonable_encoder(payload))


@router.patch("/v1/animas/{anima_id}/chat-profile", response_model=PyAnimaResponse)
async def update_anima_chat_profile(
    anima_id: str,
    req: PyAnimaChatProfileUpdateRequest,
    session: AsyncSession = Depends(get_async_session),
    user: RequestPrincipal = Depends(get_current_principal),
) -> JSONResponse:
    """Update the anima-level direct chat model selector."""

    orm_check = await session.get(ORMAnima, anima_id)
    if orm_check is None or orm_check.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anima not found")

    service = AnimaChatProfileService(
        profiles=SQLAlchemyAnimaChatProfileRepository(session),
        model_providers=SQLAlchemyModelProviderRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )
    try:
        await service.set_default_model_provider(
            anima_id=anima_id,
            model_provider_id=req.default_model_provider_id,
            metadata_patch={"source": "anima_chat_profile_update"},
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    repo = SQLAlchemyAnimaRepository(session)
    dom = await repo.get(anima_id)
    if dom is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anima not found")
    payload = _build_anima_payload(dom)
    payload = await _attach_anima_chat_profile_payload(session, payload)
    return JSONResponse(content=jsonable_encoder(payload))


@router.patch("/v1/animas/{anima_id}", response_model=PyAnimaResponse)
async def patch_anima(
    anima_id: str,
    req: PyAnimaUpdateRequest,
    session: AsyncSession = Depends(get_async_session),
    user: RequestPrincipal = Depends(get_current_principal),
) -> JSONResponse:
    """Guard explicit definition edits separately from mutable runtime state."""
    repo = SQLAlchemyAnimaRepository(session)
    uow = SQLAlchemyUnitOfWork(session)
    if not await repo.is_owned_by_user(user_id=user.id, anima_id=anima_id):
        raise HTTPException(status_code=404, detail="Anima not found")
    anima_patch = req.anima
    fields = anima_patch.model_fields_set if anima_patch else set()
    if "profile_picture_url" in fields:
        raise HTTPException(status_code=422, detail={"code": "use_typed_appearance_command"})
    definition_edit = bool(fields & {"display_name", "avatar_id"})
    if definition_edit and req.expected_aggregate_revision is None:
        raise HTTPException(status_code=409, detail={"code": "expected_aggregate_revision_required"})
    try:
        dom = (
            await repo.lock_definition(
                user_id=user.id, anima_id=anima_id, expected_revision=req.expected_aggregate_revision
            )
            if definition_edit
            else await repo.get(anima_id)
        )
        assert dom is not None
        changed = False
        if "avatar_id" in fields:
            assert anima_patch is not None
            changed = await AnimaLoadoutService(session).set_legacy_avatar_in_uow(
                user_id=user.id,
                anima_id=anima_id,
                avatar_id=anima_patch.avatar_id,
            )
        display_name = anima_patch.display_name if anima_patch else None
        changed = changed or (display_name is not None and display_name != dom.display_name)
        await repo.update(anima_update_request_to_domain(req, dom))
        if changed:
            assert req.expected_aggregate_revision is not None
            await repo.record_definition_revision(
                user_id=user.id,
                anima_id=anima_id,
                expected_revision=req.expected_aggregate_revision,
                reason="anima_definition_update",
                display_name=display_name,
            )
        await uow.commit()
    except AnimaDefinitionError as exc:
        await uow.rollback()
        code = 404 if exc.code == "anima_not_found" else 409
        raise HTTPException(
            status_code=code, detail={"code": exc.code, "current_revision": exc.current_revision}
        ) from exc
    except AnimaLoadoutError as exc:
        await uow.rollback()
        raise HTTPException(status_code=409, detail={"code": exc.code}) from exc
    except ValueError as exc:
        await uow.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception:
        await uow.rollback()
        raise
    refreshed = await repo.get(anima_id)
    if refreshed is None:
        raise HTTPException(status_code=500, detail="Failed to reload updated anima")
    payload = _build_anima_payload(refreshed)
    payload = await _attach_anima_chat_profile_payload(session, payload)
    return JSONResponse(content=jsonable_encoder(payload))


@router.delete("/v1/animas/{anima_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_anima(
    anima_id: str,
    session: AsyncSession = Depends(get_async_session),
    user: RequestPrincipal = Depends(get_current_principal),
) -> Response:
    repo = SQLAlchemyAnimaRepository(session)
    service = AnimaService(animas=repo, uow=SQLAlchemyUnitOfWork(session))
    orm_check = await session.get(ORMAnima, anima_id)
    if orm_check is None or orm_check.user_id != user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anima not found")
    deleted = await service.delete(anima_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Anima not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.put("/v1/animas/{anima_id}/emotional-state", response_model=PyAnimaResponse)
async def update_anima_emotional_state(
    anima_id: str,
    emotional_state: PyEmotionalState,
    session: AsyncSession = Depends(get_async_session),
    user: RequestPrincipal = Depends(get_current_principal),
) -> JSONResponse:
    _log.info("HTTP Anima EmotionalState Update start", anima_id=anima_id, user=user)
    repo = SQLAlchemyAnimaRepository(session)
    uow = SQLAlchemyUnitOfWork(session)
    service = AnimaService(animas=repo, uow=uow)

    orm_check = await session.get(ORMAnima, anima_id)
    if orm_check is None or orm_check.user_id != user.id:
        raise HTTPException(status_code=404, detail="Anima not found")

    dom = await repo.get(anima_id)
    if dom is None:
        raise HTTPException(status_code=404, detail="Anima not found")

    dom.emotional_state = normalize_emotional_state(
        emotional_state.model_dump(mode="python"),
    )
    stored = await service.update(dom)
    refreshed = await service.get(stored.id)
    if refreshed is None:
        raise HTTPException(status_code=500, detail="Failed to reload updated anima")

    payload = _build_anima_payload(refreshed)
    payload = await _attach_anima_chat_profile_payload(session, payload)
    return JSONResponse(content=jsonable_encoder(payload))


async def _chat_anima_direct_sse(
    anima_id: str,
    req: PyAnimaChatRequest,
    user: RequestPrincipal,
    request: Request,
) -> StreamingResponse:
    return await stream_direct_chat_sse(
        app=request.app,
        anima_id=anima_id,
        req=req,
        user=user,
        model_client_registry=get_model_client_registry(request.app),
        build_gruut_sse_text=_build_gruut_sse_text,
    )


@router.post("/v1/animas/{anima_id}/chat:sse")
async def chat_anima_direct_sse(
    anima_id: str,
    req: PyAnimaChatRequest,
    request: Request,
    user: RequestPrincipal = Depends(get_current_principal),
) -> StreamingResponse:
    """Run a direct avatar companion chat turn over SSE."""
    return await _chat_anima_direct_sse(anima_id, req, user, request)
