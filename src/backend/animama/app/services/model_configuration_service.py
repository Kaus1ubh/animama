"""Owner configuration of model connections and owner-added models.

Only the local composition exposes this service. Built-in rows are
release-managed: the owner may hide them but not edit them. Owner-added rows
and connections are retired, never deleted, because chat profiles reference
them and history keeps their snapshot.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlsplit

from animama.app.chat.api_standard import OPENAI_CHAT_COMPLETIONS_PROVIDER_TYPE, OPENAI_RESPONSES_PROVIDER_TYPE
from animama.app.main_structured_response import MAIN_STRUCTURED_RESPONSE_KIND
from animama.app.model_catalog import (
    REASONING_EFFORT_ORDER,
    STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT,
    STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
)
from animama.app.model_clients.credentials import is_allowed_credential_env, managed_credential_env
from animama.app.model_connection_presets import MODEL_CONNECTION_PRESETS, model_connection_preset
from animama.domain import ModelProvider, ModelProviderCapabilities, ModelProviderPricing
from animama.domain.model_connection import (
    BUILTIN_OPENAI_CONNECTION_ID,
    MODEL_KIND_CHAT,
    MODEL_KINDS,
    MODEL_SOURCE_BUILTIN,
    MODEL_SOURCE_OWNER,
    ModelConnection,
    ModelConnectionCompatibility,
)
from animama.domain.model_provider import AnimaModelUsage
from animama.logging import get_logger

from ..ports import (
    AnimaChatProfileRepository,
    ModelConnectionRepository,
    ModelProviderRepository,
    UnitOfWork,
    UserSettingsRepository,
)
from .model_role_resolver import ROLE_PREFERENCE_PATHS, role_preference

CREDENTIAL_MODE_NONE = "none"
CREDENTIAL_MODE_ENV = "env"
CREDENTIAL_MODE_MANAGED = "managed"
CREDENTIAL_MODES = frozenset({CREDENTIAL_MODE_NONE, CREDENTIAL_MODE_ENV, CREDENTIAL_MODE_MANAGED})

CHAT_COMPLETIONS_PROVIDER_TYPE = OPENAI_CHAT_COMPLETIONS_PROVIDER_TYPE
RESPONSES_PROVIDER_TYPE = OPENAI_RESPONSES_PROVIDER_TYPE

MODEL_ROLE_PREFERENCE_PATHS: tuple[tuple[str, str], ...] = tuple(ROLE_PREFERENCE_PATHS.values())
"""Preference keys that hold a catalog row id for an installation-wide model role."""

_MAX_NAME_LENGTH = 80
_MAX_MODEL_LENGTH = 256
_MAX_BASE_URL_LENGTH = 2048
_MIN_TIMEOUT_SECONDS = 1.0
_MAX_TIMEOUT_SECONDS = 1800.0


class ModelConfigurationError(Exception):
    """A rejected owner request with a stable ``code`` and HTTP ``status``."""

    def __init__(self, message: str, *, code: str, status: int = 400) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


@dataclass(frozen=True, slots=True)
class ModelUsage:
    """What would lose a model or connection that is being removed."""

    animas: tuple[AnimaModelUsage, ...] = ()
    roles: tuple[str, ...] = ()

    @property
    def in_use(self) -> bool:
        return bool(self.animas or self.roles)


class ModelInUseError(ModelConfigurationError):
    """Removal needs confirmation because Animas or roles use the target."""

    def __init__(self, usage: ModelUsage) -> None:
        super().__init__("The model is in use; confirm to remove it", code="model_in_use", status=409)
        self.usage = usage


@dataclass(frozen=True, slots=True)
class CredentialSetting:
    """How a connection gets its key: none, a named variable, or a managed desktop key."""

    mode: str = CREDENTIAL_MODE_NONE
    env: str | None = None


@dataclass(frozen=True, slots=True)
class ModelConnectionDraft:
    name: str
    preset: str
    base_url: str | None = None
    credential: CredentialSetting = field(default_factory=CredentialSetting)
    compatibility: ModelConnectionCompatibility | None = None
    timeout_seconds: float | None = None


@dataclass(frozen=True, slots=True)
class ModelConnectionPatch:
    """Changes to a connection; omitted fields keep their current values."""

    name: str | None = None
    preset: str | None = None
    base_url: str | None = None
    credential: CredentialSetting | None = None
    compatibility: ModelConnectionCompatibility | None = None
    timeout_seconds: float | None = None


@dataclass(frozen=True, slots=True)
class OwnerModelCapabilities:
    """Capabilities the owner confirms, usually prefilled by the probe or a template."""

    accepts_images: bool = False
    supports_streaming: bool = True
    structured_output_transport: str | None = STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
    supports_tools: bool = False
    tools_with_structured_output: bool = True
    supported_reasoning_efforts: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class OwnerModelDraft:
    model: str
    label: str | None = None
    kind: str = MODEL_KIND_CHAT
    provider_type: str | None = None
    template_id: str | None = None
    capabilities: OwnerModelCapabilities | None = None
    context_window_tokens: int | None = None
    allow_memory_writes: bool = True
    probe_result: dict[str, Any] | None = None


@dataclass(frozen=True, slots=True)
class OwnerModelPatch:
    """Changes to a row. Built-in rows accept only ``hidden``."""

    label: str | None = None
    capabilities: OwnerModelCapabilities | None = None
    context_window_tokens: int | None = None
    clear_context_window: bool = False
    allow_memory_writes: bool | None = None
    probe_result: dict[str, Any] | None = None
    hidden: bool | None = None


def normalize_base_url(value: str | None) -> str:
    """Validate an OpenAI-compatible base URL and drop a trailing slash."""

    raw = (value or "").strip()
    if not raw or len(raw) > _MAX_BASE_URL_LENGTH:
        raise ModelConfigurationError("A base URL is required", code="invalid_base_url")
    try:
        parts = urlsplit(raw)
        parts.port  # noqa: B018 - validates the port range and digits
    except ValueError as exc:
        raise ModelConfigurationError("The base URL is not a valid URL", code="invalid_base_url") from exc
    if parts.scheme not in {"http", "https"} or not parts.hostname:
        raise ModelConfigurationError("The base URL must be an http or https URL", code="invalid_base_url")
    if parts.username or parts.password or parts.query or parts.fragment:
        raise ModelConfigurationError(
            "The base URL must not contain credentials, a query or a fragment", code="invalid_base_url"
        )
    return raw.rstrip("/")


class ModelConfigurationService:
    """Create, change and retire model connections and owner-added models."""

    def __init__(
        self,
        *,
        connections: ModelConnectionRepository,
        model_providers: ModelProviderRepository,
        profiles: AnimaChatProfileRepository,
        user_settings: UserSettingsRepository,
        uow: UnitOfWork,
        connection_id_factory: Callable[[], str] | None = None,
        model_id_factory: Callable[[], str] | None = None,
    ) -> None:
        self._connections = connections
        self._model_providers = model_providers
        self._profiles = profiles
        self._user_settings = user_settings
        self._uow = uow
        self._new_connection_id = connection_id_factory or (lambda: f"c_{uuid.uuid4().hex[:12]}")
        self._new_model_id = model_id_factory or (lambda: f"owner:{uuid.uuid4().hex}")
        self._log = get_logger("app.services.model_configuration")

    # ---------------------------------------------------------------- connections

    async def list_connections(self) -> list[ModelConnection]:
        return [connection for connection in await self._connections.list_all() if connection.active]

    async def get_connection(self, connection_id: str) -> ModelConnection:
        connection = await self._connections.get(connection_id)
        if connection is None or not connection.active:
            raise ModelConfigurationError("Model connection not found", code="connection_not_found", status=404)
        return connection

    async def create_connection(self, draft: ModelConnectionDraft) -> ModelConnection:
        connection_id = self._new_connection_id()
        connection = self._connection_from_draft(connection_id, draft)
        stored = await self._connections.upsert(connection)
        await self._uow.commit()
        self._log.info("Model connection created", connection_id=stored.id, preset=stored.preset)
        return stored

    async def update_connection(self, connection_id: str, patch: ModelConnectionPatch) -> ModelConnection:
        current = await self.get_connection(connection_id)
        if current.source == MODEL_SOURCE_BUILTIN:
            raise ModelConfigurationError(
                "The built-in OpenAI connection is configured by the environment", code="connection_read_only"
            )
        draft = ModelConnectionDraft(
            name=patch.name if patch.name is not None else current.name,
            preset=patch.preset or current.preset,
            base_url=patch.base_url if patch.base_url is not None else current.base_url,
            credential=patch.credential if patch.credential is not None else _credential_setting(current),
            compatibility=patch.compatibility or current.compatibility,
            timeout_seconds=patch.timeout_seconds if patch.timeout_seconds is not None else current.timeout_seconds,
        )
        updated = self._connection_from_draft(connection_id, draft)
        stored = await self._connections.upsert(replace(updated, created_at=current.created_at))
        await self._uow.commit()
        return stored

    async def remove_connection(self, connection_id: str, *, owner_id: str, confirm: bool) -> ModelUsage:
        connection = await self.get_connection(connection_id)
        if connection.source == MODEL_SOURCE_BUILTIN:
            raise ModelConfigurationError(
                "The built-in OpenAI connection cannot be removed", code="connection_read_only"
            )
        rows = await self._model_providers.list_for_connection(connection_id)
        usage = await self._usage(owner_id, tuple(row.id for row in rows))
        if usage.in_use and not confirm:
            raise ModelInUseError(usage)
        await self._retire_rows(rows)
        await self._clear_roles(owner_id, {row.id for row in rows})
        await self._connections.upsert(replace(connection, active=False))
        await self._uow.commit()
        self._log.info("Model connection removed", connection_id=connection_id, model_count=len(rows))
        return usage

    def _connection_from_draft(self, connection_id: str, draft: ModelConnectionDraft) -> ModelConnection:
        name = draft.name.strip()
        if not name or len(name) > _MAX_NAME_LENGTH:
            raise ModelConfigurationError("A connection name of up to 80 characters is required", code="invalid_name")
        preset = MODEL_CONNECTION_PRESETS.get(draft.preset)
        if preset is None or not preset.owner_selectable:
            raise ModelConfigurationError(f"Unknown connection preset: {draft.preset}", code="invalid_preset")
        timeout = draft.timeout_seconds if draft.timeout_seconds is not None else preset.timeout_seconds
        if not _MIN_TIMEOUT_SECONDS <= timeout <= _MAX_TIMEOUT_SECONDS:
            raise ModelConfigurationError("The timeout must be between 1 and 1800 seconds", code="invalid_timeout")
        return ModelConnection(
            id=connection_id,
            name=name,
            preset=preset.id,
            source=MODEL_SOURCE_OWNER,
            base_url=normalize_base_url(draft.base_url),
            credential_env=_credential_env(connection_id, draft.credential),
            compatibility=draft.compatibility or preset.compatibility,
            timeout_seconds=timeout,
        )

    # --------------------------------------------------------------------- models

    async def list_models(self, connection_id: str) -> list[ModelProvider]:
        await self.get_connection(connection_id)
        return await self._model_providers.list_for_connection(connection_id)

    async def add_model(self, connection_id: str, draft: OwnerModelDraft) -> ModelProvider:
        connection = await self.get_connection(connection_id)
        model = draft.model.strip()
        if not model or len(model) > _MAX_MODEL_LENGTH:
            raise ModelConfigurationError("A model id of up to 256 characters is required", code="invalid_model")
        if draft.kind not in MODEL_KINDS:
            raise ModelConfigurationError(f"Unknown model kind: {draft.kind}", code="invalid_model_kind")
        template = await self._template(draft.template_id)
        if template is not None and draft.kind != MODEL_KIND_CHAT:
            raise ModelConfigurationError("Templates describe chat models only", code="invalid_template")
        provider_type = _provider_type(connection, draft, template)
        existing = await self._model_providers.get_owner_row(connection.id, provider_type, model)
        row = ModelProvider(
            id=existing.id if existing is not None else self._new_model_id(),
            model=model,
            provider_type=provider_type,
            model_label=(draft.label or "").strip() or model,
            provider_label=connection.name,
            logo_provider=model_connection_preset(connection.preset).logo_provider,
            model_type=template.model_type if template is not None else None,
            context_window_tokens=_context_window(draft.context_window_tokens, template, connection=connection),
            max_output_tokens=(
                template.max_output_tokens if template is not None and connection.is_builtin_openai else None
            ),
            connection_id=connection.id,
            source=MODEL_SOURCE_OWNER,
            model_kind=draft.kind,
            hidden=False,
            allow_memory_writes=draft.allow_memory_writes,
            probe_result=probe_result_summary(draft.probe_result),
            active=True,
            capabilities=_capabilities(draft, template, provider_type=provider_type),
            pricing=ModelProviderPricing(pricing_status="unpriced", pricing_source_provider=connection.preset),
            metadata={"template_id": template.id} if template is not None else {},
            created_at=existing.created_at if existing is not None else None,
        )
        (stored,) = await self._model_providers.upsert_many([row])
        await self._uow.commit()
        self._log.info(
            "Owner model added",
            model_provider_id=stored.id,
            connection_id=connection.id,
            reactivated=existing is not None,
        )
        return stored

    async def update_model(self, model_provider_id: str, patch: OwnerModelPatch) -> ModelProvider:
        row = await self._active_row(model_provider_id)
        if row.source == MODEL_SOURCE_BUILTIN:
            if patch.hidden is None or any(
                value is not None
                for value in (
                    patch.label,
                    patch.capabilities,
                    patch.context_window_tokens,
                    patch.allow_memory_writes,
                    patch.probe_result,
                )
            ):
                raise ModelConfigurationError("Built-in models can only be hidden or shown", code="model_read_only")
            stored_builtin = await self._model_providers.set_hidden(row.id, hidden=patch.hidden)
            await self._uow.commit()
            return stored_builtin or row
        updated = replace(
            row,
            model_label=(patch.label.strip() or row.model) if patch.label is not None else row.model_label,
            capabilities=(
                _owner_capabilities(
                    patch.capabilities,
                    kind=row.model_kind,
                    native_tool_support=row.capabilities.native_tool_support,
                )
                if patch.capabilities is not None
                else row.capabilities
            ),
            context_window_tokens=(
                None
                if patch.clear_context_window
                else _validated_context_window(patch.context_window_tokens) or row.context_window_tokens
            ),
            allow_memory_writes=(
                patch.allow_memory_writes if patch.allow_memory_writes is not None else row.allow_memory_writes
            ),
            probe_result=(
                probe_result_summary(patch.probe_result) if patch.probe_result is not None else row.probe_result
            ),
            hidden=patch.hidden if patch.hidden is not None else row.hidden,
        )
        (stored,) = await self._model_providers.upsert_many([updated])
        await self._uow.commit()
        return stored

    async def remove_model(self, model_provider_id: str, *, owner_id: str, confirm: bool) -> ModelUsage:
        row = await self._active_row(model_provider_id)
        if row.source == MODEL_SOURCE_BUILTIN:
            raise ModelConfigurationError("Built-in models can be hidden but not removed", code="model_read_only")
        usage = await self._usage(owner_id, (row.id,))
        if usage.in_use and not confirm:
            raise ModelInUseError(usage)
        await self._retire_rows([row])
        await self._clear_roles(owner_id, {row.id})
        await self._uow.commit()
        self._log.info("Owner model removed", model_provider_id=row.id)
        return usage

    async def _active_row(self, model_provider_id: str) -> ModelProvider:
        row = await self._model_providers.get(model_provider_id)
        if row is None or not row.active:
            raise ModelConfigurationError("Model not found", code="model_not_found", status=404)
        return row

    async def _template(self, template_id: str | None) -> ModelProvider | None:
        if not template_id:
            return None
        template = await self._model_providers.get(template_id)
        if template is None or template.source != MODEL_SOURCE_BUILTIN or template.model_kind != MODEL_KIND_CHAT:
            raise ModelConfigurationError("Templates must be built-in chat models", code="invalid_template")
        return template

    async def _retire_rows(self, rows: list[ModelProvider]) -> None:
        now = datetime.now(UTC).replace(tzinfo=None)
        retired = [replace(row, active=False, deprecated_at=row.deprecated_at or now) for row in rows if row.active]
        if retired:
            await self._model_providers.upsert_many(retired)

    async def _usage(self, owner_id: str, model_provider_ids: tuple[str, ...]) -> ModelUsage:
        animas = await self._profiles.list_owned_for_models(owner_id=owner_id, model_provider_ids=model_provider_ids)
        settings = await self._user_settings.get(owner_id)
        preferences = settings.preferences if settings is not None else {}
        roles = tuple(
            f"{section}.{key}"
            for section, key in MODEL_ROLE_PREFERENCE_PATHS
            if role_preference(preferences, section, key) in model_provider_ids
        )
        return ModelUsage(animas=tuple(animas), roles=roles)

    async def _clear_roles(self, owner_id: str, model_provider_ids: set[str]) -> None:
        """Clear role preferences that name retired rows so roles use their defaults."""

        settings = await self._user_settings.get(owner_id)
        if settings is None:
            return
        preferences = dict(settings.preferences)
        changed = False
        for section, key in MODEL_ROLE_PREFERENCE_PATHS:
            if role_preference(preferences, section, key) in model_provider_ids:
                section_values = dict(preferences.get(section) or {})
                section_values.pop(key, None)
                preferences[section] = section_values
                changed = True
        if changed:
            await self._user_settings.upsert(replace(settings, preferences=preferences))


def _credential_setting(connection: ModelConnection) -> CredentialSetting:
    if connection.credential_env is None:
        return CredentialSetting()
    try:
        managed = managed_credential_env(connection.id)
    except ValueError:
        managed = None
    if connection.credential_env == managed:
        return CredentialSetting(mode=CREDENTIAL_MODE_MANAGED)
    return CredentialSetting(mode=CREDENTIAL_MODE_ENV, env=connection.credential_env)


def _credential_env(connection_id: str, credential: CredentialSetting) -> str | None:
    if credential.mode not in CREDENTIAL_MODES:
        raise ModelConfigurationError(f"Unknown credential mode: {credential.mode}", code="invalid_credential")
    if credential.mode == CREDENTIAL_MODE_NONE:
        return None
    if credential.mode == CREDENTIAL_MODE_MANAGED:
        return managed_credential_env(connection_id)
    name = (credential.env or "").strip()
    if not is_allowed_credential_env(name):
        raise ModelConfigurationError(
            "Key variables must be OPENAI_API_KEY, DEEPSEEK_API_KEY, HF_TOKEN or match "
            "ANIMAMA_CONNECTION_<NAME>_API_KEY",
            code="invalid_credential",
        )
    return name


def _provider_type(connection: ModelConnection, draft: OwnerModelDraft, template: ModelProvider | None) -> str:
    requested = draft.provider_type or (template.provider_type if template is not None else None)
    provider_type = requested or CHAT_COMPLETIONS_PROVIDER_TYPE
    if provider_type not in {CHAT_COMPLETIONS_PROVIDER_TYPE, RESPONSES_PROVIDER_TYPE}:
        raise ModelConfigurationError(f"Unknown provider type: {provider_type}", code="invalid_provider_type")
    if provider_type == RESPONSES_PROVIDER_TYPE and connection.id != BUILTIN_OPENAI_CONNECTION_ID:
        if draft.provider_type == RESPONSES_PROVIDER_TYPE:
            raise ModelConfigurationError(
                "OpenAI Responses models are only available on the built-in OpenAI connection",
                code="invalid_provider_type",
            )
        # A Responses template still describes the model's capabilities; other
        # connections serve it through Chat Completions.
        provider_type = CHAT_COMPLETIONS_PROVIDER_TYPE
    if draft.kind != MODEL_KIND_CHAT and provider_type != CHAT_COMPLETIONS_PROVIDER_TYPE:
        raise ModelConfigurationError("Embedding models use the Chat Completions API family", code="invalid_model_kind")
    return provider_type


def _capabilities(
    draft: OwnerModelDraft,
    template: ModelProvider | None,
    *,
    provider_type: str,
) -> ModelProviderCapabilities:
    if draft.capabilities is not None or template is None:
        native_tools = (
            template.capabilities.native_tool_support
            if template is not None and provider_type == RESPONSES_PROVIDER_TYPE
            else None
        )
        return _owner_capabilities(
            draft.capabilities or OwnerModelCapabilities(), kind=draft.kind, native_tool_support=native_tools
        )
    copied = replace(template.capabilities)
    if provider_type != RESPONSES_PROVIDER_TYPE:
        # Native tools are Responses features; Chat Completions rows never advertise them.
        copied.native_tool_support = None
    return copied


def _owner_capabilities(
    capabilities: OwnerModelCapabilities,
    *,
    kind: str,
    native_tool_support: list[str] | None = None,
) -> ModelProviderCapabilities:
    """Build capabilities from owner-confirmed values.

    Native tools are not owner-editable: they come from a Responses template and
    are kept when the owner edits other capabilities.
    """

    if kind != MODEL_KIND_CHAT:
        return ModelProviderCapabilities(accepts=["text"], produces=["embedding"])
    transport = capabilities.structured_output_transport
    if transport not in {None, STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA, STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT}:
        raise ModelConfigurationError(f"Unknown structured output mode: {transport}", code="invalid_capabilities")
    efforts = [effort for effort in REASONING_EFFORT_ORDER if effort in set(capabilities.supported_reasoning_efforts)]
    unknown = set(capabilities.supported_reasoning_efforts).difference(REASONING_EFFORT_ORDER)
    if unknown:
        raise ModelConfigurationError(
            f"Unknown reasoning efforts: {', '.join(sorted(unknown))}", code="invalid_capabilities"
        )
    return ModelProviderCapabilities(
        accepts=["image", "text"] if capabilities.accepts_images else ["text"],
        produces=["text"],
        supports_developer_role=True,
        supports_tools=capabilities.supports_tools,
        supports_streaming=capabilities.supports_streaming,
        structured_kinds=[MAIN_STRUCTURED_RESPONSE_KIND] if transport else [],
        structured_output_transport=transport,
        supports_reasoning=bool(efforts) or None,
        supported_reasoning_efforts=efforts or None,
        native_tool_support=native_tool_support,
        tools_with_structured_output=capabilities.tools_with_structured_output,
    )


def _context_window(value: int | None, template: ModelProvider | None, *, connection: ModelConnection) -> int | None:
    """Use the owner's value; a template's window applies only to the same OpenAI model family.

    Another server serves its own window, so the probe or the owner supplies it.
    """

    validated = _validated_context_window(value)
    if validated is not None:
        return validated
    if template is not None and connection.is_builtin_openai:
        return template.context_window_tokens
    return None


def _validated_context_window(value: int | None) -> int | None:
    if value is None:
        return None
    if value < 512 or value > 10_000_000:
        raise ModelConfigurationError(
            "The context window must be between 512 and 10,000,000 tokens", code="invalid_context_window"
        )
    return value


_PROBE_SUMMARY_FIELDS = (
    "model",
    "supports_streaming",
    "structured_output_transport",
    "supports_tools",
    "tools_with_structured_output",
    "context_window_tokens",
    "embedding_dimensions",
)


def probe_result_summary(report: dict[str, Any] | None) -> dict[str, Any] | None:
    """Keep what a saved probe needs: its findings and each step's name, result and category.

    Step details and notes can quote the model server's own error text, which may
    echo a credential, so they are never stored.
    """

    if report is None:
        return None
    summary: dict[str, Any] = {}
    for name in _PROBE_SUMMARY_FIELDS:
        value = report.get(name)
        if isinstance(value, bool | int) or (isinstance(value, str) and len(value) <= 256):
            summary[name] = value
    steps = report.get("steps")
    if isinstance(steps, list):
        summary["steps"] = [
            {
                "name": str(step.get("name"))[:64],
                "ok": step.get("ok") is True,
                "category": str(step["category"])[:64] if isinstance(step.get("category"), str) else None,
            }
            for step in steps[:32]
            if isinstance(step, dict)
        ]
    return summary


__all__ = [
    "CREDENTIAL_MODES",
    "CREDENTIAL_MODE_ENV",
    "CREDENTIAL_MODE_MANAGED",
    "CREDENTIAL_MODE_NONE",
    "MODEL_ROLE_PREFERENCE_PATHS",
    "CredentialSetting",
    "ModelConfigurationError",
    "ModelConfigurationService",
    "ModelConnectionDraft",
    "ModelConnectionPatch",
    "ModelInUseError",
    "ModelUsage",
    "OwnerModelCapabilities",
    "OwnerModelDraft",
    "OwnerModelPatch",
    "normalize_base_url",
    "probe_result_summary",
]
