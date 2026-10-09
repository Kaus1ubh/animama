"""Translate a provider-neutral direct-chat request into Messages API parameters.

The direct-chat assembler produces one OpenAI-compatible message list (see
``docs/backend/runtime/prompt-caching.md``)::

    system (stable instructions, ending with the Companion Guardrails)
    developer (app compaction summary, when there is one)
    history ...
    developer (turn context: memory map, attachments, then the guardrails)
    user (the user's new message)
    [this turn's tool exchanges, an invalid reply, forced-final or repair text]

This module maps it to Anthropic's positions (D20, D21):

- The stable instructions become one ``system`` text block with
  ``cache_control``. An app compaction summary is folded into it just before
  the closing guardrails, so the system prompt still ends with them. (Phase 6
  replaces app compaction with native compaction for Anthropic chats.)
- History is replayed in order with same-role neighbours merged, memory-tool
  exchanges as ``tool_use``/``tool_result`` blocks and never any thinking.
  The last history block carries the second ``cache_control`` breakpoint.
- The user's new message is a user turn, followed by the turn context as a
  mid-conversation ``system`` message: Anthropic accepts a system message only
  after a user turn, so it follows the user's words. No tagged block is used.
- Within a turn, each round's assistant content is resent exactly as Anthropic
  returned it (signed thinking, text, ``tool_use``), taken from the
  continuation cursor. Forced-final and repair instructions, which already end
  with the guardrails, are text in a user turn after the tool results or the
  invalid reply.

Requests never carry sampling parameters or an assistant prefill.
"""

from __future__ import annotations

import copy
import json
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from animama.app.model_clients import (
    ANTHROPIC_TOOL_RESULT_ITEM_TYPE,
    ANTHROPIC_TOOL_USE_ITEM_TYPE,
    ModelClientContinuation,
    ModelClientRequest,
)
from animama.app.model_clients.prompt import prompt_messages, prompt_tools
from animama.app.safety.prompts import COMPANION_GUARDRAILS
from animama.domain import ModelProvider

from .._common import jsonable
from .schema import anthropic_strict_schema
from .support import ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE, clean_str

ANTHROPIC_MAX_TOKENS_PER_REQUEST = 64_000
"""Output cap for one request (thinking included); the row's own limit applies when lower."""
DEFAULT_ANTHROPIC_CHAT_EFFORT = "medium"
"""Effort when neither the owner nor the Anima chose one (D22).

At ``low``, Haiku 5.5 often skipped needed memory-tool calls in live tests."""
EFFORT_NONE = "none"
CACHE_CONTROL: dict[str, str] = {"type": "ephemeral"}
_THINKING_BLOCK_TYPES = frozenset({"thinking", "redacted_thinking"})


def messages_request_params(spec: ModelClientRequest) -> dict[str, Any]:
    """Return JSON-shaped keyword arguments for ``client.messages.stream``."""

    prompt = spec.prompt
    layout = _prompt_layout(prompt_messages(prompt))
    params: dict[str, Any] = {
        "model": spec.model_provider.model,
        "max_tokens": request_max_tokens(spec.model_provider),
        "messages": _request_messages(layout, continuation_rounds(spec.continuation)),
    }
    system_text = _system_text(layout.system_text, layout.summaries)
    if system_text:
        params["system"] = [{"type": "text", "text": system_text, "cache_control": dict(CACHE_CONTROL)}]
    tools = anthropic_tools(prompt_tools(prompt))
    if tools:
        params["tools"] = tools
        params["tool_choice"] = _tool_choice(prompt.tool_choice, prompt.parallel_tool_calls)
    output_config: dict[str, Any] = {}
    output_format = anthropic_output_format(prompt.response_format)
    if output_format is not None:
        output_config["format"] = output_format
    effort, thinking = effort_and_thinking(prompt.reasoning_effort, spec.model_provider)
    if effort is not None:
        output_config["effort"] = effort
    if thinking is not None:
        params["thinking"] = thinking
    if output_config:
        params["output_config"] = output_config
    return params


