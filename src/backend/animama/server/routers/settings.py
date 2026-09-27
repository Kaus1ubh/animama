from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.mappers.settings_map import anima_settings_domain_to_schema, user_settings_domain_to_schema
from animama.adapters.repositories.sqlalchemy.settings_repo import (
    SQLAlchemyAnimaSettingsRepository,
    SQLAlchemyUserSettingsRepository,
)
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.settings_service import SettingsService, default_anima_preferences
from animama.domain.request_principal import RequestPrincipal
from animama.domain.settings import AnimaSettings, UserSettings
from animama.orm.anima import ORMAnima

from ..deps import get_async_session, get_current_principal
from ..embedding_refresh import wake_embedding_refresh
from ..schemas import PyAnimaSettings, PyAnimaSettingsUpdate, PyUserSettings, PyUserSettingsUpdate

router = APIRouter()


@router.get("/v1/users/me/settings", response_model=PyUserSettings)
async def get_user_settings(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyUserSettings:
    service = SettingsService(
        user_settings=SQLAlchemyUserSettingsRepository(session),
        anima_settings=SQLAlchemyAnimaSettingsRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )
    settings = await service.get_user_settings(user.id)
    if settings is None:
        settings = UserSettings(user_id=user.id)
    return user_settings_domain_to_schema(settings)


@router.post("/v1/users/me/settings", response_model=PyUserSettings, status_code=status.HTTP_201_CREATED)
async def create_user_settings(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
    req: PyUserSettingsUpdate | None = None,
) -> PyUserSettings:
    service = SettingsService(
        user_settings=SQLAlchemyUserSettingsRepository(session),
        anima_settings=SQLAlchemyAnimaSettingsRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )
    existing = await service.get_user_settings(user.id)
    if existing is not None:
        raise HTTPException(status_code=409, detail="User settings already exist")
    patch = req.model_dump(exclude_unset=True) if req is not None else {}
    settings = await service.patch_user_settings(user_id=user.id, **patch)
    # The embeddings role may have changed.
    wake_embedding_refresh(request.app)
    return user_settings_domain_to_schema(settings)


@router.patch("/v1/users/me/settings", response_model=PyUserSettings)
async def patch_user_settings(
    req: PyUserSettingsUpdate,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyUserSettings:
    service = SettingsService(
        user_settings=SQLAlchemyUserSettingsRepository(session),
        anima_settings=SQLAlchemyAnimaSettingsRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )
    patch = req.model_dump(exclude_unset=True)
    settings = await service.patch_user_settings(user_id=user.id, **patch)
    # The embeddings role may have changed.
    wake_embedding_refresh(request.app)
    return user_settings_domain_to_schema(settings)


@router.delete("/v1/users/me/settings", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user_settings(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> Response:
    service = SettingsService(
        user_settings=SQLAlchemyUserSettingsRepository(session),
        anima_settings=SQLAlchemyAnimaSettingsRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )
    await service.delete_user_settings(user.id)
    wake_embedding_refresh(request.app)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/v1/animas/{anima_id}/settings", response_model=PyAnimaSettings)
async def get_anima_settings(
    anima_id: str,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyAnimaSettings:
    orm = await session.get(ORMAnima, anima_id)
    if orm is None or (orm.user_id is not None and orm.user_id != user.id):
        raise HTTPException(status_code=404, detail="Anima not found")
    service = SettingsService(
        user_settings=SQLAlchemyUserSettingsRepository(session),
        anima_settings=SQLAlchemyAnimaSettingsRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )
    settings = await service.get_anima_settings(user_id=user.id, anima_id=anima_id)
    if settings is None:
        settings = AnimaSettings(
            user_id=user.id,
            anima_id=anima_id,
            preferences=default_anima_preferences(),
        )
    return anima_settings_domain_to_schema(settings)


@router.patch("/v1/animas/{anima_id}/settings", response_model=PyAnimaSettings)
async def patch_anima_settings(
    anima_id: str,
    req: PyAnimaSettingsUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyAnimaSettings:
    orm = await session.get(ORMAnima, anima_id)
    if orm is None or (orm.user_id is not None and orm.user_id != user.id):
        raise HTTPException(status_code=404, detail="Anima not found")
    service = SettingsService(
        user_settings=SQLAlchemyUserSettingsRepository(session),
        anima_settings=SQLAlchemyAnimaSettingsRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )
    patch = req.model_dump(exclude_unset=True)
    settings = await service.patch_anima_settings(user_id=user.id, anima_id=anima_id, **patch)
    return anima_settings_domain_to_schema(settings)


@router.delete("/v1/animas/{anima_id}/settings", status_code=status.HTTP_204_NO_CONTENT)
async def delete_anima_settings(
    anima_id: str,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> Response:
    orm = await session.get(ORMAnima, anima_id)
    if orm is None or (orm.user_id is not None and orm.user_id != user.id):
        raise HTTPException(status_code=404, detail="Anima not found")
    service = SettingsService(
        user_settings=SQLAlchemyUserSettingsRepository(session),
        anima_settings=SQLAlchemyAnimaSettingsRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )
    await service.delete_anima_settings(user_id=user.id, anima_id=anima_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
