"""Token estimates for servers that stream no usage.

Some OpenAI-compatible servers omit streamed usage. Without a count, chat
compaction never sees the context grow, so the adapter records a rough estimate
(about four characters per token) and marks it as estimated.
"""

from __future__ import annotations

import json
from typing import Any

from animama.domain.usage import Usage

from .prompt import DirectChatPrompt, prompt_messages

_CHARACTERS_PER_TOKEN = 4

CONTEXT_TOKENS_METADATA_KEY = "context_tokens"
"""Provider-metadata key for the last request's footprint when a turn made several requests."""


def context_tokens_from_usage(usage: Usage) -> int:
    """Return the tokens a request leaves in the next turn's context (reasoning is not replayed)."""

    reasoning_tokens = int(getattr(usage.output_tokens_details, "reasoning_tokens", 0) or 0)
    return max(0, int(usage.total_tokens or 0) - reasoning_tokens)


def estimate_usage(prompt: DirectChatPrompt, output_text: str) -> Usage:
    """Return an approximate usage for one request's prompt and reply."""

    request_text = json.dumps(
        {"messages": prompt_messages(prompt), "tools": list(prompt.tools)},
        default=_json_default,
        ensure_ascii=False,
    )
    input_tokens = _tokens(request_text)
    output_tokens = _tokens(output_text)
    return Usage(
        requests=1,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
        total_tokens=input_tokens + output_tokens,
    )


def _tokens(text: str) -> int:
    return -(-len(text) // _CHARACTERS_PER_TOKEN) if text else 0


def _json_default(value: Any) -> Any:
    return str(value)


__all__ = ["CONTEXT_TOKENS_METADATA_KEY", "context_tokens_from_usage", "estimate_usage"]
