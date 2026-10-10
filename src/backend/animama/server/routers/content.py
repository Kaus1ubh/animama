"""The local composition's catalog rescan, and the content store its other local routers use.

The shared catalog, item and byte routes live in ``animama.product_http.routes.content``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Request

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
from animama.app.services.content_transition_service import ContentTransitionService
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import WriteContent, WriteSession
from animama.product_http.routes.content import catalog_response
from animama.server.config import settings
from animama.server.local_runtime import LocalRuntimePaths, initialize_local_runtime
from animama.server.schemas.content import (
    PyContentRescan,
    PyContentScanSummary,
)

from ..deps import get_current_principal

router = APIRouter(prefix="/v1/content", tags=["content"])


def _paths(request: Request) -> LocalRuntimePaths:
    paths = getattr(request.app.state, "local_runtime_paths", None)
    if isinstance(paths, LocalRuntimePaths):
        return paths
    paths = initialize_local_runtime(settings)
    request.app.state.local_runtime_paths = paths
    return paths


def _store(request: Request) -> FilesystemContentStore:
    paths = _paths(request)
    return FilesystemContentStore(
        included_root=paths.included_root,
        included_sources=paths.included_sources,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )


@router.post(":rescan", response_model=PyContentRescan)
async def rescan_content_catalog(
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: WriteSession,
    content: WriteContent,
) -> PyContentRescan:
    """Perform the authoritative scan; this never equips newly admitted content."""

    result = await ContentTransitionService(
        content=content.catalog, bindings=SQLAlchemyContentTransitionBindings(session)
    ).transition(user_id=user.id)
    items = list(result.items)
    return PyContentRescan(
        summaries=[PyContentScanSummary.from_domain(summary) for summary in result.summaries],
        catalog=catalog_response(items),
    )


__all__ = ["router"]
