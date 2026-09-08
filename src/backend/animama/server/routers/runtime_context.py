"""Accountless local bootstrap and first-run endpoints."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.services.owner_bootstrap_service import BOOTSTRAP_STEPS
from animama.domain.request_principal import RequestPrincipal
from animama.domain.user_profile import UserProfileInvalidError, UserProfileNotFoundError
from animama.local.installation_repository import SQLAlchemyInstallationSettingsRepository
from animama.server.installation_personalization import (
    InstallationBootstrapIncompleteError,
    InstallationPersonalizationService,
    InstallationPrincipalMismatchError,
)
from animama.server.local_installation_bootstrap import LocalInstallationBootstrapService
from animama.server.schemas.runtime import PyOnboardingCompleteRequest, PyRuntimeContext

from ..deps import get_async_session, get_current_principal

router = APIRouter(tags=["local-runtime"])


def _bootstrap_service(request: Request) -> LocalInstallationBootstrapService:
    service = getattr(request.app.state, "local_installation_bootstrap_service", None)
    if not isinstance(service, LocalInstallationBootstrapService):
        raise HTTPException(status_code=503, detail={"code": "installation_bootstrap_unavailable"})
    return service


async def _context(
    *,
    request: Request,
    session: AsyncSession,
    principal: RequestPrincipal,
) -> PyRuntimeContext:
    service = _bootstrap_service(request)
    state = service.state
    if state is not None and state.principal_id != principal.id:
        raise HTTPException(status_code=403, detail={"code": "installation_principal_mismatch"})
    completed_at = await SQLAlchemyInstallationSettingsRepository(session).get_first_run_completed_at()
    profile = await SQLAlchemyUserProfileRepository(session).get_profile(principal.id)
    display_name = profile.display_name if profile is not None else None

    failed = list(state.failed_steps if state is not None else BOOTSTRAP_STEPS)
    if profile is None and "local_profile" not in failed:
        failed.insert(0, "local_profile")
    return PyRuntimeContext(
        principal_id=principal.id,
        bootstrap_status="repair_required" if failed else "ready",
        failed_steps=failed,
        # Earlier development builds allowed Skip. Reopen setup for an unnamed
        # profile without resetting its durable owner or completion timestamp.
        first_run_complete=completed_at is not None and bool(display_name and display_name.strip()),
        display_name=display_name,
    )


@router.get("/v1/runtime-context", response_model=PyRuntimeContext)
async def get_runtime_context(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyRuntimeContext:
    return await _context(request=request, session=session, principal=principal)


@router.post("/v1/runtime/bootstrap:ensure", response_model=PyRuntimeContext)
async def ensure_runtime_bootstrap(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyRuntimeContext:
    state = await _bootstrap_service(request).ensure()
    request.app.state.local_bootstrap_state = state
    if state.principal_id != principal.id:
        raise HTTPException(status_code=403, detail={"code": "installation_principal_mismatch"})
    return await _context(request=request, session=session, principal=principal)


@router.post("/v1/runtime/onboarding:complete", response_model=PyRuntimeContext)
async def complete_runtime_onboarding(
    payload: PyOnboardingCompleteRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyRuntimeContext:
    bootstrap = _bootstrap_service(request)
    state = bootstrap.state
    if state is None or state.status != "ready":
        raise HTTPException(status_code=409, detail={"code": "installation_bootstrap_incomplete"})
    if state.principal_id != principal.id:
        raise HTTPException(status_code=403, detail={"code": "installation_principal_mismatch"})
    try:
        await InstallationPersonalizationService(session).complete_onboarding(
            principal_id=principal.id,
            display_name=payload.display_name,
        )
    except (InstallationBootstrapIncompleteError, UserProfileNotFoundError) as exc:
        raise HTTPException(status_code=409, detail={"code": "installation_bootstrap_incomplete"}) from exc
    except InstallationPrincipalMismatchError as exc:
        raise HTTPException(status_code=403, detail={"code": "installation_principal_mismatch"}) from exc
    except UserProfileInvalidError as exc:
        raise HTTPException(
            status_code=422,
            detail={"code": "user_profile_invalid", "field": exc.field, "reason": exc.reason},
        ) from exc
    return await _context(request=request, session=session, principal=principal)


__all__ = ["router"]
