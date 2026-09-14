from __future__ import annotations

import asyncio
import gzip
import json
from collections.abc import AsyncIterator
from dataclasses import FrozenInstanceError
from typing import Any

import httpx
import pytest
from starlette.requests import Request

from animama.local.http.telemetry import TelemetryConfig, TelemetryDestinations, TelemetryForwarder

DESTINATIONS = TelemetryDestinations(
    traces="http://collector:4318/v1/traces",
    metrics="http://collector:4318/v1/metrics",
    logs="http://collector:4318/v1/logs",
)


class CollectorStream(httpx.AsyncByteStream):
    def __init__(self, chunks: list[bytes], *, delay: float = 0) -> None:
        self.chunks = chunks
        self.delay = delay
        self.closed = False
        self.read_count = 0

    async def __aiter__(self) -> AsyncIterator[bytes]:
        for chunk in self.chunks:
            self.read_count += 1
            if self.delay:
                await asyncio.sleep(self.delay)
            yield chunk

    async def aclose(self) -> None:
        self.closed = True


def incoming(
    chunks: list[bytes] | None = None,
    *,
    headers: list[tuple[bytes, bytes]] | None = None,
    query: bytes = b"",
    delay: float = 0,
    disconnect: bool = False,
) -> tuple[Request, list[int]]:
    pending = iter(chunks if chunks is not None else [b"{}"])
    reads: list[int] = []

    async def receive():
        reads.append(1)
        if delay:
            await asyncio.sleep(delay)
        if disconnect:
            return {"type": "http.disconnect"}
        chunk = next(pending, None)
        return {"type": "http.request", "body": chunk or b"", "more_body": chunk is not None}

    request = Request(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/telemetry/logs",
            "scheme": "http",
            "server": ("localhost", 3000),
            "query_string": query,
            "headers": headers if headers is not None else [(b"content-type", b"application/json")],
        },
        receive,
    )
    return request, reads


@pytest.mark.parametrize("signal", ["traces", "metrics", "logs"])
async def test_disabled_telemetry_has_no_client_or_body_read(signal: str) -> None:
    request, reads = incoming(delay=100)
    async with TelemetryForwarder(TelemetryConfig()) as forwarder:
        assert forwarder._client is None
        result = await forwarder.response(request, signal)
    assert result.status_code == 204
    assert result.body == b""
    assert reads == []


@pytest.mark.parametrize("signal", ["unknown", "TRACES", "../logs", "http://elsewhere/v1/logs"])
async def test_signal_names_are_closed_even_when_disabled(signal: str) -> None:
    request, reads = incoming()
    async with TelemetryForwarder(TelemetryConfig()) as forwarder:
        assert (await forwarder.response(request, signal)).status_code == 404
    assert reads == []


@pytest.mark.parametrize("signal", ["traces", "metrics", "logs"])
async def test_only_fixed_destination_bytes_and_media_headers_are_forwarded(signal: str) -> None:
    body = gzip.compress(b'{"resourceLogs":[]}')
    observed: list[httpx.Request] = []
    streams: list[CollectorStream] = []

    async def collect(request: httpx.Request) -> httpx.Response:
        observed.append(request)
        stream = CollectorStream([b"{}"])
        streams.append(stream)
        return httpx.Response(
            200,
            headers={
                "content-type": "application/json",
                "set-cookie": "collector_secret=private",
                "x-private": "hidden",
            },
            stream=stream,
        )

    async with TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=DESTINATIONS), transport=httpx.MockTransport(collect)
    ) as forwarder:
        for _ in range(2):
            request, _ = incoming(
                [body[:5], body[5:]],
                headers=[
                    (b"content-type", b"application/json; charset=utf-8"),
                    (b"content-encoding", b"gzip"),
                    (b"authorization", b"Bearer browser-secret"),
                    (b"cookie", b"desktop-capability=secret"),
                    (b"x-animama-internal-token", b"secret"),
                    (b"x-otlp-endpoint", b"http://hostile.invalid"),
                    (b"origin", b"http://localhost:3000"),
                ],
            )
            response = await forwarder.response(request, signal)
            assert response.status_code == 200
            assert response.body == b"{}"
            assert "set-cookie" not in response.headers and "x-private" not in response.headers
            assert response.headers["cache-control"] == "no-store"
    assert len(observed) == 2
    assert all(stream.closed for stream in streams)
    for sent in observed:
        assert str(sent.url) == getattr(DESTINATIONS, signal)
        assert sent.content == body
        assert set(sent.headers) == {"host", "content-length", "content-type", "content-encoding"}


