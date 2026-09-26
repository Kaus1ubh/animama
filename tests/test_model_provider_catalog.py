from __future__ import annotations

import json
from datetime import date
from decimal import Decimal
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import Numeric, String, UniqueConstraint, delete, func, select, update

from animama.adapters.mappers.model_provider_map import model_provider_domain_to_public_catalog_row
from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.model_catalog import (
    MODEL_CATALOG,
    STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
    serialize_builtin_model_connections,
    serialize_model_catalog,
    serialize_model_provider_catalog,
    structured_output_transport,
)
from animama.app.services.model_provider_catalog_service import ModelProviderCatalogService
from animama.domain import ModelProvider, ModelProviderCapabilities, ModelProviderPricing
from animama.orm import ORMAnimaChatProfile, ORMChatMessage, ORMModelProvider
from animama.orm.base import Base

PRICE_COLUMNS = (
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
)
SEED_SQL_PATH = Path("alembic/seeds/01-seed-model-providers.sql")
SEED_COLUMNS = (
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
    "connection_id",
    "source",
    "model_kind",
    "service_tiers_supported",
    "active",
    "deprecated_at",
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
    "pricing_status",
    "pricing_source_provider",
    "pricing_source_model",
    "pricing_source_url",
    "pricing_source_checked_at",
    "currency",
    "billing_unit",
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
    "metadata",
)
CONNECTION_SEED_COLUMNS = (
    "id",
    "source",
    "name",
    "preset",
    "base_url",
    "credential_env",
    "compatibility",
    "timeout_seconds",
    "active",
)
SEED_JSONB_COLUMNS = {"compatibility"}
SEED_JSON_COLUMNS = {
    "service_tiers_supported",
    "accepts",
    "produces",
    "structured_kinds",
    "supported_reasoning_efforts",
    "native_tool_support",
    "pricing_notes",
    "metadata",
}


async def _clear_model_provider_rows(session) -> None:
    await session.execute(delete(ORMAnimaChatProfile))
    await session.execute(update(ORMChatMessage).values(model_provider=None, model=None))
    await session.execute(delete(ORMModelProvider))
    await session.commit()


async def _sync_registry_catalog(session) -> list[ModelProvider]:
    service = ModelProviderCatalogService(
        model_providers=SQLAlchemyModelProviderRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
    )
    return await service.sync_from_registry()


def _sql_quote(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def _seed_sql_literal(value: Any, column: str) -> str:
    if value is None:
        return "NULL"
    if column in SEED_JSON_COLUMNS or column in SEED_JSONB_COLUMNS:
        cast = "::jsonb" if column in SEED_JSONB_COLUMNS else "::json"
        return _sql_quote(json.dumps(value, sort_keys=True, separators=(",", ":"))) + cast
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, Decimal):
        return format(value, "f")
    if hasattr(value, "isoformat"):
        return _sql_quote(value.isoformat())
    if isinstance(value, int):
        return str(value)
    return _sql_quote(str(value))


def _render_upsert(
    table: str,
    columns: tuple[str, ...],
    rows: list[dict[str, Any]],
    *,
    where: str,
    insert_only: frozenset[str] = frozenset(),
) -> str:
    column_sql = ",\n    ".join(columns)
    value_lines = []
    for row in rows:
        values = ", ".join(_seed_sql_literal(row.get(column), column) for column in columns)
        value_lines.append(f"    ({values})")
    set_lines = [
        f"    {column} = EXCLUDED.{column}" for column in columns if column != "id" and column not in insert_only
    ]
    set_lines.append("    updated_at = CURRENT_TIMESTAMP")
    return (
        f"INSERT INTO {table} (\n"
        f"    {column_sql}\n"
        ") VALUES\n"
        + ",\n".join(value_lines)
        + "\nON CONFLICT (id) DO UPDATE SET\n"
        + ",\n".join(set_lines)
        + f"\nWHERE {table}.{where};\n"
    )


