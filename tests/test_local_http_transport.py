"""Real loopback transport acceptance for the additive local HTTP components."""

from __future__ import annotations

import asyncio
import contextlib
import io
import json
import socket
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from typing import Annotated, Any

import anyio
import httpx
import pytest
import starlette.formparsers
import uvicorn
from fastapi import FastAPI, File, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse, StreamingResponse
from websockets.asyncio.client import connect
from websockets.exceptions import InvalidStatus
from websockets.typing import Origin

from animama.domain.request_principal import RequestPrincipal
from animama.local.http.protocol import REVIEWED_UVICORN_VERSION, LocalH11Protocol


@dataclass
class _Probe:
    """Observe application entry and cleanup independently of response bytes."""

    requests: list[str] = field(default_factory=list)
    completed_uploads: list[bytes] = field(default_factory=list)
    caught_body_failures: list[str] = field(default_factory=list)
    stream_started: asyncio.Event = field(default_factory=asyncio.Event)
    stream_release: asyncio.Event = field(default_factory=asyncio.Event)
    stream_closed: asyncio.Event = field(default_factory=asyncio.Event)
    websocket_started: asyncio.Event = field(default_factory=asyncio.Event)
    websocket_closed: asyncio.Event = field(default_factory=asyncio.Event)
    websocket_idle: bool = False
    mutation_started: asyncio.Event = field(default_factory=asyncio.Event)
    mutation_release: asyncio.Event = field(default_factory=asyncio.Event)
    mutation_committed: asyncio.Event = field(default_factory=asyncio.Event)
    mutation_cleanup_started: asyncio.Event = field(default_factory=asyncio.Event)
    mutation_cleanup_release: asyncio.Event = field(default_factory=asyncio.Event)
    mutation_closed: asyncio.Event = field(default_factory=asyncio.Event)
    mutation_cancelled: bool = False


def _probe_app(probe: _Probe, *, product_logs: bool = False) -> FastAPI:
    """Use harmless routes so transport tests cannot invoke providers or data IO."""

    application = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @application.get("/v1/echo")
    async def echo() -> dict[str, bool]:
        probe.requests.append("echo")
        return {"ok": True}

    @application.get("/v1/slow")
    async def slow() -> dict[str, bool]:
        probe.requests.append("slow")
        await asyncio.sleep(0.35)
        return {"ok": True}

    @application.post("/v1/upload")
    async def upload(request: Request) -> dict[str, int]:
        probe.requests.append("upload")
        body = await request.body()
        probe.completed_uploads.append(body)
        return {"size": len(body)}

    @application.post("/v1/catch-body/{response_status}")
    async def catch_body(request: Request, response_status: int) -> JSONResponse:
        """Exercise route error translation independently of boundary rejection."""

        try:
            await request.body()
        except Exception as error:
            probe.caught_body_failures.append(type(error).__name__)
            return JSONResponse({"caught": True}, status_code=response_status)
        return JSONResponse({"ok": True})

    @application.post("/v1/multipart")
    async def multipart(file: Annotated[UploadFile, File()]) -> dict[str, int]:
        body = await file.read()
        probe.completed_uploads.append(body)
        return {"size": len(body)}

    @application.get("/v1/events:sse")
    async def events() -> StreamingResponse:
        async def frames() -> AsyncIterator[bytes]:
            probe.stream_started.set()
            try:
                yield b"data: first\n\n"
                await probe.stream_release.wait()
                yield b"data: second\n\n"
            finally:
                probe.stream_closed.set()

        return StreamingResponse(frames(), media_type="text/event-stream")

    @application.post("/v1/commit")
    async def commit(request: Request) -> dict[str, bool]:
        """Simulate owned commit and finally cleanup without touching a database."""

        await request.body()
        probe.mutation_started.set()
        try:
            await probe.mutation_release.wait()
            probe.mutation_committed.set()
            return {"committed": True}
        except asyncio.CancelledError:
            probe.mutation_cancelled = True
            raise
        finally:
            probe.mutation_cleanup_started.set()
            await probe.mutation_cleanup_release.wait()
            probe.mutation_closed.set()

    async def logs(websocket: WebSocket) -> None:
        await websocket.accept()
        probe.websocket_started.set()
        try:
            if probe.websocket_idle:
                # Like the current log route, an idle application can wait on
                # a producer queue without reading another client frame.
                await asyncio.Event().wait()
            else:
                while True:
                    await websocket.send_text(await websocket.receive_text())
        except WebSocketDisconnect:
            pass
        finally:
            probe.websocket_closed.set()

    if product_logs:
        from animama.server.routers.logs import router

        application.include_router(router)
    else:
        application.add_api_websocket_route("/v1/logs", logs)

    return application


