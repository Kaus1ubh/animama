"""Reviewed local-file sharing with private staging and durable outcome recovery."""

from __future__ import annotations

import asyncio
import errno
from collections.abc import Callable, Coroutine, Iterator
from tempfile import TemporaryFile
from typing import Annotated, Any, BinaryIO, cast
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.routing import APIRoute
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.types import Receive, Scope, Send

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.avatar_face_part_override_repo import (
    SQLAlchemyAvatarFacePartOverrideRepository,
)
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.contracts.content_package_import import (
    PackageImportResult,
    PackageOperationStatus,
    ReviewedPackageImport,
)
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.avatar_effect_conversion import CONVERSION_REQUIRED, PACKAGE_CONVERSION_HINT
from animama.app.services.clip_format import CLIP_FORMAT_UNSUPPORTED, PACKAGE_CLIP_FORMAT_HINT
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_export import (
    ContentPackageExportService,
    DownloadLease,
    ExportReview,
    ExportSummary,
)
from animama.app.services.content_package_import import ContentPackageImportService
from animama.app.services.content_package_staging import PackageStageService, PartAck, StageRecord
from animama.app.services.local_content_mutations import _finish_owned_work
from animama.app.services.typed_content_service import TypedContentAdmissionError
from animama.domain.anima_definition import AnimaDefinitionError
from animama.domain.content_catalog import (
    ContentConflictError,
    ContentIntegrityError,
    ContentNotFoundError,
    ContentPathError,
    ContentValidationError,
)
from animama.domain.content_documents import ContentDocumentError
from animama.domain.request_principal import RequestPrincipal
from animama.logging_config import get_logger
from animama.server.config import settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.schemas.content_packages import (
    PackageExportRequest,
    PackageImportCommitRequest,
    PackageImportCreateRequest,
    PackageSelectionRequest,
    PackageStageStatus,
)

from .content import _paths, _store

_log = get_logger("server.routers.content_packages")


