from __future__ import annotations

import json
from collections.abc import AsyncIterator, Mapping
from typing import Any

from animama.app.model_clients import ModelClientDelta, ModelClientFinal, ModelClientRequest
from animama.app.model_clients.prompt import prompt_last_user_message
from animama.domain.usage import Usage


class MockModelClient:
    """Deterministic model client for request-local direct-chat tests."""

    PROVIDER_TYPE = "MockModelClient"

    def __init__(
        self,
        *,
        response_text: str | None = None,
        responses: list[str | ModelClientFinal] | None = None,
        usage: Usage | None = None,
        raw_provider_metadata: Mapping[str, Any] | None = None,
    ) -> None:
        self._response_text = response_text
        self._responses = list(responses or [])
        self._usage = usage or Usage(requests=1)
        self._raw_provider_metadata = dict(raw_provider_metadata or {})
        self.closed = False

    async def stream(self, spec: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        scripted = self._responses.pop(0) if self._responses else None
        final = scripted if isinstance(scripted, ModelClientFinal) else None
        text = scripted if isinstance(scripted, str) else self._response_text or _default_response_text(spec)
        metadata = {
            "provider": self.PROVIDER_TYPE,
            **self._raw_provider_metadata,
        }
        if final is not None:
            text = final.text
        if text:
            yield ModelClientDelta(kind="text_delta", text=text, raw_metadata=metadata)
        yield ModelClientDelta(
            kind="final",
            final=final
            or ModelClientFinal(
                text=text,
                usage=self._usage,
                raw_provider_metadata=metadata,
            ),
        )
        yield ModelClientDelta(kind="done")

    async def aclose(self) -> None:
        self.closed = True


def _default_response_text(spec: ModelClientRequest) -> str:
    user_message = prompt_last_user_message(spec.prompt, fallback="")
    if spec.prompt.response_format:
        return json.dumps(
            {
                "emotional_tone": "neutral",
                "emotional_intensity": 1,
                "speech": f"Mock response to {user_message}",
                "gesture": "",
                "display": None,
                "remember": None,
            },
            ensure_ascii=True,
            separators=(",", ":"),
        )
    return f"Mock response to {user_message}"


__all__ = ["MockModelClient"]
