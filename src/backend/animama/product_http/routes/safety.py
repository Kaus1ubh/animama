"""Owner-visible companion-safety resources, shared by every composition (spec R5, R8; ADR 0021)."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from animama.app.contracts.safety import PyCrisisResourceRegionOption, PyCrisisResources
from animama.app.safety.config import load_safety_preferences
from animama.app.safety.crisis_resources import resolve_crisis_region
from animama.domain.request_principal import RequestPrincipal
from animama.product_http.ports import Ports, ReadRepositories
from animama.product_http.principal import get_current_principal

router = APIRouter(tags=["safety"])


@router.get("/v1/safety/crisis-resources", response_model=PyCrisisResources)
async def get_crisis_resources(
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    ports: Ports,
    repositories: ReadRepositories,
    locale: Annotated[str | None, Query(max_length=64)] = None,
) -> PyCrisisResources:
    """List selectable regions and the entry resolved from the owner's preference or ``locale``."""

    table = ports.crisis_resources()
    preferences = await load_safety_preferences(repositories.user_settings, principal.id)
    return PyCrisisResources(
        regions=[PyCrisisResourceRegionOption(code=region.code, label=region.label) for region in table.regions],
        preferred_region=preferences.crisis_resource_region,
        resolved=resolve_crisis_region(table, preferred_region=preferences.crisis_resource_region, locale=locale),
    )