class PackageRoute(APIRoute):
    """Keep submitted metadata and private filesystem errors out of error responses."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except HTTPException:
                raise
            except RequestValidationError:
                return JSONResponse(status_code=422, content={"detail": {"code": "package_request_invalid"}})
            except ContentNotFoundError:
                return JSONResponse(status_code=404, content={"detail": {"code": "package_not_found"}})
            except (
                ContentConflictError,
                ContentDocumentError,
                TypedContentAdmissionError,
                AnimaDefinitionError,
            ) as exc:
                code = exc.code
                status = {
                    "package_stage_unavailable": 404,
                    "package_export_unavailable": 404,
                    "package_stage_expired": 410,
                    "package_export_expired": 410,
                    "package_stage_disk_full": 507,
                }.get(code, 409)
                detail: dict[str, str] = {"code": code}
                if code == CONVERSION_REQUIRED:
                    # A fixed server hint naming the conversion steps, never submitted data.
                    detail["message"] = PACKAGE_CONVERSION_HINT
                elif code == CLIP_FORMAT_UNSUPPORTED:
                    detail["message"] = PACKAGE_CLIP_FORMAT_HINT
                return JSONResponse(status_code=status, content={"detail": detail})
            except (ContentIntegrityError, ContentPathError, ContentValidationError, ValueError):
                return JSONResponse(status_code=422, content={"detail": {"code": "package_invalid"}})
            except OSError as exc:
                full = exc.errno in {errno.ENOSPC, errno.EDQUOT}
                return JSONResponse(
                    status_code=507 if full else 503,
                    content={"detail": {"code": "package_disk_full" if full else "package_storage_unavailable"}},
                )
            except Exception as exc:
                _log.error("Package operation could not be confirmed", error_type=type(exc).__name__)
                return JSONResponse(status_code=503, content={"detail": {"code": "package_operation_unknown"}})

        return handler


router = APIRouter(prefix="/v1/content", tags=["content-packages"], route_class=PackageRoute)
Owner = Annotated[RequestPrincipal, Depends(get_current_principal)]
Session = Annotated[AsyncSession, Depends(get_async_session)]


def _stages(request: Request) -> PackageStageService:
    paths = _paths(request)
    return PackageStageService(imports_root=paths.imports_staging_root, exports_root=paths.exports_staging_root)


def _content(request: Request, session: AsyncSession) -> ContentCatalogService:
    return ContentCatalogService(store=_store(request), catalog=SQLAlchemyContentCatalog(session))


def _exports(request: Request, session: AsyncSession) -> ContentPackageExportService:
    content = _content(request, session)
    return ContentPackageExportService(
        content=content,
        exports_root=_paths(request).exports_staging_root,
        stages=_stages(request),
        profiles=SQLAlchemyUserProfileRepository(session),
        face_part_overrides=SQLAlchemyAvatarFacePartOverrideRepository(session),
        anima_sources=AnimaPackageSourceService(
            catalog=content.mutations.catalog,
            sources=SQLAlchemyAnimaPackageSourceRepository(session),
            max_identity_bytes=settings.anima_memory_file_max_bytes,
        ),
    )


def _imports(request: Request, session: AsyncSession) -> ContentPackageImportService:
    """One request session owns content, aggregate children and the final receipt."""
    content = _content(request, session)
    return ContentPackageImportService(
        content=content,
        mutations=content.mutations,
        stages=_stages(request),
        uow=SQLAlchemyAnimaAggregateUnitOfWork(session),
        default_model_provider_id=settings.anima_default_model_provider_id,
        max_identity_bytes=settings.anima_memory_file_max_bytes,
    )


def _public_stage(record: StageRecord, *, active: bool, part_size: int) -> PackageStageStatus:
    public = record.review.get("public") if record.review else None
    return PackageStageStatus(
        stage_id=record.stage_id,
        operation_id=record.operation_id or "",
        filename=record.filename,
        state=record.state,
        active=active,
        expected_size_bytes=record.expected_bytes,
        received_bytes=record.received_bytes,
        next_part_index=len(record.parts),
        part_size_bytes=part_size,
        expires_at=record.expires_at,
        review=(
            ReviewedPackageImport.model_validate(public).model_copy(update={"expires_at": record.expires_at})
            if public is not None
            else None
        ),
    )


@router.post("/package-exports:summary", response_model=ExportSummary)
async def summarize_package_export(
    req: PackageSelectionRequest, request: Request, user: Owner, session: Session
) -> Any:
    return await _exports(request, session).summarize(
        user_id=user.id, item_ids=tuple(req.item_ids), anima_id=req.anima_id
    )


@router.post("/package-exports", response_model=ExportReview)
async def prepare_package_export(req: PackageExportRequest, request: Request, user: Owner, session: Session) -> Any:
    return await _exports(request, session).prepare(
        user_id=user.id, item_ids=tuple(req.item_ids), anima_id=req.anima_id, expected_digest=req.expected_digest
    )


class _PackageDownloadResponse(StreamingResponse):
    """Close the opened file and OS lease even if response startup/disconnect fails."""

    def __init__(self, download: DownloadLease) -> None:
        self._download = download

        def chunks() -> Iterator[bytes]:
            while chunk := download.handle.read(1024 * 1024):
                yield chunk

        review = download.review
        super().__init__(
            chunks(),
            media_type="application/zip",
            headers={
                "Content-Disposition": f"attachment; filename*=utf-8''{quote(review.filename, safe='')}",
                "Content-Length": str(review.size_bytes),
                "X-Content-SHA256": review.package_sha256,
                "Cache-Control": "private, no-store",
                "X-Content-Type-Options": "nosniff",
            },
        )

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        try:
            await super().__call__(scope, receive, send)
        finally:
            # Completion/cancellation ends the response lease, not proof of a
            # successful user save. Preserve retry bytes until quota needs them.
            self._download.close(reclaimable=True)


@router.get("/package-exports/{export_id}/file")
async def download_package_export(export_id: str, request: Request, user: Owner, session: Session) -> Response:
    download = await _exports(request, session).download(user_id=user.id, export_id=export_id)
    return _PackageDownloadResponse(download)


@router.delete("/package-exports/{export_id}", status_code=204)
async def discard_package_export(export_id: str, request: Request, user: Owner) -> Response:
    await asyncio.to_thread(_stages(request).discard, user_id=user.id, stage_id=export_id, kind="export")
    return Response(status_code=204)


@router.post("/package-imports", response_model=PackageStageStatus, status_code=201)
async def allocate_package_import(
    req: PackageImportCreateRequest, request: Request, user: Owner, session: Session
) -> PackageStageStatus:
    receipt = await SQLAlchemyContentCatalog(session).get_mutation_receipt(
        user_id=user.id, operation_id=req.operation_id
    )
    if receipt is not None:
        raise ContentConflictError("operation_id_reused")
    stages = _stages(request)
    record = await asyncio.to_thread(
        stages.create_import,
        user_id=user.id,
        operation_id=req.operation_id,
        filename=req.filename,
        expected_bytes=req.expected_size_bytes,
    )
    return _public_stage(record, active=False, part_size=stages.limits.part_bytes)


@router.put(
    "/package-imports/{stage_id}/parts/{index}",
    response_model=PartAck,
    openapi_extra={
        "requestBody": {
            "required": True,
            "content": {"application/octet-stream": {"schema": {"type": "string", "format": "binary"}}},
        }
    },
)
async def upload_package_part(stage_id: str, index: int, request: Request, user: Owner) -> Any:
    """Hold a stage lease before consuming bytes; at most one bounded part per stage."""
    stages = _stages(request)
    with stages.acquire(user_id=user.id, stage_id=stage_id, kind="import") as lease:
        limit = stages.limits.part_bytes
        length = request.headers.get("content-length")
        if length is not None and (not length.isdecimal() or int(length) > limit):
            raise HTTPException(status_code=413, detail={"code": "package_part_too_large"})
        with TemporaryFile(mode="w+b") as source:
            received = 0
            async for chunk in request.stream():
                received += len(chunk)
                if received > limit:
                    raise HTTPException(status_code=413, detail={"code": "package_part_too_large"})
                await _finish_owned_work(asyncio.to_thread(source.write, chunk))
            source.seek(0)
            return await _finish_owned_work(
                asyncio.to_thread(lease.append_part, index=index, source=cast(BinaryIO, source))
            )


@router.get("/package-imports/{stage_id}", response_model=PackageStageStatus)
async def get_package_import(stage_id: str, request: Request, user: Owner) -> PackageStageStatus:
    stages = _stages(request)
    record, active = await asyncio.to_thread(stages.status, user_id=user.id, stage_id=stage_id, kind="import")
    return _public_stage(record, active=active, part_size=stages.limits.part_bytes)


@router.post("/package-imports/{stage_id}/review", response_model=ReviewedPackageImport)
async def review_package_import(stage_id: str, request: Request, user: Owner, session: Session) -> Any:
    return await _imports(request, session).review(user_id=user.id, stage_id=stage_id)


@router.post("/package-imports/{stage_id}/commit", response_model=PackageImportResult)
async def commit_package_import(
    stage_id: str, req: PackageImportCommitRequest, request: Request, user: Owner, session: Session
) -> Any:
    return await _imports(request, session).commit(
        user_id=user.id, stage_id=stage_id, operation_id=req.operation_id, review_digest=req.review_digest
    )


@router.get("/package-operations/{operation_id}", response_model=PackageOperationStatus)
async def get_package_operation(operation_id: str, request: Request, user: Owner, session: Session) -> Any:
    return await _imports(request, session).operation_status(user_id=user.id, operation_id=operation_id)


@router.delete("/package-imports/{stage_id}", status_code=204)
async def discard_package_import(stage_id: str, request: Request, user: Owner) -> Response:
    await asyncio.to_thread(_stages(request).discard, user_id=user.id, stage_id=stage_id, kind="import")
    return Response(status_code=204)
