"""Context budgets and conservative prompt estimates (configurable models Plan B, R10)."""

from __future__ import annotations

from animama.app.model_clients.context_budget import (
    context_budget_for_model,
    estimate_prompt_tokens,
    estimate_text_tokens,
)
from animama.app.model_clients.prompt import direct_model_prompt
from animama.domain import ModelProvider, ModelProviderCapabilities


def _row(window: int | None, max_output: int | None = None) -> ModelProvider:
    return ModelProvider(
        id="owner:row",
        provider_type="OpenAIHTTPAgent",
        model="local",
        model_label="local",
        provider_label="Local",
        active=True,
        capabilities=ModelProviderCapabilities(),
        context_window_tokens=window,
        max_output_tokens=max_output,
    )


def test_budget_reserves_the_recorded_maximum_output() -> None:
    budget = context_budget_for_model(_row(32_000, max_output=2_000))

    assert budget is not None
    assert budget.available_tokens == 30_000
    assert budget.pre_send_trigger_tokens == 27_000
    # 70% of the 32,000 window (22,400) is below 75% of the 30,000 left after the reply (22,500).
    assert budget.post_response_trigger_tokens == 22_400


def test_post_response_trigger_is_seventy_percent_of_the_window() -> None:
    budget = context_budget_for_model(_row(128_000))

    assert budget is not None
    assert budget.post_response_trigger_tokens == int(128_000 * 0.7)


def test_post_response_trigger_keeps_room_before_the_pre_send_trigger_when_the_reply_reserve_is_large() -> None:
    # A large reply reserve leaves less room; 75% of it stays below the pre-send trigger.
    budget = context_budget_for_model(_row(200_000, max_output=128_000))

    assert budget is not None
    assert budget.post_response_trigger_tokens == int(72_000 * 0.75)
    assert budget.post_response_trigger_tokens < budget.pre_send_trigger_tokens


def test_budget_reserves_a_quarter_of_small_windows_up_to_4096() -> None:
    small = context_budget_for_model(_row(4_096))
    large = context_budget_for_model(_row(128_000))

    assert small is not None and small.available_tokens == 3_072
    assert large is not None and large.available_tokens == 128_000 - 4_096


def test_rows_without_a_window_have_no_budget() -> None:
    assert context_budget_for_model(_row(None)) is None


def test_estimate_counts_non_ascii_characters_as_tokens() -> None:
    assert estimate_text_tokens("") == 0
    assert estimate_text_tokens("abcd" * 10) == 10
    # CJK text is roughly a token per character, far above four characters per token.
    assert estimate_text_tokens("你好世界") == 4


def test_prompt_estimate_includes_messages() -> None:
    short = direct_model_prompt(prompt="hi", instructions="be brief")
    long = direct_model_prompt(prompt="hi " * 400, instructions="be brief")

    assert estimate_prompt_tokens(long) > estimate_prompt_tokens(short) + 250
