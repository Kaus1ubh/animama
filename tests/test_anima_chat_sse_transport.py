"""Product chat over real loopback HTTP, with no provider or database IO.

Only the repositories, context adapters and the provider boundary are doubles. The
shared chat router and local ports, turn preparation/executor, structured parser,
SSE bridge, local admission/principal resolver and Uvicorn protocol execute normally. Incognito
turns explicitly disable optional emotion/memory/TTS side effects; persistence
and those optional integrations have separate acceptance tests.
"""

from __future__ import annotations

import asyncio
import json
import socket
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock

import httpx
import pytest
import uvicorn
from anyio import fail_after
from fastapi import FastAPI

from animama.app.chat.memory_context import DirectChatMemoryContext
from animama.app.main_structured_response import MAIN_STRUCTURED_RESPONSE_KIND
from animama.app.model_clients import (
    ModelClientDelta,
    ModelClientFinal,
    ModelClientProviderError,
    ModelClientRequest,
    StaticModelClientRegistry,
)
from animama.app.safety.ai_notice import AiNoticeState
from animama.domain.anima_chat_profile import AnimaChatProfile
from animama.domain.model_provider import ModelProvider, ModelProviderCapabilities
from animama.domain.usage import Usage
from animama.local.http.composition import install_local_http
from animama.local.http.config import LocalHTTPConfig
from animama.local.http.lifecycle import LocalHTTPLifecycle
from animama.local.http.protocol import LocalH11Protocol
from animama.product_http.chat import turn_setup
from animama.product_http.ports import install_product_ports
from animama.product_http.routes.chat_turns import router
from animama.server.product_ports import LocalProductPorts

_OWNER = "chat-transport-owner"
_ANIMA = "chat-transport-anima"
_PREFIX = '{"emotional_tone":"neutral","emotional_intensity":1,"gesture":"","speech":"First sentence. S'
_SUFFIX = 'econd sentence.","display":null,"remember":null}'


@dataclass
class _ProviderTurn:
    """A test releases the final provider bytes only after observing wire text."""

    fail: bool = False
    release: asyncio.Event = field(default_factory=asyncio.Event)
    waiting: asyncio.Event = field(default_factory=asyncio.Event)
    closed: asyncio.Event = field(default_factory=asyncio.Event)
    cancelled: bool = False
    final_sent: bool = False


class _Provider:
    def __init__(self, turns: list[_ProviderTurn]) -> None:
        self.turns = turns
        self.requests: list[ModelClientRequest] = []
        self.close_calls = 0

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        turn = self.turns[len(self.requests)]
        self.requests.append(request)
        try:
            yield ModelClientDelta(kind="text_delta", text=_PREFIX)
            turn.waiting.set()
            await turn.release.wait()
            if turn.fail:
                raise ModelClientProviderError("Fixture provider unavailable", code="fixture_provider_failed")
            yield ModelClientDelta(kind="text_delta", text=_SUFFIX)
            turn.final_sent = True
            yield ModelClientDelta(kind="final", final=ModelClientFinal(text=_PREFIX + _SUFFIX, usage=Usage()))
            yield ModelClientDelta(kind="done")
        except asyncio.CancelledError:
            turn.cancelled = True
            raise
        finally:
            turn.closed.set()

    async def aclose(self) -> None:
        self.close_calls += 1


class _Session:
    """A session with no queries, so a real repository fails closed on it."""

    def __init__(self) -> None:
        self.close_calls = 0

    async def close(self) -> None:
        self.close_calls += 1

    async def __aenter__(self) -> _Session:
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        await self.close()


class _TransportPorts(LocalProductPorts):
    """The local ports over the fixture's repositories."""

    def __init__(self, app: FastAPI, repositories: SimpleNamespace) -> None:
        super().__init__(app)
        self._fixture_repositories = repositories

    def repositories(self, session: Any) -> Any:
        return self._fixture_repositories


@dataclass
class _LiveChat:
    origin: str
    lifecycle: LocalHTTPLifecycle
    provider: _Provider
    sessions: list[_Session]

    @property
    def headers(self) -> dict[str, str]:
        return {"Origin": self.origin, "Sec-Fetch-Site": "same-origin", "X-Animama-CSRF": "1"}

    def request(self, run_id: str) -> dict[str, str]:
        return {"message": "Hello", "run_id": run_id, "chat_id": "chat-fixture", "runtime_revision": "tr1-fixture"}

    async def assert_idle(self) -> None:
        with fail_after(2):
            while self.lifecycle.active_requests:
                await asyncio.sleep(0.005)
        assert self.sessions and all(session.close_calls == 1 for session in self.sessions)
        assert self.provider.close_calls == 0, "A request must not close the app-scoped model client"
        assert not [
            task for task in asyncio.all_tasks() if not task.done() and task.get_name().startswith("direct-chat-")
        ], "Request-local chat tasks survived transport cleanup"


