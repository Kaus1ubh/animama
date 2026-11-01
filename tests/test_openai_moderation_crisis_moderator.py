"""The OpenAI moderation-endpoint adapter used as an operator crisis moderator."""

from __future__ import annotations

from typing import Any

import httpx
import pytest
from openai import APIConnectionError
from openai.types import ModerationCreateResponse

from animama.adapters.model_clients.openai_moderation import OpenAIModerationCrisisModerator
from animama.app.model_clients import ModelClientModeration
from animama.app.safety.moderation import OPENAI_MODERATION_MODEL, moderation_indicates_crisis

_CATEGORIES = (
    "harassment",
    "harassment/threatening",
    "hate",
    "hate/threatening",
    "illicit",
    "illicit/violent",
    "self-harm",
    "self-harm/instructions",
    "self-harm/intent",
    "sexual",
    "sexual/minors",
    "violence",
    "violence/graphic",
)


def _response(*flagged: str) -> ModerationCreateResponse:
    return ModerationCreateResponse.model_validate(
        {
            "id": "modr-test",
            "model": OPENAI_MODERATION_MODEL,
            "results": [
                {
                    "flagged": bool(flagged),
                    "categories": {name: name in flagged for name in _CATEGORIES},
                    "category_scores": {name: 0.9 if name in flagged else 0.01 for name in _CATEGORIES},
                    "category_applied_input_types": {name: ["text"] for name in _CATEGORIES},
                }
            ],
        }
    )


class _Moderations:
    def __init__(self, outcome: ModerationCreateResponse | Exception) -> None:
        self.outcome = outcome
        self.calls: list[dict[str, Any]] = []

    async def create(self, **kwargs: Any) -> ModerationCreateResponse:
        self.calls.append(kwargs)
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


class _Client:
    def __init__(self, outcome: ModerationCreateResponse | Exception) -> None:
        self.moderations = _Moderations(outcome)


@pytest.mark.asyncio
async def test_a_self_harm_result_maps_to_api_category_names_and_signals_crisis() -> None:
    client = _Client(_response("self-harm", "self-harm/intent"))

    result = await OpenAIModerationCrisisModerator(client=client).moderate("I want to die")

    assert result.status == "result"
    assert result.flagged_categories == ("self-harm", "self-harm/intent")
    assert result.category_scores["self-harm/intent"] == pytest.approx(0.9)
    assert moderation_indicates_crisis(result)
    # Only the model and the message text are sent.
    assert client.moderations.calls == [{"model": OPENAI_MODERATION_MODEL, "input": "I want to die"}]


@pytest.mark.asyncio
async def test_an_unflagged_result_does_not_signal_crisis() -> None:
    result = await OpenAIModerationCrisisModerator(client=_Client(_response())).moderate("hello")

    assert result.status == "result" and result.flagged_categories == ()
    assert not moderation_indicates_crisis(result)


@pytest.mark.asyncio
async def test_api_failures_return_an_error_result_without_the_text(caplog: pytest.LogCaptureFixture) -> None:
    failure = APIConnectionError(request=httpx.Request("POST", "https://api.openai.com/v1/moderations"))

    result = await OpenAIModerationCrisisModerator(client=_Client(failure)).moderate("I want to die")

    assert result == ModelClientModeration(status="error")
    assert "I want to die" not in caplog.text


@pytest.mark.asyncio
async def test_a_response_without_results_is_an_error() -> None:
    empty = ModerationCreateResponse(id="modr-test", model=OPENAI_MODERATION_MODEL, results=[])

    assert await OpenAIModerationCrisisModerator(client=_Client(empty)).moderate("x") == ModelClientModeration(
        status="error"
    )


@pytest.mark.parametrize("api_key", [None, "", "  "])
def test_a_key_is_required_without_an_injected_client(api_key: str | None) -> None:
    with pytest.raises(ValueError, match="requires an API key"):
        OpenAIModerationCrisisModerator(api_key=api_key)
