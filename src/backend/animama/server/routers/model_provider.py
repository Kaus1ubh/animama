from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.app.model_catalog import serialize_model_catalog
from animama.app.services.model_provider_catalog_service import ModelProviderCatalogService
from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_async_session, get_current_principal
from animama.server.schemas.model_provider import PyModelProviderCatalogItem

router = APIRouter()


@router.get("/v1/model-providers", response_model=list[PyModelProviderCatalogItem])
async def list_model_providers(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> list[PyModelProviderCatalogItem]:
    service = ModelProviderCatalogService(model_providers=SQLAlchemyModelProviderRepository(session))
    try:
        rows = await service.list_public_catalog()
        if rows:
            return [PyModelProviderCatalogItem.model_validate(item) for item in rows]
    except Exception:
        pass
    return [PyModelProviderCatalogItem.model_validate(item) for item in serialize_model_catalog()]