async def test_traces_can_be_disabled_without_disabling_other_signals() -> None:
    seen = []

    def collect(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(204, stream=CollectorStream([]))

    async with TelemetryForwarder(
        TelemetryConfig(enabled=True, traces_enabled=False, destinations=DESTINATIONS),
        transport=httpx.MockTransport(collect),
    ) as forwarder:
        request, reads = incoming()
        assert (await forwarder.response(request, "traces")).status_code == 204
        assert reads == []
        assert (await forwarder.response(request, "logs")).status_code == 204
    assert len(seen) == 1


@pytest.mark.parametrize(
    ("headers", "chunks", "status", "expected_reads"),
    [
        ([(b"content-type", b"text/html")], [b"{}"], 415, 0),
        ([(b"content-type", b"application/json"), (b"content-encoding", b"br")], [b"{}"], 415, 0),
        ([(b"content-type", b"application/json"), (b"content-type", b"application/x-protobuf")], [b"{}"], 415, 0),
        ([], [b"{}"], 415, 0),
        ([(b"content-type", b"application/json"), (b"content-length", b"9")], [b"{}"], 413, 0),
        ([(b"content-type", b"application/json"), (b"content-length", b"-1")], [b"{}"], 400, 0),
        ([(b"content-type", b"application/json")], [b"1234", b"56789", b"never-read"], 413, 2),
        ([(b"content-type", b"application/json"), (b"content-length", b"1")], [b"{}"], 400, 2),
    ],
)
async def test_invalid_and_oversized_inputs_never_reach_collector(headers, chunks, status, expected_reads) -> None:
    def collect(request: httpx.Request) -> httpx.Response:
        pytest.fail("Rejected input reached collector")

    request, reads = incoming(chunks, headers=headers)
    async with TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=DESTINATIONS, max_request_bytes=8),
        transport=httpx.MockTransport(collect),
    ) as forwarder:
        assert (await forwarder.response(request, "logs")).status_code == status
    assert len(reads) == expected_reads


async def test_query_destination_is_rejected_before_reading_input() -> None:
    request, reads = incoming(query=b"endpoint=http://hostile.invalid")
    async with TelemetryForwarder(TelemetryConfig()) as forwarder:
        assert (await forwarder.response(request, "logs")).status_code == 400
    assert reads == []


@pytest.mark.parametrize("disconnect", [False, True])
async def test_incomplete_body_has_a_finite_deadline_and_safe_error(disconnect: bool) -> None:
    request, _ = incoming(delay=0 if disconnect else 1, disconnect=disconnect)
    async with TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=DESTINATIONS, body_timeout_seconds=0.01),
        transport=httpx.MockTransport(lambda _: pytest.fail("Incomplete body reached collector")),
    ) as forwarder:
        response = await forwarder.response(request, "logs")
    assert response.status_code == (400 if disconnect else 408)


@pytest.mark.parametrize("upstream_status", [302, 307, 400, 429, 500])
async def test_upstream_errors_and_redirects_do_not_escape_collector_details(upstream_status: int) -> None:
    seen = []
    stream = CollectorStream([b"private internal collector failure"])

    def collect(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(
            upstream_status, headers={"location": "http://hostile.invalid", "set-cookie": "secret=x"}, stream=stream
        )

    async with TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=DESTINATIONS), transport=httpx.MockTransport(collect)
    ) as forwarder:
        response = await forwarder.response(incoming()[0], "logs")
    assert len(seen) == 1
    assert stream.closed
    assert response.status_code == (502 if upstream_status < 400 else upstream_status)
    assert json.loads(bytes(response.body)) == {"error": "upstream_rejected"}
    assert "location" not in response.headers and "set-cookie" not in response.headers


@pytest.mark.parametrize("delay", [0, 1])
async def test_upstream_response_drain_is_bounded_and_closed(delay: float) -> None:
    stream = CollectorStream([b"12345", b"67890", b"not-read"], delay=delay)
    async with TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=DESTINATIONS, max_response_bytes=8, upstream_timeout_seconds=0.01),
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=stream)),
    ) as forwarder:
        response = await forwarder.response(incoming()[0], "logs")
    assert response.status_code == (504 if delay else 502)
    assert stream.closed
    assert stream.read_count == (1 if delay else 2)


