from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import JSON, TIMESTAMP, Boolean, Date, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMModelProvider(SqlalchemyBase, TimestampMixin):
    """Supported provider/model catalog row with token pricing metadata."""

    __tablename__ = "model_providers"
    __table_args__ = (UniqueConstraint("provider_type", "model", name="uq_model_providers_provider_type_model"),)

    id: Mapped[str] = mapped_column(String, primary_key=True)
    model: Mapped[str] = mapped_column(String, nullable=False)
    provider_type: Mapped[str] = mapped_column(String, nullable=False)
    model_label: Mapped[str] = mapped_column(String, nullable=False)
    provider_label: Mapped[str] = mapped_column(String, nullable=False)
    logo_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    model_type: Mapped[str | None] = mapped_column(String, nullable=True)
    current_snapshot: Mapped[str | None] = mapped_column(String, nullable=True)
    context_window_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_output_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    provider_base_url: Mapped[str | None] = mapped_column(String, nullable=True)
    api_family: Mapped[str | None] = mapped_column(String, nullable=True)
    service_tiers_supported: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    deprecated_at: Mapped[datetime | None] = mapped_column(TIMESTAMP(timezone=False), nullable=True)

    accepts: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    produces: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    supports_developer_role: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    supports_tools: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supports_streaming: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    structured_kinds: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    structured_output_transport: Mapped[str | None] = mapped_column(String, nullable=True)
    supports_reasoning: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    supported_reasoning_efforts: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    native_tool_support: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)

    pricing_status: Mapped[str] = mapped_column(String, nullable=False, default="unpriced")
    pricing_source_provider: Mapped[str | None] = mapped_column(String, nullable=True)
    pricing_source_model: Mapped[str | None] = mapped_column(String, nullable=True)
    pricing_source_url: Mapped[str | None] = mapped_column(String, nullable=True)
    pricing_source_checked_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    currency: Mapped[str | None] = mapped_column(String, nullable=True)
    billing_unit: Mapped[str | None] = mapped_column(String, nullable=True)

    standard_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    standard_cached_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    standard_output_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    batch_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    batch_cached_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    batch_output_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    flex_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    flex_cached_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    flex_output_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    priority_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    priority_cached_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    priority_output_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)

    long_context_token_threshold: Mapped[int | None] = mapped_column(Integer, nullable=True)
    standard_long_context_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    standard_long_context_cached_input_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 6), nullable=True
    )
    standard_long_context_output_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 6), nullable=True
    )
    batch_long_context_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    batch_long_context_cached_input_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 6), nullable=True
    )
    batch_long_context_output_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    flex_long_context_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    flex_long_context_cached_input_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 6), nullable=True
    )
    flex_long_context_output_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    priority_long_context_input_price_per_million: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    priority_long_context_cached_input_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 6), nullable=True
    )
    priority_long_context_output_price_per_million: Mapped[Decimal | None] = mapped_column(
        Numeric(12, 6), nullable=True
    )

    regional_processing_uplift_factor: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    pricing_notes: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    metadata_: Mapped[dict[str, Any]] = mapped_column("metadata", JSON, nullable=False, default=dict)


ModelProvider = ORMModelProvider

__all__ = ["ORMModelProvider", "ModelProvider"]
