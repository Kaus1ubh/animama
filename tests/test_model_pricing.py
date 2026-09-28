from __future__ import annotations

from decimal import Decimal

import pytest

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


def test_model_pricing_calculates_standard_gpt_6_luna_cost_without_cached_input() -> None:
    model_provider = _catalog_provider("OpenAIResponsesHTTPAgent:gpt-6-luna")
    usage = Usage(
        input_tokens=1000,
        output_tokens=500,
        total_tokens=1500,
        output_tokens_details=UsageOutputDetails(reasoning_tokens=100),
    )

    cost = estimate_model_token_cost(model_provider=model_provider, usage=usage)

    assert cost.priced is True
    assert cost.unpriced_reason is None
    assert cost.service_tier == "standard"
    assert cost.currency == "USD"
    assert cost.billing_unit == "1M_tokens"
    assert cost.input_tokens == 1000
    assert cost.cached_input_tokens == 0
    assert cost.uncached_input_tokens == 1000
    assert cost.output_tokens == 500
    assert cost.output_reasoning_tokens == 100
    assert cost.input_price_per_million == Decimal("0.10")
    assert cost.cached_input_price_per_million is None
    assert cost.output_price_per_million == Decimal("0.50")
    assert cost.uncached_input_cost == Decimal("0.0001")
    assert cost.cached_input_cost == Decimal("0")
    assert cost.input_cost == Decimal("0.0001")
    assert cost.output_cost == Decimal("0.00025")
    assert cost.total_cost == Decimal("0.00035")


def test_model_pricing_leaves_gpt_6_luna_unpriced_when_cached_input_is_reported() -> None:
    # The cached-input rate is unknown; charging cached tokens at zero would understate cost.
    model_provider = _catalog_provider("OpenAIHTTPAgent:gpt-6-luna")
    usage = Usage(
        input_tokens=1000,
        output_tokens=500,
        total_tokens=1500,
        input_tokens_details=UsageInputDetails(cached_tokens=200),
    )

    cost = estimate_model_token_cost(model_provider=model_provider, usage=usage)

    assert cost.priced is False
    assert cost.unpriced_reason == "rate_unavailable"
    assert cost.input_price_per_million == Decimal("0.10")
    assert cost.cached_input_price_per_million is None
    assert cost.total_cost is None


def test_model_pricing_normalizes_default_service_tier_to_standard() -> None:
    model_provider = _catalog_provider("OpenAIHTTPAgent:gpt-6-luna")

    cost = estimate_model_token_cost(
        model_provider=model_provider,
        usage=Usage(input_tokens=1, output_tokens=1, total_tokens=2),
        service_tier="default",
    )

    assert cost.priced is True
    assert cost.service_tier == "standard"
    assert cost.total_cost == Decimal("6E-7")


def test_model_pricing_returns_unpriced_result_for_unpriced_provider_row() -> None:
    # Owner-added rows are unpriced; unknown pricing must never be zero.
    model_provider = ModelProvider(
        id="owner:local-model",
        model="local-model",
        provider_type="OpenAIHTTPAgent",
        model_label="local-model",
        provider_label="Ollama",
        source="owner",
    )

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


@pytest.mark.parametrize("service_tier", ["batch", "flex", "priority"])
def test_model_pricing_returns_unpriced_result_for_tiers_without_known_rates(service_tier: str) -> None:
    model_provider = _catalog_provider("OpenAIResponsesHTTPAgent:gpt-6-luna")

    cost = estimate_model_token_cost(
        model_provider=model_provider,
        usage=Usage(input_tokens=1000, output_tokens=500, total_tokens=1500),
        service_tier=service_tier,
    )

    assert cost.priced is False
    assert cost.service_tier == service_tier
    assert cost.unpriced_reason == "service_tier_unsupported"
    assert cost.input_cost is None
    assert cost.output_cost is None
    assert cost.total_cost is None
