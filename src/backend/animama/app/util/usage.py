from __future__ import annotations

from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from animama.logging import get_logger
from animama.utils.type_helpers import coerce_optional_int

from ...domain.usage import Usage, UsageInputDetails, UsageOutputDetails

# Optional type imports for static typing without forcing runtime deps
if TYPE_CHECKING:  # pragma: no cover - typing only
    from agents import Usage as OAIUsage  # OpenAI Agents SDK

    # Public alias for supported payloads (typing-only to avoid runtime deps)
    UsagePayload = Mapping[str, Any] | OAIUsage


log = get_logger("normalize_usage")


def normalize_usage(payload: UsagePayload | None) -> Usage | None:
    """Normalize provider usage payloads to a domain Usage object.

    Supports:
    - OpenAI Chat Completions: prompt_tokens, completion_tokens, total_tokens,
      prompt_tokens_details.cached_tokens, completion_tokens_details.reasoning_tokens
    - OpenAI Responses API: input_tokens, output_tokens, total_tokens,
      input_tokens_details.cached_tokens, output_tokens_details.reasoning_tokens
    Returns None when payload is None or unrecognized.
    """
    if payload is None:
        return None

    # If it's already a Usage instance, return as-is
    if isinstance(payload, Usage):
        return payload
    log.info("Normalizing usage payload", payload=payload)
    if isinstance(payload, Mapping):
        # Detect Chat Completions style
        if "prompt_tokens" in payload or "completion_tokens" in payload:
            pt = coerce_optional_int(payload.get("prompt_tokens"))
            ct = coerce_optional_int(payload.get("completion_tokens"))
            tt = coerce_optional_int(payload.get("total_tokens"))
            ptd = payload.get("prompt_tokens_details") or {}
            ctd = payload.get("completion_tokens_details") or {}
            in_det = None
            out_det = None
            if isinstance(ptd, Mapping):
                in_det = UsageInputDetails(
                    cached_tokens=coerce_optional_int(ptd.get("cached_tokens")) or 0,
                    audio_tokens=coerce_optional_int(ptd.get("audio_tokens")) or 0,
                )
            if isinstance(ctd, Mapping):
                out_det = UsageOutputDetails(
                    reasoning_tokens=coerce_optional_int(ctd.get("reasoning_tokens")) or 0,
                    audio_tokens=coerce_optional_int(ctd.get("audio_tokens")) or 0,
                    accepted_prediction_tokens=coerce_optional_int(ctd.get("accepted_prediction_tokens")) or 0,
                    rejected_prediction_tokens=coerce_optional_int(ctd.get("rejected_prediction_tokens")) or 0,
                )
            return Usage(
                requests=1,
                input_tokens=pt or 0,
                output_tokens=ct or 0,
                total_tokens=tt or 0,
                input_tokens_details=in_det or UsageInputDetails(),
                output_tokens_details=out_det or UsageOutputDetails(),
            )

        # Detect Responses API style
        if "input_tokens" in payload or "output_tokens" in payload:
            it = coerce_optional_int(payload.get("input_tokens"))
            ot = coerce_optional_int(payload.get("output_tokens"))
            tt = coerce_optional_int(payload.get("total_tokens"))
            itd = payload.get("input_tokens_details") or {}
            otd = payload.get("output_tokens_details") or {}
            in_det = None
            out_det = None
            if isinstance(itd, Mapping):
                in_det = UsageInputDetails(
                    cached_tokens=coerce_optional_int(itd.get("cached_tokens")) or 0,
                    audio_tokens=coerce_optional_int(itd.get("audio_tokens")) or 0,
                )
            if isinstance(otd, Mapping):
                out_det = UsageOutputDetails(
                    reasoning_tokens=coerce_optional_int(otd.get("reasoning_tokens")) or 0,
                    audio_tokens=coerce_optional_int(otd.get("audio_tokens")) or 0,
                    accepted_prediction_tokens=coerce_optional_int(otd.get("accepted_prediction_tokens")) or 0,
                    rejected_prediction_tokens=coerce_optional_int(otd.get("rejected_prediction_tokens")) or 0,
                )
            return Usage(
                requests=1,
                input_tokens=it or 0,
                output_tokens=ot or 0,
                total_tokens=tt or 0,
                input_tokens_details=in_det or UsageInputDetails(),
                output_tokens_details=out_det or UsageOutputDetails(),
            )
    # Agents SDK Usage -> domain Usage (guard import at runtime)
    try:  # pragma: no cover - optional dependency at runtime
        from agents import Usage as _OAIUsage

        if isinstance(payload, _OAIUsage):
            try:
                # Build detailed counters if available on the SDK payload
                in_det = None
                try:
                    itd = getattr(payload, "input_tokens_details", None)
                    if itd is not None:
                        in_det = UsageInputDetails(
                            cached_tokens=int(getattr(itd, "cached_tokens", 0) or 0),
                            audio_tokens=0,
                        )
                except Exception:
                    in_det = None

                out_det = None
                try:
                    otd = getattr(payload, "output_tokens_details", None)
                    if otd is not None:
                        out_det = UsageOutputDetails(
                            reasoning_tokens=int(getattr(otd, "reasoning_tokens", 0) or 0),
                            audio_tokens=0,
                            accepted_prediction_tokens=0,
                            rejected_prediction_tokens=0,
                        )
                except Exception:
                    out_det = None

                return Usage(
                    requests=int(getattr(payload, "requests", 0) or 0),
                    input_tokens=int(getattr(payload, "input_tokens", 0) or 0),
                    output_tokens=int(getattr(payload, "output_tokens", 0) or 0),
                    total_tokens=int(getattr(payload, "total_tokens", 0) or 0),
                    input_tokens_details=in_det or UsageInputDetails(),
                    output_tokens_details=out_det or UsageOutputDetails(),
                )
            except Exception:
                # If anything goes wrong, fall through to generic handling below
                log.warning("Failed to extract OpenAI Agents Usage payload")
                pass
    except Exception:
        pass

    return None
