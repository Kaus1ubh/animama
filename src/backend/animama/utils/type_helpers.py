"""Type coercion helpers shared across the anima framework."""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from animama.domain.types import Modality

__all__ = [
    "coerce_optional_int",
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
