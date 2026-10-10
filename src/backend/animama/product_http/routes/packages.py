"""Reviewed package sharing with private staging and durable outcome recovery (ADR 0021)."""

from __future__ import annotations

import asyncio
import errno
from collections.abc import AsyncIterator, Callable, Coroutine
from contextlib import asynccontextmanager
from tempfile import TemporaryFile
from typing import Annotated, Any, BinaryIO, cast

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.routing import APIRoute

from animama.app.contracts.content_package_import import (
    PackageImportResult,
    PackageOperationStatus,
    ReviewedPackageImport,
)
from animama.app.contracts.content_package_requests import (
    PackageExportRequest,
    PackageImportCommitRequest,
    PackageImportCreateRequest,
    PackageSelectionRequest,
    PackageStageStatus,
)
from animama.app.contracts.content_package_staging import PartAck, StageRecord
from animama.app.ports.content_package_staging import PackageStageLease, PackageStages
from animama.app.services.avatar_effect_conversion import CONVERSION_REQUIRED, PACKAGE_CONVERSION_HINT
from animama.app.services.clip_format import CLIP_FORMAT_UNSUPPORTED, PACKAGE_CLIP_FORMAT_HINT
from animama.app.services.content_package_export import ExportReview, ExportSummary
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
from animama.logging import get_logger
from animama.product_http.ports import Ports, ReadContent, WriteContent
from animama.product_http.principal import get_current_principal

_log = get_logger("product_http.packages")


class PackageRoute(APIRoute):
    """Keep submitted metadata and private filesystem errors out of error responses.

    Failures are raised as HTTP errors rather than returned, so they pass through the
    request's write session and its composition sees the failure.
    """

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except HTTPException:
                raise
            except RequestValidationError as exc:
                raise HTTPException(status_code=422, detail={"code": "package_request_invalid"}) from exc
            except ContentNotFoundError as exc:
                raise HTTPException(status_code=404, detail={"code": "package_not_found"}) from exc
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
                detail: dict[str, Any] = {"code": code}
                if isinstance(exc, ContentConflictError) and exc.items:
                    detail["items"] = list(exc.items)
                if code == CONVERSION_REQUIRED:
                    # A fixed server hint naming the conversion steps, never submitted data.
                    detail["message"] = PACKAGE_CONVERSION_HINT
                elif code == CLIP_FORMAT_UNSUPPORTED:
                    detail["message"] = PACKAGE_CLIP_FORMAT_HINT
                raise HTTPException(status_code=status, detail=detail) from exc
            except (ContentIntegrityError, ContentPathError, ContentValidationError, ValueError) as exc:
                raise HTTPException(status_code=422, detail={"code": "package_invalid"}) from exc
            except OSError as exc:
                full = exc.errno in {errno.ENOSPC, errno.EDQUOT}
                raise HTTPException(
                    status_code=507 if full else 503,
                    detail={"code": "package_disk_full" if full else "package_storage_unavailable"},
                ) from exc
            except Exception as exc:
                _log.error("Package operation could not be confirmed", error_type=type(exc).__name__)
                raise HTTPException(status_code=503, detail={"code": "package_operation_unknown"}) from exc

        return handler


router = APIRouter(prefix="/v1/content", tags=["content-packages"], route_class=PackageRoute)
Owner = Annotated[RequestPrincipal, Depends(get_current_principal)]


@asynccontextmanager
async def _import_lease(stages: PackageStages, *, user_id: str, stage_id: str) -> AsyncIterator[PackageStageLease]:
    """Hold an import stage lease, acquired and released in worker threads.

    Both finish even if the request is cancelled, so no lease is left open.
    """

    acquired: list[PackageStageLease] = []

    def acquire() -> None:
        acquired.append(stages.acquire(user_id=user_id, stage_id=stage_id, kind="import"))

    try:
        await _finish_owned_work(asyncio.to_thread(acquire))
        yield acquired[0]
    finally:
        if acquired:
            await _finish_owned_work(asyncio.to_thread(acquired[0].close))


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
async def summarize_package_export(req: PackageSelectionRequest, user: Owner, content: WriteContent) -> Any:
    return await content.packages.exports.summarize(
        user_id=user.id, item_ids=tuple(req.item_ids), anima_id=req.anima_id
    )


@router.post("/package-exports", response_model=ExportReview)
async def prepare_package_export(req: PackageExportRequest, user: Owner, content: WriteContent) -> Any:
    return await content.packages.exports.prepare(
        user_id=user.id, item_ids=tuple(req.item_ids), anima_id=req.anima_id, expected_digest=req.expected_digest
    )


@router.get("/package-exports/{export_id}/file")
async def download_package_export(
    export_id: str, request: Request, user: Owner, content: ReadContent, ports: Ports
) -> Response:
    download = await content.packages.exports.download(user_id=user.id, export_id=export_id)
    return ports.download_response(request, download)


@router.delete("/package-exports/{export_id}", status_code=204)
async def discard_package_export(export_id: str, user: Owner, content: WriteContent) -> Response:
    await asyncio.to_thread(content.packages.stages.discard, user_id=user.id, stage_id=export_id, kind="export")
    return Response(status_code=204)


@router.post("/package-imports", response_model=PackageStageStatus, status_code=201)
async def allocate_package_import(
    req: PackageImportCreateRequest, user: Owner, content: WriteContent
) -> PackageStageStatus:
    receipt = await content.catalog.mutations.catalog.get_mutation_receipt(
        user_id=user.id, operation_id=req.operation_id
    )
    if receipt is not None:
        raise ContentConflictError("operation_id_reused")
    stages = content.packages.stages
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
async def upload_package_part(stage_id: str, index: int, request: Request, user: Owner, content: WriteContent) -> Any:
    """Hold a stage lease before consuming bytes; at most one bounded part per stage."""
    stages = content.packages.stages
    async with _import_lease(stages, user_id=user.id, stage_id=stage_id) as lease:
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
async def get_package_import(stage_id: str, user: Owner, content: ReadContent) -> PackageStageStatus:
    stages = content.packages.stages
    record, active = await asyncio.to_thread(stages.status, user_id=user.id, stage_id=stage_id, kind="import")
    return _public_stage(record, active=active, part_size=stages.limits.part_bytes)


@router.post("/package-imports/{stage_id}/review", response_model=ReviewedPackageImport)
async def review_package_import(stage_id: str, user: Owner, content: WriteContent) -> Any:
    return await content.packages.imports.review(user_id=user.id, stage_id=stage_id)


@router.post("/package-imports/{stage_id}/commit", response_model=PackageImportResult)
async def commit_package_import(
    stage_id: str, req: PackageImportCommitRequest, user: Owner, content: WriteContent
) -> Any:
    return await content.packages.imports.commit(
        user_id=user.id, stage_id=stage_id, operation_id=req.operation_id, review_digest=req.review_digest
    )


@router.get("/package-operations/{operation_id}", response_model=PackageOperationStatus)
async def get_package_operation(operation_id: str, user: Owner, content: WriteContent) -> Any:
    return await content.packages.imports.operation_status(user_id=user.id, operation_id=operation_id)


@router.delete("/package-imports/{stage_id}", status_code=204)
async def discard_package_import(stage_id: str, user: Owner, content: WriteContent) -> Response:
    await asyncio.to_thread(content.packages.stages.discard, user_id=user.id, stage_id=stage_id, kind="import")
    return Response(status_code=204)
