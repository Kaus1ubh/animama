"""Authenticated catalog, rescan, and registered-byte delivery routes."""

from __future__ import annotations

import json
from collections.abc import Iterator
from typing import Annotated, BinaryIO, NoReturn

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Query, Request, Response, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_file_validation import ContentFileInvalidError
from animama.app.services.content_kind_registry import MAX_JSON_BYTES, RETIRED_CONTENT_KINDS, definition_for_kind
from animama.app.services.content_save_service import ContentSaveService
from animama.app.services.content_transition_service import ContentTransitionService
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentConflictError,
    ContentIntegrityError,
    ContentKind,
    ContentNotFoundError,
    ContentPathError,
    ContentStatus,
    ContentValidationError,
    SavedContent,
    VerifiedContentFile,
)
from animama.domain.content_documents import ContentDocumentError
from animama.domain.request_principal import RequestPrincipal
from animama.server.config import settings
from animama.server.local_runtime import LocalRuntimePaths, initialize_local_runtime
from animama.server.schemas.content import (
    PyContentCatalog,
    PyContentItem,
    PyContentRescan,
    PyContentScanSummary,
)

from ..deps import get_async_session, get_current_principal

router = APIRouter(prefix="/v1/content", tags=["content"])


def _paths(request: Request) -> LocalRuntimePaths:
    paths = getattr(request.app.state, "local_runtime_paths", None)
    if isinstance(paths, LocalRuntimePaths):
        return paths
    paths = initialize_local_runtime(settings)
    request.app.state.local_runtime_paths = paths
    return paths


def _service(request: Request, session: AsyncSession) -> ContentCatalogService:
    return ContentCatalogService(
        store=_store(request),
        catalog=SQLAlchemyContentCatalog(session),
    )


def _store(request: Request) -> FilesystemContentStore:
    paths = _paths(request)
    return FilesystemContentStore(
        included_root=paths.included_root,
        included_sources=paths.included_sources,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )


def _save_service(request: Request, session: AsyncSession) -> ContentSaveService:
    catalog = SQLAlchemyContentCatalog(session)
    store = _store(request)
    content = ContentCatalogService(
        store=store,
        catalog=catalog,
    )
    return ContentSaveService(content=content)


def _catalog_response(items: list[CatalogContentEntry]) -> PyContentCatalog:
    return PyContentCatalog(
        scan_required=any(item.status is ContentStatus.SCAN_REQUIRED for item in items),
        items=[PyContentItem.from_domain(item) for item in items],
    )