def _render_seed_sql() -> str:
    provider_rows = serialize_model_provider_catalog()
    builtin_ids = ", ".join(_sql_quote(str(row["id"])) for row in provider_rows)
    return (
        "-- Seed the built-in model connection and its provider/model catalog rows after\n"
        "-- Alembic creates the tables. Only built-in rows are inserted, updated or retired;\n"
        "-- owner-added connections and models, and the owner's hidden flags, are never changed.\n"
        "-- Generated from animama.app.model_catalog serializers by tests/test_model_provider_catalog.py.\n"
        + _render_upsert(
            "model_connections",
            CONNECTION_SEED_COLUMNS,
            serialize_builtin_model_connections(),
            where="source = 'builtin'",
        )
        + "\n"
        + _render_upsert(
            "model_providers",
            SEED_COLUMNS,
            provider_rows,
            where="source = 'builtin'",
            # A built-in row's ownership never changes after insertion.
            insert_only=frozenset({"connection_id", "source"}),
        )
        + "\n-- Retire built-in rows that the current release no longer ships.\n"
        + "UPDATE model_providers SET\n"
        + "    active = FALSE,\n"
        + "    deprecated_at = COALESCE(deprecated_at, CURRENT_TIMESTAMP),\n"
        + "    updated_at = CURRENT_TIMESTAMP\n"
        + f"WHERE source = 'builtin' AND active AND id NOT IN ({builtin_ids});\n"
    )


def _rows_by_id() -> dict[str, dict[str, object]]:
    return {str(row["id"]): row for row in serialize_model_provider_catalog()}


def _expected_provider_model_pairs() -> set[tuple[str, str]]:
    return {
        (str(provider), model) for model, entry in MODEL_CATALOG.items() for provider in (entry.get("providers") or {})
    }


def test_model_provider_catalog_has_one_row_per_registry_provider_model_pair() -> None:
    rows = serialize_model_provider_catalog()
    actual = {(str(row["provider_type"]), str(row["model"])) for row in rows}
    expected = _expected_provider_model_pairs()

    assert actual == expected
    assert len(rows) == len(expected)
    assert all(row["id"] == f"{row['provider_type']}:{row['model']}" for row in rows)


def test_openai_direct_rows_have_exact_catalog_pricing() -> None:
    rows = _rows_by_id()

    for provider_type in ("OpenAIHTTPAgent", "OpenAIResponsesHTTPAgent"):
        row = rows[f"{provider_type}:gpt-5-nano"]
        assert row["pricing_status"] == "priced"
        assert row["pricing_source_provider"] == "openai"
        assert row["pricing_source_model"] == "gpt-5-nano"
        assert row["pricing_source_checked_at"] == date(2026, 6, 16)
        assert row["currency"] == "USD"
        assert row["billing_unit"] == "1M_tokens"
        assert row["service_tiers_supported"] == ["standard", "batch", "flex"]
        assert row["standard_input_price_per_million"] == Decimal("0.05")
        assert row["standard_cached_input_price_per_million"] == Decimal("0.005")
        assert row["standard_output_price_per_million"] == Decimal("0.4")
        assert row["batch_input_price_per_million"] == Decimal("0.025")
        assert row["batch_cached_input_price_per_million"] == Decimal("0.0025")
        assert row["batch_output_price_per_million"] == Decimal("0.2")
        assert row["flex_input_price_per_million"] == Decimal("0.025")
        assert row["flex_cached_input_price_per_million"] == Decimal("0.0025")
        assert row["flex_output_price_per_million"] == Decimal("0.2")
        assert row["priority_input_price_per_million"] is None
        assert row["regional_processing_uplift_factor"] is None

    for provider_type in ("OpenAIHTTPAgent", "OpenAIResponsesHTTPAgent"):
        row = rows[f"{provider_type}:gpt-5.4-nano"]
        assert row["pricing_status"] == "priced"
        assert row["pricing_source_provider"] == "openai"
        assert row["pricing_source_model"] == "gpt-5.4-nano"
        assert row["pricing_source_checked_at"] == date(2026, 6, 16)
        assert row["currency"] == "USD"
        assert row["billing_unit"] == "1M_tokens"
        assert row["service_tiers_supported"] == ["standard", "batch", "flex"]
        assert row["standard_input_price_per_million"] == Decimal("0.20")
        assert str(row["standard_input_price_per_million"]) == "0.20"
        assert row["standard_cached_input_price_per_million"] == Decimal("0.02")
        assert row["standard_output_price_per_million"] == Decimal("1.25")
        assert row["batch_input_price_per_million"] == Decimal("0.10")
        assert row["batch_cached_input_price_per_million"] == Decimal("0.01")
        assert row["batch_output_price_per_million"] == Decimal("0.625")
        assert row["flex_input_price_per_million"] == Decimal("0.10")
        assert row["flex_cached_input_price_per_million"] == Decimal("0.01")
        assert row["flex_output_price_per_million"] == Decimal("0.625")
        assert row["priority_input_price_per_million"] is None
        assert row["regional_processing_uplift_factor"] == Decimal("1.10")
        assert str(row["regional_processing_uplift_factor"]) == "1.10"