def request_max_tokens(model_provider: ModelProvider) -> int:
    """Return the row's output limit, capped by the per-request limit."""

    limit = model_provider.max_output_tokens
    if isinstance(limit, int) and not isinstance(limit, bool) and limit > 0:
        return min(limit, ANTHROPIC_MAX_TOKENS_PER_REQUEST)
    return ANTHROPIC_MAX_TOKENS_PER_REQUEST


def effort_and_thinking(
    requested: str | None,
    model_provider: ModelProvider,
) -> tuple[str | None, dict[str, str] | None]:
    """Map the turn's reasoning effort to ``output_config.effort`` and ``thinking`` (D6, D22).

    ``none`` disables thinking and sends no effort. Any other effort leaves
    thinking at the model's adaptive default and sets the effort. Without a
    choice, chat requests use ``medium`` when the row offers it.
    """

    effort = requested.strip() if isinstance(requested, str) and requested.strip() else None
    if effort is None:
        supported = {str(value).strip() for value in model_provider.capabilities.supported_reasoning_efforts or ()}
        effort = DEFAULT_ANTHROPIC_CHAT_EFFORT if DEFAULT_ANTHROPIC_CHAT_EFFORT in supported else None
    if effort is None:
        return None, None
    if effort == EFFORT_NONE:
        return None, {"type": "disabled"}
    return effort, None


