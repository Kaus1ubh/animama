"""Classifier for chat transcript compatibility across model-client families."""

from __future__ import annotations

from dataclasses import dataclass

from animama.domain import ModelProvider
from animama.utils.type_helpers import coerce_provider_type

MODEL_CLIENT_OPENAI_CHAT_COMPLETIONS = "openai_chat_completions"
MODEL_CLIENT_OPENAI_RESPONSES = "openai_responses"

CHAT_API_STANDARD_CHAT_COMPLETIONS = "chat_completions"
CHAT_API_STANDARD_RESPONSES = "responses"

OPENAI_CHAT_COMPLETIONS_PROVIDER_TYPE = "OpenAIHTTPAgent"
OPENAI_RESPONSES_PROVIDER_TYPE = "OpenAIResponsesHTTPAgent"


@dataclass(frozen=True, slots=True)
class ChatApiStandardProfile:
    """Model-client profile and transcript standard for one provider family."""

    model_client: str
    api_standard: str


def chat_api_standard_for_provider_type(provider_type: str) -> ChatApiStandardProfile | None:
    """Return the chat API standard profile for a normalized provider type."""

    normalized = coerce_provider_type(provider_type) or str(provider_type or "").strip()
    if normalized == OPENAI_CHAT_COMPLETIONS_PROVIDER_TYPE:
        return ChatApiStandardProfile(
            model_client=MODEL_CLIENT_OPENAI_CHAT_COMPLETIONS,
            api_standard=CHAT_API_STANDARD_CHAT_COMPLETIONS,
        )
    if normalized == OPENAI_RESPONSES_PROVIDER_TYPE:
        return ChatApiStandardProfile(
            model_client=MODEL_CLIENT_OPENAI_RESPONSES,
            api_standard=CHAT_API_STANDARD_RESPONSES,
        )
    return None


def chat_api_standard_for_provider(model_provider: ModelProvider) -> ChatApiStandardProfile | None:
    """Return the chat API standard profile for a durable model-provider row."""

    return chat_api_standard_for_provider_type(model_provider.provider_type)


__all__ = [
    "CHAT_API_STANDARD_CHAT_COMPLETIONS",
    "CHAT_API_STANDARD_RESPONSES",
    "MODEL_CLIENT_OPENAI_CHAT_COMPLETIONS",
    "MODEL_CLIENT_OPENAI_RESPONSES",
    "ChatApiStandardProfile",
    "chat_api_standard_for_provider",
    "chat_api_standard_for_provider_type",
]
