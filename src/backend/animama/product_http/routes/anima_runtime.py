"""Exact Anima runtime issuance and revision-scoped byte delivery, shared by every composition (ADR 0021)."""

from __future__ import annotations

import asyncio
import hashlib
from io import BytesIO
from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, Header, HTTPException, Request, Response

from animama.app.contracts.runtime_content import PyAnimaRuntime, PyRuntimeLease
from animama.app.services.anima_runtime_service import RuntimeSnapshotError
from animama.app.services.runtime_bundle_service import RuntimeBundleService
from animama.domain.content_catalog import (
    ContentIntegrityError,
    ContentPathError,
    ContentSource,
    VerifiedContentFile,
)
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import Ports, ReadContent, WriteContent
from animama.product_http.principal import get_current_principal

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


def _raise_runtime(exc: RuntimeSnapshotError) -> NoReturn:
    status_code = 404 if exc.code in {"anima_not_found", "runtime_file_not_found"} else 409
    raise HTTPException(status_code=status_code, detail={"code": exc.code}) from exc


@router.get("/v1/animas/{anima_id}/runtime", response_model=PyAnimaRuntime)
async def get_anima_runtime(
    request: Request,
    response: Response,
    anima_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: WriteContent,
    ports: Ports,
) -> Response:
    """Compile and issue the exact current Content Catalog mount."""

    encoding = _manifest_encoding(",".join(request.headers.getlist("accept-encoding")))
    try:
        runtime = await content.runtime.issue(user_id=user.id, anima_id=anima_id)
    except RuntimeSnapshotError as exc:
        _raise_runtime(exc)
    body = PyAnimaRuntime.model_validate(runtime).model_dump_json(by_alias=True).encode("utf-8")
    # Manifest issuance must always return a fresh lease, even with If-None-Match.
    return await ports.json_response(
        request, body, encoding=encoding, headers=dict(response.headers), if_none_match=None, cacheable=True
    )


@router.post(
    "/v1/animas/{anima_id}/runtime/revisions/{revision}:renew",
    response_model=PyRuntimeLease,
)
async def renew_anima_runtime(
    anima_id: str,
    revision: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: WriteContent,
) -> PyRuntimeLease:
    """Renew an unexpired prepared runtime revision without remounting it."""

    try:
        expires_at = await content.runtime.renew(
            user_id=user.id,
            anima_id=anima_id,
            revision=revision,
        )
    except RuntimeSnapshotError as exc:
        _raise_runtime(exc)
    return PyRuntimeLease(effective_revision=revision, expires_at=expires_at)


@router.get("/v1/animas/{anima_id}/runtime/revisions/{revision}/bundles/{bundle_id}")
async def get_runtime_bundle(
    request: Request,
    anima_id: str,
    revision: str,
    bundle_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: ReadContent,
    ports: Ports,
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """Revalidate every member of one issued bundle before returning it or its conditional 304."""

    encoding = _manifest_encoding(",".join(request.headers.getlist("accept-encoding")))
    try:
        bundle = await RuntimeBundleService(content.runtime, content.store).read(
            user_id=user.id, anima_id=anima_id, revision=revision, bundle_id=bundle_id
        )
    except RuntimeSnapshotError as exc:
        _raise_runtime(exc)
    if bundle.changed:
        # Members changed on disk: record them for rescan in a write session of their own.
        async with ports.write_session(user) as session:
            catalog = ports.repositories(session).content_catalog
            for source, paths in bundle.changed.items():
                await catalog.mark_scan_required(source=source, relative_paths=tuple(paths))
            await session.commit()
    if bundle.format == "json":
        return await ports.json_response(
            request, bundle.body, encoding=encoding, headers={}, if_none_match=if_none_match, cacheable=bundle.complete
        )
    frame = VerifiedContentFile(
        handle=BytesIO(bundle.body),
        size_bytes=len(bundle.body),
        sha256=hashlib.sha256(bundle.body).hexdigest(),
        media_type="application/octet-stream",
    )
    return ports.file_response(request, frame, if_none_match=if_none_match, revalidate=bundle.complete)


@router.get("/v1/animas/{anima_id}/runtime/revisions/{revision}/files/{file_ref}")
async def stream_anima_runtime_file(
    request: Request,
    anima_id: str,
    revision: str,
    file_ref: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    content: ReadContent,
    ports: Ports,
    if_none_match: Annotated[str | None, Header(alias="If-None-Match")] = None,
) -> Response:
    """Authorize and stream one pinned runtime member in a single request."""

    source: ContentSource | None = None
    relative_path: str | None = None
    try:
        authorization = await content.runtime.authorize_file(
            user_id=user.id,
            anima_id=anima_id,
            revision=revision,
            file_ref=file_ref,
        )
        source = authorization.source
        relative_path = authorization.relative_path
        file = await asyncio.to_thread(
            content.store.open_verified_file,
            source=source,
            source_mount_id=authorization.source_mount_id,
            relative_path=relative_path,
            expected_size_bytes=authorization.size_bytes,
            expected_sha256=authorization.sha256,
            media_type=authorization.media_type,
        )
    except (ContentIntegrityError, ContentPathError, OSError) as exc:
        if source is not None and relative_path is not None:
            # The member changed on disk: record it for rescan in a write session of its own.
            async with ports.write_session(user) as session:
                await ports.repositories(session).content_catalog.mark_scan_required(
                    source=source, relative_paths=(relative_path,)
                )
                await session.commit()
        raise HTTPException(
            status_code=409,
            detail={"code": "runtime_file_changed_remount_required"},
        ) from exc
    except RuntimeSnapshotError as exc:
        _raise_runtime(exc)
    return ports.file_response(request, file, if_none_match=if_none_match, revalidate=True)


__all__ = ["router"]
