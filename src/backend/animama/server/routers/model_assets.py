"""Install, report, serve and remove pinned downloadable model assets.

Requests name assets by catalog ID only; the release URL never comes from a
request. Installation runs in the background and is polled through the state
routes. Installed bytes are served same-origin, so the browser never contacts
the release host: single files at ``/content``, sets by their consumer's mount
(Parakeet sets at ``/onnx/models/...``). A renderer that loads an installed
asset holds a renewable use lease, which blocks removal until it is released or
expires.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Request, Response, status
from fastapi.responses import JSONResponse

from animama.app.services.model_asset_service import (
    AssetBusyError,
    AssetInstallRefusedError,
    AssetLeaseLimitError,
    AssetNotInstalledError,
    AssetRemovalRefusedError,
    ModelAssetService,
    UnknownAssetError,
)
from animama.domain.model_assets import AssetState
from animama.domain.request_principal import RequestPrincipal
from animama.local.http.assets import ModelFile, verified_file_response
from animama.server.deps import get_current_principal
from animama.server.model_assets import get_model_asset_service
from animama.server.schemas.model_asset import (
    LEASE_ID_PATTERN,
    PyModelAssetLease,
    PyModelAssetLeaseRequest,
    PyModelAssetList,
    PyModelAssetState,
)

router = APIRouter(prefix="/v1/model-assets", tags=["model-assets"])

Service = Annotated[ModelAssetService, Depends(get_model_asset_service)]
Principal = Annotated[RequestPrincipal, Depends(get_current_principal)]


def _not_found() -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "model_asset_not_found"})


def _busy() -> HTTPException:
    return HTTPException(status_code=409, detail={"code": "model_asset_busy"})


def _not_installed(request: Request) -> Response:
    """The documented 404 when an installed file vanishes before delivery."""

    headers = {"cache-control": "no-store"}
    if request.method == "HEAD":
        return Response(status_code=404, headers=headers)
    return JSONResponse({"detail": {"code": "model_asset_not_installed"}}, status_code=404, headers=headers)


def _state(service: ModelAssetService, asset_id: str) -> AssetState:
    try:
        return service.state(asset_id)
    except UnknownAssetError as exc:
        raise _not_found() from exc


@router.get("", response_model=PyModelAssetList)
async def list_model_assets(_principal: Principal, service: Service) -> PyModelAssetList:
    return PyModelAssetList(
        assets=[PyModelAssetState.from_state(state) for state in service.states()],
        free_bytes=service.free_bytes(),
    )


@router.get("/{asset_id}", response_model=PyModelAssetState)
async def get_model_asset(asset_id: str, _principal: Principal, service: Service) -> PyModelAssetState:
    return PyModelAssetState.from_state(_state(service, asset_id))


@router.post(
    "/{asset_id}:install",
    response_model=PyModelAssetState,
    status_code=status.HTTP_202_ACCEPTED,
    responses={
        409: {
            "description": "The asset is being removed (model_asset_busy), or a required asset is not"
            " installed (model_asset_requires, details.requires)."
        }
    },
)
async def install_model_asset(asset_id: str, _principal: Principal, service: Service) -> PyModelAssetState:
    """Start, resume or join a verified install; an installed asset is returned as is."""

    try:
        return PyModelAssetState.from_state(service.install(asset_id))
    except UnknownAssetError as exc:
        raise _not_found() from exc
    except AssetBusyError as exc:
        raise _busy() from exc
    except AssetInstallRefusedError as exc:
        raise HTTPException(status_code=409, detail={"code": exc.code, "details": dict(exc.details)}) from exc


@router.delete(
    "/{asset_id}",
    response_model=PyModelAssetState,
    responses={
        409: {
            "description": "Removal was refused (code and details: model_asset_in_use, model_asset_required_by"
            " or a consumer's code) or the asset is busy."
        }
    },
)
async def remove_model_asset(asset_id: str, _principal: Principal, service: Service) -> PyModelAssetState:
    """Cancel an in-flight install, discarding staged bytes, or remove an installed asset."""

    try:
        return PyModelAssetState.from_state(await service.remove(asset_id))
    except UnknownAssetError as exc:
        raise _not_found() from exc
    except AssetBusyError as exc:
        raise _busy() from exc
    except AssetRemovalRefusedError as exc:
        raise HTTPException(
            status_code=409,
            detail={"code": exc.veto.code, "details": dict(exc.veto.details)},
        ) from exc


@router.post(
    "/{asset_id}:lease",
    response_model=PyModelAssetLease,
    responses={
        409: {
            "description": "The asset is not installed (model_asset_not_installed), is being removed"
            " (model_asset_busy) or holds too many leases (model_asset_lease_limit)."
        }
    },
)
async def lease_model_asset(
    asset_id: str, body: PyModelAssetLeaseRequest, _principal: Principal, service: Service
) -> PyModelAssetLease:
    """Acquire or renew a use lease on an installed asset; removal is refused while it is live."""

    try:
        ttl = service.acquire_lease(asset_id, body.lease_id)
    except UnknownAssetError as exc:
        raise _not_found() from exc
    except AssetBusyError as exc:
        raise _busy() from exc
    except AssetNotInstalledError as exc:
        raise HTTPException(status_code=409, detail={"code": "model_asset_not_installed"}) from exc
    except AssetLeaseLimitError as exc:
        raise HTTPException(status_code=409, detail={"code": "model_asset_lease_limit"}) from exc
    return PyModelAssetLease(
        asset_id=asset_id,
        lease_id=body.lease_id,
        ttl_seconds=ttl,
        expires_at=datetime.now(UTC) + timedelta(seconds=ttl),
    )


@router.delete("/{asset_id}/leases/{lease_id}", status_code=status.HTTP_204_NO_CONTENT)
async def release_model_asset_lease(
    asset_id: str,
    lease_id: Annotated[str, Path(pattern=LEASE_ID_PATTERN)],
    _principal: Principal,
    service: Service,
) -> Response:
    """Release a use lease; an unknown or expired lease is already released."""

    try:
        service.release_lease(asset_id, lease_id)
    except UnknownAssetError as exc:
        raise _not_found() from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.head("/{asset_id}/content", include_in_schema=False)
@router.get(
    "/{asset_id}/content",
    response_class=Response,
    responses={200: {"content": {"application/octet-stream": {}}}, 206: {"description": "Partial content"}},
)
async def get_model_asset_content(
    asset_id: str,
    request: Request,
    _principal: Principal,
    service: Service,
) -> Response:
    """Serve an installed single file with ETag (the SHA-256) and single-range support."""

    try:
        location = service.installed_location(asset_id)
    except UnknownAssetError as exc:
        raise _not_found() from exc
    if location is None:
        raise HTTPException(status_code=404, detail={"code": "model_asset_not_installed"})
    asset, root, name = location
    (file,) = asset.files
    model = ModelFile(path=name, size_bytes=file.size, sha256=file.sha256, media_type=file.media_type)
    return await verified_file_response(request, root, model, cache_control="no-cache", not_found=_not_installed)
