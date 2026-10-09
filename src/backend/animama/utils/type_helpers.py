"""Type coercion helpers shared across the anima framework."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from animama.domain.enums import AgentInstructionProfile
from animama.domain.types import Modality

__all__ = [
    "coerce_int",
    "coerce_optional_int",
    "coerce_instruction_profile",
    "normalize_instruction_profile",
    "coerce_modalities",
    "coerce_provider_type",
]


def coerce_optional_int(value: Any) -> int | None:
    """Best-effort conversion of ``value`` to ``int`` returning ``None`` on failure."""

    if value is None:
        return None
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int | float):
        return int(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def coerce_int(value: Any, *, default: int = 0) -> int:
    """Return an ``int`` from ``value`` or ``default`` when conversion fails."""

    coerced = coerce_optional_int(value)
    if coerced is None:
        return default
    return coerced


def coerce_instruction_profile(value: Any) -> AgentInstructionProfile | None:
    """Coerce a loose string token into AgentInstructionProfile.

    Returns None for empty/unknown values. Accepts a small, explicit set of tokens.
    """

    if isinstance(value, AgentInstructionProfile):
        return value
    if value is None:
        return None
    s = str(value).strip().lower().replace("-", "_")
    if not s:
        return None
    if s in {"default", "chat", "chat_profile"}:
        return AgentInstructionProfile.DEFAULT
    if s in {"chat_with_supervisor", "chat_supervisor", "with_supervisor"}:
        return AgentInstructionProfile.CHAT_WITH_SUPERVISOR
    if s in {"supervisor"}:
        return AgentInstructionProfile.SUPERVISOR
    if s in {"memory_manager", "memorymanager"}:
        return AgentInstructionProfile.MEMORY_MANAGER
    if s in {"summarizer", "summariser"}:
        return AgentInstructionProfile.SUMMARIZER
    if s in {"emotional_analyst", "emotional_analyst_profile", "emotional-analyst"}:
        return AgentInstructionProfile.EMOTIONAL_ANALYST
    return None


def normalize_instruction_profile(value: Any) -> AgentInstructionProfile | str | None:
    """Return a known profile enum or preserve a custom token string.

    Known profile tokens map to AgentInstructionProfile. Unknown non-empty strings
    are returned verbatim (except "custom", which preserves legacy "no profile").
    """
    prof = coerce_instruction_profile(value)
    if prof is not None:
        return prof
    if value is None:
        return None
    if isinstance(value, str):
        tok = value.strip()
        if not tok:
            return None
        if tok.lower().replace("-", "_") == "custom":
            return None
        return tok
    return None


def coerce_modalities(values: Iterable[Any]) -> set[Modality]:
    """Best-effort conversion of an iterable of values to a set of Modality.

    Ignores unknown/invalid tokens silently.
    """

    out: set[Modality] = set()
    for v in values or ():
        if isinstance(v, Modality):
            out.add(v)
            continue
        try:
            out.add(Modality(str(v)))
        except Exception:
            continue
    return out


def coerce_provider_type(value: str | None) -> str | None:
    """Canonicalize provider type tokens to known adapter class names.

    Recognises common aliases and class names:
    - OpenAI HTTP:  "OpenAIHTTPAgent", "openai_http", "openai", "http_openai", etc.
    - OpenAI Responses HTTP: "OpenAIResponsesHTTPAgent", "openai_responses_http", etc.
    - Anthropic Messages HTTP: "AnthropicMessagesHTTPAgent", "anthropic_messages_http", etc.
    Returns input value when not recognized to keep forward compatibility.
    """

    if not isinstance(value, str):
        return value
    tok = value.strip()
    if not tok:
        return tok
    if tok in ("OpenAIHTTPAgent", "OpenAIResponsesHTTPAgent", "AnthropicMessagesHTTPAgent"):
        return tok
    norm = tok.lower().replace("-", "_")
    if norm in {"openaihttpagent", "openai_http", "openai", "oai_http", "http_openai"}:
        return "OpenAIHTTPAgent"
    if norm in {
        "openairesponseshttpagent",
        "openai_responses_http",
        "openai_http_responses",
        "oai_responses_http",
        "http_openai_responses",
        "responses_openai_http",
        "responses_http_openai",
    }:
        return "OpenAIResponsesHTTPAgent"
    if norm in {"anthropicmessageshttpagent", "anthropic_messages_http", "anthropic_messages"}:
        return "AnthropicMessagesHTTPAgent"
    return value