@pytest.mark.parametrize(
    ("model", "short_rates", "long_rates"),
    [
        (
            "gpt-5.6-luna",
            {
                "standard": ("0.20", "0.02", "1.20"),
                "batch": ("0.10", "0.01", "0.60"),
                "flex": ("0.10", "0.01", "0.60"),
                "priority": ("0.40", "0.04", "2.40"),
            },
            {
                "standard": ("0.40", "0.04", "1.80"),
                "batch": ("0.20", "0.02", "0.90"),
                "flex": ("0.20", "0.02", "0.90"),
                "priority": ("0.80", "0.08", "3.60"),
            },
        ),
        (
            "gpt-5.6-terra",
            {
                "standard": ("2.00", "0.20", "12.00"),
                "batch": ("1.00", "0.10", "6.00"),
                "flex": ("1.00", "0.10", "6.00"),
                "priority": ("4.00", "0.40", "24.00"),
            },
            {
                "standard": ("4.00", "0.40", "18.00"),
                "batch": ("2.00", "0.20", "9.00"),
                "flex": ("2.00", "0.20", "9.00"),
                "priority": ("8.00", "0.80", "36.00"),
            },
        ),
    ],
)
def test_openai_gpt_5_6_responses_rows_have_exact_catalog_pricing(
    model: str,
    short_rates: dict[str, tuple[str, str, str]],
    long_rates: dict[str, tuple[str, str, str]],
) -> None:
    row = _rows_by_id()[f"OpenAIResponsesHTTPAgent:{model}"]

    assert row["pricing_status"] == "priced"
    assert row["current_snapshot"] == model
    assert row["context_window_tokens"] == 1_050_000
    assert row["max_output_tokens"] == 128_000
    assert row["pricing_source_provider"] == "openai"
    assert row["pricing_source_model"] == model
    assert row["pricing_source_checked_at"] == date(2026, 8, 8)
    assert row["currency"] == "USD"
    assert row["billing_unit"] == "1M_tokens"
    assert row["service_tiers_supported"] == ["standard", "batch", "flex", "priority"]
    assert row["long_context_token_threshold"] == 272_000
    assert row["regional_processing_uplift_factor"] == Decimal("1.10")
    assert isinstance(row["pricing_notes"], list)
    assert len(row["pricing_notes"]) == 4

    for tier, rates in short_rates.items():
        input_rate, cached_rate, output_rate = rates
        assert row[f"{tier}_input_price_per_million"] == Decimal(input_rate)
        assert row[f"{tier}_cached_input_price_per_million"] == Decimal(cached_rate)
        assert row[f"{tier}_output_price_per_million"] == Decimal(output_rate)

    for tier, rates in long_rates.items():
        input_rate, cached_rate, output_rate = rates
        assert row[f"{tier}_long_context_input_price_per_million"] == Decimal(input_rate)
        assert row[f"{tier}_long_context_cached_input_price_per_million"] == Decimal(cached_rate)
        assert row[f"{tier}_long_context_output_price_per_million"] == Decimal(output_rate)


def test_public_model_catalog_serializer_does_not_expose_pricing() -> None:
    for row in serialize_model_catalog():
        assert "pricing_status" not in row
        assert "pricing_source_provider" not in row
        assert "standard_input_price_per_million" not in row
        assert "structured_output_transport" not in row
        assert "provider_type" not in row
        assert "model_provider" in row


