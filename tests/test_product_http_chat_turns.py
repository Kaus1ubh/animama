"""The shared chat route under a composition's chat-turn guard, and between owners (ADR 0021).

The route runs over deferred-commit ports with a recording guard and a scripted
model. Admission follows the owner and runtime checks and precedes every write and
model call; a stop ends the turn at the next check; and every admitted turn
settles exactly once, after its tasks stopped, with how it ended.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator, MutableMapping
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.app.model_clients import ModelClientProviderError, StaticModelClientRegistry
from animama.app.services.chat_title_generation_service import ChatTitleGenerationSettings
from animama.app.services.model_role_resolver import ModelRoleDefaults
from animama.domain.chat import MessageRole
from animama.orm import ORMAnima, ORMChat, ORMChatMessage
from animama.product_http.chat.tts import anima_elevenlabs_voice
from animama.product_http.ports import ChatTurnStop, ProductRefusal
from animama.product_http.routes import chat_turns
from tests.product_http_support import (
    OWNER_HEADER,
    TEST_CHAT_POLICY,
    DeferredCommitPorts,
    TwoOwnerComposition,
    product_app,
)
from tests.test_chat_sse_golden import CHAT_ROW, ScriptedModel, remove_chat_owner, seed_chat_owner, structured

STOP = ChatTurnStop(code="credits_exhausted", message="Your credits ran out.")


def frames(stream: str) -> list[tuple[str, dict[str, Any]]]:
    """Each SSE frame's event name and data."""

    parsed = []
    for frame in stream.split("\n\n"):
        lines = dict(line.split(": ", 1) for line in frame.splitlines() if ": " in line)
        if "event" in lines:
            parsed.append((lines["event"], json.loads(lines["data"])))
    return parsed


@dataclass
class GuardedChat:
    """Two owners with one Anima each, served by the shared chat route over guarded ports."""

    factory: async_sessionmaker[AsyncSession]
    ports: DeferredCommitPorts
    composition: TwoOwnerComposition
    model: ScriptedModel
    animas: dict[str, str]
    revisions: dict[str, str]
    suffix: str

    @property
    def owner(self) -> str:
        return self.composition.owners[0]

    @property
    def other(self) -> str:
        return self.composition.owners[1]

    def chat_id(self, run: str) -> str:
        return f"chat-{run}-{self.suffix}"

    async def turn(
        self,
        run: str,
        *,
        owner: str | None = None,
        anima_id: str | None = None,
        chat_id: str | None = None,
        revision: str | None = None,
        **values: Any,
    ) -> httpx.Response:
        owner = owner or self.owner
        body = {
            "message": "Good morning!",
            "run_id": f"run-{run}",
            "chat_id": chat_id or self.chat_id(run),
            "runtime_revision": revision or self.revisions[owner],
            **values,
        }
        async with self.composition.client(owner) as client:
            return await client.post(f"/v1/animas/{anima_id or self.animas[owner]}/chat:sse", json=body)

    async def chat(self, run: str) -> ORMChat | None:
        async with self.factory() as session:
            return await session.get(ORMChat, self.chat_id(run))

    async def replies(self, run: str) -> int:
        """How many assistant replies the chat holds."""

        async with self.factory() as session:
            count = await session.scalar(
                select(func.count())
                .select_from(ORMChatMessage)
                .where(ORMChatMessage.chat_id == self.chat_id(run), ORMChatMessage.role == MessageRole.ASSISTANT.value)
            )
        return int(count or 0)


@pytest.fixture
async def guarded(
    async_session_factory: async_sessionmaker[AsyncSession], tmp_path: Path
) -> AsyncIterator[GuardedChat]:
    suffix = uuid4().hex[:8]
    owners = (f"guard-a-{suffix}", f"guard-b-{suffix}")
    model = ScriptedModel()
    ports = DeferredCommitPorts(
        async_session_factory,
        model_clients=StaticModelClientRegistry({"OpenAIResponsesHTTPAgent": model}),
        model_role_defaults=ModelRoleDefaults(chat=CHAT_ROW, utility=CHAT_ROW),
        # A first turn's title shows which optional work a stop after the reply skips.
        chat_policy=replace(TEST_CHAT_POLICY, title_generation=ChatTitleGenerationSettings(enabled=True)),
    )
    composition = TwoOwnerComposition(product_app(chat_turns.router, ports=ports), tmp_path, owners=owners)
    animas = {owner: f"guard-anima-{index}-{suffix}" for index, owner in enumerate(owners)}
    revisions = {owner: f"tr1-guard-{index}-{suffix}" for index, owner in enumerate(owners)}
    for owner in owners:
        await seed_chat_owner(async_session_factory, owner=owner, anima_id=animas[owner], revision=revisions[owner])
    try:
        yield GuardedChat(async_session_factory, ports, composition, model, animas, revisions, suffix)
    finally:
        for owner in owners:
            await remove_chat_owner(async_session_factory, owner=owner, anima_id=animas[owner])