@router.get("/catalog", response_model=PyContentCatalog)
async def list_content_catalog(
    request: Request,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyContentCatalog:
    """List Included, shared, and caller-owned entries without host paths."""

    items = await _service(request, session).list_visible(user_id=user.id)
    return _catalog_response(items)


@router.get("/items/{item_id}", response_model=PyContentItem)
async def get_content_item(
    item_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyContentItem:
    """Return one visible neutral catalog item by its opaque identity."""

    item = await SQLAlchemyContentCatalog(session).get_visible_item(item_id=item_id, user_id=user.id)
    if item is None or item.kind in RETIRED_CONTENT_KINDS:
        raise HTTPException(status_code=404, detail={"code": "content_not_found"})
    return PyContentItem.from_domain(item)


@router.post(":rescan", response_model=PyContentRescan)
async def rescan_content_catalog(
    request: Request,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyContentRescan:
    """Perform the authoritative scan; this never equips newly admitted content."""

    result = await ContentTransitionService(
        content=_service(request, session), bindings=SQLAlchemyContentTransitionBindings(session)
    ).transition(user_id=user.id)
    items = list(result.items)
    return PyContentRescan(
        summaries=[PyContentScanSummary.from_domain(summary) for summary in result.summaries],
        catalog=_catalog_response(items),
    )


async def _bounded_upload(upload: UploadFile, *, limit: int) -> tuple[BinaryIO, int]:
    """Measure one Starlette-spooled upload without retaining another RAM copy."""

    received = 0
    while chunk := await upload.read(1024 * 1024):
        received += len(chunk)
        if received > limit:
            raise HTTPException(
                status_code=413,
                detail={"code": "content_file_too_large", "field": "files"},
            )
    if received == 0:
        raise HTTPException(
            status_code=422,
            detail={"code": "content_file_empty", "field": "files"},
        )
    await upload.seek(0)
    return upload.file, received


def _raise_content_mutation(exc: Exception) -> NoReturn:
    if isinstance(exc, ContentDocumentError):
        raise HTTPException(status_code=422, detail={"code": "content_invalid", "reason": exc.code}) from exc
    if isinstance(exc, ContentFileInvalidError):
        raise HTTPException(
            status_code=422, detail={"code": "content_invalid", "reason": exc.reason, "field": exc.field}
        ) from exc
    if isinstance(exc, ContentNotFoundError):
        raise HTTPException(status_code=404, detail={"code": "content_not_found"}) from exc
    if isinstance(exc, ContentConflictError):
        detail: dict[str, object] = {"code": exc.code}
        if exc.current_revision is not None:
            detail["current_revision"] = exc.current_revision
        if exc.field is not None:
            detail["field"] = exc.field
        status_code = 404 if exc.code in {"anima_not_found", "catalog_item_not_found"} else 409
        raise HTTPException(status_code=status_code, detail=detail) from exc
    if isinstance(exc, ContentPathError | ValueError):
        raise HTTPException(status_code=422, detail={"code": "content_path_invalid"}) from exc
    if isinstance(exc, ContentValidationError):
        raise HTTPException(status_code=422, detail={"code": "content_invalid", "reason": str(exc)}) from exc
    raise exc


async def save_content_item(
    request: Request,
    kind: ContentKind,
    entry_name: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    operation_id: Annotated[str, Form(min_length=1, max_length=128)],
    files: Annotated[list[UploadFile] | None, File()] = None,
    catalog_item_id: Annotated[str | None, Form()] = None,
    expected_revision: Annotated[str | None, Form(pattern=r"^[0-9a-f]{64}$")] = None,
    descriptor_json: Annotated[str | None, Form()] = None,
    metadata_json: Annotated[str | None, Form()] = None,
    companion_paths_json: Annotated[str, Form()] = "[]",
    creation_context: bool = False,
) -> SavedContent:
    """Shared typed-router implementation for direct Local Save."""

    definition = definition_for_kind(kind)
    uploads = files or []
    try:
        if descriptor_json is None:
            if len(uploads) != 1:
                raise ContentConflictError("standalone_requires_one_file", field="files")
            upload = uploads[0]
            payload_stream, payload_size_bytes = await _bounded_upload(upload, limit=definition.max_file_bytes)
            metadata = metadata_json.encode() if metadata_json is not None else None
            if metadata is not None and len(metadata) > MAX_JSON_BYTES:
                raise HTTPException(status_code=413, detail={"code": "content_metadata_too_large"})
            saved = await _save_service(request, session).save_standalone_stream(
                user_id=user.id,
                kind=kind,
                entry_name=entry_name,
                filename=upload.filename or entry_name,
                payload_stream=payload_stream,
                payload_size_bytes=payload_size_bytes,
                metadata_sidecar=metadata,
                operation_id=operation_id,
                catalog_item_id=catalog_item_id,
                expected_revision=expected_revision,
                declared_content_type=upload.content_type if kind is ContentKind.APPEARANCE else None,
                creation_context=creation_context,
            )
        else:
            try:
                companion_paths = json.loads(companion_paths_json)
            except json.JSONDecodeError as exc:
                raise ContentConflictError("invalid_companion_paths", field="files") from exc
            if (
                not isinstance(companion_paths, list)
                or len(companion_paths) != len(uploads)
                or not all(isinstance(value, str) for value in companion_paths)
            ):
                raise ContentConflictError("invalid_companion_paths", field="files")
            companions: dict[str, tuple[BinaryIO, int]] = {}
            descriptor = descriptor_json.encode()
            total = len(descriptor)
            if total > MAX_JSON_BYTES:
                raise HTTPException(status_code=413, detail={"code": "content_descriptor_too_large"})
            for path, upload in zip(companion_paths, uploads, strict=True):
                if path in companions:
                    raise ContentConflictError("duplicate_companion_path", field="files")
                payload_stream, payload_size_bytes = await _bounded_upload(upload, limit=definition.max_file_bytes)
                total += payload_size_bytes
                if total > definition.max_entry_bytes:
                    raise HTTPException(
                        status_code=413,
                        detail={"code": "content_entry_too_large", "field": "files"},
                    )
                companions[path] = (payload_stream, payload_size_bytes)
            saved = await _save_service(request, session).save_descriptor_streams(
                user_id=user.id,
                kind=kind,
                entry_name=entry_name,
                descriptor=descriptor,
                companion_files=companions,
                operation_id=operation_id,
                catalog_item_id=catalog_item_id,
                expected_revision=expected_revision,
                companion_media_types={
                    path: upload.content_type for path, upload in zip(companion_paths, uploads, strict=True)
                },
            )
        return saved
    except HTTPException:
        raise
    except Exception as exc:
        _raise_content_mutation(exc)


@router.delete("/items/{item_id}", status_code=204)
async def delete_content_item(
    request: Request,
    item_id: str,
    expected_revision: Annotated[str, Query(pattern=r"^[0-9a-f]{64}$")],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> Response:
    """Delete one exact editable Local entry; Included content is read-only."""

    try:
        await _service(request, session).delete_item(
            item_id=item_id,
            user_id=user.id,
            expected_revision=expected_revision,
        )
        return Response(status_code=204)
    except Exception as exc:
        _raise_content_mutation(exc)


def _stream_verified_file(file: VerifiedContentFile) -> Iterator[bytes]:
    try:
        while chunk := file.handle.read(1024 * 1024):
            yield chunk
    finally:
        file.handle.close()


@router.get("/files/{file_ref}")
async def stream_content_file(
    request: Request,
    file_ref: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """Authorize, contain, and digest-check an opaque registration in one response."""

    try:
        file = await _service(request, session).open_registered_file(file_ref=file_ref, user_id=user.id)
    except ContentNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"code": "content_file_not_found"}) from exc
    except (ContentIntegrityError, ContentPathError) as exc:
        raise HTTPException(status_code=409, detail={"code": "content_file_changed_rescan_required"}) from exc

    etag = f'"{file.sha256}"'
    cache_control = "private, no-cache"
    headers = {
        "Cache-Control": cache_control,
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
    }
    if if_none_match == etag:
        file.handle.close()
        return Response(status_code=304, headers=headers)
    headers["Content-Length"] = str(file.size_bytes)
    return StreamingResponse(_stream_verified_file(file), media_type=file.media_type, headers=headers)


@router.get("/previews/{preview_id}/revisions/{revision_sha256}/files/{file_ref}")
async def stream_content_preview_file(
    request: Request,
    preview_id: str,
    revision_sha256: str,
    file_ref: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """Stream an exact preview membership; catalog edits invalidate its bytes."""

    try:
        file = await _service(request, session).open_preview_file(
            preview_id=preview_id,
            revision_sha256=revision_sha256,
            file_ref=file_ref,
            user_id=user.id,
        )
    except ContentNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"code": "content_preview_not_found"}) from exc
    except (ContentIntegrityError, ContentPathError) as exc:
        raise HTTPException(status_code=409, detail={"code": "content_preview_changed"}) from exc
    etag = f'"{file.sha256}"'
    headers = {
        "Cache-Control": "private, no-store",
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
    }
    if if_none_match == etag:
        file.handle.close()
        return Response(status_code=304, headers=headers)
    headers["Content-Length"] = str(file.size_bytes)
    return StreamingResponse(_stream_verified_file(file), media_type=file.media_type, headers=headers)


__all__ = ["router"]
