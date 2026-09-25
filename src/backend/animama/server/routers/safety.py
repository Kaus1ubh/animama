"""Owner-visible companion-safety resources (spec R5, R8)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.safety.crisis_resources import CrisisResourceRegion, resolve_crisis_region
from animama.domain.request_principal import RequestPrincipal
from animama.server.companion_safety import load_safety_preferences, runtime_crisis_resources
from animama.server.config import Settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers.runtime_capabilities import get_runtime_settings

router = APIRouter(tags=["safety"])


class PyCrisisResourceRegionOption(BaseModel):
    code: str
    label: str


class PyCrisisResources(BaseModel):
    regions: list[PyCrisisResourceRegionOption]
    preferred_region: str | None
    resolved: CrisisResourceRegion


@router.get("/v1/safety/crisis-resources", response_model=PyCrisisResources)
async def get_crisis_resources(
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    runtime_settings: Annotated[Settings, Depends(get_runtime_settings)],
    locale: Annotated[str | None, Query(max_length=64)] = None,
) -> PyCrisisResources:
    """List selectable regions and the entry resolved from the owner's preference or ``locale``."""

    table = runtime_crisis_resources(runtime_settings)
    preferences = await load_safety_preferences(session, principal.id)
    return PyCrisisResources(
        regions=[PyCrisisResourceRegionOption(code=region.code, label=region.label) for region in table.regions],
        preferred_region=preferences.crisis_resource_region,
        resolved=resolve_crisis_region(table, preferred_region=preferences.crisis_resource_region, locale=locale),
    )
