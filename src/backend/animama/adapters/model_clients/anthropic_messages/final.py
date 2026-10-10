"""Extract the provider-neutral final from a completed Anthropic message.

A message that paused (``stop_reason: pause_turn``) is continued by resending
its content, so one round's final can span several responses: their content
is concatenated and their usage summed.
"""

from __future__ import annotations

import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from animama.app.model_clients import ModelClientToolCall
from animama.app.model_clients.usage_estimate import CONTEXT_TOKENS_METADATA_KEY
from animama.domain.usage import Usage, UsageInputDetails, UsageOutputDetails

from .._common import get_value, jsonable
from .support import ANTHROPIC_API, ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE, clean_str, optional_int

STOP_REASON_TOOL_USE = "tool_use"
STOP_REASON_MAX_TOKENS = "max_tokens"
STOP_REASON_REFUSAL = "refusal"
STOP_REASON_PAUSE_TURN = "pause_turn"
_USAGE_FIELDS = ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")
_COMPACTION_BLOCK = "compaction"
_SERVER_TOOL_USE_BLOCK = "server_tool_use"
_WEB_SEARCH_RESULT_BLOCK = "web_search_tool_result"
_WEB_SEARCH_TOOL = "web_search"


@dataclass(frozen=True, slots=True)
class AnthropicResponse:
    """One completed (accumulated) SDK message and the usage iterations its stream reported."""

    message: Any
    stream_iterations: list[Any] = field(default_factory=list)


@dataclass(frozen=True, slots=True)
class MessageFinalParts:
    """Final text, tool calls, usage and safe metadata from one Anthropic message.

    ``content`` is the round's content blocks in request form, kept only for
    the turn's next round (never persisted). ``replay_prefix`` is the turn's
    latest compaction block, persisted before the reply text so later turns
    continue from its summary. ``refusal_category`` is the ``stop_details``
    category when the model declined the turn. ``usage_reported`` is true
    when Anthropic reported usage for at least one of the turn's responses.
    """

    text: str
    tool_calls: tuple[ModelClientToolCall, ...]
    usage: Usage
    metadata: dict[str, Any]
    content: list[dict[str, Any]]
    stop_reason: str | None
    refusal_category: str | None
    replay_prefix: tuple[dict[str, Any], ...] = ()
    usage_reported: bool = False


def message_final_parts(
    responses: Sequence[AnthropicResponse],
    *,
    earlier_rounds: Sequence[Sequence[Mapping[str, Any]]] = (),
) -> MessageFinalParts:
    """Read a round's completed (accumulated) SDK messages, oldest first.

    ``responses`` holds the first message and any ``pause_turn``
    continuations. Each one's ``stream_iterations`` are usage iterations seen
    on its stream's ``message_delta``, used when the accumulated usage does not
    carry them. ``earlier_rounds`` are this turn's previous rounds' content
    (from the continuation), so the persisted reply carries the turn's latest
    compaction block and every web search of the turn.

    A reply cut off at ``max_tokens`` offers no tool calls, because a
    truncated tool input is incomplete; its text goes to local validation and
    the structured-reply repair like other truncated replies.
    """

    if not responses:
        raise ValueError("message_final_parts needs at least one response")
    message = responses[-1].message
    content = [
        content_block_param(block)
        for response in responses
        for block in get_value(response.message, "content", None) or ()
    ]
    stop_reason = clean_str(get_value(message, "stop_reason"))
    text = "".join(
        block["text"] for block in content if block.get("type") == "text" and isinstance(block.get("text"), str)
    )
    tool_calls: tuple[ModelClientToolCall, ...] = ()
    if stop_reason != STOP_REASON_MAX_TOKENS:
        tool_calls = tuple(
            ModelClientToolCall(
                id=str(block.get("id") or ""),
                name=str(block.get("name") or ""),
                arguments=json.dumps(block.get("input") or {}, ensure_ascii=False, separators=(",", ":")),
            )
            for block in content
            if block.get("type") == "tool_use"
        )
    usages = [
        (
            get_value(response.message, "usage"),
            _iterations(get_value(response.message, "usage")) or list(response.stream_iterations),
        )
        for response in responses
    ]
    usage = Usage()
    for usage_value, iterations in usages:
        usage.add(usage_from_anthropic(usage_value, iterations=iterations))
    stop_details = _stop_details(get_value(message, "stop_details"))
    message_id = clean_str(get_value(message, "id"))
    model = clean_str(get_value(message, "model"))
    turn_content = [block for round_content in earlier_rounds for block in round_content] + content
    anthropic: dict[str, Any] = {
        "message_id": message_id,
        "model": model,
        "stop_reason": stop_reason,
        "usage": usage_summary_for(usages),
        "block_types": [str(block.get("type") or "") for block in content],
    }
    if len(responses) > 1:
        anthropic["pause_turn_continuations"] = len(responses) - 1
    if stop_details:
        anthropic["stop_details"] = stop_details
    searches = web_search_summaries(turn_content)
    if searches:
        # Sources are stored, not displayed (R6); encrypted result content is never stored (D8).
        anthropic["native_tool_summaries"] = searches
        # Billed searches across the whole turn; ``usage`` covers only this round.
        anthropic["web_search_requests"] = sum(1 for search in searches if "error_code" not in search)
    citations = web_citations(turn_content)
    if citations:
        anthropic["citations"] = citations
    metadata: dict[str, Any] = {
        "provider": ANTHROPIC_MESSAGES_HTTP_PROVIDER_TYPE,
        "api": ANTHROPIC_API,
        "model": model,
        "message_id": message_id,
        "stop_reason": stop_reason,
        "anthropic": {key: value for key, value in anthropic.items() if value is not None},
        # Only the last iteration remains in the next turn's context: a
        # compaction step is billed, but its input is replaced by the summary.
        CONTEXT_TOKENS_METADATA_KEY: context_tokens(*usages[-1]),
    }
    compaction = latest_compaction_block(turn_content)
    return MessageFinalParts(
        text=text,
        tool_calls=tool_calls,
        usage=usage,
        metadata={key: value for key, value in metadata.items() if value is not None},
        content=content,
        stop_reason=stop_reason,
        refusal_category=clean_str(stop_details.get("category")) if stop_reason == STOP_REASON_REFUSAL else None,
        replay_prefix=(compaction,) if compaction is not None else (),
        usage_reported=any(usage_value is not None for usage_value, _ in usages),
    )


