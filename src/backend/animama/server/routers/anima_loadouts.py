"""Typed Anima loadout reads and optimistic plan/commit commands."""

from __future__ import annotations

from typing import Annotated, Literal, NoReturn

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.services.anima_loadout_service import AnimaLoadoutService, LoadoutFamily
from animama.domain.anima_loadout import AnimaLoadoutError
from animama.domain.request_principal import RequestPrincipal
from animama.server.deps import get_async_session, get_current_principal
from animama.server.schemas.anima_loadout import (
    PyAnimaLoadout,
    PyAppearanceCommitRequest,
    PyAppearancePlanRequest,
    PyGestureCommitRequest,
    PyGesturePlanRequest,
    PyIdleStyleCommitRequest,
    PyIdleStylePlanRequest,
    PyLoadoutCommitResult,
    PyLoadoutPlan,
    PyMusicTrackCommitRequest,
    PyMusicTrackPlanRequest,
    PyReactionCommitRequest,
    PyReactionPlanRequest,
    PySingleSelectionCommitRequest,
    PySingleSelectionPlanRequest,
)

router = APIRouter(prefix="/v1/animas", tags=["anima-loadout"])


def _raise_loadout(exc: AnimaLoadoutError) -> NoReturn:
    status_code = 404 if exc.code == "anima_not_found" else 409
    detail: dict[str, object] = {"code": exc.code}
    if exc.current_revision is not None:
        detail["current_revision"] = exc.current_revision
    raise HTTPException(status_code=status_code, detail=detail) from exc


