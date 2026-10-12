"""Opt-in live checks of the Anthropic Messages behaviour Animama relies on.

Each test records one assumption the Anthropic adapter and Memory Manager
runtime depend on (see docs/plans/anthropic-model-provider). They make paid
requests, so they run only with ``ANIMAMA_RUN_LIVE_TESTS=1`` and a real
``ANTHROPIC_API_KEY``. Run with ``-s`` to see the recorded measurements; no
request or response content is printed.
"""

from __future__ import annotations

import json
import os
import statistics
import time
from collections.abc import Iterable
from typing import Any

import anthropic
import pytest

from animama.adapters.model_clients.anthropic_messages.schema import anthropic_strict_schema
from animama.app.chat.memory_tools import memory_tool_specs
from animama.app.main_structured_response import (
    build_main_structured_response_json_schema,
    build_main_structured_response_model,
)

MODEL = "claude-haiku-5-5"
COMPACTION_BETA = "compact-2026-01-12"
WEB_SEARCH_PROMPTS = (
    "What was the closing level of the S&P 500 on the most recent trading day?",
    "Who won the most recent Formula 1 Grand Prix?",
    "What is the weather forecast for Paris tomorrow?",
)


def _api_key() -> str:
    return os.getenv("ANTHROPIC_API_KEY", "").strip()


def _live_enabled() -> bool:
    return os.getenv("ANIMAMA_RUN_LIVE_TESTS") == "1" and _api_key() not in {"", "test-key"}


pytestmark = [
    pytest.mark.asyncio,
    pytest.mark.skipif(not _live_enabled(), reason="requires ANIMAMA_RUN_LIVE_TESTS=1 and ANTHROPIC_API_KEY"),
]


def _record(check: str, **values: Any) -> None:
    """Print one non-sensitive measurement line for the ExecPlan record."""

    print(f"[anthropic-contract] {check}: {json.dumps(values, sort_keys=True, default=str)}")


def _client() -> anthropic.AsyncAnthropic:
    return anthropic.AsyncAnthropic(api_key=_api_key(), timeout=120.0, max_retries=2)


def _api(client: anthropic.AsyncAnthropic) -> Any:
    """Untyped view of the SDK client.

    These checks deliberately send raw, JSON-shaped request parameters (the shape
    the adapter will build), so the SDK's TypedDict overloads are bypassed here.
    """

    return client


def _filler(paragraphs: int, *, seed: str) -> str:
    """Deterministic, non-personal filler text for cache and compaction sizing."""

    lines = []
    for index in range(paragraphs):
        lines.append(
            f"{seed} note {index}: the lighthouse keeper logged tide level {index % 17}, "
            f"wind from bearing {(index * 37) % 360} degrees, visibility {(index * 3) % 11} miles, "
            f"and a cargo vessel named Vessel-{index % 97} passing the northern buoy at hour {index % 24}."
        )
    return "\n".join(lines)


