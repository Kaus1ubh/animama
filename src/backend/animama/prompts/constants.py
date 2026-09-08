from __future__ import annotations

from textwrap import dedent

# Shared prompt-related constants consumed by PromptManager.


# High-level runtime overview for inclusion in system instructions
ANIMAMA_FRAMEWORK_OVERVIEW = dedent(
    """
    ## Anima Runtime Overview
    You operate as a node in a graph. Follow response guidelines and collaborate
    with helpers when requested. Keep outputs concise and policy-compliant.
    """
).strip()


# Response guideline sections (base + per-profile suffix)
RESPONSE_GUIDELINES_BASE: tuple[str, ...] = (
    "## Response Guidelines",
    "- Be concise, accurate, and helpful.",
    "- Use provided context when relevant; avoid fabrications.",
    "- Ask clarifying questions when requirements are unclear.",
)

RESPONSE_GUIDELINES_SUFFIXES: dict[str, str] = {
    "default": "- Provide a direct, user-focused answer.",
    "chat_with_supervisor": "- If delegating, acknowledge the helper engagement and what to expect next.",
    "supervisor": "- Emphasize policy compliance and sound reasoning in decisions.",
    "memory_manager": "- Summarize any durable context updates made by available tooling.",
    "summarizer": "- Produce a clear summary highlighting owners and next steps.",
}
