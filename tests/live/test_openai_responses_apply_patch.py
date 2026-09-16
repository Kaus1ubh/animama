from __future__ import annotations

import json
import os

import pytest
from openai.types.shared_params.response_format_json_schema import ResponseFormatJSONSchema

from animama.adapters.model_clients.openai_responses import OpenAIResponsesModelClient
from animama.app.model_clients import (
    DirectChatPrompt,
    ModelClientContinuation,
    ModelClientFinal,
    ModelClientProviderOptions,
    ModelClientRequest,
)
from animama.domain import ModelProvider, ModelProviderCapabilities


def _live_api_key() -> str:
    return os.getenv("ANIMAMA_LIVE_OPENAI_API_KEY", os.getenv("OPENAI_API_KEY", "")).strip()


def _live_enabled() -> bool:
    return os.getenv("ANIMAMA_RUN_LIVE_TESTS") == "1" and _live_api_key() not in {"", "test-key"}


async def _final(client: OpenAIResponsesModelClient, request: ModelClientRequest) -> ModelClientFinal:
    final: ModelClientFinal | None = None
    async for delta in client.stream(request):
        if delta.kind == "final":
            final = delta.final
    assert final is not None
    return final


@pytest.mark.asyncio
@pytest.mark.skipif(not _live_enabled(), reason="requires ANIMAMA_RUN_LIVE_TESTS=1 and a real OpenAI API key")
async def test_gpt_5_4_nano_native_apply_patch_with_structured_final() -> None:
    """Smoke the native tool/output protocol together with strict structured text."""

    provider = ModelProvider(
        id="OpenAIResponsesHTTPAgent:gpt-5.4-nano",
        provider_type="OpenAIResponsesHTTPAgent",
        model="gpt-5.4-nano",
        model_label="gpt-5.4-nano",
        provider_label="OpenAI",
        provider_base_url="https://api.openai.com/v1",
        capabilities=ModelProviderCapabilities(
            supports_streaming=True,
            supports_tools=True,
            structured_kinds=["main_structured_response"],
            native_tool_support=["apply_patch"],
        ),
    )
    response_format: ResponseFormatJSONSchema = {
        "type": "json_schema",
        "json_schema": {
            "name": "native_apply_patch_smoke",
            "strict": True,
            "schema": {
                "type": "object",
                "properties": {"speech": {"type": "string"}},
                "required": ["speech"],
                "additionalProperties": False,
            },
        },
    }
    operation_instruction = (
        "First call apply_patch exactly once with create_file for live-smoke.md. "
        "Its diff must create one markdown heading. After the tool output, return the required JSON response."
    )
    prompt = DirectChatPrompt(
        messages=(
            {"role": "system", "content": operation_instruction},
            {"role": "user", "content": "Run the native Apply Patch smoke test."},
        ),
        response_format=response_format,
        tool_choice="auto",
        parallel_tool_calls=False,
        prompt_cache_key="animama-live-apply-patch-smoke",
    )
    client = OpenAIResponsesModelClient(api_key=_live_api_key(), timeout=60.0)
    try:
        first = await _final(
            client,
            ModelClientRequest(
                model_provider=provider,
                prompt=prompt,
                provider_options=ModelClientProviderOptions(
                    store=True,
                    memory_apply_patch_enabled=True,
                ),
            ),
        )
        assert len(first.tool_calls) == 1
        call = first.tool_calls[0]
        assert call.name == "apply_patch"
        assert call.tool_type == "apply_patch"
        operation = json.loads(call.arguments)
        assert operation["type"] == "create_file"
        assert operation["path"] == "live-smoke.md"

        response_id = first.raw_provider_metadata.get("response_id")
        assert isinstance(response_id, str) and response_id
        follow_up = DirectChatPrompt(
            messages=(
                *prompt.messages,
                {
                    "type": "model_client_tool_call",
                    "call_id": call.id,
                    "tool_type": "apply_patch",
                    "name": "apply_patch",
                    "arguments": call.arguments,
                },
                {
                    "type": "model_client_tool_result",
                    "call_id": call.id,
                    "tool_type": "apply_patch",
                    "status": "completed",
                    "output": '{"ok":true,"path":"live-smoke.md"}',
                },
            ),
            response_format=response_format,
            tool_choice="auto",
            parallel_tool_calls=False,
            prompt_cache_key="animama-live-apply-patch-smoke",
        )
        second = await _final(
            client,
            ModelClientRequest(
                model_provider=provider,
                prompt=follow_up,
                provider_options=ModelClientProviderOptions(
                    store=True,
                    memory_apply_patch_enabled=True,
                ),
                continuation=ModelClientContinuation(
                    provider_type="OpenAIResponsesHTTPAgent",
                    cursor=response_id,
                ),
            ),
        )
        assert second.tool_calls == ()
        payload = json.loads(second.text)
        assert isinstance(payload.get("speech"), str) and payload["speech"]
    finally:
        await client.aclose()
