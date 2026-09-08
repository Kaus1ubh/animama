from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
from decimal import Decimal
from typing import Any

from animama.domain import ModelProvider, ModelProviderCapabilities, ModelProviderPricing
from animama.orm import ORMModelProvider

_ENTRY_FIELD_NAMES = (
    "id",
    "model",
    "provider_type",
    "model_label",
    "provider_label",
    "logo_provider",
    "model_type",
    "current_snapshot",
    "context_window_tokens",
    "max_output_tokens",
    "provider_base_url",
    "api_family",
    "active",
    "deprecated_at",
    "created_at",
    "updated_at",
    "metadata",
)
_READONLY_FIELD_NAMES = {"created_at", "updated_at"}
_CAPABILITY_FIELD_NAMES = (
    "accepts",
    "produces",
    "supports_developer_role",
    "supports_tools",
    "supports_streaming",
    "structured_kinds",
    "structured_output_transport",
    "supports_reasoning",
    "supported_reasoning_efforts",
    "native_tool_support",
)
_PRICING_FIELD_NAMES = (
    "pricing_status",
    "pricing_source_provider",
    "pricing_source_model",
    "pricing_source_url",
    "pricing_source_checked_at",
    "currency",
    "billing_unit",
    "service_tiers_supported",
    "standard_input_price_per_million",
    "standard_cached_input_price_per_million",
    "standard_output_price_per_million",
    "batch_input_price_per_million",
    "batch_cached_input_price_per_million",
    "batch_output_price_per_million",
    "flex_input_price_per_million",
    "flex_cached_input_price_per_million",
    "flex_output_price_per_million",
    "priority_input_price_per_million",
    "priority_cached_input_price_per_million",
    "priority_output_price_per_million",
    "long_context_token_threshold",
    "standard_long_context_input_price_per_million",
    "standard_long_context_cached_input_price_per_million",
    "standard_long_context_output_price_per_million",
    "batch_long_context_input_price_per_million",
    "batch_long_context_cached_input_price_per_million",
    "batch_long_context_output_price_per_million",
    "flex_long_context_input_price_per_million",
    "flex_long_context_cached_input_price_per_million",
    "flex_long_context_output_price_per_million",
    "priority_long_context_input_price_per_million",
    "priority_long_context_cached_input_price_per_million",
    "priority_long_context_output_price_per_million",
    "regional_processing_uplift_factor",
    "pricing_notes",
)
_DECIMAL_FIELD_NAMES = {
    "standard_input_price_per_million",
    "standard_cached_input_price_per_million",
    "standard_output_price_per_million",
    "batch_input_price_per_million",
    "batch_cached_input_price_per_million",
    "batch_output_price_per_million",
    "flex_input_price_per_million",
    "flex_cached_input_price_per_million",
    "flex_output_price_per_million",
    "priority_input_price_per_million",
    "priority_cached_input_price_per_million",
    "priority_output_price_per_million",
    "standard_long_context_input_price_per_million",
    "standard_long_context_cached_input_price_per_million",
    "standard_long_context_output_price_per_million",
    "batch_long_context_input_price_per_million",
    "batch_long_context_cached_input_price_per_million",
    "batch_long_context_output_price_per_million",
    "flex_long_context_input_price_per_million",
    "flex_long_context_cached_input_price_per_million",
    "flex_long_context_output_price_per_million",
    "priority_long_context_input_price_per_million",
    "priority_long_context_cached_input_price_per_million",
    "priority_long_context_output_price_per_million",
    "regional_processing_uplift_factor",
}
_LIST_FIELD_NAMES = {
    "service_tiers_supported",
    "accepts",
    "produces",
    "structured_kinds",
    "supported_reasoning_efforts",
    "native_tool_support",
    "pricing_notes",
}


def _decimal_or_none(value: Any) -> Decimal | None:
    if value is None:
        return None
    if isinstance(value, Decimal):
        return value
    raw = str(value).strip()
    return Decimal(raw) if raw else None


def _date_or_none(value: Any) -> date | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    raw = str(value).strip()
    return date.fromisoformat(raw) if raw else None


