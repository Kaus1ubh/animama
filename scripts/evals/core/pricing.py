"""Usage totals and cost estimates for evaluation turns."""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

from animama.app.util.model_pricing import estimate_model_token_cost
from animama.domain import ModelProvider
from animama.domain.usage import Usage, UsageInputDetails, UsageOutputDetails

from .inputs import EvalInputError
from .model_calls import CallRecord

__all__ = ["USAGE_KEYS", "TokenPrices", "cost_json", "parse_token_prices", "sum_usage_json", "usage_json"]

USAGE_KEYS = (
    "input_tokens",
    "cached_input_tokens",
    "cache_write_tokens",
    "output_tokens",
    "reasoning_tokens",
    "total_tokens",
)


@dataclass(frozen=True, slots=True)
class TokenPrices:
    """Published USD rates per 1M tokens, used to estimate each turn's cost.

    Uncached input is ``input_tokens - cached_input_tokens - cache_write_tokens``,
    as chat's usage model and catalog estimator define it. Reasoning tokens are
    part of ``output_tokens`` and bill at the output rate.
    """

    input: Decimal
    cached_input: Decimal
    cache_write: Decimal
    output: Decimal

    def cost(self, usage: Mapping[str, int]) -> Decimal:
        uncached = max(usage["input_tokens"] - usage["cached_input_tokens"] - usage["cache_write_tokens"], 0)
        return (
            uncached * self.input
            + usage["cached_input_tokens"] * self.cached_input
            + usage["cache_write_tokens"] * self.cache_write
            + usage["output_tokens"] * self.output
        ) / _ONE_MILLION

    def as_json(self) -> dict[str, str]:
        return {name: str(getattr(self, name)) for name in _PRICE_NAMES}


_ONE_MILLION = Decimal(1_000_000)
_PRICE_NAMES = ("input", "cached_input", "cache_write", "output")


def parse_token_prices(text: str) -> TokenPrices:
    """Parse ``input=…,cached_input=…,cache_write=…,output=…`` (USD per 1M tokens); every rate is required."""

    rates: dict[str, Decimal] = {}
    for part in text.split(","):
        name, separator, value = part.partition("=")
        name = name.strip()
        if not separator or name not in _PRICE_NAMES:
            raise EvalInputError(
                f"--price: unknown or malformed rate {part.strip()!r}; expected {', '.join(_PRICE_NAMES)}"
            )
        try:
            rate = Decimal(value.strip())
        except InvalidOperation as exc:
            raise EvalInputError(f"--price: {name} must be a number") from exc
        if not rate.is_finite() or rate < 0:
            raise EvalInputError(f"--price: {name} must be a non-negative number")
        if name in rates:
            raise EvalInputError(f"--price: duplicate rate {name!r}")
        rates[name] = rate
    missing = [name for name in _PRICE_NAMES if name not in rates]
    if missing:
        raise EvalInputError(f"--price: missing {', '.join(missing)}")
    return TokenPrices(**rates)


def usage_json(calls: Iterable[CallRecord]) -> dict[str, int]:
    """Sum the calls' reported usage; ``unreported_calls`` counts completed calls that reported none.

    A call that failed before its final (for example an oversized prompt that
    chat then retries) reported nothing and is not counted as unreported.
    """

    totals = dict.fromkeys((*USAGE_KEYS, "unreported_calls"), 0)
    for call in calls:
        usage = call.usage
        if usage is None:
            if call.final_text is not None:
                totals["unreported_calls"] += 1
            continue
        totals["input_tokens"] += usage.input_tokens
        totals["cached_input_tokens"] += usage.input_tokens_details.cached_tokens
        totals["cache_write_tokens"] += usage.input_tokens_details.cache_write_tokens
        totals["output_tokens"] += usage.output_tokens
        totals["reasoning_tokens"] += usage.output_tokens_details.reasoning_tokens
        totals["total_tokens"] += usage.total_tokens
    return totals


def sum_usage_json(parts: Iterable[Mapping[str, int]]) -> dict[str, int]:
    totals = dict.fromkeys((*USAGE_KEYS, "unreported_calls"), 0)
    for part in parts:
        for key in totals:
            totals[key] += int(part.get(key, 0))
    return totals


def cost_json(model_provider: ModelProvider, usage: Mapping[str, int]) -> dict[str, Any]:
    """Estimate the cost from the catalog row's standard-tier pricing and the reported usage."""

    cost = estimate_model_token_cost(
        model_provider=model_provider,
        usage=Usage(
            input_tokens=usage["input_tokens"],
            output_tokens=usage["output_tokens"],
            total_tokens=usage["total_tokens"],
            input_tokens_details=UsageInputDetails(
                cached_tokens=usage["cached_input_tokens"],
                cache_write_tokens=usage["cache_write_tokens"],
            ),
            output_tokens_details=UsageOutputDetails(reasoning_tokens=usage["reasoning_tokens"]),
        ),
    )
    return {
        "priced": cost.priced,
        "total": f"{cost.total_cost:.6f}" if cost.total_cost is not None else None,
        "currency": cost.currency,
        "service_tier": cost.service_tier,
        "unpriced_reason": cost.unpriced_reason,
        "unreported_calls": usage["unreported_calls"],
    }
