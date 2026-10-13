"""Duck-typed fake Anthropic SDK client that streams scripted raw Messages events.

``FakeAnthropicClient.beta.messages.stream(**params)`` (and the non-beta
``messages.stream``) records the JSON-shaped request and returns an async
context manager that yields scripted raw stream events. ``get_final_message``
accumulates them with the SDK's own stream accumulator, so the final message
has the shape a real stream produces, including server-tool, web-search
result, citation and compaction blocks. No network or key is used.
"""

from __future__ import annotations

import copy
import json
import logging
from collections.abc import Iterator, Sequence
from contextlib import contextmanager
from types import SimpleNamespace
from typing import Any

import anthropic
import httpx2
from anthropic._models import construct_type
from anthropic.lib.streaming._beta_messages import accumulate_event as accumulate_beta_event
from anthropic.lib.streaming._messages import accumulate_event
from anthropic.types import RawMessageStreamEvent
from anthropic.types.beta import BetaRawMessageStreamEvent

from animama.adapters.model_clients.anthropic_messages.support import ANTHROPIC_API_BASE_URL

SENTINEL_KEY = "sk-ant-api03-SENTINEL-do-not-leak-0123456789"
THINKING_SIGNATURE = "EqQBCkgIBBABGAIiQL-signed-thinking-signature=="

ScriptItem = dict[str, Any] | BaseException
Script = Sequence[ScriptItem] | BaseException


