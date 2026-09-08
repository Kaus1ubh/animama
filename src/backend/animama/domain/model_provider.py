from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from typing import Any


@dataclass(slots=True)
class ModelProviderCapabilities:
    """Provider/model capability metadata used for selection and compatibility."""

    accepts: list[str] = field(default_factory=list)
    produces: list[str] = field(default_factory=list)
    supports_developer_role: bool = True
    supports_tools: bool = False
    supports_streaming: bool = False
    structured_kinds: list[str] = field(default_factory=list)
    structured_output_transport: str | None = None
    supports_reasoning: bool | None = None
    supported_reasoning_efforts: list[str] | None = None
    native_tool_support: list[str] | None = None


@dataclass(slots=True)
class ModelProviderPricing:
    """Backend-internal pricing and rate-card source metadata for a catalog row."""

    pricing_status: str = "unpriced"
    pricing_source_provider: str | None = None
    pricing_source_model: str | None = None
    pricing_source_url: str | None = None
    pricing_source_checked_at: date | None = None
    currency: str | None = None
    billing_unit: str | None = None
    service_tiers_supported: list[str] = field(default_factory=list)
    standard_input_price_per_million: Decimal | None = None
    standard_cached_input_price_per_million: Decimal | None = None
    standard_output_price_per_million: Decimal | None = None
    batch_input_price_per_million: Decimal | None = None
    batch_cached_input_price_per_million: Decimal | None = None
    batch_output_price_per_million: Decimal | None = None
    flex_input_price_per_million: Decimal | None = None
    flex_cached_input_price_per_million: Decimal | None = None
    flex_output_price_per_million: Decimal | None = None
    priority_input_price_per_million: Decimal | None = None
    priority_cached_input_price_per_million: Decimal | None = None
    priority_output_price_per_million: Decimal | None = None
    long_context_token_threshold: int | None = None
    standard_long_context_input_price_per_million: Decimal | None = None
    standard_long_context_cached_input_price_per_million: Decimal | None = None
    standard_long_context_output_price_per_million: Decimal | None = None
    batch_long_context_input_price_per_million: Decimal | None = None
    batch_long_context_cached_input_price_per_million: Decimal | None = None
    batch_long_context_output_price_per_million: Decimal | None = None
    flex_long_context_input_price_per_million: Decimal | None = None
    flex_long_context_cached_input_price_per_million: Decimal | None = None
    flex_long_context_output_price_per_million: Decimal | None = None
    priority_long_context_input_price_per_million: Decimal | None = None
    priority_long_context_cached_input_price_per_million: Decimal | None = None
    priority_long_context_output_price_per_million: Decimal | None = None
    regional_processing_uplift_factor: Decimal | None = None
    pricing_notes: list[str] = field(default_factory=list)


@dataclass(slots=True)
class ModelProvider:
    """Durable provider/model catalog row without leaking pricing into runtime Agent."""

    id: str
    model: str
    provider_type: str
    model_label: str
    provider_label: str
    logo_provider: str | None = None
    model_type: str | None = None
    current_snapshot: str | None = None
    context_window_tokens: int | None = None
    max_output_tokens: int | None = None
    provider_base_url: str | None = None
    api_family: str | None = None
    active: bool = True
    deprecated_at: datetime | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    capabilities: ModelProviderCapabilities = field(default_factory=ModelProviderCapabilities)
    pricing: ModelProviderPricing = field(default_factory=ModelProviderPricing)
    metadata: dict[str, Any] = field(default_factory=dict)


__all__ = [
    "ModelProviderCapabilities",
    "ModelProvider",
    "ModelProviderPricing",
]