def latest_compaction_block(content: Iterable[Mapping[str, Any]]) -> dict[str, Any] | None:
    """Return the last compaction block with a summary; the API ignores content before it.

    A block whose summary failed (no ``content``) is a server no-op and is not kept.
    """

    latest: dict[str, Any] | None = None
    for block in content:
        if block.get("type") == _COMPACTION_BLOCK and block.get("content"):
            copied = jsonable(block)
            if isinstance(copied, dict):
                copied.pop("cache_control", None)
                latest = copied
    return latest


def web_search_summaries(content: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return each web search's query and result titles and URLs, or its error code.

    Encrypted result content and page text are never kept; citations keep only
    the short ``cited_text`` excerpt (see ``web_citations``).
    """

    blocks = list(content)
    results = {
        str(block.get("tool_use_id") or ""): block.get("content")
        for block in blocks
        if block.get("type") == _WEB_SEARCH_RESULT_BLOCK
    }
    summaries: list[dict[str, Any]] = []
    for block in blocks:
        if block.get("type") != _SERVER_TOOL_USE_BLOCK or block.get("name") != _WEB_SEARCH_TOOL:
            continue
        call_id = str(block.get("id") or "")
        tool_input = block.get("input")
        summary: dict[str, Any] = {"tool_type": _WEB_SEARCH_TOOL, "tool_use_id": call_id}
        query = clean_str(tool_input.get("query")) if isinstance(tool_input, Mapping) else None
        if query is not None:
            summary["query"] = query
        result = results.get(call_id)
        if isinstance(result, list):
            summary["results"] = [
                {key: item[key] for key in ("title", "url") if isinstance(item.get(key), str)}
                for item in result
                if isinstance(item, Mapping)
            ]
        elif isinstance(result, Mapping):
            # A search error arrives inside a successful response; the turn continues without it.
            summary["error_code"] = clean_str(result.get("error_code")) or "unknown"
        summaries.append(summary)
    return summaries


def web_citations(content: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Return the web citations attached to text blocks: URL, title and the cited text."""

    citations: list[dict[str, Any]] = []
    for block in content:
        if block.get("type") != "text" or not isinstance(block.get("citations"), list):
            continue
        for citation in block["citations"]:
            if not isinstance(citation, Mapping) or citation.get("type") != "web_search_result_location":
                continue
            entry = {key: citation[key] for key in ("url", "title", "cited_text") if isinstance(citation.get(key), str)}
            if entry and entry not in citations:
                citations.append(entry)
    return citations


def context_tokens(usage: Any, iterations: list[Any]) -> int:
    """Return the tokens a response leaves in the next turn's context.

    That is its last iteration's prompt and reply (all prompt tokens, cached
    or not), minus thinking, which later turns never replay.
    """

    last = iterations[-1] if iterations else usage
    if last is None:
        return 0
    total = sum(optional_int(get_value(last, name)) for name in _USAGE_FIELDS)
    thinking_tokens = optional_int(get_value(get_value(usage, "output_tokens_details"), "thinking_tokens"))
    return max(0, total - thinking_tokens)


def content_block_param(block: Any) -> dict[str, Any]:
    """Return a response content block in the form a later request resends unchanged."""

    to_dict = getattr(block, "to_dict", None)
    data = to_dict(mode="json", exclude_none=True) if callable(to_dict) else jsonable(block)
    if not isinstance(data, dict):
        return {}
    # SDK-local helper field, not part of the API block.
    data.pop("parsed_output", None)
    return data


def usage_from_anthropic(usage: Any, *, iterations: list[Any] | None = None) -> Usage:
    """Convert Anthropic usage, summing server-side ``iterations`` when present.

    Input counts every prompt token: uncached, cache reads and cache writes.
    Cached input is the cache reads; cache writes are recorded separately.
    Thinking tokens are reasoning tokens, which later turns never replay.
    """

    if usage is None:
        return Usage()
    entries = iterations or _iterations(usage) or [usage]
    counts = {name: sum(optional_int(get_value(entry, name)) for entry in entries) for name in _USAGE_FIELDS}
    input_tokens = counts["input_tokens"] + counts["cache_read_input_tokens"] + counts["cache_creation_input_tokens"]
    output_tokens = counts["output_tokens"]
    thinking_tokens = optional_int(get_value(get_value(usage, "output_tokens_details"), "thinking_tokens"))
    return Usage(
        requests=1,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
        input_tokens_details=UsageInputDetails(
            cached_tokens=counts["cache_read_input_tokens"],
            cache_write_tokens=counts["cache_creation_input_tokens"],
        ),
        output_tokens_details=UsageOutputDetails(reasoning_tokens=thinking_tokens),
    )


def usage_summary(usage: Any, *, iterations: list[Any] | None = None) -> dict[str, Any] | None:
    """Return the raw Anthropic usage counts stored in ``data.anthropic``."""

    if usage is None:
        return None
    summary: dict[str, Any] = {name: optional_int(get_value(usage, name)) for name in _USAGE_FIELDS}
    thinking_tokens = optional_int(get_value(get_value(usage, "output_tokens_details"), "thinking_tokens"))
    if thinking_tokens:
        summary["thinking_tokens"] = thinking_tokens
    web_search_requests = optional_int(get_value(get_value(usage, "server_tool_use"), "web_search_requests"))
    if web_search_requests:
        # Anthropic bills each search to the owner's account.
        summary["web_search_requests"] = web_search_requests
    iterations = iterations or _iterations(usage)
    if iterations:
        summary["iterations"] = [
            {
                "type": clean_str(get_value(entry, "type")),
                **{name: optional_int(get_value(entry, name)) for name in _USAGE_FIELDS},
            }
            for entry in iterations
        ]
    return summary


def usage_summary_for(usages: Sequence[tuple[Any, list[Any]]]) -> dict[str, Any] | None:
    """Return the stored usage of a round's responses: summed counts and every iteration."""

    summaries = [
        summary
        for usage_value, iterations in usages
        if (summary := usage_summary(usage_value, iterations=iterations)) is not None
    ]
    if len(summaries) <= 1:
        return summaries[0] if summaries else None
    combined: dict[str, Any] = {}
    for summary in summaries:
        for key, value in summary.items():
            if key == "iterations":
                combined.setdefault(key, []).extend(value)
            else:
                combined[key] = combined.get(key, 0) + value
    return combined


def usage_iterations(usage: Any) -> list[Any]:
    """Return the server-side usage iterations reported with ``usage``, if any."""

    return _iterations(usage)


def _iterations(usage: Any) -> list[Any]:
    value = get_value(usage, "iterations")
    if value is None:
        extra = getattr(usage, "model_extra", None)
        value = extra.get("iterations") if isinstance(extra, Mapping) else None
    return list(value) if isinstance(value, list | tuple) else []


def _stop_details(value: Any) -> dict[str, Any]:
    """Keep the refusal type and category; the explanation text is not stored."""

    if value is None:
        return {}
    details = {"type": clean_str(get_value(value, "type")), "category": clean_str(get_value(value, "category"))}
    return {key: item for key, item in details.items() if item is not None}


__all__ = [
    "STOP_REASON_MAX_TOKENS",
    "STOP_REASON_PAUSE_TURN",
    "STOP_REASON_REFUSAL",
    "STOP_REASON_TOOL_USE",
    "AnthropicResponse",
    "MessageFinalParts",
    "content_block_param",
    "context_tokens",
    "latest_compaction_block",
    "message_final_parts",
    "usage_from_anthropic",
    "usage_iterations",
    "usage_summary",
    "usage_summary_for",
    "web_citations",
    "web_search_summaries",
]