@router.get("/{anima_id}/loadout", response_model=PyAnimaLoadout)
async def get_anima_loadout(
    anima_id: str,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyAnimaLoadout:
    service = AnimaLoadoutService(session)
    try:
        value = await service.read_model(user_id=user.id, anima_id=anima_id)
    except AnimaLoadoutError as exc:
        _raise_loadout(exc)
    return PyAnimaLoadout.from_domain(
        value,
        starter_implementation_kinds=getattr(service, "starter_gesture_implementation_kinds", {}),
    )


async def _plan(
    *,
    family: LoadoutFamily,
    anima_id: str,
    body: BaseModel,
    user: RequestPrincipal,
    session: AsyncSession,
) -> PyLoadoutPlan:
    data = body.model_dump(exclude_none=True)
    try:
        value = await AnimaLoadoutService(session).plan(
            user_id=user.id,
            anima_id=anima_id,
            family=family,
            expected_revision=int(data["expected_revision"]),
            intent=dict(data["intent"]),
        )
        return PyLoadoutPlan.from_domain(value)
    except AnimaLoadoutError as exc:
        _raise_loadout(exc)


async def _commit(
    *,
    family: LoadoutFamily,
    anima_id: str,
    body: BaseModel,
    user: RequestPrincipal,
    session: AsyncSession,
) -> PyLoadoutCommitResult:
    data = body.model_dump(exclude_none=True)
    try:
        value = await AnimaLoadoutService(session).commit(
            user_id=user.id,
            anima_id=anima_id,
            family=family,
            expected_revision=int(data["expected_revision"]),
            intent=dict(data["intent"]),
            plan_digest=str(data["plan_digest"]),
            idempotency_key=str(data["idempotency_key"]),
        )
        return PyLoadoutCommitResult.from_domain(value)
    except AnimaLoadoutError as exc:
        await session.rollback()
        _raise_loadout(exc)


@router.post("/{anima_id}/gestures:plan", response_model=PyLoadoutPlan)
async def plan_gesture(
    anima_id: str,
    body: PyGesturePlanRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyLoadoutPlan:
    return await _plan(family="gesture", anima_id=anima_id, body=body, user=user, session=session)


@router.post("/{anima_id}/gestures:commit", response_model=PyLoadoutCommitResult)
async def commit_gesture(
    anima_id: str,
    body: PyGestureCommitRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyLoadoutCommitResult:
    return await _commit(family="gesture", anima_id=anima_id, body=body, user=user, session=session)


@router.post("/{anima_id}/reactions:plan", response_model=PyLoadoutPlan)
async def plan_reaction(
    anima_id: str,
    body: PyReactionPlanRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyLoadoutPlan:
    return await _plan(family="reaction", anima_id=anima_id, body=body, user=user, session=session)


@router.post("/{anima_id}/reactions:commit", response_model=PyLoadoutCommitResult)
async def commit_reaction(
    anima_id: str,
    body: PyReactionCommitRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyLoadoutCommitResult:
    return await _commit(family="reaction", anima_id=anima_id, body=body, user=user, session=session)


@router.post("/{anima_id}/idle-style:plan", response_model=PyLoadoutPlan)
async def plan_idle_style(
    anima_id: str,
    body: PyIdleStylePlanRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyLoadoutPlan:
    return await _plan(family="idle_style", anima_id=anima_id, body=body, user=user, session=session)


@router.post("/{anima_id}/idle-style:commit", response_model=PyLoadoutCommitResult)
async def commit_idle_style(
    anima_id: str,
    body: PyIdleStyleCommitRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyLoadoutCommitResult:
    return await _commit(family="idle_style", anima_id=anima_id, body=body, user=user, session=session)


@router.post("/{anima_id}/music-tracks:plan", response_model=PyLoadoutPlan)
async def plan_music_track(
    anima_id: str,
    body: PyMusicTrackPlanRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyLoadoutPlan:
    return await _plan(family="music_track", anima_id=anima_id, body=body, user=user, session=session)


@router.post("/{anima_id}/music-tracks:commit", response_model=PyLoadoutCommitResult)
async def commit_music_track(
    anima_id: str,
    body: PyMusicTrackCommitRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyLoadoutCommitResult:
    return await _commit(family="music_track", anima_id=anima_id, body=body, user=user, session=session)


def _install_single_selection_routes(
    *,
    path: str,
    singular: str,
    family: Literal["avatar", "voice"],
) -> None:
    async def plan_selection(
        anima_id: str,
        body: PySingleSelectionPlanRequest,
        user: Annotated[RequestPrincipal, Depends(get_current_principal)],
        session: Annotated[AsyncSession, Depends(get_async_session)],
    ) -> PyLoadoutPlan:
        return await _plan(family=family, anima_id=anima_id, body=body, user=user, session=session)

    async def commit_selection(
        anima_id: str,
        body: PySingleSelectionCommitRequest,
        user: Annotated[RequestPrincipal, Depends(get_current_principal)],
        session: Annotated[AsyncSession, Depends(get_async_session)],
    ) -> PyLoadoutCommitResult:
        return await _commit(family=family, anima_id=anima_id, body=body, user=user, session=session)

    plan_selection.__name__ = f"plan_{singular}"
    commit_selection.__name__ = f"commit_{singular}"
    router.add_api_route(
        f"/{{anima_id}}/{path}:plan",
        plan_selection,
        methods=["POST"],
        response_model=PyLoadoutPlan,
        operation_id=plan_selection.__name__,
    )
    router.add_api_route(
        f"/{{anima_id}}/{path}:commit",
        commit_selection,
        methods=["POST"],
        response_model=PyLoadoutCommitResult,
        operation_id=commit_selection.__name__,
    )


_install_single_selection_routes(path="avatar", singular="avatar", family="avatar")
_install_single_selection_routes(path="voice", singular="voice", family="voice")


@router.post("/{anima_id}/appearance:plan", response_model=PyLoadoutPlan)
async def plan_appearance(
    anima_id: str,
    body: PyAppearancePlanRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyLoadoutPlan:
    return await _plan(family="appearance", anima_id=anima_id, body=body, user=user, session=session)


@router.post("/{anima_id}/appearance:commit", response_model=PyLoadoutCommitResult)
async def commit_appearance(
    anima_id: str,
    body: PyAppearanceCommitRequest,
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyLoadoutCommitResult:
    return await _commit(family="appearance", anima_id=anima_id, body=body, user=user, session=session)


__all__ = ["router"]
