"""Opt-in live measurement of prompt-cache hits per provider path.

Drives the real ``DirectChatPromptAssembler`` through a scripted six-turn chat
with a synthetic, non-personal Anima, and records the share of input tokens
each provider served from its prompt cache on every turn. Rerun it after a
layout change to compare against the recorded baseline in
``docs/plans/anthropic-model-provider``.

``test_measure_prompt_cache_share_per_provider_path`` measures the current
assembly through the real adapters: OpenAI Responses with full history
(``store: false``) and with a continuation cursor, OpenAI Chat Completions with a
developer role and without one (the ``<turn_context>`` block), Anthropic
Messages (Anthropic-phrased instructions, history replayed in its stored shape),
and optionally a local Chat Completions server
(``ANIMAMA_TEST_LOCAL_CHAT_BASE_URL`` plus ``ANIMAMA_TEST_LOCAL_CHAT_MODEL``).
Rows match production: developer-role rows use the built-in OpenAI connection
and carry its explicit cache breakpoints; the row without a developer role and
the local row (a loaded owner connection with the local-server options) carry
none.
``test_measure_candidate_layouts`` and ``test_measure_owner_layout`` are the
Phase 2 comparisons. They rebuild their layouts from the current assembly, whose
system text now ends with the guardrails, so their numbers are not an exact
rerun of the Phase 2 record.

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
from openai import AsyncOpenAI

from animama.adapters.model_clients.anthropic_messages import AnthropicMessagesModelClient
from animama.adapters.model_clients.anthropic_messages.schema import anthropic_strict_schema
from animama.adapters.model_clients.openai_chat_completions import OpenAIChatCompletionsModelClient
from animama.adapters.model_clients.openai_responses import OpenAIResponsesModelClient
from animama.adapters.model_clients.openai_responses.request import responses_text_format
from animama.app.chat.anthropic_instructions import (
    ANTHROPIC_MAIN_STRUCTURED_OUTPUT_GUIDANCE,
    INSTRUCTION_STYLE_ANTHROPIC,
    INSTRUCTION_STYLE_DEFAULT,
)
from animama.app.chat.direct_turn.message_builders import assistant_replay_message
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
from animama.app.model_clients.credentials import builtin_anthropic_connection, static_credential_resolver
from animama.app.model_clients.prompt import scoped_prompt_cache_key
from animama.app.model_connection_presets import MODEL_CONNECTION_PRESETS, PRESET_CUSTOM, PRESET_OLLAMA
from animama.app.safety.prompts import COMPANION_GUARDRAILS
from animama.domain import ModelProvider, ModelProviderCapabilities
from animama.domain.model_connection import BUILTIN_OPENAI_CONNECTION_ID, ModelConnection

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


def _guidance(base: str = MAIN_STRUCTURED_OUTPUT_GUIDANCE) -> str:
    rows = "\n".join(f"- {gesture}: {gesture.title()} — a friendly {gesture}" for gesture in GESTURE_IDS)
    return f"{base.strip()}\n\nAvailable Gestures for this Anima:\n{rows}"


def _output_type() -> Any:
    return build_main_structured_response_model(agent_id="cache-harness", gesture_ids=GESTURE_IDS)


def _prompt(
    *,
    turn: int,
    history: list[dict[str, Any]],
    supports_developer_role: bool,
    provider_type: str,
    model: str,
    run_tag: str,
    instruction_style: str = INSTRUCTION_STYLE_DEFAULT,
    guidance: str = MAIN_STRUCTURED_OUTPUT_GUIDANCE,
) -> DirectChatPrompt:
    return DirectChatPromptAssembler().assemble(
        user_message=USER_TURNS[turn],
        anima_identity=_synthetic_identity(run_tag),
        anima_name="Mira",
        anima_memories=_synthetic_memories(),
        instruction_style=instruction_style,
        response_format_guidance=_guidance(guidance),
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


def _openai_provider(
    provider_type: str,
    model: str,
    *,
    developer_role: bool = True,
    connection: ModelConnection | None = None,
) -> ModelProvider:
    """A row as production builds it, so the adapter sends the same request shape.

    ``developer_role=False`` models servers without a developer role (the
    tagged-block path, with no cache breakpoints). ``connection`` is a loaded
    owner connection (for a local server); without one the row uses the
    built-in ``openai`` connection.
    """

    return ModelProvider(
        id=f"{provider_type}:{model}",
        provider_type=provider_type,
        model=model,
        model_label=model,
        provider_label="OpenAI",
        connection_id=connection.id if connection is not None else BUILTIN_OPENAI_CONNECTION_ID,
        connection=connection,
        capabilities=ModelProviderCapabilities(
            supports_streaming=True,
            supports_tools=True,
            supports_developer_role=developer_role,
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
    connection: ModelConnection | None = None,
) -> list[_TurnUsage]:
    provider = _openai_provider(provider_type, model, developer_role=supports_developer_role, connection=connection)
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


def _anthropic_provider() -> ModelProvider:
    """The built-in Haiku 5.5 row as production loads it."""

    return ModelProvider(
        id=f"AnthropicMessagesHTTPAgent:{ANTHROPIC_MODEL}",
        provider_type="AnthropicMessagesHTTPAgent",
        model=ANTHROPIC_MODEL,
        model_label="Claude Haiku 5.5",
        provider_label="Anthropic",
        connection_id="anthropic",
        connection=builtin_anthropic_connection(),
        context_window_tokens=1_000_000,
        max_output_tokens=128_000,
        capabilities=ModelProviderCapabilities(
            supports_streaming=True,
            supports_tools=True,
            supports_reasoning=True,
            supported_reasoning_efforts=["none", "low", "medium", "high", "xhigh", "max"],
            structured_kinds=["main_structured_response"],
            structured_output_transport="json_schema",
        ),
    )


async def _run_anthropic_adapter_path() -> list[_TurnUsage]:
    """Drive the real Anthropic adapter: stable cached system, history, user, then the turn-context system message.

    History is replayed in the shape the chat stores (the reply's text block),
    so the request matches production; usage counts cache reads and writes.
    """

    provider = _anthropic_provider()
    client = AnthropicMessagesModelClient(
        credential_resolver=static_credential_resolver({"ANTHROPIC_API_KEY": os.environ["ANTHROPIC_API_KEY"]}),
        timeout=120.0,
    )
    history: list[dict[str, Any]] = []
    usages: list[_TurnUsage] = []
    run_tag = uuid4().hex
    try:
        for turn in range(len(USER_TURNS)):
            prompt = _prompt(
                turn=turn,
                history=history,
                supports_developer_role=provider.accepts_developer_role,
                provider_type=provider.provider_type,
                model=ANTHROPIC_MODEL,
                run_tag=run_tag,
                instruction_style=INSTRUCTION_STYLE_ANTHROPIC,
                guidance=ANTHROPIC_MAIN_STRUCTURED_OUTPUT_GUIDANCE,
            )
            final = await _final(client, ModelClientRequest(model_provider=provider, prompt=prompt))
            usages.append(_TurnUsage(final.usage.input_tokens, final.usage.input_tokens_details.cached_tokens))
            # Stored rows carry the provider-shaped message the assembler replays.
            history += [
                {"role": "user", "content": USER_TURNS[turn]},
                {
                    "role": "assistant",
                    "content": final.text,
                    "raw_provider_message": assistant_replay_message(final.text, model_provider=provider),
                },
            ]
    finally:
        await client.aclose()
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
    runs.append(("anthropic_messages", _run_anthropic_adapter_path, ANTHROPIC_MODEL))

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
                    connection=ModelConnection(
                        id="local-harness",
                        name="Local harness",
                        preset=PRESET_CUSTOM,
                        base_url=local_base_url,
                        compatibility=MODEL_CONNECTION_PRESETS[PRESET_OLLAMA].compatibility,
                    ),
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


# Candidate layouts (Phase 2). Each keeps the system text stable and moves the
# per-turn context (memory map, attachments) and the Companion Guardrails after
# the latest user message, so the guardrails stay the final instruction text.


@dataclass(frozen=True)
class _Parts:
    system: str
    history: list[dict[str, str]]
    trailing: str
    user: str


def _parts(*, turn: int, history: list[dict[str, str]], provider_type: str, model: str, run_tag: str) -> _Parts:
    prompt = _prompt(
        turn=turn,
        history=history,
        supports_developer_role=True,
        provider_type=provider_type,
        model=model,
        run_tag=run_tag,
    )
    messages = [dict(message) for message in prompt.messages]
    assert messages[0]["role"] == "system" and messages[-2]["role"] == "developer" and messages[-1]["role"] == "user"
    return _Parts(
        system=str(messages[0]["content"]),
        history=[{"role": str(m["role"]), "content": str(m["content"])} for m in messages[1:-2]],
        trailing=str(messages[-2]["content"]),
        user=str(messages[-1]["content"]),
    )


def _response_format() -> dict[str, Any]:
    return build_main_structured_response_format(_output_type(), name="main_structured_json")


async def _run_responses_candidate(*, use_cursor: bool) -> list[_TurnUsage]:
    provider_type = "OpenAIResponsesHTTPAgent"
    run_tag = uuid4().hex
    history: list[dict[str, str]] = []
    usages: list[_TurnUsage] = []
    previous_response_id: str | None = None
    async with AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=120.0) as client:
        for turn in range(len(USER_TURNS)):
            parts = _parts(turn=turn, history=history, provider_type=provider_type, model=OPENAI_MODEL, run_tag=run_tag)
            new_items: list[dict[str, Any]] = [
                {"role": "user", "content": parts.user},
                {"role": "developer", "content": parts.trailing},
            ]
            request: dict[str, Any] = {
                "model": OPENAI_MODEL,
                "instructions": parts.system,
                "input": new_items if use_cursor else [*parts.history, *new_items],
                "store": use_cursor,
                "reasoning": {"effort": "low"},
                "text": responses_text_format(_response_format()),
                "prompt_cache_key": scoped_prompt_cache_key(
                    user_id="live-cache-harness",
                    anima_id=f"candidate-{run_tag}",
                    provider_type=provider_type,
                    model=OPENAI_MODEL,
                ),
            }
            if use_cursor and previous_response_id:
                request["previous_response_id"] = previous_response_id
            response = await cast(Any, client).responses.create(**request)
            details = response.usage.input_tokens_details
            usages.append(_TurnUsage(response.usage.input_tokens, details.cached_tokens if details else 0))
            previous_response_id = response.id
            history += [
                {"role": "user", "content": USER_TURNS[turn]},
                {"role": "assistant", "content": response.output_text},
            ]
    return usages


async def _run_chat_candidate(*, trailing_role: str) -> list[_TurnUsage]:
    """``trailing_role`` is ``developer``, ``system`` or ``user_tail`` (context appended to the user message)."""

    provider_type = "OpenAIHTTPAgent"
    run_tag = uuid4().hex
    history: list[dict[str, str]] = []
    usages: list[_TurnUsage] = []
    async with AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=120.0) as client:
        for turn in range(len(USER_TURNS)):
            parts = _parts(turn=turn, history=history, provider_type=provider_type, model=OPENAI_MODEL, run_tag=run_tag)
            if trailing_role == "user_tail":
                tail = [
                    {"role": "user", "content": f"{parts.user}\n\n<turn_context>\n{parts.trailing}\n</turn_context>"}
                ]
            else:
                tail = [{"role": "user", "content": parts.user}, {"role": trailing_role, "content": parts.trailing}]
            completion = await cast(Any, client).chat.completions.create(
                model=OPENAI_MODEL,
                messages=[{"role": "system", "content": parts.system}, *parts.history, *tail],
                reasoning_effort="low",
                response_format=_response_format(),
                prompt_cache_key=scoped_prompt_cache_key(
                    user_id="live-cache-harness",
                    anima_id=f"candidate-{run_tag}",
                    provider_type=provider_type,
                    model=OPENAI_MODEL,
                ),
            )
            details = completion.usage.prompt_tokens_details
            usages.append(_TurnUsage(completion.usage.prompt_tokens, details.cached_tokens if details else 0))
            text = completion.choices[0].message.content or ""
            history += [{"role": "user", "content": USER_TURNS[turn]}, {"role": "assistant", "content": text}]
    return usages


async def _run_anthropic_candidate() -> list[_TurnUsage]:
    """Stable cached system, breakpoint on the latest user text, then a trailing system message."""

    output_format = {
        "type": "json_schema",
        "schema": anthropic_strict_schema(build_main_structured_response_json_schema(_output_type())),
    }
    run_tag = uuid4().hex
    history: list[dict[str, str]] = []
    usages: list[_TurnUsage] = []
    async with anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=120.0) as client:
        for turn in range(len(USER_TURNS)):
            parts = _parts(
                turn=turn,
                history=history,
                provider_type="AnthropicMessagesHTTPAgent",
                model=ANTHROPIC_MODEL,
                run_tag=run_tag,
            )
            messages: list[dict[str, Any]] = [*parts.history]
            messages.append(
                {
                    "role": "user",
                    "content": [{"type": "text", "text": parts.user, "cache_control": {"type": "ephemeral"}}],
                }
            )
            messages.append({"role": "system", "content": parts.trailing})
            message = await cast(Any, client).messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=1024,
                system=[{"type": "text", "text": parts.system, "cache_control": {"type": "ephemeral"}}],
                messages=messages,
                output_config={"effort": "low", "format": output_format},
            )
            usage = message.usage
            cached = usage.cache_read_input_tokens or 0
            total = usage.input_tokens + cached + (usage.cache_creation_input_tokens or 0)
            usages.append(_TurnUsage(total, cached))
            text = "".join(getattr(block, "text", "") for block in message.content if block.type == "text")
            history += [{"role": "user", "content": USER_TURNS[turn]}, {"role": "assistant", "content": text}]
    return usages


async def test_measure_candidate_layouts() -> None:
    method = "candidate: stable system, per-turn context and guardrails after the latest user message"
    runs: list[tuple[str, Callable[[], Awaitable[list[_TurnUsage]]], str]] = [
        ("candidate_responses_stateless", partial(_run_responses_candidate, use_cursor=False), OPENAI_MODEL),
        ("candidate_responses_cursor", partial(_run_responses_candidate, use_cursor=True), OPENAI_MODEL),
        ("candidate_chat_trailing_developer", partial(_run_chat_candidate, trailing_role="developer"), OPENAI_MODEL),
        ("candidate_chat_trailing_system", partial(_run_chat_candidate, trailing_role="system"), OPENAI_MODEL),
        ("candidate_chat_user_tail", partial(_run_chat_candidate, trailing_role="user_tail"), OPENAI_MODEL),
        ("candidate_anthropic_trailing_system", _run_anthropic_candidate, ANTHROPIC_MODEL),
    ]
    for path, run, model in runs:
        _report(path, await run(), model=model, method=method)


# Owner-proposed layout (2026-10-09): per-turn context and guardrails go before
# the user's new message, as a developer message where the position is supported
# and otherwise as a tagged block inside the user message. OpenAI Chat Completions
# marks explicit cache breakpoints on the system prompt and the last two assistant
# replies; Anthropic marks the system prompt and the last history message;
# Responses with server state needs no markers.

TURN_CONTEXT_NOTE = (
    "\n\n# Turn Context\n\nThe application may begin the user's message with a <turn_context> block. "
    "The application writes it, not the user. It carries request context and the Companion Guardrails; follow it."
)


def _stable_memory_map(turn: int) -> str:
    """A memory map that changes once (before turn 3), as it does when a memory file is added."""

    return _memory_map(0 if turn < 3 else 3)


def _tagged(trailing: str, user: str) -> str:
    return f"<turn_context>\n{trailing}\n</turn_context>\n\n{user}"


def _with_openai_breakpoint(history: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Mark the last two assistant replies with explicit cache breakpoints.

    A request only looks up breakpoints it marks itself (plus eligible message
    endings), so the reply that ended the previous request's history is marked to
    read that request's cache entry, and the latest reply is marked to write the
    next one.
    """

    messages: list[dict[str, Any]] = [dict(message) for message in history]
    assistant_indexes = [index for index, message in enumerate(messages) if message["role"] == "assistant"]
    for index in assistant_indexes[-2:]:
        message = messages[index]
        messages[index] = {
            "role": message["role"],
            "content": [{"type": "text", "text": message["content"], "prompt_cache_breakpoint": {"mode": "explicit"}}],
        }
    return messages


def _openai_system_with_breakpoint(system: str) -> dict[str, Any]:
    """Mark the stable system prompt, so a developer message right after it does not end the cached block."""

    return {
        "role": "system",
        "content": [{"type": "text", "text": system, "prompt_cache_breakpoint": {"mode": "explicit"}}],
    }


async def _run_chat_owner_layout(*, developer_role: bool) -> list[_TurnUsage]:
    provider_type = "OpenAIHTTPAgent"
    run_tag = uuid4().hex
    history: list[dict[str, str]] = []
    usages: list[_TurnUsage] = []
    async with AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=120.0) as client:
        for turn in range(len(USER_TURNS)):
            parts = _parts(turn=turn, history=history, provider_type=provider_type, model=OPENAI_MODEL, run_tag=run_tag)
            if developer_role:
                system = parts.system
                tail = [{"role": "developer", "content": parts.trailing}, {"role": "user", "content": parts.user}]
            else:
                system = parts.system + TURN_CONTEXT_NOTE
                tail = [{"role": "user", "content": _tagged(parts.trailing, parts.user)}]
            completion = await cast(Any, client).chat.completions.create(
                model=OPENAI_MODEL,
                messages=[_openai_system_with_breakpoint(system), *_with_openai_breakpoint(parts.history), *tail],
                reasoning_effort="low",
                response_format=_response_format(),
                prompt_cache_key=scoped_prompt_cache_key(
                    user_id="live-cache-harness",
                    anima_id=f"owner-{run_tag}",
                    provider_type=provider_type,
                    model=OPENAI_MODEL,
                ),
            )
            details = completion.usage.prompt_tokens_details
            usages.append(_TurnUsage(completion.usage.prompt_tokens, details.cached_tokens if details else 0))
            text = completion.choices[0].message.content or ""
            history += [{"role": "user", "content": USER_TURNS[turn]}, {"role": "assistant", "content": text}]
    return usages


