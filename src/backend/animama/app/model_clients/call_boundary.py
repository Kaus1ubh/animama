"""Per-invocation admission and outcome seam for composition-owned accounting."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import Literal, Protocol

from animama.domain.usage import Usage

from .limits import ModelCallLimits
from .types import ModelClient, ModelClientDelta, ModelClientRequest


@dataclass(frozen=True, slots=True)
class AdmittedModelCall:
    """Durable receipt identity and bounded request returned by admission.

    The composition authenticates the owner, assigns the root operation and a
    unique child call, and reserves before returning. It must reject replays
    rather than returning a receipt that has already dispatched.
    """

    owner_id: str
    operation_id: str
    call_id: str
    request: ModelClientRequest


@dataclass(frozen=True, slots=True)
class ModelCallOutcome:
    """An attempted dispatch; absent measured usage always remains uncertain."""

    status: Literal["completed", "incomplete", "failed", "cancelled", "not_dispatched"]
    usage: Usage | None = None
    unmeasured_native_tools: tuple[str, ...] = ()
    """Token usage does not prove zero tool charges; retain their reservation."""


class ModelCallBoundary(Protocol):
    """Storage/policy belongs to the composition, never to shared chat services."""

    async def admit(self, request: ModelClientRequest) -> AdmittedModelCall: ...

    async def finish(self, call: AdmittedModelCall, outcome: ModelCallOutcome) -> None:
        """Persist idempotently; recovery retains a reservation if this fails."""
        ...


class AccountedModelClient:
    """Wrap a request-scoped registry client, including nested utility calls.

    Each stream invocation requires fresh admission. Closing/cancelling closes
    the upstream generator and reports uncertainty; completion is recorded
    before the final delta is exposed. Closing this wrapper does not close the
    underlying shared registry client, whose composition owns its lifetime.
    """

    def __init__(self, client: ModelClient, boundary: ModelCallBoundary) -> None:
        self._client = client
        self._boundary = boundary

    async def stream(self, request: ModelClientRequest) -> AsyncGenerator[ModelClientDelta, None]:
        call = await self._boundary.admit(request)
        limits = call.request.limits
        cleanup_seconds = limits.cleanup_timeout_seconds if limits is not None else 5.0
        native_tools = call.request.provider_options.native_tools
        outcome = ModelCallOutcome("not_dispatched")
        dispatched = False
        finished = False
        stream = None
        try:
            if limits is None:
                raise ValueError("Admitted model calls require explicit limits")
            if native_tools and limits.max_native_tool_calls is None:
                raise ValueError("Admitted native tools require an explicit call limit")
            dispatched = True
            outcome = ModelCallOutcome("incomplete", unmeasured_native_tools=native_tools)
            stream = self._client.stream(call.request)
            async with asyncio.timeout(limits.timeout_seconds):
                async for delta in stream:
                    if delta.kind == "final" and delta.final is not None:
                        final = delta.final
                        outcome = ModelCallOutcome(
                            "completed", final.usage if final.usage_reported else None, native_tools
                        )
                        finished = True
                        await self._boundary.finish(call, outcome)
                        yield delta
                        return
                    if delta.kind == "error":
                        outcome = ModelCallOutcome("failed", unmeasured_native_tools=native_tools)
                    yield delta
        except (asyncio.CancelledError, GeneratorExit):
            if dispatched:
                outcome = ModelCallOutcome("cancelled", unmeasured_native_tools=native_tools)
            raise
        except Exception:
            if dispatched:
                outcome = ModelCallOutcome("failed", unmeasured_native_tools=native_tools)
            raise
        finally:
            try:
                close = getattr(stream, "aclose", None)
                if close is not None:
                    async with asyncio.timeout(cleanup_seconds):
                        await close()
            finally:
                if not finished:
                    async with asyncio.timeout(cleanup_seconds):
                        await self._boundary.finish(call, outcome)

    async def aclose(self) -> None:
        """The owning composition closes the underlying registry once."""


__all__ = ["AccountedModelClient", "AdmittedModelCall", "ModelCallBoundary", "ModelCallLimits", "ModelCallOutcome"]
