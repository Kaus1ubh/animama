"""The local composition's catalog rescan, and content helpers its other routers use.

The shared catalog, item and byte routes live in ``animama.product_http.routes.content``.
"""

from __future__ import annotations

import json
from typing import Annotated, BinaryIO

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_kind_registry import MAX_JSON_BYTES, definition_for_kind
from animama.app.services.content_save_service import ContentSaveService
from animama.app.services.content_transition_service import ContentTransitionService
from animama.domain.content_catalog import (
    ContentConflictError,
    ContentKind,
    SavedContent,
)
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import WriteContent, WriteSession
from animama.product_http.routes.content import bounded_upload, catalog_response, raise_content_mutation
from animama.server.config import settings
from animama.server.local_runtime import LocalRuntimePaths, initialize_local_runtime
from animama.server.schemas.content import (
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


@router.post(":rescan", response_model=PyContentRescan)
async def rescan_content_catalog(
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: WriteSession,
    content: WriteContent,
) -> PyContentRescan:
    """Perform the authoritative scan; this never equips newly admitted content."""

    result = await ContentTransitionService(
        content=content.catalog, bindings=SQLAlchemyContentTransitionBindings(session)
    ).transition(user_id=user.id)
    items = list(result.items)
    return PyContentRescan(
        summaries=[PyContentScanSummary.from_domain(summary) for summary in result.summaries],
        catalog=catalog_response(items),
    )


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
            payload_stream, payload_size_bytes = await bounded_upload(upload, limit=definition.max_file_bytes)
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
                payload_stream, payload_size_bytes = await bounded_upload(upload, limit=definition.max_file_bytes)
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
        raise_content_mutation(exc)


__all__ = ["router"]
