"""Bounded, optional browser OTLP forwarding for the local HTTP composition.

Admission belongs to the outer local HTTP boundary. This adapter accepts no
browser destination configuration and never enables collection by itself.
"""

from __future__ import annotations

import asyncio
import math
from dataclasses import dataclass
from types import TracebackType
from urllib.parse import urlsplit

import httpx
from starlette.datastructures import Headers
from starlette.requests import ClientDisconnect, Request
from starlette.responses import JSONResponse, Response

_SIGNALS = frozenset({"traces", "metrics", "logs"})
_CONTENT_TYPES = frozenset({"application/json", "application/x-protobuf"})
_CONTENT_ENCODINGS = frozenset({"identity", "gzip"})
_RESPONSE_HEADERS = {"cache-control": "no-store", "x-content-type-options": "nosniff"}


@dataclass(frozen=True)
class TelemetryDestinations:
    """Exact trusted collector URLs supplied by the installation composition."""

    traces: str
    metrics: str
    logs: str

    def __post_init__(self) -> None:
        for signal in _SIGNALS:
            value = getattr(self, signal)
            try:
                parsed = urlsplit(value)
                valid = (
                    isinstance(value, str)
                    and len(value) <= 2048
                    and not any(character.isspace() or ord(character) < 32 for character in value)
                    and "\\" not in value
                    and parsed.scheme in {"http", "https"}
                    and bool(parsed.hostname)
                    and parsed.username is None
                    and parsed.password is None
                    and not parsed.query
                    and not parsed.fragment
                    and parsed.port != 0
                )
                httpx.URL(value)
            except (TypeError, ValueError, httpx.InvalidURL):
                valid = False
            if not valid:
                raise ValueError("Telemetry destinations must be fixed HTTP(S) URLs without credentials or query data")


@dataclass(frozen=True)
class TelemetryConfig:
    """Immutable opt-in policy; desktop uses the disabled default."""

    enabled: bool = False
    traces_enabled: bool = True
    destinations: TelemetryDestinations | None = None
    max_request_bytes: int = 1024 * 1024
    max_response_bytes: int = 64 * 1024
    body_timeout_seconds: float = 10.0
    upstream_timeout_seconds: float = 10.0

    def __post_init__(self) -> None:
        if type(self.enabled) is not bool or type(self.traces_enabled) is not bool:
            raise ValueError("Telemetry enablement must be explicit booleans")
        if self.destinations is not None and not isinstance(self.destinations, TelemetryDestinations):
            raise ValueError("Telemetry destinations must use the typed configuration")
        if self.enabled and self.destinations is None:
            raise ValueError("Enabled telemetry requires fixed collector destinations")
        for value in (self.max_request_bytes, self.max_response_bytes):
            if type(value) is not int or value <= 0:
                raise ValueError("Telemetry byte limits must be positive integers")
        for deadline in (self.body_timeout_seconds, self.upstream_timeout_seconds):
            if (
                isinstance(deadline, bool)
                or not isinstance(deadline, int | float)
                or not math.isfinite(deadline)
                or deadline <= 0
            ):
                raise ValueError("Telemetry deadlines must be positive finite seconds")


class _TelemetryFailure(Exception):
    def __init__(self, code: str, status: int) -> None:
        self.code = code
        self.status = status


def _error(code: str, status: int) -> Response:
    return JSONResponse({"error": code}, status_code=status, headers=_RESPONSE_HEADERS)


def _content_headers(headers: httpx.Headers | Headers) -> dict[str, str]:
    """Allow OTLP media metadata only, without copying any browser credentials."""
    # Both Starlette and HTTPX headers expose get_list/getlist differently.
    get_values = headers.get_list if isinstance(headers, httpx.Headers) else headers.getlist
    result: dict[str, str] = {}
    for name in ("content-type", "content-encoding"):
        values = get_values(name)
        if len(values) > 1:
            raise _TelemetryFailure("unsupported_media_type", 415)
        if not values:
            continue
        value = values[0].strip().lower()
        if name == "content-type":
            media_type, *parameters = [part.strip() for part in value.split(";")]
            if media_type not in _CONTENT_TYPES or parameters not in ([], ["charset=utf-8"]):
                raise _TelemetryFailure("unsupported_media_type", 415)
        elif value not in _CONTENT_ENCODINGS:
            raise _TelemetryFailure("unsupported_media_type", 415)
        result[name] = value
    return result