async def test_upstream_connection_failure_is_safe_and_client_close_is_explicit() -> None:
    def collect(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("secret collector configuration", request=request)

    forwarder = TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=DESTINATIONS), transport=httpx.MockTransport(collect)
    )
    response = await forwarder.response(incoming()[0], "logs")
    assert response.status_code == 502
    assert json.loads(bytes(response.body)) == {"error": "upstream_unavailable"}
    await forwarder.aclose()
    await forwarder.aclose()
    assert forwarder._client is not None and forwarder._client.is_closed
    assert (await forwarder.response(incoming()[0], "logs")).status_code == 503


async def test_upstream_header_wait_has_total_deadline() -> None:
    cancelled = asyncio.Event()

    async def collect(request: httpx.Request) -> httpx.Response:
        try:
            await asyncio.sleep(10)
        finally:
            cancelled.set()
        raise AssertionError("Collector deadline was not enforced")

    async with TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=DESTINATIONS, upstream_timeout_seconds=0.01),
        transport=httpx.MockTransport(collect),
    ) as forwarder:
        response = await forwarder.response(incoming()[0], "logs")
    assert response.status_code == 504
    assert cancelled.is_set()


async def test_cancellation_closes_active_collector_response() -> None:
    started = asyncio.Event()

    class PendingStream(CollectorStream):
        async def __aiter__(self) -> AsyncIterator[bytes]:
            started.set()
            await asyncio.sleep(10)
            yield b"{}"

    stream = PendingStream([])
    async with TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=DESTINATIONS),
        transport=httpx.MockTransport(lambda _: httpx.Response(200, stream=stream)),
    ) as forwarder:
        task = asyncio.create_task(forwarder.response(incoming()[0], "logs"))
        await asyncio.wait_for(started.wait(), 1)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert stream.closed


async def test_compressed_protobuf_collector_bytes_are_preserved() -> None:
    compressed = gzip.compress(b"protobuf response")
    stream = CollectorStream([compressed])
    async with TelemetryForwarder(
        TelemetryConfig(enabled=True, destinations=DESTINATIONS),
        transport=httpx.MockTransport(
            lambda _: httpx.Response(
                200, headers={"content-type": "application/x-protobuf", "content-encoding": "gzip"}, stream=stream
            )
        ),
    ) as forwarder:
        request, _ = incoming([b"protobuf request"], headers=[(b"content-type", b"application/x-protobuf")])
        response = await forwarder.response(request, "traces")
    assert response.status_code == 200
    assert response.body == compressed
    assert response.headers["content-encoding"] == "gzip"
    assert response.headers["content-type"] == "application/x-protobuf"
    assert stream.closed


@pytest.mark.parametrize(
    "url",
    [
        "file:///private/data",
        "http://user:secret@collector/v1/logs",
        "http://collector/v1/logs?url=elsewhere",
        "http://collector/v1/logs#fragment",
        "http://collector:0/v1/logs",
        "http://collector\\hostile/v1/logs",
        "http://collector/\nlogs",
        "http://[invalid",
    ],
)
def test_destination_config_rejects_unsafe_values(url: str) -> None:
    with pytest.raises(ValueError):
        TelemetryDestinations(traces=url, metrics=url, logs=url)


@pytest.mark.parametrize(
    "values",
    [
        {"enabled": True},
        {"enabled": "yes"},
        {"max_request_bytes": 0},
        {"max_response_bytes": True},
        {"body_timeout_seconds": float("inf")},
        {"upstream_timeout_seconds": float("nan")},
    ],
)
def test_config_requires_explicit_enablement_and_finite_limits(values: dict[str, Any]) -> None:
    # Deliberately untyped inputs exercise the runtime configuration validator.
    with pytest.raises(ValueError):
        TelemetryConfig(**values)


def test_config_and_destinations_are_immutable() -> None:
    with pytest.raises(FrozenInstanceError):
        DESTINATIONS.logs = "http://hostile.invalid"  # type: ignore[misc]
    with pytest.raises(FrozenInstanceError):
        TelemetryConfig().enabled = True  # type: ignore[misc]