def _anthropic_tools(specs: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Map the app's Chat Completions function specs to strict Anthropic tools.

    Strict Anthropic schemas reject some JSON Schema keywords (for example
    ``maxItems``, integer bounds and type lists); the adapter converts them.
    """

    tools = []
    for spec in specs:
        function = spec["function"]
        tools.append(
            {
                "name": function["name"],
                "description": function.get("description", ""),
                "input_schema": anthropic_strict_schema(function["parameters"]),
                "strict": True,
            }
        )
    return tools


def _main_output_type() -> Any:
    return build_main_structured_response_model(agent_id="live-contract", gesture_ids=("wave", "nod"))


def _main_output_format() -> dict[str, Any]:
    output_type = _main_output_type()
    schema = anthropic_strict_schema(build_main_structured_response_json_schema(output_type))
    return {"type": "json_schema", "schema": schema}


def _block_types(content: Iterable[Any]) -> list[str]:
    return [str(getattr(block, "type", "")) for block in content]


def _text(content: Iterable[Any]) -> str:
    return "".join(getattr(block, "text", "") for block in content if getattr(block, "type", "") == "text")


async def test_streams_text_and_reads_the_prompt_cache() -> None:
    """Checks 1 and 9: low effort, no sampling parameters, cached system prompt."""

    system = [
        {
            "type": "text",
            "text": "You are a concise assistant.\n\n" + _filler(220, seed="cache"),
            "cache_control": {"type": "ephemeral"},
        }
    ]
    request: dict[str, Any] = {
        "model": MODEL,
        "max_tokens": 512,
        "system": system,
        "output_config": {"effort": "low"},
        "messages": [{"role": "user", "content": "Reply with one short sentence about lighthouses."}],
    }
    async with _client() as client:
        deltas = 0
        async with _api(client).messages.stream(**request) as stream:
            async for event in stream:
                if event.type == "content_block_delta" and event.delta.type == "text_delta":
                    deltas += 1
            first = await stream.get_final_message()
        second = await _api(client).messages.create(**request)
    assert deltas >= 1
    assert _text(first.content)
    assert second.usage.cache_read_input_tokens and second.usage.cache_read_input_tokens > 0
    _record(
        "stream_and_cache",
        text_deltas=deltas,
        first_input=first.usage.input_tokens,
        first_cache_write=first.usage.cache_creation_input_tokens,
        second_cache_read=second.usage.cache_read_input_tokens,
        second_uncached_input=second.usage.input_tokens,
    )


async def test_disabled_thinking_still_emits_real_tool_use_blocks() -> None:
    """Check 2 (D6): the `none` effort maps to disabled thinking without text tool calls."""

    tools = _anthropic_tools(memory_tool_specs(allow_reads=True, allow_writes=False))
    async with _client() as client:
        message = await _api(client).messages.create(
            model=MODEL,
            max_tokens=1024,
            thinking={"type": "disabled"},
            tools=tools,
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
            system="Use the memory tools to look things up before answering.",
            messages=[{"role": "user", "content": "List my memory files, then tell me how many there are."}],
        )
    types = _block_types(message.content)
    assert message.stop_reason == "tool_use"
    assert "tool_use" in types
    assert "thinking" not in types
    _record("thinking_disabled_tools", stop_reason=message.stop_reason, block_types=types)


async def test_structured_output_with_strict_memory_tools_streams_valid_json() -> None:
    """Check 3: the real main response schema works beside strict memory tools."""

    tools = _anthropic_tools(memory_tool_specs(allow_reads=True, allow_writes=True))
    async with _client() as client:
        async with _api(client).messages.stream(
            model=MODEL,
            max_tokens=2048,
            output_config={"effort": "low", "format": _main_output_format()},
            tools=tools,
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
            system="You are a friendly companion. Answer directly; no tools are needed for greetings.",
            messages=[{"role": "user", "content": "Hi! How are you today?"}],
        ) as stream:
            text_deltas = 0
            async for event in stream:
                if event.type == "content_block_delta" and event.delta.type == "text_delta":
                    text_deltas += 1
            message = await stream.get_final_message()
    payload = json.loads(_text(message.content))
    # Bounds moved into descriptions must still hold under the app's own model.
    _main_output_type().model_validate(payload)
    assert isinstance(payload.get("speech"), str) and payload["speech"]
    _record(
        "structured_output_with_tools",
        stop_reason=message.stop_reason,
        text_deltas=text_deltas,
        keys=sorted(payload),
    )


async def test_mid_conversation_system_message_as_last_entry() -> None:
    """Check 4 (D9): a trailing `system` message is accepted on this model."""

    async with _client() as client:
        try:
            message = await _api(client).messages.create(
                model=MODEL,
                max_tokens=256,
                output_config={"effort": "low"},
                system="You are a helpful assistant.",
                messages=[
                    {"role": "user", "content": "Name a colour."},
                    {"role": "system", "content": "Reply with exactly one lowercase word."},
                ],
            )
        except anthropic.BadRequestError as exc:
            _record("mid_conversation_system", accepted=False, status=exc.status_code)
            pytest.fail("Mid-conversation system messages are not accepted; D9 falls back to a user text block.")
    _record("mid_conversation_system", accepted=True, words=len(_text(message.content).split()))


async def test_thinking_resend_within_turn_and_omission_across_turns() -> None:
    """Check 5 (D8): resend thinking unchanged in a tool round; omit it next turn."""

    tools = _anthropic_tools(memory_tool_specs(allow_reads=True, allow_writes=False))
    system = "Use memory_list_files before answering questions about saved files."
    first_user = {"role": "user", "content": "Which memory files do I have? Think it through carefully."}
    async with _client() as client:
        first = await _api(client).messages.create(
            model=MODEL,
            max_tokens=4096,
            output_config={"effort": "high"},
            tools=tools,
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
            system=system,
            messages=[first_user],
        )
        assert first.stop_reason == "tool_use"
        thinking = [block for block in first.content if block.type == "thinking"]
        assert thinking and all(block.signature for block in thinking)
        tool_use = next(block for block in first.content if block.type == "tool_use")
        assistant_content = [block.to_dict() for block in first.content]
        tool_result = {
            "role": "user",
            "content": [
                {
                    "type": "tool_result",
                    "tool_use_id": tool_use.id,
                    "content": json.dumps({"files": ["PROFILE.md", "notes/preferences.md"]}),
                }
            ],
        }
        # The follow-up resends the thinking unchanged. tool_choice "none" also
        # checks the forced-final round shape the adapter uses at the tool limit.
        second = await _api(client).messages.create(
            model=MODEL,
            max_tokens=4096,
            output_config={"effort": "high"},
            tools=tools,
            tool_choice={"type": "none"},
            system=system,
            messages=[first_user, {"role": "assistant", "content": assistant_content}, tool_result],
        )
        assert second.stop_reason == "end_turn"
        final_text = _text(second.content)
        assert final_text
        # Next turn: replay the turn as visible text only, with no thinking blocks.
        third = await _api(client).messages.create(
            model=MODEL,
            max_tokens=1024,
            output_config={"effort": "low"},
            tools=tools,
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
            system=system,
            messages=[
                first_user,
                {"role": "assistant", "content": final_text},
                {"role": "user", "content": "Thanks. Which of those sounds like settings?"},
            ],
        )
    # The next turn only has to be accepted without earlier thinking; the model
    # may legitimately answer or call a tool.
    assert third.stop_reason in {"end_turn", "tool_use"}
    _record(
        "thinking_continuity",
        first_block_types=_block_types(first.content),
        second_stop=second.stop_reason,
        next_turn_stop=third.stop_reason,
    )


async def _web_search_run(client: anthropic.AsyncAnthropic, tool: dict[str, Any], prompt: str) -> dict[str, Any]:
    messages: list[dict[str, Any]] = [{"role": "user", "content": prompt}]
    started = time.monotonic()
    pauses = 0
    input_tokens = 0
    types: list[str] = []
    while True:
        message = await _api(client).messages.create(
            model=MODEL,
            max_tokens=4096,
            output_config={"effort": "low", "format": _main_output_format()},
            tools=[tool],
            system="You are a companion. Search the web when the question needs current information.",
            messages=messages,
        )
        input_tokens += message.usage.input_tokens + (message.usage.cache_read_input_tokens or 0)
        types.extend(_block_types(message.content))
        if message.stop_reason != "pause_turn" or pauses >= 3:
            break
        pauses += 1
        messages = [*messages, {"role": "assistant", "content": [block.to_dict() for block in message.content]}]
    payload = json.loads(_text(message.content))
    assert payload.get("speech")
    return {
        "seconds": round(time.monotonic() - started, 2),
        "input_tokens": input_tokens,
        "pauses": pauses,
        "searches": (message.usage.server_tool_use.web_search_requests if message.usage.server_tool_use else 0),
        "block_types": sorted(set(types)),
    }


async def test_web_search_versions_with_structured_output() -> None:
    """Check 6 (D7): compare basic and dynamic-filtering web search on fixed prompts."""

    variants = {
        "basic": {"type": "web_search_20250305", "name": "web_search", "max_uses": 1, "allowed_callers": ["direct"]},
        "dynamic": {
            "type": "web_search_20260318",
            "name": "web_search",
            "max_uses": 1,
            "response_inclusion": "excluded",
        },
    }
    results: dict[str, list[dict[str, Any]]] = {name: [] for name in variants}
    async with _client() as client:
        for prompt in WEB_SEARCH_PROMPTS:
            for name, tool in variants.items():
                results[name].append(await _web_search_run(client, tool, prompt))
    for name, runs in results.items():
        _record(
            f"web_search_{name}",
            median_seconds=statistics.median(run["seconds"] for run in runs),
            median_input_tokens=statistics.median(run["input_tokens"] for run in runs),
            pauses=[run["pauses"] for run in runs],
            searches=[run["searches"] for run in runs],
            block_types=sorted({t for run in runs for t in run["block_types"]}),
        )


async def test_threshold_compaction_streams_a_resendable_block() -> None:
    """Check 7 (D4): compaction at the 50,000-token minimum, resent on the next request."""

    history: list[dict[str, Any]] = []
    # About 57,000 Haiku 5.5 input tokens: just above the 50,000 minimum trigger.
    for index in range(7):
        history.append({"role": "user", "content": f"Log part {index}:\n" + _filler(105, seed=f"part{index}")})
        history.append({"role": "assistant", "content": f"Noted log part {index}."})
    history.append({"role": "user", "content": "Summarize the logs in one sentence."})
    context_management = {
        "edits": [
            {
                "type": "compact_20260112",
                "trigger": {"type": "input_tokens", "value": 50_000},
                "pause_after_compaction": False,
            }
        ]
    }
    events: list[str] = []
    async with _client() as client:
        async with _api(client).beta.messages.stream(
            model=MODEL,
            max_tokens=1024,
            betas=[COMPACTION_BETA],
            output_config={"effort": "low"},
            context_management=context_management,
            messages=history,
        ) as stream:
            async for event in stream:
                if event.type == "content_block_start":
                    events.append(f"start:{event.content_block.type}")
                elif event.type == "content_block_delta":
                    events.append(f"delta:{event.delta.type}")
            message = await stream.get_final_message()
        block_types = _block_types(message.content)
        assert "compaction" in block_types
        resent = await _api(client).beta.messages.create(
            model=MODEL,
            max_tokens=512,
            betas=[COMPACTION_BETA],
            output_config={"effort": "low"},
            context_management=context_management,
            messages=[
                *history,
                {"role": "assistant", "content": [block.model_dump(exclude_none=True) for block in message.content]},
                {"role": "user", "content": "And how many log parts were there?"},
            ],
        )
    # Run-length encode so the record shows how many deltas each block streamed.
    sequence: list[list[Any]] = []
    for item in events:
        if sequence and sequence[-1][0] == item:
            sequence[-1][1] += 1
        else:
            sequence.append([item, 1])
    iterations = [
        {"type": getattr(it, "type", None), "input": getattr(it, "input_tokens", None)}
        for it in (getattr(message.usage, "iterations", None) or [])
    ]
    _record(
        "compaction",
        event_counts=sequence,
        block_types=block_types,
        iterations=iterations,
        resend_input_tokens=resent.usage.input_tokens,
        resend_stop=resent.stop_reason,
    )


async def test_memory_tool_command_pattern_under_manager_instructions() -> None:
    """Check 8: the memory tool's first calls and whether it writes progress notes."""

    store = {"/memories/PROFILE.md": "# Profile\n\n- Prefers coffee in the morning.\n"}
    commands: list[str] = []

    def execute(command: dict[str, Any]) -> tuple[str, bool]:
        name = command.get("command")
        path = command.get("path", "")
        commands.append(f"{name}:{path or command.get('old_path', '')}")
        if name == "view":
            if path in store:
                lines = store[path].splitlines()
                numbered = "\n".join(f"{i + 1:6d}\t{line}" for i, line in enumerate(lines))
                return f"Here's the content of {path} with line numbers:\n{numbered}", False
            listing = "\n".join(f"1.0K\t{p}" for p in sorted(store))
            return (
                f"Here're the files and directories up to 2 levels deep in /memories:\n1.0K\t/memories\n{listing}",
                False,
            )
        if name == "str_replace" and path in store and command.get("old_str", "") in store[path]:
            store[path] = store[path].replace(command["old_str"], command.get("new_str", ""), 1)
            return "The memory file has been edited.", False
        if name == "create":
            store[path] = command.get("file_text", "")
            return f"File created successfully at: {path}", False
        if name == "insert" and path in store:
            lines = store[path].split("\n")
            lines.insert(int(command.get("insert_line", 0)), command.get("insert_text", "").rstrip("\n"))
            store[path] = "\n".join(lines)
            return f"The file {path} has been edited.", False
        return f"Error: unsupported or invalid command {name}", True

    system = (
        "You curate a user's long-term memory files. Make only the change the request asks for, "
        "editing the most relevant existing file. Never create progress, status or scratch notes; "
        "the memory directory holds only curated facts about the user."
    )
    messages: list[dict[str, Any]] = [
        {"role": "user", "content": "The user now prefers tea instead of coffee in the morning. Update their memory."}
    ]
    async with _client() as client:
        for _ in range(6):
            message = await _api(client).messages.create(
                model=MODEL,
                max_tokens=2048,
                output_config={"effort": "medium"},
                tools=[{"type": "memory_20250818", "name": "memory"}],
                system=system,
                messages=messages,
            )
            messages.append({"role": "assistant", "content": [block.to_dict() for block in message.content]})
            calls = [block for block in message.content if block.type == "tool_use"]
            if not calls:
                break
            results = []
            for call in calls:
                output, is_error = execute(dict(call.input))
                results.append({"type": "tool_result", "tool_use_id": call.id, "content": output, "is_error": is_error})
            messages.append({"role": "user", "content": results})
    created_extra = sorted(path for path in store if path != "/memories/PROFILE.md")
    assert "tea" in store["/memories/PROFILE.md"].lower()
    _record("memory_tool", commands=commands, extra_files_created=created_extra)


async def test_error_shapes() -> None:
    """Check 10: authentication and unknown-model failures raise typed SDK errors."""

    async with anthropic.AsyncAnthropic(api_key="sk-ant-invalid-for-test", max_retries=0) as bad_client:
        with pytest.raises(anthropic.AuthenticationError) as auth_error:
            await _api(bad_client).messages.create(
                model=MODEL, max_tokens=16, messages=[{"role": "user", "content": "hi"}]
            )
    async with _client() as client:
        with pytest.raises(anthropic.NotFoundError) as not_found:
            await _api(client).messages.create(
                model="claude-does-not-exist", max_tokens=16, messages=[{"role": "user", "content": "hi"}]
            )
    _record(
        "error_shapes",
        auth_status=auth_error.value.status_code,
        not_found_status=not_found.value.status_code,
    )