class TelemetryForwarder:
    """Own one reusable collector client; the composition must call ``aclose``.

    ``transport`` is an explicit test seam, never request or environment input.
    The disabled desktop policy creates no HTTP client and reads no body.
    """

    def __init__(self, config: TelemetryConfig, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self.config = config
        self._closed = False
        self._client = (
            httpx.AsyncClient(
                transport=transport,
                trust_env=False,
                follow_redirects=False,
                timeout=config.upstream_timeout_seconds,
                limits=httpx.Limits(max_connections=4, max_keepalive_connections=4),
            )
            if config.enabled
            else None
        )

    async def __aenter__(self) -> TelemetryForwarder:
        return self

    async def __aexit__(
        self, exc_type: type[BaseException] | None, exc: BaseException | None, traceback: TracebackType | None
    ) -> None:
        await self.aclose()

    async def aclose(self) -> None:
        """Release pooled collector connections during application shutdown."""
        self._closed = True
        if self._client is not None:
            await self._client.aclose()

    async def response(self, request: Request, signal: str) -> Response:
        """Forward an admitted POST with bounded input and collector lifetime."""
        if signal not in _SIGNALS:
            return _error("invalid_signal", 404)
        if request.method != "POST":
            return _error("invalid_request", 405)
        if request.url.query:
            return _error("invalid_request", 400)
        if not self.config.enabled or (signal == "traces" and not self.config.traces_enabled):
            return Response(status_code=204, headers=_RESPONSE_HEADERS)
        if self._closed:
            return _error("upstream_unavailable", 503)
        try:
            headers = _content_headers(request.headers)
            if "content-type" not in headers:
                raise _TelemetryFailure("unsupported_media_type", 415)
            try:
                body = await asyncio.wait_for(self._read_body(request), self.config.body_timeout_seconds)
            except TimeoutError:
                return _error("request_timeout", 408)
            try:
                return await asyncio.wait_for(
                    self._forward(signal, body, headers), self.config.upstream_timeout_seconds
                )
            except (TimeoutError, httpx.TimeoutException):
                return _error("upstream_timeout", 504)
        except _TelemetryFailure as failure:
            return _error(failure.code, failure.status)
        except ClientDisconnect:
            return _error("invalid_body", 400)
        except (httpx.HTTPError, OSError):
            return _error("upstream_unavailable", 502)

    async def _read_body(self, request: Request) -> bytes:
        """Reject lengths and count streamed bytes before extending the buffer."""
        values = request.headers.getlist("content-length")
        declared: int | None = None
        if values:
            if len(values) != 1 or not values[0].isascii() or not values[0].isdecimal() or len(values[0]) > 20:
                raise _TelemetryFailure("invalid_body", 400)
            declared = int(values[0])
            if declared > self.config.max_request_bytes:
                raise _TelemetryFailure("body_too_large", 413)
        body = bytearray()
        async for chunk in request.stream():
            if len(body) + len(chunk) > self.config.max_request_bytes:
                raise _TelemetryFailure("body_too_large", 413)
            body.extend(chunk)
        if declared is not None and declared != len(body):
            raise _TelemetryFailure("invalid_body", 400)
        return bytes(body)

    async def _forward(self, signal: str, body: bytes, headers: dict[str, str]) -> Response:
        """Drain only bounded raw collector bytes and sanitize failure details."""
        assert self._client is not None and self.config.destinations is not None
        # Construct the request directly so cookies learned from a collector and
        # client defaults cannot become forwarded browser authority or metadata.
        outgoing = httpx.Request("POST", getattr(self.config.destinations, signal), headers=headers, content=body)
        upstream = await self._client.send(outgoing, stream=True, follow_redirects=False)
        try:
            response_body = bytearray()
            async for chunk in upstream.aiter_raw():
                if len(response_body) + len(chunk) > self.config.max_response_bytes:
                    raise _TelemetryFailure("upstream_response_too_large", 502)
                response_body.extend(chunk)
            if not 200 <= upstream.status_code < 300:
                status = upstream.status_code if 400 <= upstream.status_code <= 599 else 502
                return _error("upstream_rejected", status)
            if upstream.status_code == 204:
                return Response(status_code=204, headers=_RESPONSE_HEADERS)
            try:
                response_headers = _content_headers(upstream.headers)
            except _TelemetryFailure:
                raise _TelemetryFailure("upstream_unavailable", 502) from None
            return Response(
                bytes(response_body),
                status_code=upstream.status_code,
                headers={**_RESPONSE_HEADERS, **response_headers},
            )
        finally:
            await upstream.aclose()
