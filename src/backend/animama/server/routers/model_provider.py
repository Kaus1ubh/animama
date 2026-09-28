from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.app.services.model_provider_catalog_service import ModelCatalogPolicy, ModelProviderCatalogService
from animama.domain.request_principal import RequestPrincipal
from animama.logging import get_logger
from animama.server.deps import get_async_session, get_current_principal
from animama.server.model_roles import composition_model_policy
from animama.server.schemas.model_provider import PyModelProviderCatalogItem

router = APIRouter()
_log = get_logger("server.routers.model_provider")


def get_model_catalog_policy(request: Request) -> ModelCatalogPolicy:
    """Return the composition's catalog policy; built-in rows only by default."""

    return composition_model_policy(request.app)


@router.get("/v1/model-providers", response_model=list[PyModelProviderCatalogItem])
async def list_model_providers(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    policy: Annotated[ModelCatalogPolicy, Depends(get_model_catalog_policy)],
) -> list[PyModelProviderCatalogItem]:
    service = ModelProviderCatalogService(model_providers=SQLAlchemyModelProviderRepository(session))
    try:
        rows = await service.list_public_catalog(policy)
    except SQLAlchemyError as exc:
        # Never substitute the static catalog: it would silently hide owner models.
        _log.error("Model catalog query failed", error_type=exc.__class__.__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "model_catalog_unavailable"},
        ) from exc
    return [PyModelProviderCatalogItem.model_validate(item) for item in rows]
