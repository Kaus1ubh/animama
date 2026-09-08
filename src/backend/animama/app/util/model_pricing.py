from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal

from animama.domain.model_provider import ModelProvider, ModelProviderPricing
from animama.domain.usage import Usage

_ONE_MILLION = Decimal("1000000")
_STANDARD_TIER = "standard"
_SERVICE_TIER_ALIASES = {
    "": _STANDARD_TIER,
    "auto": _STANDARD_TIER,
    "default": _STANDARD_TIER,
    _STANDARD_TIER: _STANDARD_TIER,
    "batch": "batch",
    "flex": "flex",
    "priority": "priority",
}
_PRICE_FIELDS_BY_TIER = {
    "standard": (
        "standard_input_price_per_million",
        "standard_cached_input_price_per_million",
        "standard_output_price_per_million",
    ),
    "batch": (
        "batch_input_price_per_million",
        "batch_cached_input_price_per_million",
        "batch_output_price_per_million",
    ),
    "flex": (
        "flex_input_price_per_million",
        "flex_cached_input_price_per_million",
        "flex_output_price_per_million",
    ),
    "priority": (
        "priority_input_price_per_million",
        "priority_cached_input_price_per_million",
        "priority_output_price_per_million",
    ),
}


@dataclass(frozen=True, slots=True)
class ModelTokenCost:
    """Token-cost estimate for one usage payload and provider/model catalog row."""

    model_provider_id: str
    provider_type: str
    model: str
    service_tier: str
    priced: bool
    unpriced_reason: str | None
    currency: str | None
    billing_unit: str | None
    input_tokens: int
    cached_input_tokens: int
    uncached_input_tokens: int
    output_tokens: int
    output_reasoning_tokens: int
    input_price_per_million: Decimal | None
    cached_input_price_per_million: Decimal | None
    output_price_per_million: Decimal | None
    uncached_input_cost: Decimal | None
    cached_input_cost: Decimal | None
    input_cost: Decimal | None
    output_cost: Decimal | None
    total_cost: Decimal | None


def _normalize_service_tier(service_tier: str | None) -> str:
    raw = str(service_tier or _STANDARD_TIER).strip().lower()
    return _SERVICE_TIER_ALIASES.get(raw, raw)


def _non_negative_int(value: int | None) -> int:
    return max(0, int(value or 0))


def _usage_counts(usage: Usage | None) -> tuple[int, int, int, int, int]:
    if usage is None:
        return 0, 0, 0, 0, 0
    input_tokens = _non_negative_int(getattr(usage, "input_tokens", 0))
    cached_input_tokens = _non_negative_int(getattr(getattr(usage, "input_tokens_details", None), "cached_tokens", 0))
    uncached_input_tokens = max(input_tokens - cached_input_tokens, 0)
    output_tokens = _non_negative_int(getattr(usage, "output_tokens", 0))
    output_reasoning_tokens = _non_negative_int(
        getattr(getattr(usage, "output_tokens_details", None), "reasoning_tokens", 0)
    )
    return input_tokens, cached_input_tokens, uncached_input_tokens, output_tokens, output_reasoning_tokens


def _prices_for_tier(
    pricing: ModelProviderPricing,
    service_tier: str,
) -> tuple[Decimal | None, Decimal | None, Decimal | None]:
    field_names = _PRICE_FIELDS_BY_TIER.get(service_tier)
    if field_names is None:
        return None, None, None
    input_field, cached_input_field, output_field = field_names
    return (
        getattr(pricing, input_field),
        getattr(pricing, cached_input_field),
        getattr(pricing, output_field),
    )


def _unpriced(
    *,
    model_provider: ModelProvider,
    service_tier: str,
    usage: Usage | None,
    reason: str,
    input_price_per_million: Decimal | None = None,
    cached_input_price_per_million: Decimal | None = None,
    output_price_per_million: Decimal | None = None,
) -> ModelTokenCost:
    input_tokens, cached_input_tokens, uncached_input_tokens, output_tokens, output_reasoning_tokens = _usage_counts(
        usage
    )
    return ModelTokenCost(
        model_provider_id=model_provider.id,
        provider_type=model_provider.provider_type,
        model=model_provider.model,
        service_tier=service_tier,
        priced=False,
        unpriced_reason=reason,
        currency=model_provider.pricing.currency,
        billing_unit=model_provider.pricing.billing_unit,
        input_tokens=input_tokens,
        cached_input_tokens=cached_input_tokens,
        uncached_input_tokens=uncached_input_tokens,
        output_tokens=output_tokens,
        output_reasoning_tokens=output_reasoning_tokens,
        input_price_per_million=input_price_per_million,
        cached_input_price_per_million=cached_input_price_per_million,
        output_price_per_million=output_price_per_million,
        uncached_input_cost=None,
        cached_input_cost=None,
        input_cost=None,
        output_cost=None,
        total_cost=None,
    )