@dataclass
class _LiveServer:
    origin: str
    probe: _Probe
    server: uvicorn.Server
    task: asyncio.Task[None]
    protocols: list[LocalH11Protocol]
    lifecycle: Any
    desktop: bool

    @property
    def headers(self) -> dict[str, str]:
        """Browser metadata is sent to real admission, never a test bypass."""

        result = {"Origin": self.origin, "Sec-Fetch-Site": "same-origin", "X-Animama-CSRF": "1"}
        if self.desktop:
            result["Cookie"] = f"animama_renderer_capability={'r' * 64}"
        return result

    @property
    def control_headers(self) -> dict[str, str]:
        """Private supervisor requests use neither browser metadata nor cookies."""

        return {"X-Animama-Desktop-Control": "c" * 64}

    async def open_connection(self) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        port = int(self.origin.rsplit(":", 1)[1])
        return await asyncio.open_connection("127.0.0.1", port)

    def request_head(self, method: str, path: str, *, chunked: bool = False) -> bytes:
        headers = {"Host": self.origin.removeprefix("http://"), **self.headers}
        if chunked:
            headers["Transfer-Encoding"] = "chunked"
        return (
            f"{method} {path} HTTP/1.1\r\n" + "".join(f"{key}: {value}\r\n" for key, value in headers.items()) + "\r\n"
        ).encode("ascii")


@contextlib.asynccontextmanager
async def _serve(
    *,
    desktop: bool = False,
    header_timeout: float = 0.2,
    body_timeout: float = 0.2,
    max_body_bytes: int = 1024,
    protected: bool = True,
    product_logs: bool = False,
) -> AsyncIterator[_LiveServer]:
    """Own an ephemeral socket and Uvicorn task; never discover or stop a stack."""

    probe = _Probe()
    application = _probe_app(probe, product_logs=product_logs)
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", 0))
        listener.setblocking(False)
        origin = f"http://127.0.0.1:{listener.getsockname()[1]}"
        protocols: list[LocalH11Protocol] = []
        lifecycle = None
        if protected:
            from animama.local.http.composition import install_local_http
            from animama.local.http.config import DesktopAccess, LocalHTTPConfig
            from animama.local.http.lifecycle import LocalHTTPLifecycle

            class _ShortDrainLifecycle(LocalHTTPLifecycle):
                async def quiesce(self, timeout: float = 15.0) -> bool:
                    return await super().quiesce(timeout=0.1)

            lifecycle = install_local_http(
                application,
                LocalHTTPConfig(
                    public_origin=origin,
                    desktop=DesktopAccess("r" * 64, "c" * 64) if desktop else None,
                    max_body_bytes=max_body_bytes,
                    body_timeout_seconds=body_timeout,
                ),
                lifecycle=_ShortDrainLifecycle(),
            )
            lifecycle.mark_ready("transport-fixture-owner")

        class _ShortDeadlineProtocol(LocalH11Protocol):
            headers_timeout_seconds = header_timeout

            def connection_made(self, transport: asyncio.Transport) -> None:  # type: ignore[override]
                protocols.append(self)
                super().connection_made(transport)

        config = uvicorn.Config(
            application,
            host="127.0.0.1",
            port=listener.getsockname()[1],
            loop="asyncio",
            http=_ShortDeadlineProtocol,
            # Match Uvicorn's current auto selection, including its finite
            # message-size and queue limits before the ASGI receive pump.
            ws="websockets",
            lifespan="off",
            proxy_headers=False,
            access_log=False,
            log_config=None,
            timeout_keep_alive=5,
            timeout_graceful_shutdown=15,
        )
        server = uvicorn.Server(config)
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            with anyio.fail_after(3):
                while not server.started:
                    if task.done():
                        await task
                        raise AssertionError("Uvicorn exited before readiness")
                    await asyncio.sleep(0.005)
            yield _LiveServer(origin, probe, server, task, protocols, lifecycle, desktop)
        finally:
            server.should_exit = True
            try:
                await asyncio.wait_for(asyncio.shield(task), timeout=3)
            except TimeoutError:
                server.force_exit = True
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                pytest.fail("The isolated Uvicorn fixture failed to release its tasks during cleanup", pytrace=False)


