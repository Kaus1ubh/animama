"""Private installation-owner personalization endpoints."""

from __future__ import annotations

from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.services.user_profile_service import UserProfileService
from animama.domain.request_principal import RequestPrincipal
from animama.domain.user_profile import UserProfile, UserProfileInvalidError, UserProfileNotFoundError
from animama.server.installation_personalization import (
    FirstRunIncompleteError,
    InstallationPersonalizationService,
    InstallationPrincipalMismatchError,
)

from ..deps import get_async_session, get_current_principal
from ..schemas.user_profile import PyUserProfile, PyUserProfileUpdate

router = APIRouter()


def _service(session: AsyncSession) -> UserProfileService:
    return UserProfileService(
        profiles=SQLAlchemyUserProfileRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )


def _profile_response(profile: UserProfile) -> PyUserProfile:
    return PyUserProfile(display_name=profile.display_name)


def _raise_profile_error(exc: Exception) -> NoReturn:
    if isinstance(exc, UserProfileNotFoundError):
        raise HTTPException(status_code=404, detail={"code": "user_profile_missing"}) from exc
    if isinstance(exc, UserProfileInvalidError):
        raise HTTPException(
            status_code=422,
            detail={"code": "user_profile_invalid", "field": exc.field, "reason": exc.reason},
        ) from exc
    raise exc


@router.get("/v1/users/me/profile", response_model=PyUserProfile)
async def get_user_profile(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyUserProfile:
    try:
        profile = await _service(session).require_profile(principal.id)
    except UserProfileNotFoundError as exc:
        _raise_profile_error(exc)
    return _profile_response(profile)


@router.patch("/v1/users/me/profile", response_model=PyUserProfile)
async def update_user_profile(
    request: PyUserProfileUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyUserProfile:
    try:
        result = await InstallationPersonalizationService(session).update_display_name(
            principal_id=principal.id,
            display_name=request.display_name,
        )
    except (UserProfileNotFoundError, UserProfileInvalidError) as exc:
        _raise_profile_error(exc)
    except FirstRunIncompleteError as exc:
        raise HTTPException(status_code=409, detail={"code": "first_run_incomplete"}) from exc
    except InstallationPrincipalMismatchError as exc:
        raise HTTPException(status_code=403, detail={"code": "installation_principal_mismatch"}) from exc
    return PyUserProfile(display_name=result.display_name)


__all__ = ["router"]
