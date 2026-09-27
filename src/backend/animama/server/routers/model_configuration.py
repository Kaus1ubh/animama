"""Owner model configuration routes: mounted only by the local composition.

These routes accept owner-supplied endpoints and send requests to them (model
listing and the capability probe). The hosted composition never mounts them;
see ``create_local_app``.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.model_clients.openai_chat_completions.probe import OpenAICompatibleConnectionProbe
from animama.adapters.repositories.sqlalchemy.anima_chat_profile_repo import SQLAlchemyAnimaChatProfileRepository
from animama.adapters.repositories.sqlalchemy.model_connection_repo import SQLAlchemyModelConnectionRepository
from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.settings_repo import SQLAlchemyUserSettingsRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.chat.api_standard import OPENAI_RESPONSES_PROVIDER_TYPE
from animama.app.model_clients.credentials import ModelCredentialResolver
from animama.app.model_clients.error_categories import ERROR_CREDENTIAL_MISSING, ERROR_INVALID_BASE_URL
from animama.app.model_clients.probe import ModelConnectionProbe, ModelConnectionProbeError, ModelProbeReport
from animama.app.model_connection_presets import MODEL_CONNECTION_PRESETS, model_connection_preset
from animama.app.services.model_configuration_service import (
    CredentialSetting,
    ModelConfigurationError,
    ModelConfigurationService,
    ModelConnectionDraft,
    ModelConnectionPatch,
    ModelInUseError,
    ModelUsage,
    OwnerModelCapabilities,
    OwnerModelDraft,
    OwnerModelPatch,
)
from animama.domain import ModelProvider
from animama.domain.model_connection import MODEL_KIND_EMBEDDING, ModelConnection, ModelConnectionCompatibility
from animama.domain.request_principal import RequestPrincipal
from animama.server.config import Settings
from animama.server.deps import get_async_session, get_current_principal
from animama.server.model_clients import build_model_credential_resolver
from animama.server.routers.runtime_capabilities import get_runtime_settings
from animama.server.schemas.model_configuration import (
    PyAvailableModels,
    PyConfiguredModel,
    PyModelCapabilitiesView,
    PyModelConnection,
    PyModelConnectionCompatibility,
    PyModelConnectionPreset,
    PyModelConnectionRequest,
    PyModelConnectionUpdate,
    PyModelProbeReport,
    PyModelProbeRequest,
    PyModelProbeStep,
    PyModelRemovalResult,
    PyModelUsage,
    PyModelUsageAnima,
    PyOwnerModelCapabilities,
    PyOwnerModelPatch,
    PyOwnerModelRequest,
)

router = APIRouter(tags=["model-configuration"])


def get_model_credential_resolver(
    runtime_settings: Annotated[Settings, Depends(get_runtime_settings)],
) -> ModelCredentialResolver:
    return build_model_credential_resolver(app_settings=runtime_settings)


def get_model_connection_probe(
    runtime_settings: Annotated[Settings, Depends(get_runtime_settings)],
    credentials: Annotated[ModelCredentialResolver, Depends(get_model_credential_resolver)],
) -> ModelConnectionProbe:
    return OpenAICompatibleConnectionProbe(
        credential_resolver=credentials,
        default_timeout=runtime_settings.anima_model_client_timeout_seconds,
    )


def _service(session: AsyncSession) -> ModelConfigurationService:
    return ModelConfigurationService(
        connections=SQLAlchemyModelConnectionRepository(session),
        model_providers=SQLAlchemyModelProviderRepository(session),
        profiles=SQLAlchemyAnimaChatProfileRepository(session),
        user_settings=SQLAlchemyUserSettingsRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )


def _probe_http_error(exc: ModelConnectionProbeError) -> HTTPException:
    """Configuration problems are the owner's to fix (400); upstream failures are 502."""

    owner_fixable = exc.category in {ERROR_CREDENTIAL_MISSING, ERROR_INVALID_BASE_URL}
    status_code = status.HTTP_400_BAD_REQUEST if owner_fixable else status.HTTP_502_BAD_GATEWAY
    return HTTPException(status_code=status_code, detail={"code": exc.category, "message": str(exc)})


