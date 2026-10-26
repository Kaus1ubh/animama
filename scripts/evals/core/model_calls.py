"""The budgeted model client that every evaluation turn calls through, and its call records."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field

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
    "CallRecord",
    "Clock",
    "UnusedModelClient",
    "call_latency",
    "seconds",
]

BUDGET_ERROR_CODE = "eval_call_budget_spent"

Clock = Callable[[], float]
"""A monotonic clock in seconds; runs use ``time.monotonic`` and tests inject a fake."""


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


class BudgetedModelClient:
    """Dispatch at most ``max_calls`` requests to the wrapped client and record each call.

    A request beyond the budget is refused with a model-client error before it
    reaches the provider; the runner then discards that turn and stops.
    """

    def __init__(self, client: ModelClient, *, max_calls: int, clock: Clock) -> None:
        self._client = client
        self._max_calls = max_calls
        self._clock = clock
        self.calls: list[CallRecord] = []
        self.refused = False

    @property
    def native_context_compaction(self) -> bool:
        """Report the wrapped client's value so chat fits prompts exactly as it would without the budget."""

        return uses_native_context_compaction(self._client)

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        if len(self.calls) >= self._max_calls:
            self.refused = True
            raise ModelClientError("The evaluation call budget is spent", code=BUDGET_ERROR_CODE)
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
