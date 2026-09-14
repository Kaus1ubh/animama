from __future__ import annotations

import asyncio
from dataclasses import FrozenInstanceError

import pytest
from fastapi import HTTPException, WebSocketException
from starlette.requests import Request
from starlette.types import Scope
from starlette.websockets import WebSocket

from animama.local.http.lifecycle import AdmittedLocalPrincipalResolver, LocalHTTPLifecycle


def scope(kind: str = "http", *, state: dict[str, object] | None = None) -> Scope:
    return {
        "type": kind,
        "method": "POST",
        "path": "/v1/chats",
        "scheme": "http" if kind == "http" else "ws",
        "server": ("localhost", 3000),
        "query_string": b"principal_id=forged&ready=true",
        "headers": [
            (b"x-animama-principal-id", b"forged"),
            (b"x-animama-internal-token", b"forged"),
            (b"authorization", b"Bearer forged"),
        ],
        "state": {} if state is None else state,
    }


def websocket(connection_scope: Scope) -> WebSocket:
    async def receive():
        return {"type": "websocket.disconnect", "code": 1000}

    async def send(message):
        raise AssertionError("Resolving a principal must not send WebSocket messages")

    return WebSocket(connection_scope, receive, send)


@pytest.mark.parametrize("kind", ["http", "websocket"])
@pytest.mark.parametrize("marker", [None, "forged", True, object()])
async def test_unready_and_unadmitted_requests_fail_closed_despite_forged_inputs(kind: str, marker: object) -> None:
    lifecycle = LocalHTTPLifecycle()
    resolver = AdmittedLocalPrincipalResolver(lifecycle)
    connection_scope = scope(
        kind, state={"animama_local_http_admission": marker, "principal_id": "forged", "ready": True}
    )
    for bootstrapped in (False, True):
        if bootstrapped:
            lifecycle.mark_ready("installation-owner")
        assert lifecycle.admitted_principal(connection_scope) is None
        if kind == "http":
            with pytest.raises(HTTPException) as http_failure:
                await resolver.resolve_http(Request(connection_scope))
            assert http_failure.value.status_code == 503
            assert isinstance(http_failure.value.detail, dict)
            assert http_failure.value.detail == {"code": "local_runtime_unavailable"}
        else:
            with pytest.raises(WebSocketException) as websocket_failure:
                await resolver.resolve_websocket(websocket(connection_scope))
            assert websocket_failure.value.code == 1008
            assert websocket_failure.value.reason == "local_runtime_unavailable"
    assert lifecycle.active_requests == 0


def test_bootstrap_is_required_for_admission_and_does_not_consume_work_slots() -> None:
    lifecycle = LocalHTTPLifecycle()
    connection_scope = scope()
    assert not lifecycle.ready
    assert lifecycle.admit(connection_scope) == "local_runtime_unavailable"
    assert lifecycle.active_requests == 0
    assert lifecycle.admitted_principal(connection_scope) is None
    lifecycle.mark_ready("installation-owner")
    assert lifecycle.ready
    assert lifecycle.admit(connection_scope) is None
    assert lifecycle.active_requests == 1
    lifecycle.release(connection_scope)
    assert lifecycle.active_requests == 0


@pytest.mark.parametrize("principal_id", [None, "", "  ", 42])
def test_invalid_bootstrap_identity_never_establishes_readiness(principal_id: object) -> None:
    lifecycle = LocalHTTPLifecycle()
    with pytest.raises(ValueError):
        lifecycle.mark_ready(principal_id)  # type: ignore[arg-type]
    assert not lifecycle.ready


@pytest.mark.parametrize("kind", ["http", "websocket"])
async def test_admitted_principal_comes_only_from_immutable_completed_bootstrap(kind: str) -> None:
    lifecycle = LocalHTTPLifecycle()
    lifecycle.mark_ready("installation-owner")
    resolver = AdmittedLocalPrincipalResolver(lifecycle)
    connection_scope = scope(kind)
    assert lifecycle.admit(connection_scope) is None
    principal = (
        await resolver.resolve_http(Request(connection_scope))
        if kind == "http"
        else await resolver.resolve_websocket(websocket(connection_scope))
    )
    assert principal.id == "installation-owner"
    with pytest.raises(FrozenInstanceError):
        principal.id = "forged"  # type: ignore[misc]
    with pytest.raises(RuntimeError):
        lifecycle.mark_ready("replacement-owner")
    assert lifecycle.admitted_principal(connection_scope) is principal
    lifecycle.release(connection_scope)
    assert lifecycle.admitted_principal(connection_scope) is None


