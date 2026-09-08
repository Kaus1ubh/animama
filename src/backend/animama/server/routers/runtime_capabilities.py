"""Owner-visible capability metadata, never executable paths or credentials."""

from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.services.user_file_service import ALLOWED_USER_FILE_EXTENSIONS
from animama.domain.request_principal import RequestPrincipal
from animama.orm.runtime_worker import ORMRuntimeWorkerHeartbeat
from animama.server.config import Settings, settings
from animama.server.deps import get_async_session, get_current_principal

router = APIRouter()


def get_runtime_settings(request: Request) -> Settings:
    """Use the composition's policy, including explicitly supplied test settings."""

    return getattr(request.app.state, "runtime_settings", settings)


class UserFileProcessingCapability(BaseModel):
    enabled: bool
    worker_state: Literal["disabled", "starting", "ready", "stale"]
    last_heartbeat_at: datetime | None
    pack_id: Literal["document-processing"] | None
    supported_extensions: list[str]


class RuntimeCapabilities(BaseModel):
    schema_version: Literal[1] = 1
    runtime_kind: Literal["desktop", "self_hosted_web"]
    user_file_processing: UserFileProcessingCapability
    offline_speech_enabled: bool
    offline_speech_asset_version: str | None


@router.get("/v1/runtime-capabilities", response_model=RuntimeCapabilities)
async def get_runtime_capabilities(
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
            state = "ready" if heartbeat.heartbeat_at >= datetime.now(timezone.utc) - timedelta(seconds=20) else "stale"
    desktop = bool(runtime_settings.animama_desktop_control_token)
    return RuntimeCapabilities(
        runtime_kind="desktop" if desktop else "self_hosted_web",
        offline_speech_enabled=runtime_settings.animama_parakeet_stt_enabled,
        offline_speech_asset_version=runtime_settings.animama_parakeet_asset_version,
        user_file_processing=UserFileProcessingCapability(
            enabled=enabled,
            worker_state=state,
            last_heartbeat_at=last_heartbeat_at,
            pack_id="document-processing" if desktop else None,
            supported_extensions=sorted(ALLOWED_USER_FILE_EXTENSIONS) if enabled else [],
        ),
    )
