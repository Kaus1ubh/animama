"""Generic wrapper for the OpenAI Agents SDK run/pause surface."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from agents import Agent, RunConfig, RunState


@dataclass(slots=True)
class OpenAIAgentsRunOutput:
    """Small stable subset of an OpenAI Agents SDK run result."""

    final_output: str | None
    interruptions: list[Any]
    serialized_agent_state: str | None
    last_response_id: str | None
    state: RunState | None
    usage_metadata: dict[str, Any]
    metadata: dict[str, Any]


class OpenAIAgentsRunner:
    """Run Agents SDK agents and normalize completion versus approval pauses."""

    async def run(
        self,
        *,
        agent: Agent[Any],
        input_value: Any,
        context: dict[str, Any] | None = None,
        run_config: RunConfig | None = None,
        max_turns: int | None = 10,
        previous_response_id: str | None = None,
        auto_previous_response_id: bool = False,
    ) -> OpenAIAgentsRunOutput:
        """Execute one SDK run segment."""

        from agents import Runner

        result = await Runner.run(
            agent,
            input_value,
            context=context or {},
            max_turns=max_turns,
            run_config=run_config,
            previous_response_id=previous_response_id,
            auto_previous_response_id=auto_previous_response_id,
        )
        return self._normalize_result(result)

    async def load_state(
        self,
        *,
        agent: Agent[Any],
        serialized_state: str,
        context: dict[str, Any] | None = None,
        turn_budget: int | None = None,
    ) -> RunState:
        """Deserialize one persisted SDK run state.

        ``turn_budget`` gives the resumed run that many more model turns. A
        resumed state keeps its turn count and its own ``max_turns``; the SDK
        ignores the ``max_turns`` passed to ``Runner.run`` with a state
        (openai-agents 0.18). The budget is therefore written to the snapshot's
        public ``max_turns`` field, relative to its ``current_turn``, before
        ``RunState.from_json`` reads it.
        """

        import json

        from agents import RunState

        state_json = json.loads(serialized_state)
        if turn_budget is not None:
            state_json["max_turns"] = int(state_json.get("current_turn") or 0) + turn_budget
        return await RunState.from_json(agent, state_json, context_override=context or {})

    async def resume_state(
        self,
        *,
        agent: Agent[Any],
        state: RunState,
        run_config: RunConfig | None = None,
        max_turns: int | None = 10,
    ) -> OpenAIAgentsRunOutput:
        """Resume a prepared SDK run state.

        The SDK runs a state within the state's own ``max_turns``; give a
        persisted state a fresh budget through ``load_state(turn_budget=...)``.
        """

        from agents import Runner

        result = await Runner.run(agent, state, max_turns=max_turns, run_config=run_config)
        return self._normalize_result(result)

    @staticmethod
    def _normalize_result(result: Any) -> OpenAIAgentsRunOutput:
        interruptions = list(getattr(result, "interruptions", []) or [])
        serialized_agent_state = None
        state = None
        if interruptions:
            state = result.to_state()
            serialized_agent_state = state.to_string()

        usage_metadata = _usage_metadata(result)
        last_response_id = _nonblank_string(getattr(result, "last_response_id", None))
        metadata = {
            "has_last_response_id": last_response_id is not None,
            "raw_response_count": len(getattr(result, "raw_responses", []) or []),
            "interruption_count": len(interruptions),
        }
        final_output = getattr(result, "final_output", None)
        return OpenAIAgentsRunOutput(
            final_output=str(final_output) if final_output is not None else None,
            interruptions=interruptions,
            serialized_agent_state=serialized_agent_state,
            last_response_id=last_response_id,
            state=state,
            usage_metadata=usage_metadata,
            metadata=metadata,
        )


def _nonblank_string(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _usage_metadata(result: Any) -> dict[str, Any]:
    context_wrapper = getattr(result, "context_wrapper", None)
    usage = getattr(context_wrapper, "usage", None)
    if usage is None:
        raw_responses = list(getattr(result, "raw_responses", []) or [])
        if raw_responses:
            usage = getattr(raw_responses[-1], "usage", None)
    if usage is None:
        return {}
    return {
        "requests": int(getattr(usage, "requests", 0) or 0),
        "input_tokens": int(getattr(usage, "input_tokens", 0) or 0),
        "output_tokens": int(getattr(usage, "output_tokens", 0) or 0),
        "total_tokens": int(getattr(usage, "total_tokens", 0) or 0),
    }


__all__ = ["OpenAIAgentsRunOutput", "OpenAIAgentsRunner"]