def text_block(*chunks: str, citations: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """A streamed text block; ``citations`` arrive as ``citations_delta`` events after the text."""

    return {"type": "text", "chunks": list(chunks), "citations": list(citations or ())}


def web_citation(url: str, title: str, cited_text: str = "Cited words.") -> dict[str, Any]:
    return {
        "type": "web_search_result_location",
        "url": url,
        "title": title,
        "cited_text": cited_text,
        "encrypted_index": "EncryptedIndex==",
    }


def server_search_block(call_id: str, query: str) -> dict[str, Any]:
    """Anthropic's ``web_search`` server tool call (the server runs it)."""

    return {"type": "server_tool_use", "id": call_id, "name": "web_search", "input": {"query": query}}


def search_result_block(call_id: str, results: list[tuple[str, str]] | None = None) -> dict[str, Any]:
    """A ``web_search_tool_result`` listing ``(title, url)`` results with encrypted content."""

    return {
        "type": "web_search_tool_result",
        "tool_use_id": call_id,
        "content": [
            {
                "type": "web_search_result",
                "title": title,
                "url": url,
                "encrypted_content": f"Encrypted-{index}==",
                "page_age": "1 day ago",
            }
            for index, (title, url) in enumerate(results or ())
        ],
    }


def search_error_block(call_id: str, error_code: str = "max_uses_exceeded") -> dict[str, Any]:
    """A ``web_search_tool_result`` whose content is an error object (HTTP 200, not raised)."""

    return {
        "type": "web_search_tool_result",
        "tool_use_id": call_id,
        "content": {"type": "web_search_tool_result_error", "error_code": error_code},
    }


def compaction_block(summary: str = "Summary of the earlier conversation.") -> dict[str, Any]:
    """A server-side compaction block; the summary arrives as one ``compaction_delta``."""

    return {"type": "compaction", "content": summary}


def thinking_block(thinking: str = "", signature: str = THINKING_SIGNATURE) -> dict[str, Any]:
    return {"type": "thinking", "thinking": thinking, "signature": signature}


def tool_use_block(call_id: str, name: str, tool_input: dict[str, Any]) -> dict[str, Any]:
    return {"type": "tool_use", "id": call_id, "name": name, "input": tool_input}


def message_events(
    *blocks: dict[str, Any],
    message_id: str = "msg_test_1",
    model: str = "claude-haiku-5-5",
    stop_reason: str = "end_turn",
    stop_details: dict[str, Any] | None = None,
    input_tokens: int = 40,
    cache_read_input_tokens: int = 900,
    cache_creation_input_tokens: int = 60,
    output_tokens: int = 25,
    thinking_tokens: int | None = None,
    iterations: list[dict[str, Any]] | None = None,
    include_stop: bool = True,
) -> list[dict[str, Any]]:
    """Return the raw event sequence Anthropic streams for one message."""

    events: list[dict[str, Any]] = [
        {
            "type": "message_start",
            "message": {
                "id": message_id,
                "type": "message",
                "role": "assistant",
                "model": model,
                "content": [],
                "stop_reason": None,
                "stop_sequence": None,
                "usage": {
                    "input_tokens": input_tokens,
                    "output_tokens": 1,
                    "cache_read_input_tokens": cache_read_input_tokens,
                    "cache_creation_input_tokens": cache_creation_input_tokens,
                },
            },
        }
    ]
    for index, block in enumerate(blocks):
        kind = block["type"]
        if kind == "text":
            events.append(
                {"type": "content_block_start", "index": index, "content_block": {"type": "text", "text": ""}}
            )
            for chunk in block["chunks"]:
                events.append(
                    {"type": "content_block_delta", "index": index, "delta": {"type": "text_delta", "text": chunk}}
                )
            for citation in block.get("citations") or ():
                events.append(
                    {
                        "type": "content_block_delta",
                        "index": index,
                        "delta": {"type": "citations_delta", "citation": citation},
                    }
                )
        elif kind == "thinking":
            events.append(
                {
                    "type": "content_block_start",
                    "index": index,
                    "content_block": {"type": "thinking", "thinking": "", "signature": ""},
                }
            )
            if block["thinking"]:
                events.append(
                    {
                        "type": "content_block_delta",
                        "index": index,
                        "delta": {"type": "thinking_delta", "thinking": block["thinking"]},
                    }
                )
            events.append(
                {
                    "type": "content_block_delta",
                    "index": index,
                    "delta": {"type": "signature_delta", "signature": block["signature"]},
                }
            )
        elif kind in {"tool_use", "server_tool_use"}:
            events.append(
                {
                    "type": "content_block_start",
                    "index": index,
                    "content_block": {"type": kind, "id": block["id"], "name": block["name"], "input": {}},
                }
            )
            encoded = json.dumps(block["input"])
            for start in range(0, len(encoded), 7):
                events.append(
                    {
                        "type": "content_block_delta",
                        "index": index,
                        "delta": {"type": "input_json_delta", "partial_json": encoded[start : start + 7]},
                    }
                )
        elif kind == "web_search_tool_result":
            # The whole result arrives with the block start; no deltas follow.
            events.append({"type": "content_block_start", "index": index, "content_block": dict(block)})
        elif kind == "compaction":
            compaction_start: dict[str, Any] = {
                "type": "content_block_start",
                "index": index,
                "content_block": {"type": "compaction", "content": None},
            }
            events.append(compaction_start)
            events.append(
                {
                    "type": "content_block_delta",
                    "index": index,
                    "delta": {"type": "compaction_delta", "content": block["content"], "encrypted_content": None},
                }
            )
        else:  # pragma: no cover - fixture misuse
            raise ValueError(kind)
        events.append({"type": "content_block_stop", "index": index})
    usage: dict[str, Any] = {"output_tokens": output_tokens}
    if thinking_tokens is not None:
        usage["output_tokens_details"] = {"thinking_tokens": thinking_tokens}
    if iterations is not None:
        usage["iterations"] = iterations
    searches = sum(1 for block in blocks if block["type"] == "server_tool_use")
    if searches:
        usage["server_tool_use"] = {"web_search_requests": searches}
    events.append(
        {
            "type": "message_delta",
            "delta": {"stop_reason": stop_reason, "stop_sequence": None, "stop_details": stop_details},
            "usage": usage,
        }
    )
    if include_stop:
        events.append({"type": "message_stop"})
    return events


def structured_reply(
    speech: str = "Hello there, friend.",
    *,
    tone: str = "joy",
    intensity: int = 4,
    gesture: str | None = None,
    remember: str | None = None,
) -> str:
    return json.dumps(
        {
            "emotional_tone": tone,
            "emotional_intensity": intensity,
            "speech": speech,
            "gesture": gesture,
            "display": None,
            "remember": remember,
        },
        separators=(",", ":"),
    )


def chunked(text: str, size: int = 9) -> list[str]:
    return [text[index : index + size] for index in range(0, len(text), size)]


class FakeMessageStream:
    """Async context manager and iterator over one scripted raw event sequence.

    ``beta`` streams parse and accumulate events with the SDK's beta types, as
    ``client.beta.messages.stream`` does.
    """

    def __init__(self, script: Sequence[ScriptItem], *, beta: bool = False) -> None:
        self._items = list(script)
        self._beta = beta
        self._snapshot: Any = None
        self._json_bufs: dict[int, bytes] = {}

    async def __aenter__(self) -> FakeMessageStream:
        return self

    async def __aexit__(self, *exc_info: object) -> None:
        return None

    def __aiter__(self) -> FakeMessageStream:
        return self

    async def __anext__(self) -> Any:
        if not self._items:
            raise StopAsyncIteration
        item = self._items.pop(0)
        if isinstance(item, BaseException):
            raise item
        if self._beta:
            beta_event = construct_type(type_=BetaRawMessageStreamEvent, value=item)
            self._snapshot = accumulate_beta_event(
                event=beta_event,  # type: ignore[arg-type]
                current_snapshot=self._snapshot,
                json_bufs=self._json_bufs,
                request_headers=httpx2.Headers(),
            )
            return beta_event
        event = construct_type(type_=RawMessageStreamEvent, value=item)
        self._snapshot = accumulate_event(
            event=event,  # type: ignore[arg-type]
            current_snapshot=self._snapshot,
            json_bufs=self._json_bufs,
        )
        return event

    async def get_final_message(self) -> Any:
        async for _event in self:
            pass
        return self._snapshot


class _FailingStreamManager:
    def __init__(self, error: BaseException) -> None:
        self._error = error

    async def __aenter__(self) -> Any:
        raise self._error

    async def __aexit__(self, *exc_info: object) -> None:
        return None


class FakeAnthropicClient:
    """Records each ``beta.messages.stream`` (or ``messages.stream``) request and replays one script per request."""

    def __init__(self, scripts: Sequence[Script]) -> None:
        self.scripts = list(scripts)
        self.requests: list[dict[str, Any]] = []
        self.close_calls = 0
        self.messages = SimpleNamespace(stream=self._stream)
        self.beta = SimpleNamespace(messages=SimpleNamespace(stream=self._beta_stream))

    def _stream(self, **params: Any) -> Any:
        return self._start(params, beta=False)

    def _beta_stream(self, **params: Any) -> Any:
        return self._start(params, beta=True)

    def _start(self, params: dict[str, Any], *, beta: bool) -> Any:
        self.requests.append(copy.deepcopy(params))
        script = self.scripts.pop(0)
        if isinstance(script, BaseException):
            return _FailingStreamManager(script)
        return FakeMessageStream(script, beta=beta)

    async def close(self) -> None:
        self.close_calls += 1


class FakeClientFactory:
    """Builds one fake client per call and records the key and timeout it received."""

    def __init__(self, client: FakeAnthropicClient) -> None:
        self.client = client
        self.calls: list[dict[str, Any]] = []

    def __call__(self, *, api_key: str, timeout: float | None) -> FakeAnthropicClient:
        self.calls.append({"api_key": api_key, "timeout": timeout})
        return self.client


def status_error(
    status: int,
    *,
    error_type: str,
    message: str,
    cls: type[anthropic.APIStatusError] = anthropic.APIStatusError,
    headers: dict[str, str] | None = None,
) -> anthropic.APIStatusError:
    """An SDK status error with Anthropic's error body (stream ``error`` events arrive with status 200)."""

    request = httpx2.Request("POST", f"{ANTHROPIC_API_BASE_URL}/v1/messages")
    body = {"type": "error", "error": {"type": error_type, "message": message}}
    response = httpx2.Response(status, request=request, json=body, headers=headers or {"request-id": "req_test"})
    return cls(f"{body}", response=response, body=body)


class _ListHandler(logging.Handler):
    def __init__(self, records: list[logging.LogRecord]) -> None:
        super().__init__(level=logging.DEBUG)
        self._records = records

    def emit(self, record: logging.LogRecord) -> None:
        self._records.append(record)


@contextmanager
def captured_anima_log_records() -> Iterator[list[logging.LogRecord]]:
    """Collect every ``anima`` log record at DEBUG, whatever earlier tests did to logging.

    Logging configuration in other tests can disable existing loggers, raise
    levels or stop propagation to the root, so records are collected on the
    ``anima`` logger itself with its descendants re-enabled for the block.
    """

    records: list[logging.LogRecord] = []
    handler = _ListHandler(records)
    names = ["anima", *(name for name in logging.Logger.manager.loggerDict if name.startswith("anima."))]
    loggers = [logging.getLogger(name) for name in names]
    previous = [(logger.disabled, logger.level) for logger in loggers]
    for logger in loggers:
        logger.disabled = False
        if logger.level > logging.DEBUG:
            logger.setLevel(logging.DEBUG)
    loggers[0].setLevel(logging.DEBUG)
    loggers[0].addHandler(handler)
    try:
        yield records
    finally:
        loggers[0].removeHandler(handler)
        for logger, (disabled, level) in zip(loggers, previous, strict=True):
            logger.disabled = disabled
            logger.setLevel(level)


def connection_error(*, timeout: bool = False) -> anthropic.APIConnectionError:
    request = httpx2.Request("POST", f"{ANTHROPIC_API_BASE_URL}/v1/messages")
    if timeout:
        return anthropic.APITimeoutError(request=request)
    return anthropic.APIConnectionError(request=request)


__all__ = [
    "SENTINEL_KEY",
    "THINKING_SIGNATURE",
    "FakeAnthropicClient",
    "FakeClientFactory",
    "FakeMessageStream",
    "captured_anima_log_records",
    "chunked",
    "compaction_block",
    "connection_error",
    "message_events",
    "search_error_block",
    "search_result_block",
    "server_search_block",
    "status_error",
    "structured_reply",
    "text_block",
    "thinking_block",
    "tool_use_block",
    "web_citation",
]