def _http_error(exc: ModelConfigurationError) -> HTTPException:
    detail: dict[str, object] = {"code": exc.code, "message": str(exc)}
    if isinstance(exc, ModelInUseError):
        detail["usage"] = _usage_view(exc.usage).model_dump()
    return HTTPException(status_code=exc.status, detail=detail)


@router.get("/v1/model-connection-presets", response_model=list[PyModelConnectionPreset])
async def list_model_connection_presets(
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    runtime_settings: Annotated[Settings, Depends(get_runtime_settings)],
) -> list[PyModelConnectionPreset]:
    return [
        PyModelConnectionPreset(
            id=preset.id,
            label=preset.label,
            logo_provider=preset.logo_provider,
            local=preset.local,
            expects_key=preset.expects_key,
            default_base_url=preset.base_url(local_host=runtime_settings.animama_local_model_host),
            suggested_credential_env=preset.suggested_credential_env,
            compatibility=_compatibility_view(preset.compatibility),
            timeout_seconds=preset.timeout_seconds,
        )
        for preset in MODEL_CONNECTION_PRESETS.values()
        if preset.owner_selectable
    ]


@router.get("/v1/model-connections", response_model=list[PyModelConnection])
async def list_model_connections(
    session: Annotated[AsyncSession, Depends(get_async_session)],
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    credentials: Annotated[ModelCredentialResolver, Depends(get_model_credential_resolver)],
) -> list[PyModelConnection]:
    service = _service(session)
    views: list[PyModelConnection] = []
    for connection in await service.list_connections():
        models = await service.list_models(connection.id)
        views.append(_connection_view(connection, credentials, models))
    return views


@router.post("/v1/model-connections", response_model=PyModelConnection, status_code=status.HTTP_201_CREATED)
async def create_model_connection(
    body: PyModelConnectionRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    credentials: Annotated[ModelCredentialResolver, Depends(get_model_credential_resolver)],
) -> PyModelConnection:
    try:
        connection = await _service(session).create_connection(_connection_draft(body))
    except ModelConfigurationError as exc:
        raise _http_error(exc) from exc
    return _connection_view(connection, credentials, [])


@router.patch("/v1/model-connections/{connection_id}", response_model=PyModelConnection)
async def update_model_connection(
    connection_id: str,
    body: PyModelConnectionUpdate,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    credentials: Annotated[ModelCredentialResolver, Depends(get_model_credential_resolver)],
) -> PyModelConnection:
    service = _service(session)
    try:
        connection = await service.update_connection(
            connection_id,
            ModelConnectionPatch(
                name=body.name,
                preset=body.preset,
                base_url=body.base_url,
                credential=(
                    CredentialSetting(mode=body.credential.mode, env=body.credential.env)
                    if body.credential is not None
                    else None
                ),
                compatibility=(
                    ModelConnectionCompatibility(**body.compatibility.model_dump())
                    if body.compatibility is not None
                    else None
                ),
                timeout_seconds=body.timeout_seconds,
            ),
        )
        models = await service.list_models(connection_id)
    except ModelConfigurationError as exc:
        raise _http_error(exc) from exc
    return _connection_view(connection, credentials, models)


@router.delete("/v1/model-connections/{connection_id}", response_model=PyModelRemovalResult)
async def remove_model_connection(
    connection_id: str,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    confirm: Annotated[bool, Query()] = False,
) -> PyModelRemovalResult:
    try:
        usage = await _service(session).remove_connection(connection_id, owner_id=principal.id, confirm=confirm)
    except ModelConfigurationError as exc:
        raise _http_error(exc) from exc
    return PyModelRemovalResult(removed=True, usage=_usage_view(usage))