def test_public_model_catalog_serializer_exposes_api_standard_fields() -> None:
    rows = {str(row["id"]): row for row in serialize_model_catalog()}

    assert rows
    for row in rows.values():
        assert "model_client" in row
        assert "api_standard" in row
        assert "supports_developer_role" in row

    for model in ("gpt-5-nano", "gpt-5.4-nano"):
        chat_row = rows[f"OpenAIHTTPAgent:{model}"]
        assert chat_row["model_client"] == "openai_chat_completions"
        assert chat_row["api_standard"] == "chat_completions"
        assert chat_row["supports_developer_role"] is True

        responses_row = rows[f"OpenAIResponsesHTTPAgent:{model}"]
        assert responses_row["model_client"] == "openai_responses"
        assert responses_row["api_standard"] == "responses"
        assert responses_row["supports_developer_role"] is True

    for model in ("gpt-5.6-luna", "gpt-5.6-terra"):
        assert f"OpenAIHTTPAgent:{model}" not in rows
        responses_row = rows[f"OpenAIResponsesHTTPAgent:{model}"]
        assert responses_row["model_client"] == "openai_responses"
        assert responses_row["api_standard"] == "responses"
        assert responses_row["supports_developer_role"] is True
        assert responses_row["supported_reasoning_efforts"] == [
            "none",
            "low",
            "medium",
            "high",
            "xhigh",
            "max",
        ]
        # The frontend uses the first catalog effort as its explicit default.
        assert responses_row["supported_reasoning_efforts"][0] == "none"


def test_internal_catalog_rows_include_structured_output_transport() -> None:
    rows = _rows_by_id()

    for model in ("gpt-5-nano", "gpt-5.4-nano"):
        assert rows[f"OpenAIHTTPAgent:{model}"]["structured_output_transport"] == (
            STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
        )
        assert rows[f"OpenAIResponsesHTTPAgent:{model}"]["structured_output_transport"] == (
            STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
        )

    for model in ("gpt-5.6-luna", "gpt-5.6-terra"):
        assert rows[f"OpenAIResponsesHTTPAgent:{model}"]["structured_output_transport"] == (
            STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
        )

    for row in rows.values():
        assert row["structured_output_transport"] == structured_output_transport(
            str(row["provider_type"]),
            str(row["model"]),
        )


def test_openai_native_web_search_and_apply_patch_are_responses_only() -> None:
    public_rows = {row["id"]: row for row in serialize_model_catalog()}
    provider_rows = _rows_by_id()

    assert "native_tool_support" not in public_rows["OpenAIResponsesHTTPAgent:gpt-5-nano"]
    assert provider_rows["OpenAIResponsesHTTPAgent:gpt-5-nano"]["native_tool_support"] is None
    assert "native_tool_support" not in public_rows["OpenAIHTTPAgent:gpt-5.4-nano"]
    assert public_rows["OpenAIResponsesHTTPAgent:gpt-5.4-nano"]["native_tool_support"] == [
        "apply_patch",
        "web_search",
    ]
    assert public_rows["OpenAIResponsesHTTPAgent:gpt-5.4-nano"]["requestable_native_tool_support"] == ["web_search"]
    assert provider_rows["OpenAIHTTPAgent:gpt-5.4-nano"]["native_tool_support"] is None
    assert provider_rows["OpenAIResponsesHTTPAgent:gpt-5.4-nano"]["native_tool_support"] == [
        "apply_patch",
        "web_search",
    ]
    assert "requestable_native_tool_support" not in provider_rows["OpenAIResponsesHTTPAgent:gpt-5.4-nano"]

    for model in ("gpt-5.6-luna", "gpt-5.6-terra"):
        assert f"OpenAIHTTPAgent:{model}" not in public_rows
        responses_row = public_rows[f"OpenAIResponsesHTTPAgent:{model}"]
        assert responses_row["native_tool_support"] == ["apply_patch", "web_search"]
        assert responses_row["requestable_native_tool_support"] == ["web_search"]
        assert provider_rows[f"OpenAIResponsesHTTPAgent:{model}"]["native_tool_support"] == [
            "apply_patch",
            "web_search",
        ]


@pytest.mark.asyncio
async def test_model_provider_catalog_sync_inserts_current_registry_rows(async_session) -> None:
    await _clear_model_provider_rows(async_session)

    stored = await _sync_registry_catalog(async_session)
    count = await async_session.scalar(select(func.count()).select_from(ORMModelProvider))

    assert len(stored) == len(serialize_model_provider_catalog())
    assert count == len(serialize_model_provider_catalog())


