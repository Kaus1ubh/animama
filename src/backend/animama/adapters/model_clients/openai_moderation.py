"""Operator crisis moderation through OpenAI's moderation endpoint.

A composition builds this with its own operator key and supplies it as the
chat policy's crisis moderator. The endpoint is free and, per OpenAI's data
controls, neither trains on nor retains moderation requests.
"""

from __future__ import annotations

from typing import Any

from openai import AsyncOpenAI, OpenAIError

from animama.app.model_clients import ModelClientModeration
from animama.app.safety.moderation import OPENAI_MODERATION_MODEL, moderation_result
from animama.logging import get_logger

DEFAULT_MODERATION_TIMEOUT_SECONDS = 10.0

_log = get_logger("adapters.model_clients.openai_moderation")


class OpenAIModerationCrisisModerator:
    """Check one user message with ``omni-moderation-latest``.

    Satisfies ``CrisisModerator``. An API failure returns an ``error`` result;
    neither the message nor the key is logged.
    """

    def __init__(
        self,
        *,
        api_key: str | None = None,
        client: Any | None = None,
        timeout_seconds: float = DEFAULT_MODERATION_TIMEOUT_SECONDS,
    ) -> None:
        if client is None:
            if api_key is None or not api_key.strip():
                raise ValueError("OpenAI crisis moderation requires an API key")
            # No SDK retries: the turn waits only briefly for the check after the reply.
            client = AsyncOpenAI(api_key=api_key, timeout=timeout_seconds, max_retries=0)
        self._client = client

    async def moderate(self, text: str) -> ModelClientModeration:
        try:
            response = await self._client.moderations.create(model=OPENAI_MODERATION_MODEL, input=text)
        except OpenAIError as exc:
            _log.warning("OpenAI crisis moderation request failed", error_type=type(exc).__name__)
            return ModelClientModeration(status="error")
        if not response.results:
            return ModelClientModeration(status="error")
        result = response.results[0]
        # The SDK models name categories in Python; their aliases are the API names ("self-harm/intent").
        return moderation_result(
            result.categories.model_dump(by_alias=True), result.category_scores.model_dump(by_alias=True)
        )

    async def aclose(self) -> None:
        await self._client.close()


__all__ = ["OpenAIModerationCrisisModerator"]