async def test_a_refused_turn_writes_nothing_and_reaches_no_model(guarded: GuardedChat) -> None:
    guarded.ports.chat_guard.refusal = ProductRefusal(402, "credits_exhausted")

    response = await guarded.turn("refused")

    assert response.status_code == 402
    assert response.json() == {"detail": {"code": "credits_exhausted"}}
    assert guarded.ports.chat_guard.leases == []
    assert guarded.model.requests == []
    assert await guarded.chat("refused") is None
    assert guarded.ports.commits_requested == 0


async def test_an_admitted_turn_settles_once_as_completed(guarded: GuardedChat) -> None:
    guarded.model.replies.append(structured("Good morning! Shall we have tea?"))

    response = await guarded.turn("completed")

    assert response.status_code == 200
    [lease] = guarded.ports.chat_guard.leases
    assert lease.owner == guarded.owner
    assert lease.admission.anima_id == guarded.animas[guarded.owner]
    assert (lease.admission.chat_id, lease.admission.run_id) == (guarded.chat_id("completed"), "run-completed")
    assert lease.admission.request.message == "Good morning!"
    assert lease.settlements == ["completed"]
    assert lease.checks > 0
    names = [name for name, _data in frames(response.text)]
    assert "error" not in names
    assert names[-2:] == ["chat.title.updated", "run.completed"]
    # The setup session's new chat and the stream's own writes were committed by the composition.
    chat = await guarded.chat("completed")
    assert chat is not None and chat.user_id == guarded.owner and chat.title == "Morning Tea"
    assert await guarded.replies("completed") == 1
    assert set(guarded.ports.owners) == {guarded.owner}


async def test_a_stop_while_the_model_streams_ends_the_turn_unsaved(guarded: GuardedChat) -> None:
    guarded.model.hold = asyncio.Event()
    guarded.model.replies.append(structured("First sentence. Second sentence."))

    async def once_streaming() -> ChatTurnStop | None:
        return STOP if guarded.model.holding.is_set() else None

    guarded.ports.chat_guard.stop = once_streaming

    response = await guarded.turn("stopped")

    assert response.status_code == 200
    parsed = frames(response.text)
    assert ("error", {"run_id": "run-stopped", "error": STOP.message, "code": STOP.code}) in parsed
    assert parsed[-1][0] == "run.completed"
    assert guarded.model.cancelled
    [lease] = guarded.ports.chat_guard.leases
    assert lease.settlements == ["interrupted"]
    assert await guarded.replies("stopped") == 0


async def test_a_stop_after_the_reply_is_saved_keeps_it_and_skips_the_rest(guarded: GuardedChat) -> None:
    guarded.model.replies.append(structured("Good morning! Shall we have tea?"))

    async def once_saved() -> ChatTurnStop | None:
        return STOP if await guarded.replies("saved") else None

    guarded.ports.chat_guard.stop = once_saved

    response = await guarded.turn("saved")

    assert response.status_code == 200
    names = [name for name, _data in frames(response.text)]
    assert "error" not in names
    assert "chat.title.updated" not in names
    assert names[-1] == "run.completed"
    [lease] = guarded.ports.chat_guard.leases
    assert lease.settlements == ["completed"]
    assert await guarded.replies("saved") == 1
    chat = await guarded.chat("saved")
    assert chat is not None and chat.title is None


async def test_a_provider_failure_settles_failed_with_public_error_text(guarded: GuardedChat) -> None:
    guarded.model.replies.append(ModelClientProviderError("upstream said: key sk-live-123 rejected", code="bad key!"))

    response = await guarded.turn("failed")

    parsed = frames(response.text)
    errors = [data for name, data in parsed if name == "error"]
    # The policy's public text replaces provider detail, and an unsafe code becomes turn_failed.
    assert errors == [{"run_id": "run-failed", "error": TEST_CHAT_POLICY.public_error_text, "code": "turn_failed"}]
    assert "sk-live" not in response.text
    assert parsed[-1][0] == "run.completed"
    [lease] = guarded.ports.chat_guard.leases
    assert lease.settlements == ["failed"]


async def test_setup_failure_after_admission_settles_unstarted_and_rolls_back(guarded: GuardedChat) -> None:
    guarded.ports.model_clients = None

    response = await guarded.turn("unavailable")

    assert response.status_code == 503
    [lease] = guarded.ports.chat_guard.leases
    assert lease.settlements == ["unstarted"]
    assert guarded.model.requests == []
    assert await guarded.chat("unavailable") is None
    assert guarded.ports.commits == 0