def _install_context(monkeypatch: pytest.MonkeyPatch, app: FastAPI, sessions: list[_Session]) -> None:
    """Supply only fixture-owned repository/context inputs, retaining real setup."""

    def session_factory() -> _Session:
        session = _Session()
        sessions.append(session)
        return session

    provider = ModelProvider(
        id="OpenAIHTTPAgent:transport-fixture",
        provider_type="OpenAIHTTPAgent",
        model="transport-fixture",
        model_label="Fixture",
        provider_label="Fixture",
        active=True,
        capabilities=ModelProviderCapabilities(
            supports_streaming=True, structured_kinds=[MAIN_STRUCTURED_RESPONSE_KIND]
        ),
    )
    chat_manager = SimpleNamespace(
        ensure_owned_chat=AsyncMock(return_value=SimpleNamespace(metadata={}, openai_previous_response_id=None)),
        get_chat_context=AsyncMock(return_value=SimpleNamespace(messages=[], blocks=[])),
    )
    repositories = SimpleNamespace(
        animas=SimpleNamespace(
            is_owned_by_user=AsyncMock(
                side_effect=lambda *, user_id, anima_id: (user_id, anima_id) == (_OWNER, _ANIMA)
            ),
            stored_emotional_state=AsyncMock(return_value=None),
        ),
        anima_runtime_snapshots=SimpleNamespace(
            get_snapshot=AsyncMock(
                return_value=SimpleNamespace(
                    expires_at=datetime.now(UTC) + timedelta(minutes=5), catalog={"gestures": []}
                )
            )
        ),
        model_providers=SimpleNamespace(get=AsyncMock(return_value=provider)),
        anima_chat_profiles=SimpleNamespace(
            get=AsyncMock(return_value=AnimaChatProfile(anima_id=_ANIMA, default_model_provider_id=provider.id))
        ),
        user_settings=SimpleNamespace(get=AsyncMock(return_value=None)),
        companion_safety=SimpleNamespace(
            lock_ai_notice_state=AsyncMock(return_value=AiNoticeState()), save_ai_notice_state=AsyncMock()
        ),
        unit_of_work=SimpleNamespace(commit=AsyncMock()),
        memory_entries=None,
        memory_episodes=None,
        user_file_processing=None,
    )
    app.state.session_factory = session_factory
    install_product_ports(app, _TransportPorts(app, repositories))
    monkeypatch.setattr(turn_setup, "chat_manager", lambda _repositories: chat_manager)
    monkeypatch.setattr(
        turn_setup,
        "resolve_chat_request_options",
        AsyncMock(
            return_value={
                "incognito": True,
                "disable_memory_influence": True,
                "disable_memory_updates": True,
                "disable_emotion_updates": True,
                "tts": {"enabled": False},
            }
        ),
    )
    monkeypatch.setattr(
        turn_setup,
        "DirectChatMemoryContextService",
        lambda **_kwargs: SimpleNamespace(
            build_context=AsyncMock(
                return_value=DirectChatMemoryContext(
                    anima_identity="Fixture companion", manifest={}, anima_name="Fixture"
                )
            )
        ),
    )


@asynccontextmanager
async def _serve(monkeypatch: pytest.MonkeyPatch, turns: list[_ProviderTurn]) -> AsyncIterator[_LiveChat]:
    """Own just one ephemeral loopback socket; never attach to a running stack."""

    sessions: list[_Session] = []
    provider = _Provider(turns)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    _install_context(monkeypatch, app, sessions)
    app.include_router(router)
    app.state.model_client_registry = StaticModelClientRegistry({"OpenAIHTTPAgent": provider})
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        listener.setblocking(False)
        origin = f"http://127.0.0.1:{listener.getsockname()[1]}"
        lifecycle = install_local_http(app, LocalHTTPConfig(public_origin=origin))
        lifecycle.mark_ready(_OWNER)
        server = uvicorn.Server(
            uvicorn.Config(
                app,
                host="127.0.0.1",
                port=listener.getsockname()[1],
                loop="asyncio",
                http=LocalH11Protocol,
                lifespan="off",
                proxy_headers=False,
                access_log=False,
                log_config=None,
                timeout_graceful_shutdown=2,
            )
        )
        task = asyncio.create_task(server.serve(sockets=[listener]))
        try:
            with fail_after(3):
                while not server.started:
                    if task.done():
                        await task
                        raise AssertionError("Uvicorn exited before readiness")
                    await asyncio.sleep(0.005)
            yield _LiveChat(origin, lifecycle, provider, sessions)
        finally:
            # Release a stuck fixture provider after assertions, including fault
            # runs, so cleanup never leaves a provider task behind.
            for turn in turns:
                turn.release.set()
            server.should_exit = True
            try:
                await asyncio.wait_for(asyncio.shield(task), 3)
            except TimeoutError:
                task.cancel()
                await asyncio.gather(task, return_exceptions=True)
                pytest.fail("Chat Uvicorn fixture did not shut down cleanly")


