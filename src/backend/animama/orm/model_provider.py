from __future__ import annotations

from datetime import date, datetime
from decimal import Decimal
from typing import Any

from sqlalchemy import (
    JSON,
    TIMESTAMP,
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from .mixins import TimestampMixin
from .sqlalchemy_base import SqlalchemyBase


class ORMModelProvider(SqlalchemyBase, TimestampMixin):
    """Provider/model catalog row with token pricing metadata.

    Rows belong to one model connection. Built-in rows are release-managed and
    reseeded; owner rows are never touched by the seed. Rows are retired with
    ``active = false`` instead of deleted because chat profiles reference them.
    """

    __tablename__ = "model_providers"
    __table_args__ = (
        # Source is part of the key so a release can add a built-in row that an
        # owner already added under the same connection without a seed conflict.
        UniqueConstraint(
            "connection_id", "provider_type", "model", "source", name="uq_model_providers_connection_model"
        ),
        CheckConstraint("source IN ('builtin', 'owner')", name="source_valid"),
        CheckConstraint("model_kind IN ('chat', 'embedding')", name="model_kind_valid"),
    )

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
    connection_id: Mapped[str] = mapped_column(
        String, ForeignKey("model_connections.id"), nullable=False, default="openai", server_default="openai"
    )
    source: Mapped[str] = mapped_column(String, nullable=False, default="builtin", server_default="builtin")
    model_kind: Mapped[str] = mapped_column(String, nullable=False, default="chat", server_default="chat")
    hidden: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="false")
    # The owner's Compact early choice; applies only to rows with a long-context price step.
    early_compaction: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    allow_memory_writes: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, server_default="true")
    probe_result: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
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
    tools_with_structured_output: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=True, server_default="true"
    )

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
