"""Pocket voice catalog uploads, shared by every composition (ADR 0021).

An owner stages a ``.bin`` upload, sends its bytes into the composition's private
storage, then finalizes it into a normal Local ``voices/`` content file (see
:class:`VoiceCatalogUploadService`). The composition supplies the storage, the
spool directory and the limits; a request never creates the runtime layout.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status

from animama.app.contracts.avatar import PyAvatarUploadInitRequest, PyAvatarUploadInitResponse
from animama.app.contracts.content import PyContentSaveResult
from animama.app.services.voice_catalog_upload_service import (
    VoiceCatalogBytesInvalidError,
    VoiceCatalogSaveConflictError,
    VoiceCatalogStorageError,
    VoiceCatalogUploadError,
    VoiceCatalogUploadExpiredError,
    VoiceCatalogUploadInvalidError,
    VoiceCatalogUploadNotFoundError,
    VoiceCatalogUploadService,
    VoiceCatalogUploadStateError,
)
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import (
    Ports,
    ProductPorts,
    ProductRepositories,
    ProductUploads,
    WriteContent,
    WriteRepositories,
)
from animama.product_http.principal import get_current_principal
from animama.product_http.uploads import UploadEnvelopeError, spool_bounded_request

router = APIRouter()
UserDep = Annotated[RequestPrincipal, Depends(get_current_principal)]

_STATUS: tuple[tuple[type[VoiceCatalogUploadError], int], ...] = (
    (VoiceCatalogUploadInvalidError, status.HTTP_400_BAD_REQUEST),
    (VoiceCatalogUploadNotFoundError, status.HTTP_404_NOT_FOUND),
    (VoiceCatalogUploadStateError, status.HTTP_409_CONFLICT),
    (VoiceCatalogSaveConflictError, status.HTTP_409_CONFLICT),
    (VoiceCatalogUploadExpiredError, status.HTTP_410_GONE),
    (VoiceCatalogBytesInvalidError, status.HTTP_422_UNPROCESSABLE_CONTENT),
    (VoiceCatalogStorageError, status.HTTP_507_INSUFFICIENT_STORAGE),
)


def _service(
    ports: ProductPorts, repositories: ProductRepositories, uploads: ProductUploads
) -> VoiceCatalogUploadService:
    policy = ports.policy
    return VoiceCatalogUploadService(
        uploads=repositories.voice_catalog_uploads,
        private_files=uploads.private_files,
        uow=repositories.unit_of_work,
        max_upload_bytes=policy.voice_catalog_max_upload_bytes,
        upload_ttl_seconds=policy.private_upload_ttl_seconds,
    )


def _http_error(exc: VoiceCatalogUploadError) -> HTTPException:
    code = next(code for kind, code in _STATUS if isinstance(exc, kind))
    return HTTPException(status_code=code, detail=exc.detail)


@router.post(
    "/v1/animas/voice-catalogs/uploads",
    response_model=PyAvatarUploadInitResponse,
    status_code=status.HTTP_200_OK,
)
async def init_anima_voice_catalog_upload(
    req: PyAvatarUploadInitRequest,
    ports: Ports,
    repositories: WriteRepositories,
    user: UserDep,
) -> PyAvatarUploadInitResponse:
    try:
        upload = await _service(ports, repositories, ports.uploads(user)).initiate(
            user_id=user.id, filename=req.filename, size_bytes=req.size_bytes, content_type=req.content_type
        )
    except VoiceCatalogUploadError as exc:
        raise _http_error(exc) from exc
    return PyAvatarUploadInitResponse(
        upload_id=upload.id,
        upload_url=f"/v1/animas/voice-catalogs/uploads/{upload.id}/content",
        method="PUT",
        headers={"Content-Type": upload.declared_content_type or "application/octet-stream"},
        expires_at=upload.expires_at,
    )


@router.put(
    "/v1/animas/voice-catalogs/uploads/{upload_id}/content",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def upload_anima_voice_catalog_content(
    upload_id: str,
    request: Request,
    ports: Ports,
    repositories: WriteRepositories,
    user: UserDep,
) -> Response:
    """Stream one owner-scoped Pocket voice catalog into private staging."""

    uploads = ports.uploads(user)
    service = _service(ports, repositories, uploads)
    try:
        upload = await service.pending_upload(user_id=user.id, upload_id=upload_id)
        try:
            body = await spool_bounded_request(
                request,
                expected_size_bytes=upload.declared_size_bytes,
                max_size_bytes=ports.policy.voice_catalog_max_upload_bytes,
                staging_directory=uploads.staging_directory,
            )
        except UploadEnvelopeError as exc:
            raise HTTPException(status_code=422, detail={"code": exc.code}) from exc
        try:
            service.store_bytes(upload, body.stream, size_bytes=body.size_bytes)
        finally:
            body.close()
    except VoiceCatalogUploadError as exc:
        raise _http_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/v1/animas/voice-catalogs/uploads/{upload_id}:finalize",
    response_model=PyContentSaveResult,
)
async def finalize_anima_voice_catalog_upload(
    upload_id: str,
    ports: Ports,
    repositories: WriteRepositories,
    content: WriteContent,
    user: UserDep,
) -> PyContentSaveResult:
    """Validate and publish a normal readable ``content/local/voices`` file."""

    try:
        saved = await _service(ports, repositories, ports.uploads(user)).finalize(
            user_id=user.id,
            upload_id=upload_id,
            content=content.catalog,
            catalog=repositories.content_catalog,
            store=content.store,
        )
    except VoiceCatalogUploadError as exc:
        raise _http_error(exc) from exc
    return PyContentSaveResult.from_domain(saved)


@router.delete(
    "/v1/animas/voice-catalogs/uploads/{upload_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
)
async def abort_anima_voice_catalog_upload(
    upload_id: str,
    ports: Ports,
    repositories: WriteRepositories,
    user: UserDep,
) -> Response:
    try:
        await _service(ports, repositories, ports.uploads(user)).abort(user_id=user.id, upload_id=upload_id)
    except VoiceCatalogUploadError as exc:
        raise _http_error(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


__all__ = ["router"]