async def _response(reader: asyncio.StreamReader) -> tuple[int, bytes]:
    """Read one small length-delimited fixture response, preserving pipelining."""

    head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), 2)
    lines = head.decode("ascii").split("\r\n")
    status = int(lines[0].split()[1])
    headers = dict(line.lower().split(": ", 1) for line in lines[1:] if ": " in line)
    length = int(headers.get("content-length", "0"))
    return status, await asyncio.wait_for(reader.readexactly(length), 2)


async def _close(writer: asyncio.StreamWriter) -> None:
    writer.close()
    with contextlib.suppress(ConnectionError):
        await writer.wait_closed()


def test_local_transport_review_tripwire() -> None:
    """The small parser-state hook must be reviewed on a dependency upgrade."""

    assert uvicorn.__version__ == REVIEWED_UVICORN_VERSION
    assert LocalH11Protocol.headers_timeout_seconds == 15


@pytest.mark.parametrize("prefix", [b"", b"GET /v1/echo HTTP/1.1\r\nHost: "])
async def test_initial_incomplete_headers_expire_without_application_work(prefix: bytes) -> None:
    async with _serve(protected=False) as live:
        reader, writer = await live.open_connection()
        try:
            writer.write(prefix)
            await writer.drain()
            assert await asyncio.wait_for(reader.read(), 1) == b""
            assert live.probe.requests == []
            assert live.protocols[0]._headers_timer is None
        finally:
            await _close(writer)


async def test_trickled_header_bytes_do_not_extend_the_deadline() -> None:
    async with _serve(protected=False) as live:
        reader, writer = await live.open_connection()
        closed = asyncio.create_task(reader.read())
        try:
            writer.write(b"GET /v1/echo HTTP/1.1\r\nX-Trickle: ")
            # A sliding timer would never expire while these bytes arrive.
            with anyio.fail_after(1):
                while not closed.done():
                    writer.write(b"a")
                    with contextlib.suppress(ConnectionError):
                        await writer.drain()
                    await asyncio.sleep(0.03)
            assert await closed == b""
            assert live.probe.requests == []
        finally:
            closed.cancel()
            await asyncio.gather(closed, return_exceptions=True)
            await _close(writer)


async def test_header_deadline_rearms_for_the_next_keepalive_request() -> None:
    async with _serve(protected=False) as live:
        reader, writer = await live.open_connection()
        try:
            writer.write(live.request_head("GET", "/v1/echo"))
            await writer.drain()
            assert (await _response(reader))[0] == 200
            writer.write(b"GET /v1/echo HTTP/1.1\r\nHost: ")
            await writer.drain()
            assert await asyncio.wait_for(reader.read(), 1) == b""
            assert live.probe.requests == ["echo"]
        finally:
            await _close(writer)


async def test_pipelined_requests_wait_for_an_active_response_without_header_timeout() -> None:
    async with _serve(protected=False) as live:
        reader, writer = await live.open_connection()
        try:
            writer.write(live.request_head("GET", "/v1/slow") + live.request_head("GET", "/v1/echo"))
            await writer.drain()
            # The first response takes longer than the header timeout. The
            # second request is already buffered but cannot be parsed yet.
            assert (await _response(reader))[0] == 200
            assert (await _response(reader))[0] == 200
            assert live.probe.requests == ["slow", "echo"]
            writer.write(b"GET /v1/echo HTTP/1.1\r\nHost: ")
            await writer.drain()
            assert await asyncio.wait_for(reader.read(), 1) == b""
        finally:
            await _close(writer)


