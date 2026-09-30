"""Cache-write token counts reach Animama usage from every usage source."""

from __future__ import annotations

from openai.types.completion_usage import CompletionUsage
from openai.types.responses.response_usage import ResponseUsage

from animama.adapters.model_clients.openai_chat_completions.usage import usage_from_chat_completion_usage
from animama.adapters.model_clients.openai_responses.final import usage_from_openai_responses
from animama.app.util.usage import normalize_usage
from animama.domain.usage import Usage, UsageInputDetails


def test_chat_completions_usage_reads_cache_write_tokens() -> None:
    usage = usage_from_chat_completion_usage(
        CompletionUsage.model_validate(
            {
                "prompt_tokens": 1000,
                "completion_tokens": 10,
                "total_tokens": 1010,
                "prompt_tokens_details": {"cached_tokens": 200, "cache_write_tokens": 300},
            }
        )
    )

    assert usage.input_tokens_details.cached_tokens == 200
    assert usage.input_tokens_details.cache_write_tokens == 300


def test_responses_usage_reads_cache_write_tokens() -> None:
    usage = usage_from_openai_responses(
        ResponseUsage.model_validate(
            {
                "input_tokens": 1000,
                "input_tokens_details": {"cached_tokens": 200, "cache_write_tokens": 300},
                "output_tokens": 10,
                "output_tokens_details": {"reasoning_tokens": 0},
                "total_tokens": 1010,
            }
        )
    )

    assert usage.input_tokens_details.cached_tokens == 200
    assert usage.input_tokens_details.cache_write_tokens == 300


def test_normalized_usage_payloads_read_cache_write_tokens() -> None:
    chat = normalize_usage(
        {"prompt_tokens": 5, "completion_tokens": 1, "prompt_tokens_details": {"cache_write_tokens": 4}}
    )
    responses = normalize_usage(
        {"input_tokens": 5, "output_tokens": 1, "input_tokens_details": {"cache_write_tokens": 3}}
    )

    assert chat is not None and chat.input_tokens_details.cache_write_tokens == 4
    assert responses is not None and responses.input_tokens_details.cache_write_tokens == 3


def test_added_usage_keeps_cache_write_tokens() -> None:
    total = Usage(input_tokens_details=UsageInputDetails(cached_tokens=1, cache_write_tokens=2))
    total.add(Usage(input_tokens_details=UsageInputDetails(cached_tokens=3, cache_write_tokens=4)))

    assert total.input_tokens_details.cached_tokens == 4
    assert total.input_tokens_details.cache_write_tokens == 6