async def _frames(response: httpx.Response) -> AsyncIterator[tuple[str, dict[str, Any]]]:
    """Parse the public SSE envelope; do not use the server's formatting helper."""

    name = ""
    data: list[str] = []
    async for line in response.aiter_lines():
        if line.startswith("event: "):
            name = line[7:]
        elif line.startswith("data: "):
            data.append(line[6:])
        elif not line and data:
            yield name, json.loads("\n".join(data))
            name, data = "", []
    assert not data, "The route left a truncated SSE frame"


async def _first_text(
    frames: AsyncIterator[tuple[str, dict[str, Any]]], turn: _ProviderTurn, live: _LiveChat
) -> list[tuple[str, dict[str, Any]]]:
    """Return any leading safety frames followed by the first streamed reply text."""

    leading: list[tuple[str, dict[str, Any]]] = []
    first = await asyncio.wait_for(anext(frames), 2)
    while first[0].startswith("safety."):
        # Companion-safety frames (the AI notice) precede provider output.
        leading.append(first)
        first = await asyncio.wait_for(anext(frames), 2)
    assert first[0] == "user.response"
    assert first[1]["text"] == "First sentence."
    assert first[1]["is_delta"] is True
    assert turn.waiting.is_set() and not turn.release.is_set()
    assert not turn.final_sent and not turn.closed.is_set()
    assert live.lifecycle.active_requests == 1
    assert live.sessions[0].close_calls == 1, "The setup session must close before provider streaming"
    return [*leading, first]


@pytest.mark.parametrize("fail", [False, True], ids=["success", "provider-error"])
async def test_product_chat_streams_before_provider_completion_and_has_one_terminal_frame(
    monkeypatch, fail: bool
) -> None:
    turn = _ProviderTurn(fail=fail)
    async with _serve(monkeypatch, [turn]) as live:
        async with httpx.AsyncClient(base_url=live.origin, trust_env=False, timeout=3) as client:
            async with client.stream(
                "POST", f"/v1/animas/{_ANIMA}/chat:sse", headers=live.headers, json=live.request("run-terminal")
            ) as response:
                assert response.status_code == 200
                assert response.headers["content-type"].startswith("text/event-stream")
                assert response.headers["x-accel-buffering"] == "no"
                frames = _frames(response)
                first = await _first_text(frames, turn, live)
                turn.release.set()
                with fail_after(3):
                    observed = [*first, *[frame async for frame in frames]]
            await live.assert_idle()
        names = [name for name, _ in observed]
        assert names[-1] == "run.completed"
        assert names.count("run.completed") == 1
        assert observed[-1][1]["chat_id"] == "chat-fixture"
        assert all(data["run_id"] == "run-terminal" for _, data in observed)
        assert turn.closed.is_set() and not turn.cancelled
        if fail:
            assert names.count("error") == 1
            assert names.index("error") < names.index("run.completed")
            error = next(data for name, data in observed if name == "error")
            assert error["code"] == "fixture_provider_failed"
            assert not turn.final_sent
        else:
            assert "error" not in names
            assert turn.final_sent
            assert (
                "".join(data["text"] for name, data in observed if name == "user.response")
                == "First sentence. Second sentence."
            )


async def test_product_chat_disconnect_cancels_provider_then_same_app_accepts_a_new_turn(monkeypatch) -> None:
    disconnected, resumed = _ProviderTurn(), _ProviderTurn()
    async with _serve(monkeypatch, [disconnected, resumed]) as live:
        async with httpx.AsyncClient(base_url=live.origin, trust_env=False, timeout=3) as client:
            async with client.stream(
                "POST", f"/v1/animas/{_ANIMA}/chat:sse", headers=live.headers, json=live.request("run-disconnect")
            ) as response:
                assert response.status_code == 200
                await _first_text(_frames(response), disconnected, live)
                # Exit with the provider still blocked: httpx closes the actual
                # connection, rather than cancelling an in-process iterator.
            await asyncio.wait_for(disconnected.closed.wait(), 2)
            assert disconnected.cancelled and not disconnected.final_sent
            assert not disconnected.release.is_set()
            await live.assert_idle()
            resumed.release.set()
            response = await client.post(
                f"/v1/animas/{_ANIMA}/chat:sse", headers=live.headers, json=live.request("run-resumed")
            )
            assert response.status_code == 200
            observed = [frame async for frame in _frames(response)]
            assert sum(name == "run.completed" for name, _ in observed) == 1
            assert all(data["run_id"] == "run-resumed" for _, data in observed)
            assert not any(name == "error" for name, _ in observed)
            assert len(live.provider.requests) == 2
            await live.assert_idle()
