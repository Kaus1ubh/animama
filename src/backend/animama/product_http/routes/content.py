"""Content catalog, item and verified-byte routes shared by every composition (ADR 0021)."""

from __future__ import annotations

import asyncio
from typing import Annotated, BinaryIO, Literal, NoReturn

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, UploadFile

from animama.app.contracts.content import PyContentCatalog, PyContentItem
from animama.app.services.content_file_validation import ContentFileInvalidError
from animama.app.services.content_kind_registry import RETIRED_CONTENT_KINDS
from animama.app.services.content_thumbnails import ContentThumbnailError, thumbnail_file
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentConflictError,
    ContentIntegrityError,
    ContentNotFoundError,
    ContentPathError,
    ContentStatus,
    ContentValidationError,
)
from animama.domain.content_documents import ContentDocumentError
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.delivery import negotiate_json_encoding
from animama.product_http.ports import Ports, ReadContent, ReadRepositories, WriteContent
from animama.product_http.principal import get_current_principal

router = APIRouter(prefix="/v1/content", tags=["content"])


def catalog_response(items: list[CatalogContentEntry]) -> PyContentCatalog:
    """Project visible catalog entries, noting whether any awaits a rescan."""

    return PyContentCatalog(
        scan_required=any(item.status is ContentStatus.SCAN_REQUIRED for item in items),
        items=[PyContentItem.from_domain(item) for item in items],
    )


async def bounded_upload(upload: UploadFile, *, limit: int) -> tuple[BinaryIO, int]:
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


def raise_content_mutation(exc: Exception) -> NoReturn:
    """Report a content service failure with its public error code."""

    if isinstance(exc, ContentDocumentError):
        # The validator message may quote a submitted key; ``field`` is a JSON path when known.
        document_detail: dict[str, object] = {"code": "content_invalid", "reason": exc.code, "message": str(exc)}
        if exc.field is not None:
            document_detail["field"] = exc.field
        raise HTTPException(status_code=422, detail=document_detail) from exc
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


@router.get("/catalog", response_model=PyContentCatalog)
async def list_content_catalog(
    request: Request,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: ReadContent,
    ports: Ports,
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """List Included, shared, and caller-owned entries without host paths.

    Clients poll this catalog for health, so it is compressed and revalidated by
    ETag: an unchanged catalog costs a 304 rather than the whole body.
    """

    encoding = negotiate_json_encoding(request, refusal_code="content_encoding_not_acceptable")
    items = await content.catalog.list_visible(user_id=user.id)
    body = catalog_response(items).model_dump_json(by_alias=True).encode("utf-8")
    return await ports.json_response(
        request, body, encoding=encoding, headers={}, if_none_match=if_none_match, cacheable=True
    )


@router.get("/items/{item_id}", response_model=PyContentItem)
async def get_content_item(
    item_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    repositories: ReadRepositories,
) -> PyContentItem:
    """Return one visible neutral catalog item by its opaque identity."""

    item = await repositories.content_catalog.get_visible_item(item_id=item_id, user_id=user.id)
    if item is None or item.kind in RETIRED_CONTENT_KINDS:
        raise HTTPException(status_code=404, detail={"code": "content_not_found"})
    return PyContentItem.from_domain(item)


@router.delete("/items/{item_id}", status_code=204)
async def delete_content_item(
    item_id: str,
    expected_revision: Annotated[str, Query(pattern=r"^[0-9a-f]{64}$")],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: WriteContent,
) -> Response:
    """Delete one exact editable Local entry; Included content is read-only."""

    try:
        await content.catalog.delete_item(
            item_id=item_id,
            user_id=user.id,
            expected_revision=expected_revision,
        )
        return Response(status_code=204)
    except Exception as exc:
        raise_content_mutation(exc)


@router.get("/files/{file_ref}")
async def stream_content_file(
    request: Request,
    file_ref: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: ReadContent,
    ports: Ports,
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
    variant: Annotated[Literal["thumbnail"] | None, Query()] = None,
) -> Response:
    """Authorize, contain, and digest-check an opaque registration in one response.

    ``variant=thumbnail`` answers an image with a Library-sized copy instead
    (``content_thumbnails``); other files are refused with 422.
    """

    try:
        file = await content.catalog.open_registered_file(file_ref=file_ref, user_id=user.id)
    except ContentNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"code": "content_file_not_found"}) from exc
    except (ContentIntegrityError, ContentPathError) as exc:
        raise HTTPException(status_code=409, detail={"code": "content_file_changed_rescan_required"}) from exc
    if variant == "thumbnail":
        try:
            file = await asyncio.to_thread(thumbnail_file, file)
        except ContentThumbnailError as exc:
            raise HTTPException(status_code=422, detail={"code": "content_thumbnail_unsupported"}) from exc
    return ports.file_response(request, file, if_none_match=if_none_match, revalidate=True)


@router.get("/previews/{preview_id}/revisions/{revision_sha256}/files/{file_ref}")
async def stream_content_preview_file(
    request: Request,
    preview_id: str,
    revision_sha256: str,
    file_ref: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: ReadContent,
    ports: Ports,
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """Stream an exact preview membership; catalog edits invalidate its bytes."""

    try:
        file = await content.catalog.open_preview_file(
            preview_id=preview_id,
            revision_sha256=revision_sha256,
            file_ref=file_ref,
            user_id=user.id,
        )
    except ContentNotFoundError as exc:
        raise HTTPException(status_code=404, detail={"code": "content_preview_not_found"}) from exc
    except (ContentIntegrityError, ContentPathError) as exc:
        raise HTTPException(status_code=409, detail={"code": "content_preview_changed"}) from exc
    # A preview's bytes change with any catalog edit, so clients never keep them.
    return ports.file_response(request, file, if_none_match=if_none_match, revalidate=False)


__all__ = ["bounded_upload", "catalog_response", "raise_content_mutation", "router"]