async def _run_responses_server_state_owner_layout(*, map_changes_every_turn: bool) -> list[_TurnUsage]:
    """Server state: stable instructions ending with the guardrails; context sent only when it changes.

    When the turn context changes it is sent as a developer item before the user
    message, followed again by the guardrails so they stay the last instruction.
    """

    provider_type = "OpenAIResponsesHTTPAgent"
    run_tag = uuid4().hex
    usages: list[_TurnUsage] = []
    previous_response_id: str | None = None
    last_context: str | None = None
    guardrails = COMPANION_GUARDRAILS.strip()
    async with AsyncOpenAI(api_key=os.environ["OPENAI_API_KEY"], timeout=120.0) as client:
        for turn in range(len(USER_TURNS)):
            parts = _parts(turn=turn, history=[], provider_type=provider_type, model=OPENAI_MODEL, run_tag=run_tag)
            memory_map = _memory_map(turn) if map_changes_every_turn else _stable_memory_map(turn)
            context = parts.trailing.replace(_memory_map(turn), memory_map).removesuffix(guardrails).strip()
            items: list[dict[str, Any]] = []
            if context != last_context:
                items.append({"role": "developer", "content": f"{context}\n\n{guardrails}"})
                last_context = context
            items.append({"role": "user", "content": parts.user})
            request: dict[str, Any] = {
                "model": OPENAI_MODEL,
                "instructions": f"{parts.system}\n\n{guardrails}",
                "input": items,
                "store": True,
                "reasoning": {"effort": "low"},
                "text": responses_text_format(_response_format()),
                "context_management": [{"type": "compaction", "compact_threshold": 90_000}],
                "prompt_cache_key": scoped_prompt_cache_key(
                    user_id="live-cache-harness",
                    anima_id=f"owner-{run_tag}",
                    provider_type=provider_type,
                    model=OPENAI_MODEL,
                ),
            }
            if previous_response_id:
                request["previous_response_id"] = previous_response_id
            response = await cast(Any, client).responses.create(**request)
            details = response.usage.input_tokens_details
            usages.append(_TurnUsage(response.usage.input_tokens, details.cached_tokens if details else 0))
            previous_response_id = response.id
    return usages


