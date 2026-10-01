"""Local FastAPI composition root for desktop and self-hosted installations."""

from __future__ import annotations

import logging
import os

from fastapi import FastAPI, HTTPException, Request
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.app.safety.config import safety_override_warnings
from animama.app.services.model_provider_catalog_service import ModelCatalogPolicy
from animama.local.database import LocalDatabase
from animama.local.http.composition import install_local_http
from animama.logging_config import configure_logging
from animama.server.config import Settings
from animama.server.content_startup import start_content_runtime, stop_content_runtime
from animama.server.deps import get_async_session_factory
from animama.server.embedding_refresh import start_embedding_refresh, stop_embedding_refresh
from animama.server.local_http import local_assets, local_http_config, local_telemetry
from animama.server.local_installation_bootstrap import create_local_installation_bootstrap_service
from animama.server.local_runtime import initialize_local_runtime
from animama.server.model_assets import close_model_asset_service, model_asset_service_for
from animama.server.routers import router
from animama.server.routers.desktop_control import require_desktop_control, router as desktop_control_router
from animama.server.routers.model_configuration import router as model_configuration_router
from animama.server.routers.web_search import router as web_search_router
from animama.server.runtime_credentials import (
    PinnedCredentialsMiddleware,
    follow_trace_export_key,
    scrub_credential_environment,
)
from animama.server.telemetry import setup_telemetry

logger = logging.getLogger(__name__)


def create_local_app(
    *,
    runtime_settings: Settings | None = None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,
) -> FastAPI:
    """Create only the local accountless composition.

    Product traffic stays fail-closed until startup completes bootstrap for the
    migration-owned principal. Browser metadata never supplies that identity.
    """

    local_settings = runtime_settings or Settings()
    http_config = local_http_config(local_settings)
    application = FastAPI(title="Animama Local Server", version="0.1.0")
    application.state.runtime_settings = local_settings
    database = LocalDatabase(local_settings) if session_factory is None else None
    application.state.session_factory = session_factory
    if database is not None:
        application.state.session_factory_provider = database.session_factory
    setup_telemetry(application, service_name="animama-server", service_version=application.version)

    @application.get("/health")
    async def health() -> dict[str, str]:
        return {"status": "ok"}

    application.include_router(router)
    # The installation owner may add model connections and models. These routes
    # reach owner-supplied endpoints, so only the local composition mounts them.
    application.state.model_catalog_policy = ModelCatalogPolicy(owner_models_enabled=True)
    application.include_router(model_configuration_router)
    # Application web search sends queries to an owner-configured backend
    # (a SearXNG URL may be a loopback or LAN host), so only this composition
    # enables it and mounts its settings routes.
    application.state.application_web_search_enabled = True
    application.include_router(web_search_router)
    if http_config.desktop is not None:
        # Desktop keys change while this process runs; the runtime store is
        # their only copy (see runtime_credentials).
        scrub_credential_environment()
        application.include_router(desktop_control_router)

        @application.get("/_desktop/health", include_in_schema=False)
        async def desktop_health(request: Request) -> dict[str, object]:
            """Identify this exact owned child without exposing browser credentials."""
            require_desktop_control(request)
            state = getattr(application.state, "local_bootstrap_state", None)
            if state is not None and not state.content_ready:
                # Nothing updates content_ready after startup, so this process
                # can never become ready. A distinct terminal code lets the
                # supervisor stop waiting.
                raise HTTPException(status_code=503, detail={"code": "content_startup_failed"})
            if state is None or not lifecycle.ready:
                raise HTTPException(status_code=503, detail="runtime_starting")
            from alembic.script import ScriptDirectory
            from animama.runtime.resources import alembic_config

            return {
                "schema_version": 1,
                # The desktop app version, not this API's schema version: the
                # supervisor refuses a backend reporting any other value.
                "runtime_version": os.getenv("ANIMAMA_DESKTOP_APP_VERSION", application.version),
                "build_id": os.getenv("ANIMAMA_DESKTOP_BUILD_ID", "development"),
                "alembic_head": ScriptDirectory.from_config(alembic_config()).get_current_head(),
                "installation_principal_id": state.principal_id,
                "local_http_schema_version": 1,
                "process_id": os.getpid(),
                "process_start_token": os.getenv("ANIMAMA_PROCESS_START_TOKEN", ""),
            }

    @application.on_event("startup")
    async def initialize_accountless_runtime() -> None:  # pragma: no cover - startup IO
        """Validate local paths, require the principal, and ensure owner defaults."""

        paths = initialize_local_runtime(local_settings)
        application.state.local_runtime_paths = paths
        # Discard staging left by an interrupted install before serving requests.
        model_asset_service_for(application)
        bootstrap = create_local_installation_bootstrap_service(
            session_factory=get_async_session_factory(application),
            paths=paths,
            settings=local_settings,
        )
        application.state.local_installation_bootstrap_service = bootstrap
        state = await bootstrap.ensure()
        application.state.local_bootstrap_state = state
        await start_content_runtime(
            application,
            owner_id=state.principal_id,
            perform_initial_scan=False,
        )
        start_embedding_refresh(application, session_factory=get_async_session_factory(application))
        # A bounded repair state may still use the existing bootstrap API. The
        # owner is established by completed service bootstrap, never that API's
        # request body; desktop readiness separately requires content readiness.
        lifecycle.mark_ready(state.principal_id)

    @application.on_event("shutdown")
    async def stop_accountless_runtime() -> None:  # pragma: no cover - startup IO
        await stop_embedding_refresh(application)
        await close_model_asset_service(application)
        await stop_content_runtime(application)
        if database is not None:
            await database.close()

    @application.on_event("startup")
    async def configure_anima_logging() -> None:  # pragma: no cover - simple IO
        try:
            configure_logging()
        except Exception:
            pass

    @application.on_event("startup")
    async def warn_companion_safety_overrides() -> None:
        for warning in safety_override_warnings(local_settings.companion_safety):
            logger.warning("Companion safety override: %s", warning)

    @application.on_event("startup")
    async def init_model_clients() -> None:  # pragma: no cover - simple IO
        try:
            from animama.server.model_clients import init_model_client_registry

            await init_model_client_registry(application)
        except Exception:
            application.state.model_client_registry = None

    @application.on_event("shutdown")
    async def close_model_clients() -> None:  # pragma: no cover - simple IO
        try:
            from animama.server.model_clients import close_model_client_registry

            await close_model_client_registry(application)
        except Exception:
            pass

    @application.on_event("startup")
    async def init_voice_providers() -> None:  # pragma: no cover - simple IO
        if os.getenv("ANIMAMA_ENABLE_VOICE"):
            try:
                from animama.server.voice_providers import ensure_voice_providers

                await ensure_voice_providers()
            except Exception:
                pass

    lifecycle = install_local_http(
        application,
        http_config,
        assets=local_assets(local_settings),
        telemetry=local_telemetry(http_config),
    )
    # Outermost, so everything a request runs sees the keys it was admitted with.
    application.add_middleware(PinnedCredentialsMiddleware)
    follow_trace_export_key()
    return application


app = create_local_app()

__all__ = ["app", "create_local_app"]