@pytest.mark.asyncio
async def test_model_provider_catalog_sync_is_idempotent_and_updates_existing_rows(async_session) -> None:
    await _clear_model_provider_rows(async_session)
    await _sync_registry_catalog(async_session)

    row = await async_session.get(ORMModelProvider, "OpenAIResponsesHTTPAgent:gpt-5-nano")
    assert row is not None
    row.model_label = "stale label"
    await async_session.commit()

    await _sync_registry_catalog(async_session)
    count = await async_session.scalar(select(func.count()).select_from(ORMModelProvider))
    refreshed = await async_session.get(ORMModelProvider, "OpenAIResponsesHTTPAgent:gpt-5-nano")

    assert count == len(serialize_model_provider_catalog())
    assert refreshed is not None
    assert refreshed.model_label == "gpt-5-nano"


@pytest.mark.asyncio
async def test_model_provider_catalog_sync_keeps_owner_hidden_built_ins_hidden(async_session) -> None:
    await _clear_model_provider_rows(async_session)
    await _sync_registry_catalog(async_session)
    row = await async_session.get(ORMModelProvider, "OpenAIResponsesHTTPAgent:gpt-5.6-terra")
    assert row is not None
    row.hidden = True
    await async_session.commit()

    await _sync_registry_catalog(async_session)
    async_session.expire_all()
    refreshed = await async_session.get(ORMModelProvider, "OpenAIResponsesHTTPAgent:gpt-5.6-terra")

    assert refreshed is not None
    assert refreshed.hidden is True


@pytest.mark.asyncio
async def test_model_provider_catalog_sync_soft_retires_rows_missing_from_registry(async_session) -> None:
    await _clear_model_provider_rows(async_session)
    repo = SQLAlchemyModelProviderRepository(async_session)
    retired_id = "RetiredAgent:retired-model"
    owner_id = "owner:kept-model"
    capabilities = ModelProviderCapabilities(
        accepts=["text"],
        produces=["text"],
        supports_tools=False,
        supports_streaming=False,
    )
    await repo.upsert_many(
        [
            ModelProvider(
                id=retired_id,
                model="retired-model",
                provider_type="RetiredAgent",
                model_label="Retired model",
                provider_label="Retired",
                capabilities=capabilities,
            ),
            ModelProvider(
                id=owner_id,
                model="kept-model",
                provider_type="OpenAIHTTPAgent",
                model_label="Kept model",
                provider_label="OpenAI HTTP",
                source="owner",
                capabilities=capabilities,
            ),
        ]
    )
    await async_session.commit()

    await _sync_registry_catalog(async_session)
    retired = await async_session.get(ORMModelProvider, retired_id)
    kept = await async_session.get(ORMModelProvider, owner_id)

    assert retired is not None
    assert retired.active is False
    assert retired.deprecated_at is not None
    assert kept is not None
    assert kept.active is True


@pytest.mark.asyncio
async def test_synced_db_rows_retain_pricing_and_explicit_unpriced_values(async_session) -> None:
    await _clear_model_provider_rows(async_session)
    await _sync_registry_catalog(async_session)
    repo = SQLAlchemyModelProviderRepository(async_session)

    openai_chat = await repo.get("OpenAIHTTPAgent:gpt-5.4-nano")
    assert openai_chat is not None
    assert openai_chat.capabilities.supports_developer_role is True
    assert openai_chat.capabilities.structured_output_transport == STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
    assert openai_chat.capabilities.native_tool_support is None

    openai_responses = await repo.get("OpenAIResponsesHTTPAgent:gpt-5.4-nano")
    assert openai_responses is not None
    assert openai_responses.capabilities.supports_developer_role is True
    assert openai_responses.capabilities.supports_tools is True
    assert openai_responses.capabilities.supports_streaming is True
    assert openai_responses.capabilities.structured_output_transport == STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
    assert openai_responses.capabilities.supports_reasoning is True
    assert openai_responses.capabilities.supported_reasoning_efforts == ["none", "low", "medium", "high", "xhigh"]
    assert openai_responses.capabilities.native_tool_support == ["apply_patch", "web_search"]
    assert openai_responses.pricing.pricing_status == "priced"
    assert openai_responses.pricing.pricing_source_provider == "openai"
    assert openai_responses.pricing.pricing_source_model == "gpt-5.4-nano"
    assert openai_responses.pricing.pricing_source_checked_at == date(2026, 6, 16)
    assert openai_responses.pricing.currency == "USD"
    assert openai_responses.pricing.billing_unit == "1M_tokens"
    assert openai_responses.pricing.standard_input_price_per_million == Decimal("0.20")
    assert openai_responses.pricing.standard_cached_input_price_per_million == Decimal("0.02")
    assert openai_responses.pricing.standard_output_price_per_million == Decimal("1.25")
    assert openai_responses.pricing.batch_input_price_per_million == Decimal("0.10")
    assert openai_responses.pricing.batch_cached_input_price_per_million == Decimal("0.01")
    assert openai_responses.pricing.batch_output_price_per_million == Decimal("0.625")
    assert openai_responses.pricing.flex_input_price_per_million == Decimal("0.10")
    assert openai_responses.pricing.flex_cached_input_price_per_million == Decimal("0.01")
    assert openai_responses.pricing.flex_output_price_per_million == Decimal("0.625")
    assert openai_responses.pricing.priority_input_price_per_million is None
    assert openai_responses.pricing.regional_processing_uplift_factor == Decimal("1.10")

    for row in await repo.list_active():
        assert row.source == "builtin"
        assert row.connection_id == "openai"
        assert row.connection is not None
        assert row.connection.is_builtin_openai