@router.get("/v1/model-connections/{connection_id}/available-models", response_model=PyAvailableModels)
async def list_available_models(
    connection_id: str,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    probe: Annotated[ModelConnectionProbe, Depends(get_model_connection_probe)],
) -> PyAvailableModels:
    connection = await _connection_or_404(session, connection_id)
    try:
        return PyAvailableModels(models=await probe.list_models(connection))
    except ModelConnectionProbeError as exc:
        raise _probe_http_error(exc) from exc


@router.post("/v1/model-connections/{connection_id}/probe", response_model=PyModelProbeReport)
async def probe_model(
    connection_id: str,
    body: PyModelProbeRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    probe: Annotated[ModelConnectionProbe, Depends(get_model_connection_probe)],
) -> PyModelProbeReport:
    """Send a few small requests to the model and suggest its capabilities."""

    connection = await _connection_or_404(session, connection_id)
    try:
        if body.kind == MODEL_KIND_EMBEDDING:
            report = await probe.probe_embedding_model(connection, model=body.model)
        elif body.provider_type == OPENAI_RESPONSES_PROVIDER_TYPE:
            if not connection.is_builtin_openai:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail={"code": "invalid_provider_type", "message": "Responses needs the OpenAI connection"},
                )
            report = await probe.probe_responses_model(connection, model=body.model)
        else:
            report = await probe.probe_chat_model(connection, model=body.model)
    except ModelConnectionProbeError as exc:
        raise _probe_http_error(exc) from exc
    return _probe_view(report)