async def test_partial_pipelined_headers_expire_after_the_active_response_completes() -> None:
    async with _serve(protected=False) as live:
        reader, writer = await live.open_connection()
        try:
            writer.write(live.request_head("GET", "/v1/slow") + b"GET /v1/echo HTTP/1.1\r\nHost: ")
            await writer.drain()
            assert (await _response(reader))[0] == 200
            assert await asyncio.wait_for(reader.read(), 1) == b""
            assert live.probe.requests == ["slow"]
            assert live.protocols[0]._headers_timer is None
        finally:
            await _close(writer)


async def test_malformed_headers_close_without_retaining_the_deadline() -> None:
    async with _serve(protected=False, header_timeout=5) as live:
        reader, writer = await live.open_connection()
        try:
            writer.write(b"GET /v1/echo HTTP/1.1\r\nMalformed header\r\n\r\n")
            await writer.drain()
            response = await asyncio.wait_for(reader.read(), 1)
            assert response.startswith(b"HTTP/1.1 400 Bad Request\r\n")
            assert live.probe.requests == []
            assert live.protocols[0]._headers_timer is None
        finally:
            await _close(writer)


async def test_disconnect_cancels_the_header_timer_and_releases_connection_state() -> None:
    async with _serve(protected=False, header_timeout=5) as live:
        _reader, writer = await live.open_connection()
        # Client connect completion does not guarantee the server accept callback ran.
        with anyio.fail_after(1):
            while not live.protocols:
                await asyncio.sleep(0.005)
        protocol = live.protocols[0]
        assert protocol._headers_timer is not None
        await _close(writer)
        with anyio.fail_after(1):
            while protocol in live.server.server_state.connections:
                await asyncio.sleep(0.005)
        assert protocol._headers_timer is None


async def test_shutdown_cancels_an_idle_connection_header_timer() -> None:
    async with _serve(protected=False, header_timeout=5) as live:
        reader, writer = await live.open_connection()
        try:
            # Observe actual server acceptance before initiating shutdown.
            with anyio.fail_after(1):
                while not live.protocols:
                    await asyncio.sleep(0.005)
            protocol = live.protocols[0]
            live.server.should_exit = True
            assert await asyncio.wait_for(reader.read(), 2) == b""
            await asyncio.wait_for(asyncio.shield(live.task), 2)
            assert protocol._headers_timer is None
        finally:
            await _close(writer)


async def test_real_sse_is_incremental_and_outlives_header_and_body_receipt_deadlines() -> None:
    async with _serve(desktop=True) as live, httpx.AsyncClient(timeout=2) as client:
        async with client.stream("GET", live.origin + "/v1/events:sse", headers=live.headers) as response:
            assert response.status_code == 200
            frames = response.aiter_bytes()
            assert await asyncio.wait_for(anext(frames), 1) == b"data: first\n\n"
            assert live.lifecycle.active_requests == 1
            await asyncio.sleep(0.35)
            live.probe.stream_release.set()
            assert await asyncio.wait_for(anext(frames), 1) == b"data: second\n\n"
        await asyncio.wait_for(live.probe.stream_closed.wait(), 1)


async def test_real_stream_disconnect_runs_cleanup_and_releases_admission() -> None:
    async with _serve(desktop=True) as live, httpx.AsyncClient(timeout=2) as client:
        async with client.stream("GET", live.origin + "/v1/events:sse", headers=live.headers) as response:
            assert response.status_code == 200
            assert await asyncio.wait_for(anext(response.aiter_bytes()), 1) == b"data: first\n\n"
        await asyncio.wait_for(live.probe.stream_closed.wait(), 1)
        with anyio.fail_after(1):
            while live.lifecycle.active_requests:
                await asyncio.sleep(0.005)
        assert not live.probe.stream_release.is_set()