async def test_a_disconnect_stops_the_turn_and_settles_once(guarded: GuardedChat) -> None:
    guarded.model.hold = asyncio.Event()
    guarded.model.replies.append(structured("First sentence. Second sentence."))
    disconnected = asyncio.Event()
    sent = False
    body = {
        "message": "Good morning!",
        "run_id": "run-gone",
        "chat_id": guarded.chat_id("gone"),
        "runtime_revision": guarded.revisions[guarded.owner],
    }

    async def receive() -> dict[str, Any]:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": json.dumps(body).encode(), "more_body": False}
        await disconnected.wait()
        return {"type": "http.disconnect"}

    async def send(message: MutableMapping[str, Any]) -> None:
        # Leave once the model is streaming.
        if message["type"] == "http.response.body" and guarded.model.holding.is_set():
            disconnected.set()

    path = f"/v1/animas/{guarded.animas[guarded.owner]}/chat:sse"
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "headers": [
            (b"host", b"test"),
            (b"content-type", b"application/json"),
            (OWNER_HEADER.lower().encode(), guarded.owner.encode()),
        ],
        "client": ("127.0.0.1", 50000),
        "server": ("test", 80),
    }
    await asyncio.wait_for(guarded.composition.app(scope, receive, send), timeout=10)

    [lease] = guarded.ports.chat_guard.leases
    assert lease.settlements == ["interrupted"]
    assert guarded.model.cancelled
    # The lease settled only after every turn task had stopped.
    assert not [task for task in asyncio.all_tasks() if not task.done() and task.get_name().startswith("direct-chat-")]
    assert await guarded.replies("gone") == 0


async def test_an_owner_never_chats_with_another_owners_anima_chat_or_revision(guarded: GuardedChat) -> None:
    guarded.model.replies.append(structured("Good morning!"))
    assert (await guarded.turn("owned")).status_code == 200
    owned = await guarded.chat("owned")
    assert owned is not None

    # The other owner cannot use the first owner's Anima, even with its revision.
    response = await guarded.turn(
        "foreign-anima",
        owner=guarded.other,
        anima_id=guarded.animas[guarded.owner],
        revision=guarded.revisions[guarded.owner],
    )
    assert (response.status_code, response.json()) == (404, {"detail": "Anima not found"})
    # Nor the first owner's mounted revision on its own Anima.
    response = await guarded.turn("foreign-revision", owner=guarded.other, revision=guarded.revisions[guarded.owner])
    assert (response.status_code, response.json()) == (409, {"detail": {"code": "runtime_remount_required"}})
    # Nor continue the first owner's chat from its own Anima.
    response = await guarded.turn("foreign-chat", owner=guarded.other, chat_id=guarded.chat_id("owned"))
    assert (response.status_code, response.json()) == (404, {"detail": "Chat not found"})

    # Only the last request reached admission; its setup failed, so it settled unstarted.
    assert [(lease.owner, lease.settlements) for lease in guarded.ports.chat_guard.leases] == [
        (guarded.owner, ["completed"]),
        (guarded.other, ["unstarted"]),
    ]
    assert len(guarded.model.requests) == 2  # the first owner's reply and its title
    after = await guarded.chat("owned")
    assert after is not None and (after.user_id, after.next_turn) == (guarded.owner, owned.next_turn)


async def test_an_anima_without_an_owner_is_not_found(guarded: GuardedChat) -> None:
    unowned = f"guard-unowned-{guarded.suffix}"
    async with guarded.factory() as session:
        session.add(ORMAnima(id=unowned, user_id=None))
        await session.commit()
    try:
        response = await guarded.turn("unowned", anima_id=unowned)
    finally:
        async with guarded.factory() as session:
            await session.execute(delete(ORMAnima).where(ORMAnima.id == unowned))
            await session.commit()

    assert (response.status_code, response.json()) == (404, {"detail": "Anima not found"})
    assert guarded.ports.chat_guard.leases == []


async def test_speech_resolves_only_the_callers_anima_voice(guarded: GuardedChat) -> None:
    guarded.model.replies.append(structured("Hello there. The kettle is on."))
    realtime = {"tts": {"enabled": True, "provider": "elevenlabs", "model_id": "eleven_flash_v2_5"}}

    response = await guarded.turn("speech", dispatch_options=realtime)

    assert "tts.session" in [name for name, _data in frames(response.text)]
    assert ("realtime_session", guarded.owner, "voice-mika") in guarded.ports.speech.calls
    unowned = f"guard-voice-unowned-{guarded.suffix}"
    async with guarded.factory() as session:
        session.add(ORMAnima(id=unowned, user_id=None))
        await session.flush()
        repositories = SQLAlchemyProductRepositories(session)
        # Another owner's Anima, or one without an owner, has no voice for the caller.
        for user_id, anima_id in ((guarded.other, guarded.animas[guarded.owner]), (guarded.owner, unowned)):
            with pytest.raises(HTTPException) as raised:
                await anima_elevenlabs_voice(repositories, user_id=user_id, anima_id=anima_id)
            assert raised.value.status_code == 404
        await session.rollback()