@router.post(
    "/v1/model-connections/{connection_id}/models",
    response_model=PyConfiguredModel,
    status_code=status.HTTP_201_CREATED,
)
async def add_owner_model(
    connection_id: str,
    body: PyOwnerModelRequest,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyConfiguredModel:
    draft = OwnerModelDraft(
        model=body.model,
        label=body.label,
        kind=body.kind,
        provider_type=body.provider_type,
        template_id=body.template_id,
        capabilities=_owner_capabilities(body.capabilities),
        context_window_tokens=body.context_window_tokens,
        allow_memory_writes=body.allow_memory_writes,
        probe_result=body.probe_result,
    )
    try:
        row = await _service(session).add_model(connection_id, draft)
    except ModelConfigurationError as exc:
        raise _http_error(exc) from exc
    return _model_view(row)


@router.patch("/v1/model-providers/{model_provider_id}", response_model=PyConfiguredModel)
async def update_model(
    model_provider_id: str,
    body: PyOwnerModelPatch,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    _principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
) -> PyConfiguredModel:
    patch = OwnerModelPatch(
        label=body.label,
        capabilities=_owner_capabilities(body.capabilities),
        context_window_tokens=body.context_window_tokens,
        clear_context_window=body.clear_context_window,
        allow_memory_writes=body.allow_memory_writes,
        probe_result=body.probe_result,
        hidden=body.hidden,
    )
    try:
        row = await _service(session).update_model(model_provider_id, patch)
    except ModelConfigurationError as exc:
        raise _http_error(exc) from exc
    return _model_view(row)


@router.delete("/v1/model-providers/{model_provider_id}", response_model=PyModelRemovalResult)
async def remove_model(
    model_provider_id: str,
    session: Annotated[AsyncSession, Depends(get_async_session)],
    principal: Annotated[RequestPrincipal, Depends(get_current_principal)],
    confirm: Annotated[bool, Query()] = False,
) -> PyModelRemovalResult:
    try:
        usage = await _service(session).remove_model(model_provider_id, owner_id=principal.id, confirm=confirm)
    except ModelConfigurationError as exc:
        raise _http_error(exc) from exc
    return PyModelRemovalResult(removed=True, usage=_usage_view(usage))


async def _connection_or_404(session: AsyncSession, connection_id: str) -> ModelConnection:
    try:
        return await _service(session).get_connection(connection_id)
    except ModelConfigurationError as exc:
        raise _http_error(exc) from exc


def _connection_draft(body: PyModelConnectionRequest) -> ModelConnectionDraft:
    return ModelConnectionDraft(
        name=body.name,
        preset=body.preset,
        base_url=body.base_url,
        credential=CredentialSetting(mode=body.credential.mode, env=body.credential.env),
        compatibility=(
            ModelConnectionCompatibility(**body.compatibility.model_dump()) if body.compatibility is not None else None
        ),
        timeout_seconds=body.timeout_seconds,
    )


def _owner_capabilities(body: PyOwnerModelCapabilities | None) -> OwnerModelCapabilities | None:
    if body is None:
        return None
    return OwnerModelCapabilities(
        accepts_images=body.accepts_images,
        supports_streaming=body.supports_streaming,
        structured_output_transport=body.structured_output_transport,
        supports_tools=body.supports_tools,
        tools_with_structured_output=body.tools_with_structured_output,
        supported_reasoning_efforts=tuple(body.supported_reasoning_efforts),
    )


def _compatibility_view(compatibility: ModelConnectionCompatibility) -> PyModelConnectionCompatibility:
    return PyModelConnectionCompatibility.model_validate(compatibility.to_dict())


def _connection_view(
    connection: ModelConnection,
    credentials: ModelCredentialResolver,
    models: list[ModelProvider],
) -> PyModelConnection:
    return PyModelConnection(
        id=connection.id,
        name=connection.name,
        preset=connection.preset,
        source="builtin" if connection.is_builtin_openai else "owner",
        logo_provider=model_connection_preset(connection.preset).logo_provider,
        base_url=connection.base_url,
        credential_env=connection.credential_env,
        credential_state=credentials.resolve(connection).state,
        compatibility=_compatibility_view(connection.compatibility),
        timeout_seconds=connection.timeout_seconds,
        models=[_model_view(row) for row in models],
    )


def _model_view(row: ModelProvider) -> PyConfiguredModel:
    capabilities = row.capabilities
    template_id = row.metadata.get("template_id") if isinstance(row.metadata, dict) else None
    return PyConfiguredModel(
        id=row.id,
        model=row.model,
        model_label=row.model_label or row.model,
        provider_type=row.provider_type,
        source=row.source,
        model_kind=row.model_kind,
        hidden=row.hidden,
        connection_id=row.connection_id,
        context_window_tokens=row.context_window_tokens,
        allow_memory_writes=row.allow_memory_writes,
        capabilities=PyModelCapabilitiesView(
            accepts=list(capabilities.accepts),
            supports_streaming=capabilities.supports_streaming,
            supports_tools=capabilities.supports_tools,
            structured_output_transport=capabilities.structured_output_transport,
            tools_with_structured_output=capabilities.tools_with_structured_output,
            supports_reasoning=capabilities.supports_reasoning,
            supported_reasoning_efforts=capabilities.supported_reasoning_efforts,
            native_tool_support=capabilities.native_tool_support,
        ),
        probe_result=row.probe_result,
        template_id=template_id if isinstance(template_id, str) else None,
    )


def _usage_view(usage: ModelUsage) -> PyModelUsage:
    return PyModelUsage(
        animas=[
            PyModelUsageAnima(
                anima_id=item.anima_id,
                display_name=item.display_name,
                model_provider_id=item.model_provider_id,
            )
            for item in usage.animas
        ],
        roles=list(usage.roles),
    )


def _probe_view(report: ModelProbeReport) -> PyModelProbeReport:
    return PyModelProbeReport(
        model=report.model,
        steps=[
            PyModelProbeStep(name=step.name, ok=step.ok, category=step.category, detail=step.detail)
            for step in report.steps
        ],
        supports_streaming=report.supports_streaming,
        structured_output_transport=report.structured_output_transport,
        supports_tools=report.supports_tools,
        tools_with_structured_output=report.tools_with_structured_output,
        context_window_tokens=report.context_window_tokens,
        embedding_dimensions=report.embedding_dimensions,
        notes=list(report.notes),
    )


__all__ = ["get_model_connection_probe", "get_model_credential_resolver", "router"]