@pytest.mark.asyncio
async def test_public_db_catalog_matches_public_registry_shape_without_pricing(async_session) -> None:
    await _clear_model_provider_rows(async_session)
    await _sync_registry_catalog(async_session)
    service = ModelProviderCatalogService(model_providers=SQLAlchemyModelProviderRepository(async_session))

    db_rows = await service.list_public_catalog()

    assert db_rows == serialize_model_catalog()
    for row in db_rows:
        assert "pricing_status" not in row
        assert "pricing_source_provider" not in row
        assert "standard_input_price_per_million" not in row
        assert "structured_output_transport" not in row
        assert "provider_type" not in row
        assert "model_provider" in row
        assert "model_client" in row
        assert "api_standard" in row


def test_public_catalog_mapper_uses_model_provider_key_without_pricing() -> None:
    row = model_provider_domain_to_public_catalog_row(
        ModelProvider(
            id="Provider:model",
            model="model",
            provider_type="Provider",
            model_label="Model",
            provider_label="Provider",
            capabilities=ModelProviderCapabilities(
                accepts=["text"],
                produces=["text"],
                supports_tools=True,
                supports_streaming=True,
            ),
            pricing=ModelProviderPricing(standard_input_price_per_million=Decimal("1.23")),
        )
    )

    assert row["model_provider"] == "Provider"
    assert row["model_client"] is None
    assert row["api_standard"] is None
    assert "provider_type" not in row
    assert "standard_input_price_per_million" not in row
    assert "structured_output_transport" not in row


def test_public_catalog_mapper_computes_api_standard_from_provider_type() -> None:
    row = model_provider_domain_to_public_catalog_row(
        ModelProvider(
            id="OpenAIResponsesHTTPAgent:gpt-5-nano",
            model="gpt-5-nano",
            provider_type="OpenAIResponsesHTTPAgent",
            model_label="gpt-5-nano",
            provider_label="OpenAI Responses HTTP",
            capabilities=ModelProviderCapabilities(
                accepts=["text"],
                produces=["text"],
                supports_tools=True,
                supports_streaming=True,
            ),
        )
    )

    assert row["model_client"] == "openai_responses"
    assert row["api_standard"] == "responses"


def test_model_provider_catalog_entry_keeps_prices_out_of_top_level_fields() -> None:
    entry = ModelProvider(
        id="Provider:model",
        model="model",
        provider_type="Provider",
        model_label="Model",
        provider_label="Provider",
        pricing=ModelProviderPricing(standard_input_price_per_million=Decimal("1.23")),
    )

    assert not hasattr(entry, "standard_input_price_per_million")
    assert entry.pricing.standard_input_price_per_million == Decimal("1.23")


def test_model_provider_seed_sql_matches_registry_catalog() -> None:
    assert SEED_SQL_PATH.read_text(encoding="utf-8") == _render_seed_sql()


