"""Strict creation endpoints, registered before dynamic Anima routes."""

from __future__ import annotations

from collections.abc import Awaitable, Callable, Coroutine
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.routing import APIRoute
from pydantic.json_schema import SkipJsonSchema
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_creation_repo import SQLAlchemyAnimaCreationRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.adapters.repositories.sqlalchemy.settings_repo import SQLAlchemyUserSettingsRepository
from animama.app.anima_creation_contract import (
    AnimaSpec,
    CreateAnimaRequest,
    EnsureAnimaStartersRequest,
    LegacyCreateAnimaRequest,
)
from animama.app.services.anima_creation_service import AnimaCreationService
from animama.app.services.anima_creation_sources import AnimaCreationSources
from animama.app.services.anima_starter_service import AnimaStarterService
from animama.domain.anima_creation_error import AnimaCreationError, AnimaCreationIssue
from animama.domain.request_principal import RequestPrincipal
from animama.logging_config import get_logger
from animama.server.config import settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.schemas.anima_creation import (
    AnimaCreationErrorResponse,
    AnimaCreationOptions,
    AnimaCreationResult,
    AnimaValidationResult,
    EnsureAnimaStartersResult,
)

from .content import _store

_log = get_logger("server.routers.anima_creation")


class AnimaCreationRoute(APIRoute):
    """Keep schema/auth/semantic failures in one safe, bounded error envelope."""

    def get_route_handler(self) -> Callable[[Request], Coroutine[Any, Any, Response]]:
        original = super().get_route_handler()

        async def handler(request: Request) -> Response:
            try:
                return await original(request)
            except RequestValidationError as exc:
                issues = []
                for error in exc.errors()[:101]:
                    parts = [
                        str(part).replace("~", "~0").replace("/", "~1")[:128] for part in error["loc"] if part != "body"
                    ]
                    issues.append(
                        AnimaCreationIssue(
                            "request_field_invalid", "Invalid or missing request field.", "/" + "/".join(parts)
                        )
                    )
                failure = AnimaCreationError(issues=issues)
                return JSONResponse(status_code=422, content={"detail": failure.detail})
            except AnimaCreationError as exc:
                return JSONResponse(status_code=exc.status, content={"detail": exc.detail})
            except HTTPException as exc:
                failure = AnimaCreationError(
                    "anima_creation_unauthorized" if exc.status_code == 401 else "anima_creation_unavailable",
                    status=exc.status_code,
                    message="Authentication is required."
                    if exc.status_code == 401
                    else "The operation is unavailable.",
                    retryable=exc.status_code >= 500,
                )
                return JSONResponse(
                    status_code=exc.status_code, content={"detail": failure.detail}, headers=exc.headers
                )
            except Exception as exc:
                # Do not log submitted identity, private locators or database
                # exceptions that may contain a bound request payload.
                _log.error("Anima creation operation failed", error_type=type(exc).__name__)
                failure = AnimaCreationError(
                    "anima_creation_unavailable",
                    status=503,
                    retryable=True,
                    message="The result could not be confirmed. Retry the unchanged request.",
                )
                return JSONResponse(status_code=503, content={"detail": failure.detail})

        return handler


router = APIRouter(
    tags=["anima-creation"],
    route_class=AnimaCreationRoute,
    responses={code: {"model": AnimaCreationErrorResponse} for code in (401, 403, 404, 409, 410, 422, 503)},
)


def preferred_default_model_reader(session: AsyncSession) -> Callable[[str], Awaitable[str | None]]:
    """Read ``preferences.chat.default_model_provider_id`` from the owner's App Settings."""

    repository = SQLAlchemyUserSettingsRepository(session)

    async def read(user_id: str) -> str | None:
        stored = await repository.get(user_id)
        chat = (stored.preferences if stored else {}).get("chat")
        value = chat.get("default_model_provider_id") if isinstance(chat, dict) else None
        return value.strip() or None if isinstance(value, str) else None

    return read


def creation_service(request: Request, session: AsyncSession) -> AnimaCreationService:
    """All repositories share this HTTP request's one caller-owned session."""

    return AnimaCreationService(
        uow=SQLAlchemyAnimaAggregateUnitOfWork(session),
        receipts=SQLAlchemyAnimaCreationRepository(session),
        sources=AnimaCreationSources(
            catalog=SQLAlchemyContentCatalog(session),
            store=_store(request),
            max_identity_bytes=settings.anima_memory_file_max_bytes,
        ),
        default_model_provider_id=settings.anima_default_model_provider_id,
        preferred_model_provider_id=preferred_default_model_reader(session),
    )


@router.get("/v1/animas/creation-options", response_model=AnimaCreationOptions)
async def get_anima_creation_options(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> Any:
    return await creation_service(request, session).sources.options(user_id=user.id)


@router.post("/v1/animas:validate", response_model=AnimaValidationResult)
async def validate_anima(
    req: AnimaSpec,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> Any:
    return await creation_service(request, session).validate(user_id=user.id, spec=req)


@router.post(
    "/v1/animas", response_model=AnimaCreationResult, status_code=201, responses={200: {"model": AnimaCreationResult}}
)
async def create_anima(
    req: CreateAnimaRequest | SkipJsonSchema[LegacyCreateAnimaRequest],
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> JSONResponse:
    result = await creation_service(request, session).create(user_id=user.id, request=req)
    return JSONResponse(status_code=200 if result["idempotent_replay"] else 201, content=result)


@router.post("/v1/animas/starters:ensure", response_model=EnsureAnimaStartersResult)
async def ensure_anima_starters(
    req: EnsureAnimaStartersRequest,
    request: Request,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    user: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> Any:
    return await AnimaStarterService(creation_service(request, session)).ensure(user_id=user.id, request=req)
