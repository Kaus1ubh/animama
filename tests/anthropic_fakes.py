"""Duck-typed fake Anthropic SDK client that streams scripted raw Messages events.

``FakeAnthropicClient.messages.stream(**params)`` records the JSON-shaped
request and returns an async context manager that yields scripted raw stream
events. ``get_final_message`` accumulates them with the SDK's own stream
accumulator, so the final ``Message`` has the shape a real stream produces.
No network or key is used.
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
from anthropic.lib.streaming._messages import accumulate_event
from anthropic.types import RawMessageStreamEvent

from animama.adapters.model_clients.anthropic_messages.support import ANTHROPIC_API_BASE_URL

SENTINEL_KEY = "sk-ant-api03-SENTINEL-do-not-leak-0123456789"
THINKING_SIGNATURE = "EqQBCkgIBBABGAIiQL-signed-thinking-signature=="

ScriptItem = dict[str, Any] | BaseException
Script = Sequence[ScriptItem] | BaseException


def text_block(*chunks: str) -> dict[str, Any]:
    return {"type": "text", "chunks": list(chunks)}


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
        elif kind == "tool_use":
            events.append(
                {
                    "type": "content_block_start",
                    "index": index,
                    "content_block": {"type": "tool_use", "id": block["id"], "name": block["name"], "input": {}},
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
        else:  # pragma: no cover - fixture misuse
            raise ValueError(kind)
        events.append({"type": "content_block_stop", "index": index})
    usage: dict[str, Any] = {"output_tokens": output_tokens}
    if thinking_tokens is not None:
        usage["output_tokens_details"] = {"thinking_tokens": thinking_tokens}
    if iterations is not None:
        usage["iterations"] = iterations
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
    """Async context manager and iterator over one scripted raw event sequence."""

    def __init__(self, script: Sequence[ScriptItem]) -> None:
        self._items = list(script)
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
    """Records each ``messages.stream`` request and replays one script per request."""

    def __init__(self, scripts: Sequence[Script]) -> None:
        self.scripts = list(scripts)
        self.requests: list[dict[str, Any]] = []
        self.close_calls = 0
        self.messages = SimpleNamespace(stream=self._stream)

    def _stream(self, **params: Any) -> Any:
        self.requests.append(copy.deepcopy(params))
        script = self.scripts.pop(0)
        if isinstance(script, BaseException):
            return _FailingStreamManager(script)
        return FakeMessageStream(script)

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
    "connection_error",
    "message_events",
    "status_error",
    "structured_reply",
    "text_block",
    "thinking_block",
    "tool_use_block",
]
