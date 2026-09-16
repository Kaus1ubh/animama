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
    DEEPSEEK_BASE_URL,
    HUGGINGFACE_ROUTER_BASE_URL,
    MODEL_CATALOG,
    STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT,
    STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA,
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
HUGGINGFACE_MODELS = (
    "zai-org/GLM-5.2:deepinfra",
    "deepseek-ai/DeepSeek-V4-Pro:deepinfra",
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
    "provider_base_url",
    "api_family",
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
    if column in SEED_JSON_COLUMNS:
        return _sql_quote(json.dumps(value, sort_keys=True, separators=(",", ":"))) + "::json"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, Decimal):
        return format(value, "f")
    if hasattr(value, "isoformat"):
        return _sql_quote(value.isoformat())
    if isinstance(value, int):
        return str(value)
    return _sql_quote(str(value))


def _render_seed_sql() -> str:
    column_sql = ",\n    ".join(SEED_COLUMNS)
    value_lines = []
    for row in serialize_model_provider_catalog():
        values = ", ".join(_seed_sql_literal(row.get(column), column) for column in SEED_COLUMNS)
        value_lines.append(f"    ({values})")
    set_lines = [f"    {column} = EXCLUDED.{column}" for column in SEED_COLUMNS if column != "id"]
    set_lines.append("    updated_at = CURRENT_TIMESTAMP")
    return (
        "-- Seed built-in provider/model catalog rows after Alembic creates model_providers.\n"
        "-- Generated from animama.app.model_catalog.serialize_model_provider_catalog().\n"
        "INSERT INTO model_providers (\n"
        f"    {column_sql}\n"
        ") VALUES\n" + ",\n".join(value_lines) + "\nON CONFLICT (id) DO UPDATE SET\n" + ",\n".join(set_lines) + ";\n"
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


def test_openai_litellm_alias_uses_openai_pass_through_pricing_source() -> None:
    row = _rows_by_id()["LiteLLMAgent:openai/gpt-5.4-nano"]

    assert row["pricing_status"] == "priced"
    assert row["api_family"] == "litellm"
    assert row["pricing_source_provider"] == "openai"
    assert row["pricing_source_model"] == "gpt-5.4-nano"
    assert row["standard_input_price_per_million"] == Decimal("0.20")
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


def test_non_openai_rows_are_explicitly_unpriced() -> None:
    priced_ids = {
        "OpenAIHTTPAgent:gpt-5-nano",
        "OpenAIResponsesHTTPAgent:gpt-5-nano",
        "OpenAIHTTPAgent:gpt-5.4-nano",
        "OpenAIResponsesHTTPAgent:gpt-5.4-nano",
        "OpenAIResponsesHTTPAgent:gpt-5.6-luna",
        "OpenAIResponsesHTTPAgent:gpt-5.6-terra",
        "LiteLLMAgent:openai/gpt-5.4-nano",
    }

    for row in serialize_model_provider_catalog():
        if row["id"] in priced_ids:
            continue
        assert row["pricing_status"] == "unpriced"
        assert row["pricing_source_provider"] in {"gemini", "xai", "groq", "deepseek", "huggingface"}
        assert row["pricing_source_model"] is None
        assert row["pricing_source_url"] is None
        assert row["pricing_source_checked_at"] is None
        assert row["currency"] is None
        assert row["billing_unit"] is None
        assert row["service_tiers_supported"] == []
        for column in PRICE_COLUMNS:
            assert row[column] is None


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

    for row in rows.values():
        if str(row["model_provider"]) in {"GeminiAgent", "LiteLLMAgent"}:
            assert row["model_client"] is None
            assert row["api_standard"] is None
            assert row["supports_developer_role"] is False


def test_deepseek_v4_rows_use_openai_chat_completions_provider() -> None:
    provider_rows = _rows_by_id()
    public_rows = {str(row["id"]): row for row in serialize_model_catalog()}

    assert "LiteLLMAgent:deepseek/deepseek-v4-flash" not in provider_rows
    assert "LiteLLMAgent:deepseek/deepseek-v4-pro" not in provider_rows

    for model in ("deepseek-v4-flash", "deepseek-v4-pro"):
        row = provider_rows[f"OpenAIHTTPAgent:{model}"]
        assert row["provider_type"] == "OpenAIHTTPAgent"
        assert row["provider_label"] == "DeepSeek"
        assert row["logo_provider"] == "deepseek"
        assert row["provider_base_url"] == DEEPSEEK_BASE_URL
        assert row["api_family"] == "deepseek"
        assert row["pricing_status"] == "unpriced"
        assert row["pricing_source_provider"] == "deepseek"
        assert row["accepts"] == ["text"]
        assert row["produces"] == ["text"]
        assert row["supports_developer_role"] is False
        assert row["supports_tools"] is True
        assert row["supports_streaming"] is True
        assert row["structured_kinds"] == ["main_structured_response"]
        assert row["structured_output_transport"] == STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT
        assert row["supports_reasoning"] is True
        assert row["supported_reasoning_efforts"] == ["none", "high", "max"]
        assert isinstance(row["metadata"], dict)
        assert row["metadata"]["openai_compatible_provider"] == "deepseek"
        assert "thinking" not in row["metadata"]
        assert "reasoning_effort_map" not in row["metadata"]
        assert structured_output_transport("OpenAIHTTPAgent", model) == STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT

        public_row = public_rows[f"OpenAIHTTPAgent:{model}"]
        assert public_row["model_provider"] == "OpenAIHTTPAgent"
        assert public_row["provider_label"] == "DeepSeek"
        assert public_row["logo_provider"] == "deepseek"
        assert public_row["model_client"] == "openai_chat_completions"
        assert public_row["api_standard"] == "chat_completions"
        assert public_row["supports_developer_role"] is False


def test_huggingface_rows_use_openai_chat_completions_provider() -> None:
    provider_rows = _rows_by_id()
    public_rows = {str(row["id"]): row for row in serialize_model_catalog()}

    for model in HUGGINGFACE_MODELS:
        row_id = f"OpenAIHTTPAgent:{model}"
        row = provider_rows[row_id]
        assert row["id"] == row_id
        assert row["provider_type"] == "OpenAIHTTPAgent"
        assert row["model"] == model
        assert row["provider_label"] == "Hugging Face"
        assert row["logo_provider"] == "huggingface"
        assert row["provider_base_url"] == HUGGINGFACE_ROUTER_BASE_URL
        assert row["api_family"] == "huggingface"
        assert row["pricing_status"] == "unpriced"
        assert row["pricing_source_provider"] == "huggingface"
        assert row["accepts"] == ["text"]
        assert row["produces"] == ["text"]
        assert row["supports_developer_role"] is False
        assert row["supports_tools"] is True
        assert row["supports_streaming"] is True
        assert row["structured_kinds"] == ["main_structured_response"]
        assert row["structured_output_transport"] == STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
        assert row["supports_reasoning"] is None
        assert row["supported_reasoning_efforts"] is None
        assert row["native_tool_support"] is None
        assert isinstance(row["metadata"], dict)
        assert row["metadata"]["openai_compatible_provider"] == "huggingface"
        assert structured_output_transport("OpenAIHTTPAgent", model) == STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA

        public_row = public_rows[row_id]
        assert public_row["model"] == model
        assert public_row["model_provider"] == "OpenAIHTTPAgent"
        assert public_row["provider_label"] == "Hugging Face"
        assert public_row["logo_provider"] == "huggingface"
        assert public_row["model_client"] == "openai_chat_completions"
        assert public_row["api_standard"] == "chat_completions"
        assert public_row["supports_developer_role"] is False
        assert "native_tool_support" not in public_row


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

    for model in ("deepseek-v4-flash", "deepseek-v4-pro"):
        assert rows[f"OpenAIHTTPAgent:{model}"]["structured_output_transport"] == (
            STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT
        )

    for model in HUGGINGFACE_MODELS:
        assert rows[f"OpenAIHTTPAgent:{model}"]["structured_output_transport"] == (
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
async def test_model_provider_catalog_sync_soft_retires_rows_missing_from_registry(async_session) -> None:
    await _clear_model_provider_rows(async_session)
    repo = SQLAlchemyModelProviderRepository(async_session)
    retired_id = "RetiredAgent:retired-model"
    await repo.upsert_many(
        [
            ModelProvider(
                id=retired_id,
                model="retired-model",
                provider_type="RetiredAgent",
                model_label="Retired model",
                provider_label="Retired",
                capabilities=ModelProviderCapabilities(
                    accepts=["text"],
                    produces=["text"],
                    supports_tools=False,
                    supports_streaming=False,
                ),
            )
        ]
    )
    await async_session.commit()

    await _sync_registry_catalog(async_session)
    retired = await async_session.get(ORMModelProvider, retired_id)

    assert retired is not None
    assert retired.active is False
    assert retired.deprecated_at is not None


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

    gemini = await repo.get("GeminiAgent:gemini-3.1-flash-lite-preview")
    assert gemini is not None
    assert gemini.pricing.pricing_status == "unpriced"
    assert gemini.pricing.pricing_source_provider == "gemini"
    assert gemini.pricing.pricing_source_model is None
    assert gemini.pricing.pricing_source_url is None
    assert gemini.pricing.pricing_source_checked_at is None
    assert gemini.pricing.currency is None
    assert gemini.pricing.billing_unit is None
    assert gemini.pricing.service_tiers_supported == []
    for column in PRICE_COLUMNS:
        assert getattr(gemini.pricing, column) is None

    deepseek = await repo.get("OpenAIHTTPAgent:deepseek-v4-pro")
    assert deepseek is not None
    assert deepseek.provider_type == "OpenAIHTTPAgent"
    assert deepseek.provider_label == "DeepSeek"
    assert deepseek.logo_provider == "deepseek"
    assert deepseek.provider_base_url == DEEPSEEK_BASE_URL
    assert deepseek.api_family == "deepseek"
    assert deepseek.capabilities.supports_developer_role is False
    assert deepseek.capabilities.supports_tools is True
    assert deepseek.capabilities.supports_streaming is True
    assert deepseek.capabilities.structured_output_transport == STRUCTURED_OUTPUT_TRANSPORT_JSON_OBJECT
    assert deepseek.capabilities.supports_reasoning is True
    assert deepseek.capabilities.supported_reasoning_efforts == ["none", "high", "max"]
    assert deepseek.pricing.pricing_status == "unpriced"
    assert deepseek.pricing.pricing_source_provider == "deepseek"
    assert deepseek.metadata["openai_compatible_provider"] == "deepseek"

    huggingface = await repo.get("OpenAIHTTPAgent:deepseek-ai/DeepSeek-V4-Pro:deepinfra")
    assert huggingface is not None
    assert huggingface.provider_type == "OpenAIHTTPAgent"
    assert huggingface.model == "deepseek-ai/DeepSeek-V4-Pro:deepinfra"
    assert huggingface.provider_label == "Hugging Face"
    assert huggingface.logo_provider == "huggingface"
    assert huggingface.provider_base_url == HUGGINGFACE_ROUTER_BASE_URL
    assert huggingface.api_family == "huggingface"
    assert huggingface.capabilities.supports_developer_role is False
    assert huggingface.capabilities.supports_tools is True
    assert huggingface.capabilities.supports_streaming is True
    assert huggingface.capabilities.structured_output_transport == STRUCTURED_OUTPUT_TRANSPORT_JSON_SCHEMA
    assert huggingface.capabilities.supports_reasoning is None
    assert huggingface.capabilities.supported_reasoning_efforts is None
    assert huggingface.capabilities.native_tool_support is None
    assert huggingface.pricing.pricing_status == "unpriced"
    assert huggingface.pricing.pricing_source_provider == "huggingface"
    assert huggingface.metadata["openai_compatible_provider"] == "huggingface"


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

    unique_constraints = [constraint for constraint in table.constraints if isinstance(constraint, UniqueConstraint)]
    assert any(
        {column.name for column in constraint.columns} == {"provider_type", "model"}
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
