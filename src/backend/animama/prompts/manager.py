from __future__ import annotations

from collections.abc import Sequence
from typing import Any

from ..domain.agent import HelperInstructionData, HelperInstructions
from ..domain.enums import AgentInstructionProfile
from .avatar_animation_manifest import render_available_animations
from .constants import (
    ANIMAMA_FRAMEWORK_OVERVIEW,
    RESPONSE_GUIDELINES_BASE,
    RESPONSE_GUIDELINES_SUFFIXES,
)
from .profiles import PROFILE_TEMPLATES, ProfileTemplate

__all__ = [
    "AgentInstructionProfile",
    "PromptManager",
]

from animama.logging import get_logger

log = get_logger("PromptManager")


class PromptManager:
    """Container for reusable prompt rendering helpers."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def build_helper_prompt(
        self,
        *,
        role: str,
        user_prompt: str,
        agent_response: str,
        helper_node: Any,
        source_node: Any,
        prompt_override: str | None = None,
    ) -> str:
        """Return a helper prompt based on role and context."""
        log.info("PromptManager - building helper prompt")
        role_key = (role or "").strip().lower()
        template = prompt_override or self._resolve_helper_prompt(role_key)

        user_prompt_text = (user_prompt or "").strip() or "(no direct user prompt provided)"
        agent_response_text = (agent_response or "").strip() or "(no draft response provided)"

        context = {
            "USER_PROMPT": user_prompt_text,
            "AGENT_RESPONSE": agent_response_text,
            "HELPER_NAME": getattr(helper_node, "name", None) or getattr(helper_node, "id", "helper"),
            "SOURCE_NAME": getattr(source_node, "name", None) or getattr(source_node, "id", "source"),
        }

        return template.format_map(context)

    def build_agent_instructions(
        self,
        profile: AgentInstructionProfile | None = None,
        structured_output: bool = False,
        helper: HelperInstructions | None = None,
    ) -> str:
        """Compose system instructions by stitching together reusable sections.

        When ``profile`` is ``None`` a default is derived from the presence of helper metadata.
        """
        log.info(
            "PromptManager - build_agent_instructions start",
            profile=profile,
            structured_output=structured_output,
            helper_instructions=helper,
        )

        if profile is None:
            profile = (
                AgentInstructionProfile.CHAT_WITH_SUPERVISOR
                if helper and helper.items
                else AgentInstructionProfile.DEFAULT
            )

        entry = self._profile_entry(profile)
        custom_system = entry.get("system_prompt")
        if isinstance(custom_system, str) and custom_system.strip():
            system_prompt = custom_system.strip()
            if profile == AgentInstructionProfile.EMOTIONAL_ANALYST:
                system_prompt = system_prompt.replace("{available_animations}", render_available_animations())
            return system_prompt

        sections = [self._anima_framework_overview()]
        sections.append(self._custom_agent_instructions(profile, helper))

        sections.append(self._response_guidelines(profile))

        if structured_output:
            sections.append(self._structured_output_requirements(profile, helper))
            examples = self._structured_output_examples(profile, helper)
            if examples:
                sections.append(examples)

        log.info("PromptManager - build_agent_instructions end")
        return "\n\n".join(section for section in sections if section)

    @staticmethod
    def render_graph_context_section(
        *,
        node_id: str,
        node_name: str | None,
        adjacency: Sequence[tuple[str, str | None]],
    ) -> str:
        """Render an instruction block describing the execution node and its edges."""
        log.info("PromptManager - render_graph_context_section")
        readable = node_name or node_id
        heading = f"## Graph Execution Context\nYou are currently executing as node `{node_id}` ({readable})."

        lines: list[str] = [heading]

        if adjacency:
            lines.append("Your structured output may propagate to the following adjacent nodes:")
            for target_id, target_name in adjacency:
                display = target_name or target_id
                lines.append(f"- `{display}` (node id: `{target_id}`)")
        else:
            lines.append("This node currently has no outgoing edges.")

        lines.extend(
            [
                "\nRouting guidance:",
                "- Populate `response` with the text meant for the end user stream.",
                "- Request adjacent nodes for assistance if available.",
            ]
        )

        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Prompt section helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _anima_framework_overview() -> str:
        return ANIMAMA_FRAMEWORK_OVERVIEW

    def _response_guidelines(self, profile: AgentInstructionProfile) -> str:
        lines = list(RESPONSE_GUIDELINES_BASE)
        suffix = RESPONSE_GUIDELINES_SUFFIXES.get(profile.value) or RESPONSE_GUIDELINES_SUFFIXES["default"]
        if suffix:
            lines.append(suffix)
        return "\n".join(lines)

    def _structured_output_requirements(
        self,
        profile: AgentInstructionProfile,
        helper: HelperInstructions | None = None,
    ) -> str:
        structured = self._profile_entry(profile).get("structured_output")
        if not structured:
            return ""

        template = structured.get("requirements")
        if not template:
            return ""

        if "{schema_yaml}" in template:
            yaml_override = (
                helper.helper_example_yaml if (helper and isinstance(helper.helper_example_yaml, str)) else None
            )
            schema_yaml = (yaml_override or self._helper_schema_yaml(helper.items if helper else None)).strip()
            return template.replace("{schema_yaml}", schema_yaml)
        return template

    def _structured_output_examples(
        self,
        profile: AgentInstructionProfile,
        helper: HelperInstructions | None = None,
    ) -> str:
        structured = self._profile_entry(profile).get("structured_output")
        if not structured:
            return ""

        template = structured.get("examples_template")
        if template:
            items = helper.items if helper else []
            fields: list[str] = []
            for h in items or []:
                try:
                    fid = getattr(h, "field", None) or getattr(h, "id", None)
                    if fid:
                        fields.append(str(fid))
                except Exception:
                    continue
            if not fields:
                return ""
            helper_list = "\n".join(f"- `{field}`" for field in fields)

            def _render_example(response: str, value: str) -> str:
                lines = [f'response: "{response}"']
                for field_name in fields:
                    lines.append(f'{field_name}: "{value}"')
                return "\n".join(lines)

            request_example = _render_example(
                "Routing a helper for a deeper review. You'll hear from them shortly.",
                "yes",
            )
            solo_example = _render_example(
                "Here's a concise explanation covering the basics you asked for...",
                "no",
            )
            yaml_reference = (
                helper.helper_example_yaml.strip() if (helper and isinstance(helper.helper_example_yaml, str)) else ""
            )
            if yaml_reference:
                yaml_reference = f"```yaml\n{yaml_reference}\n```"
            return template.format(
                helper_list=helper_list,
                request_example=request_example,
                solo_example=solo_example,
                yaml_reference=yaml_reference,
            )
        examples = structured.get("examples")
        return examples if isinstance(examples, str) else ""

    def _custom_agent_instructions(
        self,
        profile: AgentInstructionProfile,
        helper: HelperInstructions | None = None,
    ) -> str:
        base = self._profile_entry(profile).get("guidance") or ""
        if profile == AgentInstructionProfile.CHAT_WITH_SUPERVISOR and helper and helper.items:
            lines = base.rstrip().splitlines()
            lines.append("- Available helpers:")
            for h in helper.items:
                try:
                    field_name = getattr(h, "field", None) or getattr(h, "id", None) or "request_helper"
                    helper_id = getattr(h, "id", None) or field_name
                    role = getattr(h, "role", None) or helper_id
                except Exception:
                    continue
                lines.append(f"- `{field_name}` → requests helper `{helper_id}` ({role})")
            return "\n".join(lines)
        return base

    @staticmethod
    def _helper_schema_yaml(helper_data: Sequence[HelperInstructionData] | None) -> str:
        lines = ['response: "Message for the requester."']
        if helper_data:
            for h in helper_data:
                try:
                    field_name = getattr(h, "field", None) or getattr(h, "id", None) or "request_helper"
                    role = getattr(h, "role", None) or getattr(h, "id", None) or field_name
                except Exception:
                    continue
                lines.append(f'{field_name}: "yes" | "no" | null  # request {role}')
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Internal utilities
    # ------------------------------------------------------------------

    def _profile_entry(self, profile: AgentInstructionProfile) -> ProfileTemplate:
        entry = PROFILE_TEMPLATES.get(profile.value)
        if entry is None:
            entry = PROFILE_TEMPLATES["chat_default"]
        return entry

    def _resolve_helper_prompt(self, role_key: str) -> str:
        if not role_key:
            role_key = "default"

        for entry in PROFILE_TEMPLATES.values():
            helpers = entry.get("helper_prompts") or {}
            prompt = helpers.get(role_key)
            if isinstance(prompt, str):
                return prompt

        default_helpers = PROFILE_TEMPLATES["chat_default"].get("helper_prompts") or {}
        fallback = default_helpers.get(role_key) or default_helpers.get("default")
        if isinstance(fallback, str):
            return fallback

        return "Assist with the following context:\n\nUser request:\n{USER_PROMPT}"
