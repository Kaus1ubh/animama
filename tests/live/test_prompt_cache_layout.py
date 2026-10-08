"""Opt-in live measurement of prompt-cache hits per provider path.

Drives the real ``DirectChatPromptAssembler`` through a scripted six-turn chat
with a synthetic, non-personal Anima, and records the share of input tokens
each provider served from its prompt cache on every turn. Rerun it after a
layout change to compare against the recorded baseline in
``docs/plans/anthropic-model-provider``.

Paths: OpenAI Responses without and with a continuation cursor, OpenAI Chat
Completions with a developer role and with developer text folded into the system
message, Anthropic Messages, and optionally a local Chat Completions server
(``ANIMAMA_TEST_LOCAL_CHAT_BASE_URL`` plus ``ANIMAMA_TEST_LOCAL_CHAT_MODEL``).

Requires ``ANIMAMA_RUN_LIVE_TESTS=1`` with ``OPENAI_API_KEY`` and
``ANTHROPIC_API_KEY``. Run with ``-s`` to see the table; no content is printed.
"""

from __future__ import annotations

import json
import os
import subprocess
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from functools import partial
from typing import Any, cast
from uuid import uuid4

import anthropic
import pytest

from animama.adapters.model_clients.anthropic_messages.schema import anthropic_strict_schema
from animama.adapters.model_clients.openai_chat_completions import OpenAIChatCompletionsModelClient
from animama.adapters.model_clients.openai_responses import OpenAIResponsesModelClient
from animama.app.chat.direct_turn.response_format import build_main_structured_response_format
from animama.app.chat.direct_turn.types import DirectChatAttachmentContext
from animama.app.chat.memory_context import MAIN_STRUCTURED_OUTPUT_GUIDANCE
from animama.app.chat.openai_prompt import DirectChatPromptAssembler
from animama.app.main_structured_response import (
    build_main_structured_response_json_schema,
    build_main_structured_response_model,
)
from animama.app.model_clients import (
    DirectChatPrompt,
    ModelClient,
    ModelClientContinuation,
    ModelClientFinal,
    ModelClientProviderOptions,
    ModelClientRequest,
)
from animama.app.model_clients.prompt import scoped_prompt_cache_key
from animama.domain import ModelProvider, ModelProviderCapabilities

OPENAI_MODEL = "gpt-6-luna"
ANTHROPIC_MODEL = "claude-haiku-5-5"
GESTURE_IDS = ("wave", "nod", "shrug")
USER_TURNS = (
    "Hi there! What should we talk about today?",
    "Tell me something calming about the sea.",
    "What do you remember about my reading habits?",
    "Can you suggest a short evening routine?",
    "Which of those steps matters most?",
    "Thanks. Say goodnight in your own style.",
)


def _live_enabled() -> bool:
    keys = (os.getenv("OPENAI_API_KEY", "").strip(), os.getenv("ANTHROPIC_API_KEY", "").strip())
    return os.getenv("ANIMAMA_RUN_LIVE_TESTS") == "1" and all(key and key != "test-key" for key in keys)


pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(
        not _live_enabled(), reason="requires ANIMAMA_RUN_LIVE_TESTS=1, OPENAI_API_KEY, ANTHROPIC_API_KEY"
    ),
]


