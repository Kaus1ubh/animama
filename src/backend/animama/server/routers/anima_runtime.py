"""Exact Anima runtime issuance and revision-scoped local byte delivery."""

from __future__ import annotations

import asyncio
import gzip
import hashlib
import json
from collections.abc import Iterator
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.anima_runtime_service import AnimaRuntimeService, RuntimeSnapshotError
from animama.app.services.runtime_json_bundle_service import RuntimeJsonBundleService
from animama.domain.content_catalog import ContentIntegrityError, ContentPathError, ContentSource, VerifiedContentFile
from animama.domain.request_principal import RequestPrincipal
from animama.server.config import settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.local_runtime import LocalRuntimePaths, initialize_local_runtime
from animama.server.schemas.runtime_content import PyAnimaRuntime, PyRuntimeLease

router = APIRouter(tags=["anima-runtime"])


def _manifest_encoding(accept_encoding: str) -> str:
    """Negotiate this JSON response only; explicit exclusions override wildcards."""
    qualities: dict[str, float] = {}
    for member in accept_encoding.lower().split(","):
        coding, *parameters = member.strip().split(";")
        if not coding:
            continue
        quality = 1.0
        for parameter in parameters:
            name, _, value = parameter.strip().partition("=")
            if name == "q":
                try:
                    quality = float(value)
                except ValueError:
                    quality = 0.0
                if not 0 <= quality <= 1:
                    quality = 0.0
        qualities[coding.strip()] = min(qualities.get(coding.strip(), 1.0), quality)
    gzip_quality = qualities.get("gzip", qualities.get("*", 0.0))
    if gzip_quality > 0 and gzip_quality >= qualities.get("identity", 0.0):
        return "gzip"
    if qualities.get("identity", 0.0 if qualities.get("*") == 0 else 1.0) > 0:
        return "identity"
    raise HTTPException(status_code=406, detail={"code": "runtime_encoding_not_acceptable"})


async def _manifest_response(runtime: PyAnimaRuntime, response: Response, encoding: str) -> Response:
    """Serialize once, compress off the event loop, and validate the actual wire representation."""
    body = runtime.model_dump_json(by_alias=True).encode("utf-8")
    # Manifest issuance must always return a fresh lease, even with If-None-Match.
    return await _json_response(body, encoding=encoding, headers=dict(response.headers))


async def _json_response(
    body: bytes,
    *,
    encoding: str,
    headers: dict[str, str],
    if_none_match: str | None = None,
    cacheable: bool = True,
) -> Response:
    """Encode bounded JSON with wire validators; callers establish authorization first."""
    if encoding == "gzip":
        body = await asyncio.to_thread(gzip.compress, body, compresslevel=6, mtime=0)
        headers["content-encoding"] = "gzip"
    vary = [value.strip() for value in headers.get("vary", "").split(",") if value.strip()]
    if not any(value.lower() in {"accept-encoding", "*"} for value in vary):
        vary.append("Accept-Encoding")
    headers.update(
        {
            "vary": ", ".join(vary),
            "cache-control": "private, no-cache" if cacheable else "no-store",
            "etag": f'"{hashlib.sha256(body).hexdigest()}"',
            "content-length": str(len(body)),
        }
    )
    headers["x-content-type-options"] = "nosniff"
    if cacheable and if_none_match == headers["etag"]:
        headers.pop("content-length")
        return Response(status_code=304, headers=headers)
    if not cacheable:
        headers.pop("etag")
    return Response(body, media_type="application/json", headers=headers)


def _raise_runtime(exc: RuntimeSnapshotError) -> NoReturn:
    status_code = 404 if exc.code in {"anima_not_found", "runtime_file_not_found"} else 409
    raise HTTPException(status_code=status_code, detail={"code": exc.code}) from exc


def _paths(request: Request) -> LocalRuntimePaths:
    paths = getattr(request.app.state, "local_runtime_paths", None)
    if isinstance(paths, LocalRuntimePaths):
        return paths
    paths = initialize_local_runtime(settings)
    request.app.state.local_runtime_paths = paths
    return paths


