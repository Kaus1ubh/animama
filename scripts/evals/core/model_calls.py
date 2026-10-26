"""The budgeted model client that every evaluation turn calls through, and its call records."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from decimal import Decimal

from animama.app.model_clients import (
    ModelClient,
    ModelClientDelta,
    ModelClientError,
    ModelClientRequest,
    uses_native_context_compaction,
)
from animama.domain.usage import Usage

__all__ = [
    "BUDGET_ERROR_CODE",
    "BudgetedModelClient",
    "CallBudget",
    "CallPrice",
    "CallRecord",
    "Clock",
    "UnusedModelClient",
    "call_latency",
    "seconds",
]

BUDGET_ERROR_CODE = "eval_call_budget_spent"

Clock = Callable[[], float]
"""A monotonic clock in seconds; runs use ``time.monotonic`` and tests inject a fake."""

CallPrice = Callable[[Usage], Decimal | None]
"""A call's estimated USD cost from its reported usage, or ``None`` when it cannot be priced."""


@dataclass(slots=True)
class CallBudget:
    """The call and spend cap one run's budgeted clients share.

    A call is refused before it is sent once ``max_calls`` calls were made, or
    when the spend so far plus the most expensive call seen so far would pass
    ``max_usd``. The new call's cost is unknown until it returns, so a call
    larger than every earlier one (a long chat's growing prompt) can still pass
    the cap by the difference; a call that reports no usage is not charged.
    """

    max_calls: int
    max_usd: Decimal | None = None
    calls: int = 0
    spent_usd: Decimal = Decimal(0)
    largest_call_usd: Decimal = Decimal(0)
    refused: str | None = None
    """Why a call was refused, ``max_calls`` or ``max_usd``; ``None`` while every call was sent."""

    def refusal(self) -> str | None:
        if self.calls >= self.max_calls:
            return "max_calls"
        if self.max_usd is not None and self.spent_usd + self.largest_call_usd > self.max_usd:
            return "max_usd"
        return None

    def charge(self, cost_usd: Decimal) -> None:
        self.spent_usd += cost_usd
        self.largest_call_usd = max(self.largest_call_usd, cost_usd)


@dataclass(slots=True)
class CallRecord:
    started: float
    """Clock reading when the call was dispatched."""
    finished: float | None = None
    """Clock reading when the call's stream ended or failed."""
    first_text: float | None = None
    """Clock reading at the call's first streamed text delta, or ``None`` when it streamed none."""
    usage: Usage | None = None
    """Provider-reported usage, or ``None`` when the call failed or the server reported none."""
    final_text: str | None = None
    """The call's final reply text, or ``None`` when it failed."""
    text_deltas: list[str] = field(default_factory=list)
    """The reply text the call streamed before its final."""
    served_model: str | None = None
    """The model the provider reported serving (``raw_provider_metadata["model"]``), when it reported one."""
    cost_usd: Decimal | None = None
    """The call's estimated cost, when the client prices calls and the call reported usage."""


class BudgetedModelClient:
    """Dispatch requests to the wrapped client within a call budget and record each call.

    The budget is ``max_calls`` calls of this client, or a ``budget`` shared
    with other clients, which can also cap spend when ``price`` prices each
    call. A request beyond the budget is refused with a model-client error
    before it reaches the provider; the runner then discards that turn and stops.
    """

    def __init__(
        self,
        client: ModelClient,
        *,
        clock: Clock,
        max_calls: int | None = None,
        budget: CallBudget | None = None,
        price: CallPrice | None = None,
    ) -> None:
        if (max_calls is None) == (budget is None):
            raise ValueError("Give exactly one of max_calls and budget")
        self._client = client
        self._budget = budget if budget is not None else CallBudget(max_calls=max_calls or 0)
        self._price = price
        self._clock = clock
        self.calls: list[CallRecord] = []
        self.refused = False

    @property
    def native_context_compaction(self) -> bool:
        """Report the wrapped client's value so chat fits prompts exactly as it would without the budget."""

        return uses_native_context_compaction(self._client)

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        refusal = self._budget.refusal()
        if refusal is not None:
            self.refused = True
            self._budget.refused = refusal
            raise ModelClientError("The evaluation call budget is spent", code=BUDGET_ERROR_CODE)
        self._budget.calls += 1
        record = CallRecord(started=self._clock())
        self.calls.append(record)
        try:
            async for delta in self._client.stream(request):
                if delta.kind == "text_delta" and delta.text:
                    if record.first_text is None:
                        record.first_text = self._clock()
                    record.text_deltas.append(delta.text)
                elif delta.kind == "final" and delta.final is not None:
                    record.final_text = delta.final.text
                    if delta.final.usage_reported:
                        record.usage = delta.final.usage
                        if self._price is not None:
                            record.cost_usd = self._price(delta.final.usage)
                            if record.cost_usd is not None:
                                self._budget.charge(record.cost_usd)
                    served = delta.final.raw_provider_metadata.get("model")
                    record.served_model = served if isinstance(served, str) and served else None
                    # The final reply has arrived; a trailing ``done`` delta adds nothing to wait for.
                    record.finished = self._clock()
                yield delta
        finally:
            if record.finished is None:
                record.finished = self._clock()

    async def aclose(self) -> None:
        """The composition closes the wrapped registry client."""


class UnusedModelClient:
    """Registered only so chat can prepare a turn for the token estimate; it is never called."""

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        raise AssertionError("The token estimate prepares turns without calling a model")
        yield  # pragma: no cover - makes this an async generator

    async def aclose(self) -> None:
        """Nothing to close."""


def seconds(value: float) -> float:
    return round(value, 4)


def call_latency(call: CallRecord) -> dict[str, float | None]:
    """One model call's duration and its time to the first streamed text delta (``None`` when none streamed)."""

    finished = call.finished if call.finished is not None else call.started
    return {
        "seconds": seconds(finished - call.started),
        "first_text_seconds": seconds(call.first_text - call.started) if call.first_text is not None else None,
    }