def _source_revision() -> str:
    try:
        return subprocess.run(
            ["git", "describe", "--always", "--dirty"], capture_output=True, text=True, check=True
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _synthetic_identity(run_tag: str) -> str:
    """Synthetic persona tagged per run so no run reads another's cache.

    The tag leads the identity section, after about 265 tokens of core
    instructions, which is below OpenAI's 1,024-token minimum, so runs and paths
    stay isolated. If a layout change moves more shared text ahead of the
    identity, move the tag ahead of it too.
    """

    traits = [
        f"- Trait {index}: Mira the lighthouse keeper speaks calmly, favours sea metaphors number {index}, "
        f"and keeps answers warm, brief and practical for everyday conversation."
        for index in range(60)
    ]
    return f"Run {run_tag}. You are Mira, a gentle lighthouse keeper companion.\n\n" + "\n".join(traits)


def _synthetic_memories() -> str:
    return "\n".join(
        f"- Shared moment {index}: we talked about tide charts and quiet evenings on day {index}."
        for index in range(25)
    )


def _memory_map(turn: int) -> str:
    files = "\n".join(f"- notes/topic-{index}.md: notes about topic {index}" for index in range(8))
    header = f"Memory files (updated before turn {turn}):\n- PROFILE.md: reader, prefers mornings"
    return f"{header}\n{files}\n- notes/turn-{turn}.md: latest"


ATTACHMENT = DirectChatAttachmentContext(filename="handbook.md", chunk_count=3, description="Lighthouse handbook")


def _guidance() -> str:
    rows = "\n".join(f"- {gesture}: {gesture.title()} — a friendly {gesture}" for gesture in GESTURE_IDS)
    return f"{MAIN_STRUCTURED_OUTPUT_GUIDANCE.strip()}\n\nAvailable Gestures for this Anima:\n{rows}"


def _output_type() -> Any:
    return build_main_structured_response_model(agent_id="cache-harness", gesture_ids=GESTURE_IDS)


def _prompt(
    *,
    turn: int,
    history: list[dict[str, str]],
    supports_developer_role: bool,
    provider_type: str,
    model: str,
    run_tag: str,
) -> DirectChatPrompt:
    return DirectChatPromptAssembler().assemble(
        user_message=USER_TURNS[turn],
        anima_identity=_synthetic_identity(run_tag),
        anima_name="Mira",
        anima_memories=_synthetic_memories(),
        response_format_guidance=_guidance(),
        memory_map=_memory_map(turn),
        attached_files=[ATTACHMENT],
        supports_developer_role=supports_developer_role,
        visible_history=history,
        response_format=cast(Any, build_main_structured_response_format(_output_type(), name="main_structured_json")),
        prompt_cache_key=scoped_prompt_cache_key(
            user_id="live-cache-harness", anima_id="synthetic-mira", provider_type=provider_type, model=model
        ),
        reasoning_effort="low",
    )


@dataclass
class _TurnUsage:
    input_tokens: int
    cached_tokens: int

    @property
    def share(self) -> float:
        return round(self.cached_tokens / self.input_tokens, 3) if self.input_tokens else 0.0


def _openai_provider(provider_type: str, model: str) -> ModelProvider:
    return ModelProvider(
        id=f"{provider_type}:{model}",
        provider_type=provider_type,
        model=model,
        model_label=model,
        provider_label="OpenAI",
        capabilities=ModelProviderCapabilities(
            supports_streaming=True,
            supports_tools=True,
            structured_kinds=["main_structured_response"],
            structured_output_transport="json_schema",
        ),
    )


async def _final(client: ModelClient, request: ModelClientRequest) -> ModelClientFinal:
    final: ModelClientFinal | None = None
    async for delta in client.stream(request):
        if delta.kind == "final":
            final = delta.final
        elif delta.kind == "error":
            raise AssertionError(f"model client error: {delta.error}")
    assert final is not None
    return final


async def _run_openai_path(
    *,
    provider_type: str,
    client: ModelClient,
    supports_developer_role: bool,
    use_cursor: bool,
    model: str = OPENAI_MODEL,
) -> list[_TurnUsage]:
    provider = _openai_provider(provider_type, model)
    run_tag = uuid4().hex
    history: list[dict[str, str]] = []
    cursor: str | None = None
    usages: list[_TurnUsage] = []
    for turn in range(len(USER_TURNS)):
        prompt = _prompt(
            turn=turn,
            history=history,
            supports_developer_role=supports_developer_role,
            provider_type=provider_type,
            model=model,
            run_tag=run_tag,
        )
        request = ModelClientRequest(
            model_provider=provider,
            prompt=prompt,
            provider_options=ModelClientProviderOptions(store=use_cursor),
            continuation=ModelClientContinuation(provider_type=provider_type, cursor=cursor) if cursor else None,
        )
        final = await _final(client, request)
        usages.append(_TurnUsage(final.usage.input_tokens, final.usage.input_tokens_details.cached_tokens))
        history += [{"role": "user", "content": USER_TURNS[turn]}, {"role": "assistant", "content": final.text}]
        if use_cursor:
            response_id = final.raw_provider_metadata.get("response_id")
            cursor = response_id if isinstance(response_id, str) else None
    return usages


async def _run_anthropic_current_layout() -> list[_TurnUsage]:
    """Map today's folded layout to Anthropic with top-level automatic caching."""

    output_format = {
        "type": "json_schema",
        "schema": anthropic_strict_schema(build_main_structured_response_json_schema(_output_type())),
    }
    history: list[dict[str, str]] = []
    usages: list[_TurnUsage] = []
    run_tag = uuid4().hex
    async with anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=120.0) as client:
        for turn in range(len(USER_TURNS)):
            prompt = _prompt(
                turn=turn,
                history=history,
                supports_developer_role=False,
                provider_type="AnthropicMessagesHTTPAgent",
                model=ANTHROPIC_MODEL,
                run_tag=run_tag,
            )
            system = next(str(m["content"]) for m in prompt.messages if m.get("role") == "system")
            messages = [
                {"role": str(m["role"]), "content": str(m["content"])}
                for m in prompt.messages
                if m.get("role") in {"user", "assistant"}
            ]
            message = await cast(Any, client).messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=1024,
                system=system,
                messages=messages,
                cache_control={"type": "ephemeral"},
                output_config={"effort": "low", "format": output_format},
            )
            usage = message.usage
            cached = usage.cache_read_input_tokens or 0
            total = usage.input_tokens + cached + (usage.cache_creation_input_tokens or 0)
            usages.append(_TurnUsage(total, cached))
            text = "".join(getattr(block, "text", "") for block in message.content if block.type == "text")
            history += [{"role": "user", "content": USER_TURNS[turn]}, {"role": "assistant", "content": text}]
    return usages


