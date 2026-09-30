from __future__ import annotations

from openai.types.completion_usage import CompletionUsage

from animama.domain.usage import Usage, UsageInputDetails, UsageOutputDetails


def usage_from_chat_completion_usage(value: CompletionUsage | None) -> Usage:
    if value is None:
        return Usage()
    prompt_details = value.prompt_tokens_details
    completion_details = value.completion_tokens_details
    return Usage(
        requests=1,
        input_tokens=int(value.prompt_tokens or 0),
        output_tokens=int(value.completion_tokens or 0),
        total_tokens=int(value.total_tokens or 0),
        input_tokens_details=UsageInputDetails(
            cached_tokens=_optional_int(getattr(prompt_details, "cached_tokens", None)),
            audio_tokens=_optional_int(getattr(prompt_details, "audio_tokens", None)),
            cache_write_tokens=_optional_int(getattr(prompt_details, "cache_write_tokens", None)),
        ),
        output_tokens_details=UsageOutputDetails(
            reasoning_tokens=_optional_int(getattr(completion_details, "reasoning_tokens", None)),
            audio_tokens=_optional_int(getattr(completion_details, "audio_tokens", None)),
            accepted_prediction_tokens=_optional_int(getattr(completion_details, "accepted_prediction_tokens", None)),
            rejected_prediction_tokens=_optional_int(getattr(completion_details, "rejected_prediction_tokens", None)),
        ),
    )


def _optional_int(value: int | None) -> int:
    return int(value or 0)


__all__ = ["usage_from_chat_completion_usage"]
