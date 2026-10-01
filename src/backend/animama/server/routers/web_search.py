"""Owner web search settings routes: mounted only by the local composition.

The SearXNG URL is owner-supplied and may point at a loopback or LAN host, and
Test sends a query to the configured backend, so the hosted composition never
mounts these routes; see ``create_local_app``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.web_search_settings_repo import SQLAlchemyWebSearchSettingsRepository
from animama.app.model_clients.credentials import WEB_SEARCH_MANAGED_CREDENTIAL_ENV
from animama.app.services.web_search_settings_service import (
    WebSearchSettingsDraft,
    WebSearchSettingsError,
    WebSearchSettingsService,
)
from animama.domain.request_principal import RequestPrincipal
from animama.domain.web_search import WebSearchSettings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.schemas.web_search import PyWebSearchSettings, PyWebSearchSettingsRequest, PyWebSearchTestResult
from animama.server.web_search import build_web_search_backend, web_search_credential_state

router = APIRouter(tags=["web-search"])


def _service(session: AsyncSession) -> WebSearchSettingsService:
    return WebSearchSettingsService(
        settings=SQLAlchemyWebSearchSettingsRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        backend_factory=build_web_search_backend,
    )


def _draft(body: PyWebSearchSettingsRequest) -> WebSearchSettingsDraft:
    return WebSearchSettingsDraft(
        backend=body.backend,
        base_url=body.base_url,
        credential_mode=body.credential.mode,
        credential_env=body.credential.env,
        timeout_seconds=body.timeout_seconds,
    )


def _view(settings: WebSearchSettings | None) -> PyWebSearchSettings:
    if settings is None:
        return PyWebSearchSettings(configured=False, managed_credential_env=WEB_SEARCH_MANAGED_CREDENTIAL_ENV)
    return PyWebSearchSettings(
        configured=True,
        backend=settings.backend,
        base_url=settings.base_url,
        credential_env=settings.credential_env,
        credential_state=web_search_credential_state(settings),
        managed_credential_env=WEB_SEARCH_MANAGED_CREDENTIAL_ENV,
        timeout_seconds=settings.timeout_seconds,
    )


def _http_error(exc: WebSearchSettingsError) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"code": exc.code, "message": str(exc)})


@router.get("/v1/web-search/settings", response_model=PyWebSearchSettings)
async def get_web_search_settings(
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyWebSearchSettings:
    return _view(await _service(session).get())


@router.put("/v1/web-search/settings", response_model=PyWebSearchSettings)
async def update_web_search_settings(
    body: PyWebSearchSettingsRequest,
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> PyWebSearchSettings:
    try:
        return _view(await _service(session).update(_draft(body)))
    except WebSearchSettingsError as exc:
        raise _http_error(exc) from exc


@router.delete("/v1/web-search/settings", status_code=status.HTTP_204_NO_CONTENT)
async def clear_web_search_settings(
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
) -> None:
    await _service(session).clear()


@router.post("/v1/web-search/settings/test", response_model=PyWebSearchTestResult)
async def test_web_search_settings(
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    body: Annotated[PyWebSearchSettingsRequest | None, Body()] = None,
) -> PyWebSearchTestResult:
    """Send one query to the draft backend, or to the saved one without a body."""

    try:
        result = await _service(session).test(_draft(body) if body is not None else None)
    except WebSearchSettingsError as exc:
        raise _http_error(exc) from exc
    return PyWebSearchTestResult(ok=result.ok, category=result.category, result_count=result.result_count)


__all__ = ["router"]