def _datetime_or_none(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    raw = str(value).strip()
    return datetime.fromisoformat(raw) if raw else None


def _list_or_none(value: Any) -> list[str] | None:
    if value is None:
        return None
    return [str(item) for item in value]


def _coerce_field(name: str, value: Any) -> Any:
    if name in _DECIMAL_FIELD_NAMES:
        return _decimal_or_none(value)
    if name == "pricing_source_checked_at":
        return _date_or_none(value)
    if name in {"deprecated_at", "created_at", "updated_at"}:
        return _datetime_or_none(value)
    if name in _LIST_FIELD_NAMES:
        return _list_or_none(value)
    if name == "metadata":
        return dict(value or {})
    return value


def _copy_value(value: Any) -> Any:
    if isinstance(value, list):
        return list(value)
    if isinstance(value, dict):
        return dict(value)
    return value


def _row_values(row: Mapping[str, Any], field_names: tuple[str, ...]) -> dict[str, Any]:
    return {name: _coerce_field(name, row.get(name)) for name in field_names if name in row}


def model_provider_registry_row_to_domain(row: Mapping[str, Any]) -> ModelProvider:
    """Map a serialized registry row into the durable catalog-entry shape."""

    return ModelProvider(
        **_row_values(row, _ENTRY_FIELD_NAMES),
        capabilities=ModelProviderCapabilities(**_row_values(row, _CAPABILITY_FIELD_NAMES)),
        pricing=ModelProviderPricing(**_row_values(row, _PRICING_FIELD_NAMES)),
    )


def _apply_value(target: dict[str, Any], name: str, value: Any) -> None:
    if name == "metadata":
        target["metadata_"] = dict(value or {})
    else:
        target[name] = _copy_value(value)


def _flat_domain_values(model_provider: ModelProvider) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for name in _ENTRY_FIELD_NAMES:
        if name in _READONLY_FIELD_NAMES:
            continue
        _apply_value(values, name, getattr(model_provider, name))
    for name in _CAPABILITY_FIELD_NAMES:
        values[name] = _copy_value(getattr(model_provider.capabilities, name))
    for name in _PRICING_FIELD_NAMES:
        values[name] = _copy_value(getattr(model_provider.pricing, name))
    return values


def model_provider_domain_to_orm(model_provider: ModelProvider) -> ORMModelProvider:
    """Create an ORM row from a nested domain catalog entry."""

    return ORMModelProvider(**_flat_domain_values(model_provider))


def apply_model_provider_to_orm(
    orm: ORMModelProvider,
    model_provider: ModelProvider,
) -> ORMModelProvider:
    """Update an ORM row in place from a nested domain catalog entry."""

    for name, value in _flat_domain_values(model_provider).items():
        setattr(orm, name, value)
    return orm


def _orm_values(orm: ORMModelProvider, field_names: tuple[str, ...]) -> dict[str, Any]:
    values: dict[str, Any] = {}
    for name in field_names:
        if name == "metadata":
            values[name] = dict(orm.metadata_ or {})
        else:
            values[name] = _copy_value(getattr(orm, name))
    return values


def model_provider_orm_to_domain(orm: ORMModelProvider) -> ModelProvider:
    """Map an ORM catalog row into the framework-free nested domain type."""

    entry_values = _orm_values(orm, _ENTRY_FIELD_NAMES)
    return ModelProvider(
        **entry_values,
        capabilities=ModelProviderCapabilities(**_orm_values(orm, _CAPABILITY_FIELD_NAMES)),
        pricing=ModelProviderPricing(**_orm_values(orm, _PRICING_FIELD_NAMES)),
    )


def _chat_api_standard_fields(model_provider: ModelProvider) -> dict[str, str | None]:
    from animama.app.chat.api_standard import chat_api_standard_for_provider

    profile = chat_api_standard_for_provider(model_provider)
    return {
        "model_client": profile.model_client if profile is not None else None,
        "api_standard": profile.api_standard if profile is not None else None,
    }


def model_provider_domain_to_public_catalog_row(model_provider: ModelProvider) -> dict[str, Any]:
    """Return the public `/v1/model-providers` row without internal pricing fields."""

    capabilities = model_provider.capabilities
    row: dict[str, Any] = {
        "id": model_provider.id,
        "model": model_provider.model,
        "model_provider": model_provider.provider_type,
        "model_label": model_provider.model_label,
        "provider_label": model_provider.provider_label,
        "logo_provider": model_provider.logo_provider,
        **_chat_api_standard_fields(model_provider),
        "accepts": list(capabilities.accepts),
        "produces": list(capabilities.produces),
        "supports_developer_role": bool(capabilities.supports_developer_role),
        "supports_tools": bool(capabilities.supports_tools),
        "supports_streaming": bool(capabilities.supports_streaming),
    }
    if capabilities.supports_reasoning is not None:
        row["supports_reasoning"] = bool(capabilities.supports_reasoning)
    if capabilities.supported_reasoning_efforts is not None:
        row["supported_reasoning_efforts"] = list(capabilities.supported_reasoning_efforts)
    if capabilities.native_tool_support is not None:
        row["native_tool_support"] = list(capabilities.native_tool_support)
    return row


__all__ = [
    "apply_model_provider_to_orm",
    "model_provider_domain_to_orm",
    "model_provider_domain_to_public_catalog_row",
    "model_provider_orm_to_domain",
    "model_provider_registry_row_to_domain",
]