async def test_real_quiesce_drains_active_http_and_sse_without_cancelling_them() -> None:
    async with _serve(desktop=True) as live, httpx.AsyncClient(timeout=2) as client:
        control_url = live.origin + "/_desktop/runtime:quiesce"
        async with client.stream("GET", live.origin + "/v1/events:sse", headers=live.headers) as response:
            assert response.status_code == 200
            frames = response.aiter_bytes()
            assert await asyncio.wait_for(anext(frames), 1) == b"data: first\n\n"
            mutation = asyncio.create_task(client.post(live.origin + "/v1/commit", headers=live.headers))
            try:
                await asyncio.wait_for(live.probe.mutation_started.wait(), 1)
                busy = await client.post(control_url, headers=live.control_headers)
                assert busy.status_code == 409
                assert busy.json() == {"detail": {"code": "runtime_busy"}}
                assert live.lifecycle.quiescing
                assert live.lifecycle.active_requests == 2
                assert not live.probe.stream_closed.is_set()
                assert not live.probe.mutation_committed.is_set()
                assert not live.probe.mutation_cancelled

                rejected = await client.get(live.origin + "/v1/echo", headers=live.headers)
                assert rejected.status_code == 503
                assert rejected.json() == {"error": "runtime_quiescing"}
                assert live.probe.requests == []

                live.probe.stream_release.set()
                with anyio.fail_after(1):
                    assert [frame async for frame in frames] == [b"data: second\n\n"]
                live.probe.mutation_release.set()
                live.probe.mutation_cleanup_release.set()
                assert (await asyncio.wait_for(mutation, 1)).json() == {"committed": True}
                assert live.probe.mutation_closed.is_set()
                assert live.lifecycle.active_requests == 0

                for _ in range(2):
                    drained = await client.post(control_url, headers=live.control_headers)
                    assert drained.status_code == 200
                    assert drained.json() == {"schema_version": 1, "state": "quiesced"}
            finally:
                live.probe.stream_release.set()
                live.probe.mutation_release.set()
                live.probe.mutation_cleanup_release.set()
                await asyncio.gather(mutation, return_exceptions=True)


async def test_real_http_disconnect_retains_admission_through_commit_and_finally_cleanup() -> None:
    async with _serve(desktop=True) as live:
        _reader, writer = await live.open_connection()
        try:
            writer.write(live.request_head("POST", "/v1/commit"))
            await writer.drain()
            await asyncio.wait_for(live.probe.mutation_started.wait(), 1)
            protocol = live.protocols[0]
            await _close(writer)
            with anyio.fail_after(1):
                while protocol in live.server.server_state.connections:
                    await asyncio.sleep(0.005)
            assert live.lifecycle.active_requests == 1
            assert not live.probe.mutation_cancelled
            assert not live.probe.mutation_committed.is_set()

            live.probe.mutation_release.set()
            await asyncio.wait_for(live.probe.mutation_cleanup_started.wait(), 1)
            assert live.probe.mutation_committed.is_set()
            assert live.lifecycle.active_requests == 1
            assert not live.probe.mutation_closed.is_set()

            live.probe.mutation_cleanup_release.set()
            await asyncio.wait_for(live.probe.mutation_closed.wait(), 1)
            with anyio.fail_after(1):
                while live.lifecycle.active_requests:
                    await asyncio.sleep(0.005)
            assert not live.probe.mutation_cancelled
        finally:
            live.probe.mutation_release.set()
            live.probe.mutation_cleanup_release.set()
            await _close(writer)


async def test_real_chunked_request_limit_prevents_completed_upload() -> None:
    async def chunks() -> AsyncIterator[bytes]:
        yield b"a" * 512
        await asyncio.sleep(0)
        yield b"b" * 513

    async with _serve(desktop=True) as live, httpx.AsyncClient(timeout=2) as client:
        response = await client.post(live.origin + "/v1/upload", headers=live.headers, content=chunks())
        assert response.status_code == 413
        assert live.probe.completed_uploads == []
        assert live.lifecycle.active_requests == 0


async def test_real_valid_body_may_outlive_the_completed_header_deadline() -> None:
    async with _serve(desktop=True, body_timeout=1) as live:
        reader, writer = await live.open_connection()
        try:
            writer.write(live.request_head("POST", "/v1/upload", chunked=True) + b"1\r\na\r\n")
            await writer.drain()
            await asyncio.sleep(0.35)
            writer.write(b"1\r\nb\r\n0\r\n\r\n")
            await writer.drain()
            assert (await _response(reader))[0] == 200
            assert live.probe.completed_uploads == [b"ab"]
        finally:
            await _close(writer)


