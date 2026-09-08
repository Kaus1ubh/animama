"""Public prompt helper façade backed by :class:`PromptManager`."""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from ..domain.agent import HelperInstructions
from .manager import AgentInstructionProfile, PromptManager

__all__ = [
    "AgentInstructionProfile",
    "PromptManager",
    "DEFAULT_PROMPT_MANAGER",
    "build_helper_prompt",
    "build_agent_instructions",
    "render_graph_context_section",
]


DEFAULT_PROMPT_MANAGER = PromptManager()


def build_helper_prompt(
    *,
    role: str,
    user_prompt: str,
    agent_response: str,
    helper_node: Any,
    source_node: Any,
    prompt_override: str | None = None,
) -> str:
    """Return a helper prompt based on role and context."""

    return DEFAULT_PROMPT_MANAGER.build_helper_prompt(
        role=role,
        user_prompt=user_prompt,
        agent_response=agent_response,
        helper_node=helper_node,
        source_node=source_node,
        prompt_override=prompt_override,
    )


def build_agent_instructions(
    profile: AgentInstructionProfile | None = None,
    *,
    structured_output: bool = False,
    helper: HelperInstructions | None = None,
) -> str:
    """Compose system instructions from reusable sections."""

    return DEFAULT_PROMPT_MANAGER.build_agent_instructions(
        profile,
        structured_output=structured_output,
        helper=helper,
    )


def render_graph_context_section(
    *,
    node_id: str,
    node_name: str | None,
    adjacency: Sequence[tuple[str, str | None]],
) -> str:
    """Render an instruction block describing the execution node and its edges."""

    return PromptManager.render_graph_context_section(
        node_id=node_id,
        node_name=node_name,
        adjacency=adjacency,
    )
