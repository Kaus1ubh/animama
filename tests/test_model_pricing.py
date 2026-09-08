from __future__ import annotations

from decimal import Decimal

from animama.adapters.mappers.model_provider_map import model_provider_registry_row_to_domain
from animama.app.model_catalog import serialize_model_provider_catalog
from animama.app.util.model_pricing import estimate_model_token_cost
from animama.domain import ModelProvider
from animama.domain.usage import Usage, UsageInputDetails, UsageOutputDetails


def _catalog_provider(model_provider_id: str) -> ModelProvider:
    for row in serialize_model_provider_catalog():
        if row["id"] == model_provider_id:
            return model_provider_registry_row_to_domain(row)
    raise AssertionError(f"model provider {model_provider_id!r} not found")


def test_model_pricing_calculates_standard_gpt_5_nano_cost_with_cached_input() -> None:
    model_provider = _catalog_provider("OpenAIResponsesHTTPAgent:gpt-5-nano")
    usage = Usage(
        input_tokens=1000,
        output_tokens=500,
        total_tokens=1500,
        input_tokens_details=UsageInputDetails(cached_tokens=200),
    )

    cost = estimate_model_token_cost(model_provider=model_provider, usage=usage)

    assert cost.priced is True
    assert cost.unpriced_reason is None
    assert cost.service_tier == "standard"
    assert cost.currency == "USD"
    assert cost.billing_unit == "1M_tokens"
    assert cost.input_tokens == 1000
    assert cost.cached_input_tokens == 200
    assert cost.uncached_input_tokens == 800
    assert cost.output_tokens == 500
    assert cost.input_price_per_million == Decimal("0.05")
    assert cost.cached_input_price_per_million == Decimal("0.005")
    assert cost.output_price_per_million == Decimal("0.4")
    assert cost.uncached_input_cost == Decimal("0.00004")
    assert cost.cached_input_cost == Decimal("0.000001")
    assert cost.input_cost == Decimal("0.000041")
    assert cost.output_cost == Decimal("0.0002")
    assert cost.total_cost == Decimal("0.000241")


def test_model_pricing_calculates_batch_gpt_5_4_nano_cost_and_keeps_reasoning_in_output() -> None:
    model_provider = _catalog_provider("OpenAIResponsesHTTPAgent:gpt-5.4-nano")
    usage = Usage(
        input_tokens=10000,
        output_tokens=2000,
        total_tokens=12000,
        input_tokens_details=UsageInputDetails(cached_tokens=1000),
        output_tokens_details=UsageOutputDetails(reasoning_tokens=500),
    )

    cost = estimate_model_token_cost(model_provider=model_provider, usage=usage, service_tier="batch")

    assert cost.priced is True
    assert cost.service_tier == "batch"
    assert cost.input_price_per_million == Decimal("0.10")
    assert cost.cached_input_price_per_million == Decimal("0.01")
    assert cost.output_price_per_million == Decimal("0.625")
    assert cost.uncached_input_tokens == 9000
    assert cost.output_tokens == 2000
    assert cost.output_reasoning_tokens == 500
    assert cost.uncached_input_cost == Decimal("0.0009")
    assert cost.cached_input_cost == Decimal("0.00001")
    assert cost.output_cost == Decimal("0.00125")
    assert cost.total_cost == Decimal("0.00216")


def test_model_pricing_calculates_gpt_5_6_luna_fast_rates_from_priority_tier() -> None:
    model_provider = _catalog_provider("OpenAIResponsesHTTPAgent:gpt-5.6-luna")
    usage = Usage(
        input_tokens=10_000,
        output_tokens=2_000,
        total_tokens=12_000,
        input_tokens_details=UsageInputDetails(cached_tokens=1_000),
    )

    cost = estimate_model_token_cost(
        model_provider=model_provider,
        usage=usage,
        service_tier="priority",
    )

    assert cost.priced is True
    assert cost.service_tier == "priority"
    assert cost.input_price_per_million == Decimal("0.40")
    assert cost.cached_input_price_per_million == Decimal("0.04")
    assert cost.output_price_per_million == Decimal("2.40")
    assert cost.total_cost == Decimal("0.00844")


def test_model_pricing_normalizes_default_service_tier_to_standard() -> None:
    model_provider = _catalog_provider("OpenAIHTTPAgent:gpt-5-nano")

    cost = estimate_model_token_cost(
        model_provider=model_provider,
        usage=Usage(input_tokens=1, output_tokens=1, total_tokens=2),
        service_tier="default",
    )

    assert cost.priced is True
    assert cost.service_tier == "standard"
    assert cost.total_cost == Decimal("4.5E-7")


def test_model_pricing_returns_unpriced_result_for_unpriced_provider_row() -> None:
    model_provider = _catalog_provider("GeminiAgent:gemini-3.1-flash-lite-preview")

    cost = estimate_model_token_cost(
        model_provider=model_provider,
        usage=Usage(input_tokens=1000, output_tokens=500, total_tokens=1500),
    )

    assert cost.priced is False
    assert cost.unpriced_reason == "unpriced"
    assert cost.currency is None
    assert cost.input_tokens == 1000
    assert cost.output_tokens == 500
    assert cost.input_cost is None
    assert cost.output_cost is None
    assert cost.total_cost is None


def test_model_pricing_returns_unpriced_result_for_unsupported_service_tier() -> None:
    model_provider = _catalog_provider("OpenAIHTTPAgent:gpt-5-nano")

    cost = estimate_model_token_cost(
        model_provider=model_provider,
        usage=Usage(input_tokens=1000, output_tokens=500, total_tokens=1500),
        service_tier="priority",
    )

    assert cost.priced is False
    assert cost.service_tier == "priority"
    assert cost.unpriced_reason == "service_tier_unsupported"
    assert cost.input_cost is None
    assert cost.output_cost is None
    assert cost.total_cost is None
