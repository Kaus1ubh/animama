"""Automatic episode processing routes: mounted only by the local composition.

Hosted never processes episode notes in the background, so it never mounts these
routes and reports ``automatic_episode_processing = false`` in its capabilities.
"""

from __future__ import annotations

from dataclasses import asdict
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from animama.domain.request_principal import RequestPrincipal
from animama.local.installation_repository import SQLAlchemyEpisodeProcessingSettingsRepository
from animama.server.deps import get_async_session, get_current_principal
from animama.server.episode_processing import (
    AutomaticEpisodeProcessingWorker,
    get_automatic_episode_processing_worker,
)
from animama.server.schemas.memory_automation import (
    PyAutomaticEpisodeProcessingStatus,
    PyAutomaticEpisodeProcessingUpdate,
)

router = APIRouter(tags=["memory"])


def _worker(request: Request, principal: RequestPrincipal) -> AutomaticEpisodeProcessingWorker:
    worker = get_automatic_episode_processing_worker(request.app)
    if worker is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Automatic processing is starting")
    # The task serves the installation owner, the only principal the local app admits.
    if worker.owner_id != principal.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Automatic processing is not available")
    return worker


@router.get("/v1/memory/automatic-processing", response_model=PyAutomaticEpisodeProcessingStatus)
async def get_automatic_episode_processing(
    request: Request,
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyAutomaticEpisodeProcessingStatus:
    """Return the threshold and what automatic processing will do next."""

    return PyAutomaticEpisodeProcessingStatus(**asdict(await _worker(request, principal).status()))


@router.put("/v1/memory/automatic-processing", response_model=PyAutomaticEpisodeProcessingStatus)
async def update_automatic_episode_processing(
    body: PyAutomaticEpisodeProcessingUpdate,
    request: Request,
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyAutomaticEpisodeProcessingStatus:
    """Store the threshold; a changed value lifts a failure pause. Then check right away."""

    worker = _worker(request, principal)
    await SQLAlchemyEpisodeProcessingSettingsRepository(session).set_threshold(
        user_id=principal.id, threshold=body.threshold, changed_at=datetime.now(UTC)
    )
    await session.commit()
    worker.wake()
    return PyAutomaticEpisodeProcessingStatus(**asdict(await worker.status()))