def estimate_model_token_cost(
    *,
    model_provider: ModelProvider,
    usage: Usage | None,
    service_tier: str | None = None,
) -> ModelTokenCost:
    """Estimate model token cost from provider usage and catalog pricing.

    Cached input tokens are charged at the cached-input rate. The uncached input
    token count is `max(input_tokens - cached_input_tokens, 0)`. Output
    reasoning tokens are included in `output_tokens` and are not priced
    separately.
    """

    service_tier = _normalize_service_tier(service_tier)
    pricing = model_provider.pricing
    input_tokens, cached_input_tokens, uncached_input_tokens, output_tokens, output_reasoning_tokens = _usage_counts(
        usage
    )
    input_price, cached_input_price, output_price = _prices_for_tier(pricing, service_tier)

    if str(pricing.pricing_status or "").lower() != "priced":
        return _unpriced(
            model_provider=model_provider,
            service_tier=service_tier,
            usage=usage,
            reason=str(pricing.pricing_status or "unpriced"),
            input_price_per_million=input_price,
            cached_input_price_per_million=cached_input_price,
            output_price_per_million=output_price,
        )
    if pricing.billing_unit != "1M_tokens":
        return _unpriced(
            model_provider=model_provider,
            service_tier=service_tier,
            usage=usage,
            reason="unsupported_billing_unit",
            input_price_per_million=input_price,
            cached_input_price_per_million=cached_input_price,
            output_price_per_million=output_price,
        )
    if not pricing.currency:
        return _unpriced(
            model_provider=model_provider,
            service_tier=service_tier,
            usage=usage,
            reason="missing_currency",
            input_price_per_million=input_price,
            cached_input_price_per_million=cached_input_price,
            output_price_per_million=output_price,
        )
    if pricing.service_tiers_supported and service_tier not in pricing.service_tiers_supported:
        return _unpriced(
            model_provider=model_provider,
            service_tier=service_tier,
            usage=usage,
            reason="service_tier_unsupported",
            input_price_per_million=input_price,
            cached_input_price_per_million=cached_input_price,
            output_price_per_million=output_price,
        )
    if (
        (uncached_input_tokens > 0 and input_price is None)
        or (cached_input_tokens > 0 and cached_input_price is None)
        or (output_tokens > 0 and output_price is None)
    ):
        return _unpriced(
            model_provider=model_provider,
            service_tier=service_tier,
            usage=usage,
            reason="rate_unavailable",
            input_price_per_million=input_price,
            cached_input_price_per_million=cached_input_price,
            output_price_per_million=output_price,
        )

    uncached_input_cost = Decimal(uncached_input_tokens) * (input_price or Decimal(0)) / _ONE_MILLION
    cached_input_cost = Decimal(cached_input_tokens) * (cached_input_price or Decimal(0)) / _ONE_MILLION
    input_cost = uncached_input_cost + cached_input_cost
    output_cost = Decimal(output_tokens) * (output_price or Decimal(0)) / _ONE_MILLION

    return ModelTokenCost(
        model_provider_id=model_provider.id,
        provider_type=model_provider.provider_type,
        model=model_provider.model,
        service_tier=service_tier,
        priced=True,
        unpriced_reason=None,
        currency=pricing.currency,
        billing_unit=pricing.billing_unit,
        input_tokens=input_tokens,
        cached_input_tokens=cached_input_tokens,
        uncached_input_tokens=uncached_input_tokens,
        output_tokens=output_tokens,
        output_reasoning_tokens=output_reasoning_tokens,
        input_price_per_million=input_price,
        cached_input_price_per_million=cached_input_price,
        output_price_per_million=output_price,
        uncached_input_cost=uncached_input_cost,
        cached_input_cost=cached_input_cost,
        input_cost=input_cost,
        output_cost=output_cost,
        total_cost=input_cost + output_cost,
    )


__all__ = ["ModelTokenCost", "estimate_model_token_cost"]