async def test_real_declared_request_limit_rejects_before_route_entry() -> None:
    async with _serve(desktop=True) as live, httpx.AsyncClient(timeout=2) as client:
        response = await client.post(live.origin + "/v1/upload", headers=live.headers, content=b"a" * 1025)
        assert response.status_code == 413
        assert live.probe.requests == []
        assert live.probe.completed_uploads == []


async def test_real_stalled_chunked_body_has_a_receipt_deadline() -> None:
    async with _serve(desktop=True) as live:
        reader, writer = await live.open_connection()
        try:
            writer.write(live.request_head("POST", "/v1/upload", chunked=True) + b"1\r\na\r\n")
            await writer.drain()
            assert (await _response(reader))[0] == 408
            assert live.probe.completed_uploads == []
        finally:
            await _close(writer)


@pytest.mark.parametrize("response_status", [200, 502])
@pytest.mark.parametrize(("failure", "expected"), [("oversize", 413), ("deadline", 408)])
async def test_real_body_failure_cannot_be_swallowed_or_translated_by_the_route(
    response_status: int, failure: str, expected: int
) -> None:
    async with _serve(desktop=True) as live:
        reader, writer = await live.open_connection()
        try:
            writer.write(live.request_head("POST", f"/v1/catch-body/{response_status}", chunked=True))
            writer.write(b"1\r\na\r\n")
            if failure == "oversize":
                writer.write(b"400\r\n" + b"b" * 1024 + b"\r\n0\r\n\r\n")
            await writer.drain()
            # The boundary must close this connection, even when route error
            # handling tries to replace the transport failure with a response.
            response = await asyncio.wait_for(reader.read(), 1)
            head, body = response.split(b"\r\n\r\n", 1)
            assert int(head.split()[1]) == expected
            assert b"\r\nconnection: close" in head.lower()
            assert b"\r\ncache-control: no-store" in head.lower()
            code = "request_body_too_large" if failure == "oversize" else "request_body_timeout"
            assert json.loads(body) == {"detail": {"code": code}}
            assert len(live.probe.caught_body_failures) == 1
            assert live.lifecycle.active_requests == 0
        finally:
            await _close(writer)