def anthropic_tools(function_tools: Sequence[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Convert Chat Completions function tools into strict Anthropic tools (D3)."""

    tools: list[dict[str, Any]] = []
    for raw_tool in function_tools:
        function = raw_tool.get("function") if raw_tool.get("type") == "function" else None
        if not isinstance(function, Mapping):
            continue
        name = clean_str(function.get("name"))
        if name is None:
            continue
        parameters = jsonable(function.get("parameters") or {"type": "object", "properties": {}})
        tool: dict[str, Any] = {"name": name}
        description = clean_str(function.get("description"))
        if description is not None:
            tool["description"] = description
        tool["input_schema"] = anthropic_strict_schema(parameters if isinstance(parameters, dict) else {})
        tool["strict"] = True
        tools.append(tool)
    return tools


def anthropic_output_format(response_format: Mapping[str, Any] | None) -> dict[str, Any] | None:
    """Return ``output_config.format`` for a strict JSON-schema response format, else ``None``."""

    raw = jsonable(response_format) if isinstance(response_format, Mapping) else None
    if not isinstance(raw, dict) or raw.get("type") != "json_schema":
        return None
    schema_config = raw.get("json_schema")
    schema = schema_config.get("schema") if isinstance(schema_config, dict) else None
    if not isinstance(schema, dict):
        return None
    return {"type": "json_schema", "schema": anthropic_strict_schema(schema)}


def continuation_rounds(continuation: ModelClientContinuation | None) -> list[list[dict[str, Any]]]:
    """Return this turn's earlier assistant content arrays carried by the cursor."""

    if continuation is None or continuation.provider_type != ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE:
        return []
    try:
        parsed = json.loads(continuation.cursor)
    except (TypeError, ValueError):
        return []
    if not isinstance(parsed, list):
        return []
    return [[block for block in content if isinstance(block, dict)] for content in parsed if isinstance(content, list)]


def continuation_with_round(
    continuation: ModelClientContinuation | None,
    content: list[dict[str, Any]],
    *,
    model: str,
) -> ModelClientContinuation:
    """Return a cursor carrying this turn's earlier rounds plus ``content``, unchanged."""

    rounds = [*continuation_rounds(continuation), content]
    return ModelClientContinuation(
        provider_type=ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE,
        cursor=json.dumps(rounds, ensure_ascii=False, separators=(",", ":")),
        metadata={"source": "tool_call_response", "model": model, "round_count": len(rounds)},
    )


@dataclass(slots=True)
class _PromptLayout:
    """The assembler's prompt split into the parts Anthropic places differently."""

    system_text: str | None = None
    summaries: list[str] = field(default_factory=list)
    history: list[Mapping[str, Any]] = field(default_factory=list)
    turn_user: Mapping[str, Any] | None = None
    turn_context: str | None = None
    after_turn: list[Mapping[str, Any]] = field(default_factory=list)


def _prompt_layout(messages: list[dict[str, Any]]) -> _PromptLayout:
    layout = _PromptLayout()
    start = 0
    if messages and _is_instruction(messages[0], "system"):
        layout.system_text = _text(messages[0].get("content"))
        start = 1
    user_index = next(
        (index for index in range(len(messages) - 1, start - 1, -1) if _is_plain(messages[index], "user")),
        None,
    )
    if user_index is None:
        layout.history = list(messages[start:])
        return layout
    history_end = user_index
    if user_index - 1 >= start and _is_instruction(messages[user_index - 1], "developer"):
        # The turn context sits directly before the user's new message.
        layout.turn_context = _text(messages[user_index - 1].get("content"))
        history_end = user_index - 1
    index = start
    while index < history_end and _is_instruction(messages[index], "developer"):
        # Leading developer messages are the app compaction summary.
        summary = _text(messages[index].get("content"))
        if summary:
            layout.summaries.append(summary)
        index += 1
    layout.history = list(messages[index:history_end])
    layout.turn_user = messages[user_index]
    layout.after_turn = list(messages[user_index + 1 :])
    return layout


def _system_text(system_text: str | None, summaries: list[str]) -> str | None:
    """Fold an app compaction summary into the system prompt before its closing guardrails."""

    if not summaries:
        return system_text
    summary = "\n\n".join(summaries)
    if not system_text:
        return summary
    guardrails = COMPANION_GUARDRAILS.strip()
    if system_text.endswith(guardrails):
        head = system_text[: -len(guardrails)].rstrip()
        return f"{head}\n\n{summary}\n\n{guardrails}" if head else f"{summary}\n\n{guardrails}"
    return f"{system_text}\n\n{summary}"


class _Conversation:
    """Messages under construction; adjacent user or assistant turns merge into one."""

    def __init__(self) -> None:
        self.messages: list[dict[str, Any]] = []

    def add(self, role: str, blocks: list[dict[str, Any]]) -> None:
        if not blocks:
            return
        last = self.messages[-1] if self.messages else None
        if last is not None and last["role"] == role and role in {"user", "assistant"}:
            last["content"].extend(blocks)
        else:
            self.messages.append({"role": role, "content": list(blocks)})

    def add_instruction(self, text: str) -> None:
        """Add app instruction text where Anthropic reads it after the turn's latest content.

        After tool results or an assistant reply it is text in a user turn. A
        system message must be last or followed by an assistant turn, so text
        that directly follows the turn-context message joins that message.
        """

        last = self.messages[-1] if self.messages else None
        if last is not None and last["role"] == "system":
            last["content"] = f"{last['content']}\n\n{text}"
        else:
            self.add("user", [_text_block(text)])


def _request_messages(layout: _PromptLayout, rounds: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    conversation = _Conversation()
    for message in layout.history:
        mapped = _history_blocks(message)
        if mapped is not None:
            conversation.add(*mapped)
    _drop_orphan_prefix(conversation.messages)
    if conversation.messages:
        # Cache the replayed history: the previous request wrote an entry at
        # its own last history block, which this request reads.
        conversation.messages[-1]["content"][-1]["cache_control"] = dict(CACHE_CONTROL)
    if layout.turn_user is not None:
        conversation.add("user", _content_blocks(layout.turn_user.get("content")))
    if layout.turn_context:
        conversation.messages.append({"role": "system", "content": layout.turn_context})
    pending: list[Mapping[str, Any]] = []
    for message in layout.after_turn:
        if message.get("type") == ANTHROPIC_TOOL_USE_ITEM_TYPE:
            pending.append(message)
            continue
        _flush_tool_uses(conversation, pending, rounds)
        pending = []
        if message.get("type") == ANTHROPIC_TOOL_RESULT_ITEM_TYPE:
            conversation.add("user", [_tool_result_block(message)])
        elif _is_plain(message, "assistant"):
            conversation.add("assistant", _content_blocks(message.get("content")))
        elif _is_instruction(message, "developer") or _is_instruction(message, "system"):
            text = _text(message.get("content"))
            if text:
                conversation.add_instruction(text)
        elif _is_plain(message, "user"):
            conversation.add("user", _content_blocks(message.get("content")))
    _flush_tool_uses(conversation, pending, rounds)
    return conversation.messages


def _flush_tool_uses(
    conversation: _Conversation,
    items: list[Mapping[str, Any]],
    rounds: list[list[dict[str, Any]]],
) -> None:
    """Add one round's tool calls as the assistant content Anthropic returned for them."""

    if not items:
        return
    ids = [str(item.get("id") or "") for item in items]
    for content in rounds:
        if [str(block.get("id") or "") for block in content if block.get("type") == "tool_use"] == ids:
            # Resent exactly as returned: signed thinking, text and tool_use blocks.
            conversation.add("assistant", copy.deepcopy(content))
            return
    conversation.add("assistant", [_tool_use_block(item) for item in items])


def _history_blocks(message: Mapping[str, Any]) -> tuple[str, list[dict[str, Any]]] | None:
    """Map one replayed history message; other providers' items never reach an Anthropic chat."""

    item_type = message.get("type")
    if item_type == ANTHROPIC_TOOL_USE_ITEM_TYPE:
        return "assistant", [_tool_use_block(message)]
    if item_type == ANTHROPIC_TOOL_RESULT_ITEM_TYPE:
        return "user", [_tool_result_block(message)]
    if item_type is not None:
        return None
    role = _role(message)
    if role not in {"user", "assistant"}:
        return None
    return role, _content_blocks(message.get("content"))


def _drop_orphan_prefix(messages: list[dict[str, Any]]) -> None:
    """Start history at a user turn without tool results whose calls fell outside the window."""

    while messages:
        first = messages[0]
        if first["role"] != "user":
            messages.pop(0)
            continue
        first["content"] = [block for block in first["content"] if block.get("type") != "tool_result"]
        if first["content"]:
            return
        messages.pop(0)


def _content_blocks(content: Any) -> list[dict[str, Any]]:
    """Return text or stored content blocks, never thinking (D8)."""

    if isinstance(content, str):
        return [_text_block(content)] if content else []
    if not isinstance(content, list | tuple):
        return []
    blocks: list[dict[str, Any]] = []
    for block in content:
        if not isinstance(block, Mapping) or block.get("type") in _THINKING_BLOCK_TYPES:
            continue
        copied = jsonable(block)
        if isinstance(copied, dict):
            copied.pop("cache_control", None)
            blocks.append(copied)
    return blocks


def _tool_use_block(item: Mapping[str, Any]) -> dict[str, Any]:
    tool_input = jsonable(item.get("input"))
    return {
        "type": "tool_use",
        "id": str(item.get("id") or ""),
        "name": str(item.get("name") or ""),
        "input": tool_input if isinstance(tool_input, dict) else {},
    }


def _tool_result_block(item: Mapping[str, Any]) -> dict[str, Any]:
    content = item.get("content")
    return {
        "type": "tool_result",
        "tool_use_id": str(item.get("tool_use_id") or ""),
        "content": content if isinstance(content, str) else json.dumps(jsonable(content), ensure_ascii=False),
    }


def _tool_choice(tool_choice: Any, parallel_tool_calls: bool | None) -> dict[str, Any]:
    if tool_choice == "none":
        # Forced-final and repair rounds keep the tools so the cache and the
        # turn's thinking blocks stay valid, and ask for no further calls.
        return {"type": "none"}
    choice: dict[str, Any] = {"type": "auto"}
    if parallel_tool_calls is False:
        choice["disable_parallel_tool_use"] = True
    return choice


def _text_block(text: str) -> dict[str, Any]:
    return {"type": "text", "text": text}


def _role(message: Mapping[str, Any]) -> str:
    return str(message.get("role") or "").strip().lower()


def _is_plain(message: Mapping[str, Any], role: str) -> bool:
    return message.get("type") is None and _role(message) == role


def _is_instruction(message: Mapping[str, Any], role: str) -> bool:
    return _is_plain(message, role) and isinstance(message.get("content"), str)


def _text(value: Any) -> str | None:
    return value if isinstance(value, str) and value.strip() else None


__all__ = [
    "ANTHROPIC_MAX_TOKENS_PER_REQUEST",
    "CACHE_CONTROL",
    "DEFAULT_ANTHROPIC_CHAT_EFFORT",
    "anthropic_output_format",
    "anthropic_tools",
    "continuation_rounds",
    "continuation_with_round",
    "effort_and_thinking",
    "messages_request_params",
    "request_max_tokens",
]
