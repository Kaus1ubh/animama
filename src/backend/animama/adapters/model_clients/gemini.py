from __future__ import annotations

import asyncio
import os
from collections.abc import AsyncIterator, Mapping
from typing import Any

from animama.app.model_clients import (
    ModelClientDelta,
    ModelClientFinal,
    ModelClientProviderError,
    ModelClientRequest,
)
from animama.app.model_clients.prompt import (
    prompt_conversation_messages,
    prompt_instruction_text,
    prompt_last_user_message,
)
from animama.domain.usage import Usage

from ._common import (
    close_maybe_async,
    get_value,
    jsonable,
    usage_from_payload,
)

GEMINI_PROVIDER_TYPE = "GeminiAgent"


class GeminiModelClient:
    """Provider-neutral model client backed by the google-genai SDK."""

    def __init__(
        self,
        *,
        api_key: str | None = None,
        client: Any | None = None,
        timeout: float | None = 60.0,
        close_client: bool | None = None,
    ) -> None:
        self._api_key = (api_key if api_key is not None else os.getenv("GEMINI_API_KEY") or "").strip()
        self._client = client
        self._timeout = timeout
        self._close_client = (client is None) if close_client is None else close_client

    async def stream(self, spec: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        if self._client is None and not self._api_key:
            raise ModelClientProviderError("Gemini API key is not configured", code="missing_api_key")

        parts: list[str] = []
        usage = Usage()
        metadata: dict[str, Any] = {
            "provider": GEMINI_PROVIDER_TYPE,
            "model": spec.model_provider.model,
        }

        try:
            stream = await self._create_stream(spec)
            async for chunk in stream:
                chunk_usage = get_value(chunk, "usage_metadata")
                if chunk_usage is not None:
                    usage = usage_from_payload(chunk_usage)
                text = _extract_text(chunk, fallback_to_string=False)
                if text:
                    parts.append(text)
                    yield ModelClientDelta(kind="text_delta", text=text, raw_metadata=metadata)
        except asyncio.CancelledError:
            raise
        except ModelClientProviderError:
            raise
        except Exception as exc:
            raise ModelClientProviderError(
                "Gemini request failed",
                code="provider_request_failed",
                raw_metadata={"exc_type": exc.__class__.__name__},
            ) from exc

        yield ModelClientDelta(
            kind="final",
            final=ModelClientFinal(
                text="".join(parts),
                usage=usage,
                raw_provider_metadata=metadata,
            ),
        )
        yield ModelClientDelta(kind="done")

    async def aclose(self) -> None:
        if self._client is not None and self._close_client:
            await close_maybe_async(self._client)
        self._client = None

    async def _create_stream(self, spec: ModelClientRequest) -> Any:
        client = self._client_for_spec()
        return await client.models.generate_content_stream(
            model=spec.model_provider.model,
            contents=_to_genai_contents(spec),
            config=_generate_content_config(spec),
        )

    def _client_for_spec(self) -> Any:
        if self._client is None:
            from google import genai
            from google.genai import types

            _ = self._timeout
            self._client = genai.Client(api_key=self._api_key, http_options=types.HttpOptions()).aio
            self._close_client = True
        return self._client


def _to_genai_contents(spec: ModelClientRequest) -> list[dict[str, Any]]:
    contents: list[dict[str, Any]] = []
    for message in prompt_conversation_messages(spec.prompt):
        role = message["role"]
        content = message["content"]
        gemini_role = "model" if role == "assistant" else "user"
        contents.append({"role": gemini_role, "parts": [{"text": content}]})
    return contents or [{"role": "user", "parts": [{"text": prompt_last_user_message(spec.prompt, fallback="")}]}]


def _generate_content_config(spec: ModelClientRequest) -> Any | None:
    response_format = spec.prompt.response_format
    instruction_text = prompt_instruction_text(spec.prompt)
    raw = jsonable(response_format) if isinstance(response_format, Mapping) else None
    schema: Any | None = None
    include_response_config = False
    if isinstance(raw, dict):
        if raw.get("type") == "json_schema" and isinstance(raw.get("json_schema"), dict):
            schema = raw["json_schema"].get("schema")
            include_response_config = True
        elif raw.get("type") == "json_object":
            include_response_config = True

    from google.genai import types

    kwargs: dict[str, Any] = {}
    if include_response_config:
        kwargs["response_mime_type"] = "application/json"
    if isinstance(schema, Mapping) and schema:
        kwargs["response_json_schema"] = dict(schema)
    if instruction_text is not None:
        kwargs["system_instruction"] = instruction_text
    if not kwargs:
        return None
    return types.GenerateContentConfig(**kwargs)


def _extract_text(response: Any, *, fallback_to_string: bool = True) -> str:
    try:
        text_value = get_value(response, "text")
        if isinstance(text_value, str) and text_value:
            return text_value
    except Exception:
        pass
    try:
        candidates = get_value(response, "candidates") or []
        for candidate in candidates:
            content = get_value(candidate, "content")
            parts = content.get("parts") if isinstance(content, dict) else get_value(content, "parts", [])
            for part in parts or []:
                text_part = part.get("text") if isinstance(part, dict) else get_value(part, "text")
                if isinstance(text_part, str) and text_part:
                    return text_part
    except Exception:
        pass
    if not fallback_to_string:
        return ""
    try:
        return str(response)
    except Exception:
        return ""


__all__ = ["GEMINI_PROVIDER_TYPE", "GeminiModelClient"]