def test_model_provider_orm_metadata_is_registered() -> None:
    assert ORMModelProvider.__tablename__ == "model_providers"
    assert "model_providers" in Base.metadata.tables

    table = Base.metadata.tables["model_providers"]
    assert table.c.id.primary_key
    assert table.c.id.type.python_type is str
    assert table.c.deprecated_at.nullable
    assert "created_at" in table.c
    assert "updated_at" in table.c
    assert isinstance(table.c.structured_output_transport.type, String)
    assert table.c.structured_output_transport.nullable
    assert not table.c.connection_id.nullable
    assert {fk.column.table.name for fk in table.c.connection_id.foreign_keys} == {"model_connections"}

    unique_constraints = [constraint for constraint in table.constraints if isinstance(constraint, UniqueConstraint)]
    assert any(
        {column.name for column in constraint.columns} == {"connection_id", "provider_type", "model", "source"}
        for constraint in unique_constraints
    )

    for column_name in PRICE_COLUMNS:
        column_type = table.c[column_name].type
        assert isinstance(column_type, Numeric)
        assert column_type.precision == 12
        assert column_type.scale == 6
        assert table.c[column_name].nullable

    regional_type = table.c.regional_processing_uplift_factor.type
    assert isinstance(regional_type, Numeric)
    assert regional_type.precision == 12
    assert regional_type.scale == 6
    assert table.c.regional_processing_uplift_factor.nullable


async def _apply_seed_sql(session) -> None:  # noqa: ANN001
    connection = await session.connection()
    raw = await connection.get_raw_connection()
    await raw.driver_connection.execute(SEED_SQL_PATH.read_text(encoding="utf-8"))


@pytest.mark.asyncio
async def test_seed_rerun_keeps_owner_rows_and_hidden_flags_and_retires_missing_builtins(async_session) -> None:
    from animama.orm import ORMModelConnection

    await _clear_model_provider_rows(async_session)
    await async_session.execute(delete(ORMModelConnection).where(ORMModelConnection.source == "owner"))
    await async_session.commit()
    await _apply_seed_sql(async_session)
    await async_session.commit()

    async_session.add(ORMModelConnection(id="seed-conn-ollama", source="owner", name="Ollama", preset="ollama"))
    async_session.add(ORMModelConnection(id="seed-conn-lmstudio", source="owner", name="LM Studio", preset="lmstudio"))
    common = {
        "provider_type": "OpenAIHTTPAgent",
        "provider_label": "Local",
        "source": "owner",
        "accepts": ["text"],
        "produces": ["text"],
        "supports_streaming": True,
        "structured_kinds": [],
        "service_tiers_supported": [],
        "pricing_notes": [],
        "metadata_": {},
    }
    for connection_id in ("seed-conn-ollama", "seed-conn-lmstudio"):
        async_session.add(
            ORMModelProvider(
                id=f"owner:{connection_id}",
                model="qwen3:8b",
                model_label="qwen3:8b",
                connection_id=connection_id,
                **common,
            )
        )
    # An owner row that later collides with a built-in on the same connection.
    async_session.add(
        ORMModelProvider(
            id="owner:openai-gpt-5-nano",
            model="gpt-5-nano",
            model_label="my nano",
            connection_id="openai",
            **common,
        )
    )
    retired = ORMModelProvider(
        id="OpenAIHTTPAgent:gpt-retired",
        model="gpt-retired",
        model_label="gpt-retired",
        **{**common, "source": "builtin"},
    )
    async_session.add(retired)
    hidden = await async_session.get(ORMModelProvider, "OpenAIResponsesHTTPAgent:gpt-5.6-terra")
    assert hidden is not None
    hidden.hidden = True
    await async_session.commit()

    await _apply_seed_sql(async_session)
    await async_session.commit()
    async_session.expire_all()

    owner_rows = (
        await async_session.execute(select(ORMModelProvider).where(ORMModelProvider.source == "owner"))
    ).scalars()
    assert {(row.id, row.model_label, row.active) for row in owner_rows} == {
        ("owner:seed-conn-ollama", "qwen3:8b", True),
        ("owner:seed-conn-lmstudio", "qwen3:8b", True),
        ("owner:openai-gpt-5-nano", "my nano", True),
    }
    terra = await async_session.get(ORMModelProvider, "OpenAIResponsesHTTPAgent:gpt-5.6-terra")
    assert terra is not None and terra.hidden is True and terra.active is True
    retired_row = await async_session.get(ORMModelProvider, "OpenAIHTTPAgent:gpt-retired")
    assert retired_row is not None and retired_row.active is False and retired_row.deprecated_at is not None
    builtin_nano = await async_session.get(ORMModelProvider, "OpenAIHTTPAgent:gpt-5-nano")
    assert builtin_nano is not None and builtin_nano.active is True
