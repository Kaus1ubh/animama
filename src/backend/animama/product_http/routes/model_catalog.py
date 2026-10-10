"""Model catalog and model-role reads, shared by every composition (ADR 0021).

The catalog lists the rows the composition's ``ModelCatalogPolicy`` admits. Roles
resolve against that catalog, the owner's App Settings and the composition's
operator defaults; adding models and connections stays with the local composition.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import SQLAlchemyError

from animama.app.contracts.model_provider import PyModelProviderCatalogItem
from animama.app.contracts.model_roles import PyEmbeddingRefreshStatus, PyModelRoleAssignment, PyModelRoles
from animama.app.services.model_provider_catalog_service import ModelProviderCatalogService
from animama.app.services.model_role_resolver import MODEL_ROLES, ROLE_EMBEDDINGS, ResolvedModelRole
from animama.domain.request_principal import RequestPrincipal
from animama.logging import get_logger
from animama.product_http.ports import Ports, ReadRepositories, ReadSession, model_role_resolver
from animama.product_http.principal import get_current_principal

router = APIRouter()
_log = get_logger("product_http.routes.model_catalog")


@router.get("/v1/model-providers", response_model=list[PyModelProviderCatalogItem])
async def list_model_providers(
    repositories: ReadRepositories,
    ports: Ports,
) -> list[PyModelProviderCatalogItem]:
    service = ModelProviderCatalogService(model_providers=repositories.model_providers)
    try:
        rows = await service.list_public_catalog(ports.model_catalog_policy)
    except SQLAlchemyError as exc:
        # Never substitute the static catalog: it would silently hide owner models.
        _log.error("Model catalog query failed", error_type=exc.__class__.__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"code": "model_catalog_unavailable"},
        ) from exc
    return [PyModelProviderCatalogItem.model_validate(item) for item in rows]


@router.get("/v1/model-roles", response_model=PyModelRoles, tags=["model-configuration"])
async def get_model_roles(
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    ports: Ports,
    session: ReadSession,
) -> PyModelRoles:
    """Report the row doing each role's job and whether stored vectors match the embeddings role."""

    resolver = model_role_resolver(ports, ports.repositories(session))
    resolved = [await resolver.resolve(principal.id, role) for role in MODEL_ROLES]
    embeddings = next(role for role in resolved if role.role == ROLE_EMBEDDINGS)
    refresh = await ports.embedding_refresh_status(
        session,
        principal,
        embeddings.model_provider.id if embeddings.model_provider is not None else None,
    )
    return PyModelRoles(
        roles=[_role_view(role) for role in resolved],
        embeddings_refresh=PyEmbeddingRefreshStatus(
            state=refresh.state,
            pending=refresh.pending,
            error_category=refresh.error_category,
        ),
    )


def _role_view(resolved: ResolvedModelRole) -> PyModelRoleAssignment:
    row = resolved.model_provider
    return PyModelRoleAssignment(
        role=resolved.role,
        source=resolved.source,
        model_provider_id=row.id if row is not None else None,
        model_label=row.model_label if row is not None else None,
        connection_name=row.connection.name if row is not None and row.connection is not None else None,
        requested_model_provider_id=resolved.requested_id,
        assignment_available=resolved.assignment_available,
    )


__all__ = ["router"]