def _report(path: str, usages: list[_TurnUsage], *, model: str, method: str) -> None:
    later = usages[1:]
    mean_share = round(sum(u.share for u in later) / len(later), 3) if later else 0.0
    print(
        "[prompt-cache] "
        + json.dumps(
            {
                "path": path,
                "model": model,
                "revision": _source_revision(),
                "method": method,
                "input_tokens": [u.input_tokens for u in usages],
                "cached_tokens": [u.cached_tokens for u in usages],
                "share_by_turn": [u.share for u in usages],
                "mean_share_turns_2_plus": mean_share,
            },
            sort_keys=True,
        )
    )


async def test_measure_prompt_cache_share_per_provider_path() -> None:
    method = "six scripted turns, synthetic Anima, memory map changes each turn, effort low"
    openai_key = os.environ["OPENAI_API_KEY"]
    runs: list[tuple[str, Callable[[], Awaitable[list[_TurnUsage]]], str]] = []

    responses_client = OpenAIResponsesModelClient(api_key=openai_key, timeout=120.0, compaction_threshold_tokens=None)
    chat_client = OpenAIChatCompletionsModelClient(api_key=openai_key, timeout=120.0)
    runs.append(
        (
            "openai_responses_stateless",
            partial(
                _run_openai_path,
                provider_type="OpenAIResponsesHTTPAgent",
                client=responses_client,
                supports_developer_role=True,
                use_cursor=False,
            ),
            OPENAI_MODEL,
        )
    )
    runs.append(
        (
            "openai_responses_cursor",
            partial(
                _run_openai_path,
                provider_type="OpenAIResponsesHTTPAgent",
                client=responses_client,
                supports_developer_role=True,
                use_cursor=True,
            ),
            OPENAI_MODEL,
        )
    )
    for folded in (False, True):
        runs.append(
            (
                "openai_chat_completions_" + ("folded" if folded else "developer"),
                partial(
                    _run_openai_path,
                    provider_type="OpenAIHTTPAgent",
                    client=chat_client,
                    supports_developer_role=not folded,
                    use_cursor=False,
                ),
                OPENAI_MODEL,
            )
        )
    runs.append(("anthropic_messages_current_layout", _run_anthropic_current_layout, ANTHROPIC_MODEL))

    local_base_url = os.getenv("ANIMAMA_TEST_LOCAL_CHAT_BASE_URL", "").strip()
    local_model = os.getenv("ANIMAMA_TEST_LOCAL_CHAT_MODEL", "").strip()
    local_client: OpenAIChatCompletionsModelClient | None = None
    if local_base_url and local_model:
        local_client = OpenAIChatCompletionsModelClient(api_key="local", base_url=local_base_url, timeout=300.0)
        runs.append(
            (
                "local_chat_completions_folded",
                partial(
                    _run_openai_path,
                    provider_type="OpenAIHTTPAgent",
                    client=local_client,
                    supports_developer_role=False,
                    use_cursor=False,
                    model=local_model,
                ),
                local_model,
            )
        )

    try:
        for path, run, model in runs:
            _report(path, await run(), model=model, method=method)
    finally:
        await responses_client.aclose()
        await chat_client.aclose()
        if local_client is not None:
            await local_client.aclose()