def test_admission_markers_from_another_runtime_cannot_resolve_or_release() -> None:
    first, second = LocalHTTPLifecycle(), LocalHTTPLifecycle()
    first.mark_ready("first-owner")
    second.mark_ready("second-owner")
    connection_scope = scope()
    first.admit(connection_scope)
    assert second.admitted_principal(connection_scope) is None
    with pytest.raises(RuntimeError):
        second.release(connection_scope)
    assert second.active_requests == 0
    first.release(connection_scope)
    with pytest.raises(RuntimeError):
        first.release(connection_scope)
    assert first.active_requests == 0


def test_duplicate_admission_cannot_leak_active_request_accounting() -> None:
    lifecycle = LocalHTTPLifecycle()
    lifecycle.mark_ready("installation-owner")
    connection_scope = scope()
    lifecycle.admit(connection_scope)
    with pytest.raises(RuntimeError):
        lifecycle.admit(connection_scope)
    assert lifecycle.active_requests == 1
    lifecycle.release(connection_scope)
    assert lifecycle.active_requests == 0


async def test_concurrent_drain_calls_close_admission_then_wait_for_all_cleanup() -> None:
    lifecycle = LocalHTTPLifecycle()
    lifecycle.mark_ready("installation-owner")
    first, second = scope(), scope("websocket")
    lifecycle.admit(first)
    lifecycle.admit(second)
    drains = [asyncio.create_task(lifecycle.quiesce(timeout=1)) for _ in range(3)]
    await asyncio.sleep(0)
    assert lifecycle.quiescing
    assert lifecycle.active_requests == 2
    assert lifecycle.admit(scope()) == "runtime_quiescing"
    first_principal = lifecycle.admitted_principal(first)
    second_principal = lifecycle.admitted_principal(second)
    assert first_principal is not None and first_principal.id == "installation-owner"
    assert second_principal is not None and second_principal.id == "installation-owner"
    lifecycle.release(first)
    await asyncio.sleep(0)
    assert not any(task.done() for task in drains)
    lifecycle.release(second)
    assert await asyncio.gather(*drains) == [True, True, True]
    assert lifecycle.active_requests == 0
    assert lifecycle.quiescing
    assert await lifecycle.quiesce(timeout=0.01)
    assert lifecycle.admit(scope()) == "runtime_quiescing"


async def test_drain_timeout_keeps_existing_work_authorized_and_admission_closed() -> None:
    lifecycle = LocalHTTPLifecycle()
    lifecycle.mark_ready("installation-owner")
    existing = scope()
    lifecycle.admit(existing)
    assert await lifecycle.quiesce(timeout=0.01) is False
    assert lifecycle.quiescing
    assert lifecycle.active_requests == 1
    principal = lifecycle.admitted_principal(existing)
    assert principal is not None and principal.id == "installation-owner"
    assert lifecycle.admit(scope()) == "runtime_quiescing"
    lifecycle.release(existing)
    assert await lifecycle.quiesce(timeout=0.01) is True


async def test_cancelling_one_drain_does_not_reopen_admission_or_cancel_product_work() -> None:
    lifecycle = LocalHTTPLifecycle()
    lifecycle.mark_ready("installation-owner")
    admitted = scope()
    lifecycle.admit(admitted)
    finish_work = asyncio.Event()

    async def product_work() -> str:
        try:
            await finish_work.wait()
            principal = lifecycle.admitted_principal(admitted)
            assert principal is not None and principal.id == "installation-owner"
            return "completed"
        finally:
            lifecycle.release(admitted)

    work = asyncio.create_task(product_work())
    cancelled_drain = asyncio.create_task(lifecycle.quiesce(timeout=1))
    remaining_drain = asyncio.create_task(lifecycle.quiesce(timeout=1))
    await asyncio.sleep(0)
    cancelled_drain.cancel()
    with pytest.raises(asyncio.CancelledError):
        await cancelled_drain
    assert lifecycle.quiescing
    assert lifecycle.active_requests == 1
    assert lifecycle.admit(scope()) == "runtime_quiescing"
    assert not work.done()
    assert not remaining_drain.done()
    finish_work.set()
    assert await work == "completed"
    assert await remaining_drain is True
    assert lifecycle.active_requests == 0


async def test_quiescing_before_bootstrap_cannot_later_open_admission() -> None:
    lifecycle = LocalHTTPLifecycle()
    assert await lifecycle.quiesce(timeout=0.01)
    with pytest.raises(RuntimeError):
        lifecycle.mark_ready("installation-owner")
    assert not lifecycle.ready
    assert lifecycle.admit(scope()) == "runtime_quiescing"


@pytest.mark.parametrize("timeout", [0, -1, 15.1, float("inf"), float("nan")])
async def test_invalid_drain_deadline_does_not_change_admission(timeout: float) -> None:
    lifecycle = LocalHTTPLifecycle()
    lifecycle.mark_ready("installation-owner")
    with pytest.raises(ValueError):
        await lifecycle.quiesce(timeout=timeout)
    assert not lifecycle.quiescing
    admitted = scope()
    assert lifecycle.admit(admitted) is None
    lifecycle.release(admitted)
