"""Install, report, serve and remove pinned downloadable model assets.

Requests name assets by catalog ID only; the release URL never comes from a
request. Installation runs in the background and is polled through the state
routes. Installed bytes are served same-origin, so the browser never contacts
the release host.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse

from animama.app.services.model_asset_service import (
    AssetBusyError,
    AssetRemovalRefusedError,
    ModelAssetService,
    UnknownAssetError,
)
from animama.domain.model_assets import AssetState
from animama.domain.request_principal import RequestPrincipal
from animama.local.http.assets import ModelFile, verified_file_response
from animama.server.deps import get_current_principal
from animama.server.model_assets import get_model_asset_service
from animama.server.schemas.model_asset import PyModelAssetList, PyModelAssetState

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
    responses={409: {"description": "The asset is being removed; detail code model_asset_busy."}},
)
async def install_model_asset(asset_id: str, _principal: Principal, service: Service) -> PyModelAssetState:
    """Start or join a verified install; an installed asset is returned as is."""

    try:
        return PyModelAssetState.from_state(service.install(asset_id))
    except UnknownAssetError as exc:
        raise _not_found() from exc
    except AssetBusyError as exc:
        raise _busy() from exc


@router.delete(
    "/{asset_id}",
    response_model=PyModelAssetState,
    responses={409: {"description": "A consumer refused removal (code and details) or the asset is busy."}},
)
async def remove_model_asset(asset_id: str, _principal: Principal, service: Service) -> PyModelAssetState:
    """Cancel an in-flight install or remove an installed asset."""

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
    """Serve installed bytes with ETag (the SHA-256) and single-range support."""

    try:
        location = service.installed_location(asset_id)
    except UnknownAssetError as exc:
        raise _not_found() from exc
    if location is None:
        raise HTTPException(status_code=404, detail={"code": "model_asset_not_installed"})
    asset, root, name = location
    model = ModelFile(path=name, size_bytes=asset.size, sha256=asset.sha256, media_type=asset.media_type)
    return await verified_file_response(request, root, model, cache_control="no-cache", not_found=_not_installed)
