"""The owner's private profile routes, shared by every composition (ADR 0021)."""

from __future__ import annotations

from typing import Annotated, NoReturn

from fastapi import APIRouter, Depends, HTTPException

from animama.app.contracts.user_profile import PyUserProfile, PyUserProfileUpdate
from animama.app.services.user_profile_service import UserProfileService
from animama.domain.request_principal import RequestPrincipal
from animama.domain.user_profile import UserProfile, UserProfileInvalidError, UserProfileNotFoundError
from animama.product_http.ports import Ports, ProductRefusal, ReadRepositories, WriteSession, refusal_error
from animama.product_http.principal import get_current_principal

router = APIRouter()


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
    repositories: ReadRepositories,
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyUserProfile:
    service = UserProfileService(profiles=repositories.user_profiles, uow=repositories.unit_of_work)
    try:
        profile = await service.require_profile(principal.id)
    except UserProfileNotFoundError as exc:
        _raise_profile_error(exc)
    return _profile_response(profile)


@router.patch("/v1/users/me/profile", response_model=PyUserProfile)
async def update_user_profile(
    request: PyUserProfileUpdate,
    ports: Ports,
    session: WriteSession,
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyUserProfile:
    # Each composition owns where a display name is stored and what else it updates.
    try:
        display_name = await ports.update_display_name(session, principal, request.display_name)
    except (UserProfileNotFoundError, UserProfileInvalidError) as exc:
        _raise_profile_error(exc)
    except ProductRefusal as exc:
        raise refusal_error(exc) from exc
    return PyUserProfile(display_name=display_name)


__all__ = ["router"]
