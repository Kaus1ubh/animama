"""Local adapter for the shared runtime capability contract.

The response models live in :mod:`animama.app.contracts.runtime_capabilities` so
other compositions can return the same contract without importing this router.
"""

from datetime import UTC, datetime, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.web_search_settings_repo import SQLAlchemyWebSearchSettingsRepository
from animama.app.contracts.runtime_capabilities import (
    CompanionSafetyCapability,
    RuntimeCapabilities,
    UserFileProcessingCapability,
    WebSearchCapability,
)
from animama.app.services.user_file_service import ALLOWED_USER_FILE_EXTENSIONS
from animama.domain.request_principal import RequestPrincipal
from animama.orm.runtime_worker import ORMRuntimeWorkerHeartbeat
from animama.server.config import Settings, settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.model_assets import parakeet_availability
from animama.server.routers.model_provider import get_model_catalog_policy
from animama.server.web_search import composition_web_search_enabled, web_search_credential_state

router = APIRouter()


def get_runtime_settings(request: Request) -> Settings:
    """Use the composition's policy, including explicitly supplied test settings."""

    return getattr(request.app.state, "runtime_settings", settings)


@router.get("/v1/runtime-capabilities", response_model=RuntimeCapabilities)
async def get_runtime_capabilities(
    request: Request,
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    session: Annotated[AsyncSession, Depends(get_async_session)],
    runtime_settings: Annotated[Settings, Depends(get_runtime_settings)],
) -> RuntimeCapabilities:
    """A stale worker may still accept durable jobs; an absent pack may not."""

    enabled = runtime_settings.animama_user_file_processing_enabled
    state: Literal["disabled", "starting", "ready", "stale"] = "disabled"
    last_heartbeat_at = None
    if enabled:
        heartbeat = await session.get(ORMRuntimeWorkerHeartbeat, "document-processing")
        expected = runtime_settings.animama_document_worker_instance_id
        if heartbeat is None or (expected and heartbeat.instance_id != expected):
            state = "starting"
        else:
            last_heartbeat_at = heartbeat.heartbeat_at
            state = "ready" if heartbeat.heartbeat_at >= datetime.now(UTC) - timedelta(seconds=20) else "stale"
    desktop = bool(runtime_settings.animama_desktop_control_token)
    speech = parakeet_availability(request.app, runtime_settings)
    safety = runtime_settings.companion_safety
    web_search = WebSearchCapability()
    if composition_web_search_enabled(request.app):
        search_settings = await SQLAlchemyWebSearchSettingsRepository(session).get()
        web_search = WebSearchCapability(
            configuration=True,
            configured=search_settings is not None,
            backend=search_settings.backend if search_settings is not None else None,
            credential_state=web_search_credential_state(search_settings) if search_settings is not None else None,
        )
    return RuntimeCapabilities(
        chat=True,
        model_selection=True,
        model_role_selection=True,
        model_configuration=get_model_catalog_policy(request).owner_models_enabled,
        provider_credentials=True,
        web_search=web_search,
        companion_safety=CompanionSafetyCapability(
            enabled=safety.enabled,
            ai_notice_enabled=safety.effective_ai_notice_enabled,
            crisis_detection_enabled=safety.effective_crisis_detection_enabled,
            operator_reminder_hours=safety.reminder_interval.total_seconds() / 3600,
        ),
        runtime_kind="desktop" if desktop else "self_hosted_web",
        # The local composition mounts upload and Anima-creation routes.
        chat_file_uploads=True,
        anima_creation=True,
        local_filesystem_administration=True,
        native_features=desktop,
        offline_speech_enabled=speech.enabled,
        offline_speech_asset_version=speech.asset_version,
        offline_speech_gpu_asset_version=speech.gpu_asset_version,
        user_file_processing=UserFileProcessingCapability(
            enabled=enabled,
            worker_state=state,
            last_heartbeat_at=last_heartbeat_at,
            pack_id="document-processing" if desktop else None,
            supported_extensions=sorted(ALLOWED_USER_FILE_EXTENSIONS) if enabled else [],
        ),
    )