async def _run_anthropic_owner_layout() -> list[_TurnUsage]:
    """Anthropic rejects a system message before the user turn, so the context is a tagged user block."""

    output_format = {
        "type": "json_schema",
        "schema": anthropic_strict_schema(build_main_structured_response_json_schema(_output_type())),
    }
    run_tag = uuid4().hex
    history: list[dict[str, str]] = []
    usages: list[_TurnUsage] = []
    async with anthropic.AsyncAnthropic(api_key=os.environ["ANTHROPIC_API_KEY"], timeout=120.0) as client:
        for turn in range(len(USER_TURNS)):
            parts = _parts(
                turn=turn,
                history=history,
                provider_type="AnthropicMessagesHTTPAgent",
                model=ANTHROPIC_MODEL,
                run_tag=run_tag,
            )
            messages: list[dict[str, Any]] = [dict(message) for message in parts.history]
            if messages:
                last = messages[-1]
                messages[-1] = {
                    "role": last["role"],
                    "content": [{"type": "text", "text": last["content"], "cache_control": {"type": "ephemeral"}}],
                }
            messages.append({"role": "user", "content": _tagged(parts.trailing, parts.user)})
            message = await cast(Any, client).messages.create(
                model=ANTHROPIC_MODEL,
                max_tokens=1024,
                system=[
                    {
                        "type": "text",
                        "text": parts.system + TURN_CONTEXT_NOTE,
                        "cache_control": {"type": "ephemeral"},
                    }
                ],
                messages=messages,
                output_config={"effort": "low", "format": output_format},
            )
            usage = message.usage
            cached = usage.cache_read_input_tokens or 0
            total = usage.input_tokens + cached + (usage.cache_creation_input_tokens or 0)
            usages.append(_TurnUsage(total, cached))
            text = "".join(getattr(block, "text", "") for block in message.content if block.type == "text")
            history += [{"role": "user", "content": USER_TURNS[turn]}, {"role": "assistant", "content": text}]
    return usages


async def test_measure_owner_layout() -> None:
    method = "owner layout: context and guardrails before the user message; provider-specific cache breakpoints"
    runs: list[tuple[str, Callable[[], Awaitable[list[_TurnUsage]]], str]] = [
        ("owner_chat_developer_before_user", partial(_run_chat_owner_layout, developer_role=True), OPENAI_MODEL),
        ("owner_chat_tagged_user_block", partial(_run_chat_owner_layout, developer_role=False), OPENAI_MODEL),
        (
            "owner_responses_server_state_map_every_turn",
            partial(_run_responses_server_state_owner_layout, map_changes_every_turn=True),
            OPENAI_MODEL,
        ),
        (
            "owner_responses_server_state_map_changes_once",
            partial(_run_responses_server_state_owner_layout, map_changes_every_turn=False),
            OPENAI_MODEL,
        ),
        ("owner_anthropic_tagged_user_block", _run_anthropic_owner_layout, ANTHROPIC_MODEL),
    ]
    for path, run, model in runs:
        _report(path, await run(), model=model, method=method)