@pytest.mark.parametrize("failure", ["oversize", "deadline", "disconnect"])
async def test_real_partial_multipart_spools_close_when_body_receipt_fails(
    failure: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Observe parser-owned files without writing partial uploads to disk."""

    opened: list[io.BytesIO] = []

    class _MemorySpool(io.BytesIO):
        _rolled = False
        _max_size = 0

    def new_spool(*args: object, **kwargs: object) -> io.BytesIO:
        spool = _MemorySpool()
        opened.append(spool)
        return spool

    monkeypatch.setattr(starlette.formparsers, "SpooledTemporaryFile", new_spool)
    async with _serve(desktop=True, body_timeout=0.5) as live:
        reader, writer = await live.open_connection()
        try:
            head = live.request_head("POST", "/v1/multipart", chunked=True).removesuffix(b"\r\n")
            writer.write(head + b"Content-Type: multipart/form-data; boundary=transport\r\n\r\n")
            first = (
                b'--transport\r\nContent-Disposition: form-data; name="file"; filename="sample"\r\n\r\n' + b"a" * 100
            )
            writer.write(f"{len(first):x}\r\n".encode() + first + b"\r\n")
            await writer.drain()
            with anyio.fail_after(1):
                while not opened or (not opened[0].closed and opened[0].tell() == 0):
                    await asyncio.sleep(0.005)
            assert len(opened) == 1
            assert not opened[0].closed
            if failure == "disconnect":
                await _close(writer)
            else:
                if failure == "oversize":
                    writer.write(b"400\r\n" + b"b" * 1024 + b"\r\n0\r\n\r\n")
                    await writer.drain()
                status, _body = await _response(reader)
                assert status == (413 if failure == "oversize" else 408)
            with anyio.fail_after(1):
                while live.lifecycle.active_requests:
                    await asyncio.sleep(0.005)
            assert opened[0].closed
            assert live.probe.completed_uploads == []
        finally:
            await _close(writer)
            for spool in opened:
                spool.close()


async def test_real_websocket_admission_and_upgrade_cancel_the_http_timer() -> None:
    async with _serve(desktop=True) as live:
        url = live.origin.replace("http:", "ws:") + "/v1/logs"
        headers = {"Cookie": live.headers["Cookie"]}
        async with connect(url, origin=Origin(live.origin), additional_headers=headers) as websocket:
            await asyncio.wait_for(live.probe.websocket_started.wait(), 1)
            protocol = live.protocols[0]
            assert protocol._websocket_transferred
            assert protocol._headers_timer is None
            await asyncio.sleep(0.35)
            await websocket.send("still connected")
            assert await asyncio.wait_for(websocket.recv(), 1) == "still connected"
        await asyncio.wait_for(live.probe.websocket_closed.wait(), 1)


@pytest.mark.parametrize("failure", ["foreign-origin", "missing-capability", "unknown-route"])
async def test_real_websocket_rejects_unadmitted_upgrades(failure: str) -> None:
    async with _serve(desktop=True) as live:
        path = "/v1/unknown" if failure == "unknown-route" else "/v1/logs"
        url = live.origin.replace("http:", "ws:") + path
        headers = {} if failure == "missing-capability" else {"Cookie": live.headers["Cookie"]}
        origin = "https://foreign.invalid" if failure == "foreign-origin" else live.origin
        with pytest.raises(InvalidStatus) as rejected:
            async with connect(url, origin=Origin(origin), additional_headers=headers):
                raise AssertionError("unadmitted upgrade reached the application")
        # ASGI close before accept consistently rejects the HTTP upgrade with
        # 403, independent of the application policy's internal reason.
        assert rejected.value.response.status_code == 403
        assert not live.probe.websocket_started.is_set()


async def test_real_websocket_disconnect_cleans_an_application_not_reading_client_frames() -> None:
    async with _serve(desktop=True) as live:
        live.probe.websocket_idle = True
        url = live.origin.replace("http:", "ws:") + "/v1/logs"
        async with connect(url, origin=Origin(live.origin), additional_headers={"Cookie": live.headers["Cookie"]}):
            await asyncio.wait_for(live.probe.websocket_started.wait(), 1)
        await asyncio.wait_for(live.probe.websocket_closed.wait(), 1)
        with anyio.fail_after(1):
            while live.lifecycle.active_requests:
                await asyncio.sleep(0.005)


async def test_real_product_log_route_resolves_the_owner_and_unsubscribes_on_idle_disconnect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from animama.server.deps import resolve_websocket_principal
    from animama.server.routers import logs

    queue: asyncio.Queue[dict[str, str]] = asyncio.Queue()
    subscribed, unsubscribed = asyncio.Event(), asyncio.Event()
    owners: list[str] = []

    async def resolve(websocket: WebSocket) -> RequestPrincipal:
        principal = await resolve_websocket_principal(websocket)
        owners.append(principal.id)
        return principal

    async def subscribe(*, queue_size: int) -> asyncio.Queue[dict[str, str]]:
        assert queue_size == 1024
        subscribed.set()
        return queue

    async def unsubscribe(actual: asyncio.Queue[dict[str, str]]) -> None:
        assert actual is queue
        unsubscribed.set()

    monkeypatch.setattr(logs, "resolve_websocket_principal", resolve)
    monkeypatch.setattr(logs, "subscribe_logs", subscribe)
    monkeypatch.setattr(logs, "unsubscribe_logs", unsubscribe)
    async with _serve(desktop=True, product_logs=True) as live:
        url = live.origin.replace("http:", "ws:") + "/v1/logs"
        headers = {"Cookie": live.headers["Cookie"], "X-Animama-Principal-Id": "forged"}
        async with connect(url, origin=Origin(live.origin), additional_headers=headers):
            await asyncio.wait_for(subscribed.wait(), 1)
            assert owners == ["transport-fixture-owner"]
            assert live.lifecycle.active_requests == 1
            assert queue.empty()
        await asyncio.wait_for(unsubscribed.wait(), 1)
        with anyio.fail_after(1):
            while live.lifecycle.active_requests:
                await asyncio.sleep(0.005)