@router.get("/v1/animas/{anima_id}/runtime", response_model=PyAnimaRuntime)
async def get_anima_runtime(
    request: Request,
    response: Response,
    anima_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> Response:
    """Compile and issue the exact current Content Catalog mount."""

    encoding = _manifest_encoding(",".join(request.headers.getlist("accept-encoding")))
    try:
        paths = _paths(request)
        store = FilesystemContentStore(
            included_root=paths.included_root,
            included_sources=paths.included_sources,
            local_root=paths.local_root,
            operations_root=paths.operations_root,
        )
        runtime = await AnimaRuntimeService(session, store=store).issue(user_id=user.id, anima_id=anima_id)
    except RuntimeSnapshotError as exc:
        _raise_runtime(exc)
    return await _manifest_response(PyAnimaRuntime.model_validate(runtime), response, encoding)


@router.post(
    "/v1/animas/{anima_id}/runtime/revisions/{revision}:renew",
    response_model=PyRuntimeLease,
)
async def renew_anima_runtime(
    anima_id: str,
    revision: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyRuntimeLease:
    """Renew an unexpired prepared runtime revision without remounting it."""

    try:
        expires_at = await AnimaRuntimeService(session).renew(
            user_id=user.id,
            anima_id=anima_id,
            revision=revision,
        )
    except RuntimeSnapshotError as exc:
        _raise_runtime(exc)
    return PyRuntimeLease(effective_revision=revision, expires_at=expires_at)


@router.get("/v1/animas/{anima_id}/runtime/revisions/{revision}/json-bundle")
async def get_runtime_json_bundle(
    request: Request,
    anima_id: str,
    revision: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """Revalidate every selected file before returning a bundle or its conditional 304."""
    encoding = _manifest_encoding(",".join(request.headers.getlist("accept-encoding")))
    paths = _paths(request)
    store = FilesystemContentStore(
        included_root=paths.included_root,
        included_sources=paths.included_sources,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )
    try:
        bundle = await RuntimeJsonBundleService(AnimaRuntimeService(session), store).read(
            user_id=user.id,
            anima_id=anima_id,
            revision=revision,
        )
    except RuntimeSnapshotError as exc:
        _raise_runtime(exc)
    body = json.dumps(bundle, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return await _json_response(
        body,
        encoding=encoding,
        headers={},
        if_none_match=if_none_match,
        cacheable=not any("error" in member for member in bundle["members"]),
    )


@router.get("/v1/animas/{anima_id}/runtime/revisions/{revision}/files/{file_ref}")
async def stream_anima_runtime_file(
    request: Request,
    anima_id: str,
    revision: str,
    file_ref: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """Authorize and stream one pinned runtime member in a single request."""

    source: ContentSource | None = None
    relative_path: str | None = None
    try:
        service = AnimaRuntimeService(session)
        authorization = await service.authorize_file(
            user_id=user.id,
            anima_id=anima_id,
            revision=revision,
            file_ref=file_ref,
        )
        source = authorization.source
        relative_path = authorization.relative_path
        paths = _paths(request)
        file = await asyncio.to_thread(
            FilesystemContentStore(
                included_root=paths.included_root,
                included_sources=paths.included_sources,
                local_root=paths.local_root,
                operations_root=paths.operations_root,
            ).open_verified_file,
            source=source,
            source_mount_id=authorization.source_mount_id,
            relative_path=relative_path,
            expected_size_bytes=authorization.size_bytes,
            expected_sha256=authorization.sha256,
            media_type=authorization.media_type,
        )
    except (ContentIntegrityError, ContentPathError, OSError) as exc:
        await session.rollback()
        if source is not None and relative_path is not None:
            await SQLAlchemyContentCatalog(session).mark_scan_required(
                source=source,
                relative_paths=(relative_path,),
            )
            await session.commit()
        raise HTTPException(
            status_code=409,
            detail={"code": "runtime_file_changed_remount_required"},
        ) from exc
    except RuntimeSnapshotError as exc:
        await session.rollback()
        _raise_runtime(exc)

    etag = f'"{file.sha256}"'
    headers = {
        "Cache-Control": "private, no-cache",
        "ETag": etag,
        "X-Content-Type-Options": "nosniff",
    }
    if if_none_match == etag:
        file.handle.close()
        return Response(status_code=304, headers=headers)
    headers["Content-Length"] = str(file.size_bytes)
    return StreamingResponse(_stream_file(file), media_type=file.media_type, headers=headers)


def _stream_file(file: VerifiedContentFile) -> Iterator[bytes]:
    try:
        while chunk := file.handle.read(1024 * 1024):
            yield chunk
    finally:
        file.handle.close()


__all__ = ["router"]
