"""The local composition's Anima voice-catalog uploads and direct chat streaming.

The shared Anima list, read, edit and delete routes live in
``animama.product_http.routes.animas``.
"""

from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import PurePosixPath
from typing import Literal
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import definition_for_kind
from animama.app.services.content_save_service import readable_entry_name
from animama.domain.content_catalog import (
    ContentConflictError,
    ContentKind,
    ContentSource,
    ContentStatus,
    SavedContent,
)
from animama.domain.request_principal import RequestPrincipal
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
    PyAnimaChatRequest,
    PyAvatarUploadInitRequest,
    PyAvatarUploadInitResponse,
)

router = APIRouter()


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
