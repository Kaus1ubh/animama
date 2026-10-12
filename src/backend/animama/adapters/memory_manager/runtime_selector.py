"""Choose the Memory Manager runtime by the provider type of the row that runs each step (D11)."""

from __future__ import annotations

from collections.abc import Callable, Sequence

from animama.app.chat.api_standard import ANTHROPIC_MESSAGES_PROVIDER_TYPE
from animama.app.ports.memory_manager_runtime import (
    MemoryManagerPinnedModelUnavailableError,
    MemoryManagerRuntime,
    MemoryManagerRuntimeResult,
)
from animama.app.ports.model_provider_port import ModelProviderRepository
from animama.domain import ModelProvider
from animama.domain.memory_manager import MemoryManagerApproval, MemoryManagerMessage, MemoryManagerRun

MemoryManagerRuntimeBuilder = Callable[[ModelProvider | None], MemoryManagerRuntime]
"""Builds one runtime kind for a row; ``None`` builds it without a role row, to resolve a pinned one."""


class MemoryManagerRuntimeSelector:
    """Run each Memory Manager step on the runtime that serves its row.

    New messages run on the Memory Manager role's row: Anthropic rows on the
    Anthropic runtime, every other row on the OpenAI Agents runtime. An
    approval resumes on the runtime of the row the run is pinned to (the one
    that proposed the change), even after the role moved to another provider.
    """

    def __init__(
        self,
        *,
        model_provider: ModelProvider | None,
        model_providers: ModelProviderRepository | None,
        openai_agents: MemoryManagerRuntimeBuilder,
        anthropic: MemoryManagerRuntimeBuilder,
    ) -> None:
        self._model_providers = model_providers
        self._openai_agents = openai_agents
        self._anthropic = anthropic
        self.role_runtime = self._builder_for(model_provider)(model_provider)
        self.name = self.role_runtime.name

    @property
    def model_provider_id(self) -> str | None:
        return self.role_runtime.model_provider_id

    async def for_run(self, run: MemoryManagerRun) -> MemoryManagerRuntime:
        """Return the runtime of the row ``run`` is pinned to.

        Raises ``MemoryManagerPinnedModelUnavailableError`` when that row was
        removed or can no longer run the Memory Manager; the pinned row's own
        runtime checks the row, its connection and its key.
        """

        pinned_id = run.model_provider_id
        if pinned_id is None or pinned_id == self.model_provider_id:
            return await self.role_runtime.for_run(run)
        row = await self._model_providers.get(pinned_id) if self._model_providers is not None else None
        if row is None:
            raise MemoryManagerPinnedModelUnavailableError()
        return await self._builder_for(row)(None).for_run(run)

    async def run_user_message(
        self,
        *,
        run: MemoryManagerRun,
        user_message: MemoryManagerMessage,
        history: Sequence[MemoryManagerMessage] = (),
    ) -> MemoryManagerRuntimeResult:
        return await self.role_runtime.run_user_message(run=run, user_message=user_message, history=history)

    async def resume_approval_decision(
        self,
        *,
        run: MemoryManagerRun,
        approval: MemoryManagerApproval,
        decision: str,
        feedback: str | None = None,
    ) -> MemoryManagerRuntimeResult:
        runtime = await self.for_run(run)
        return await runtime.resume_approval_decision(run=run, approval=approval, decision=decision, feedback=feedback)

    def _builder_for(self, row: ModelProvider | None) -> MemoryManagerRuntimeBuilder:
        if row is not None and row.provider_type == ANTHROPIC_MESSAGES_PROVIDER_TYPE:
            return self._anthropic
        return self._openai_agents


__all__ = ["MemoryManagerRuntimeBuilder", "MemoryManagerRuntimeSelector"]
