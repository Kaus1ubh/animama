"""Golden SSE transcripts of local chat turns (shared-routes ExecPlan, Phase 5).

Each scenario runs real ``POST /v1/animas/{anima_id}/chat:sse`` turns through the
local application and a real database. Only the provider boundary is scripted: the
model-client registry, the ElevenLabs client and the emotion tie-break. The
normalized stream must equal its recorded transcript byte for byte, so moving the
chat code into the shared package cannot change what clients receive. Set
``CHAT_SSE_GOLDEN_RECORD=1`` to record the transcripts again after an intended
change, and review the diff.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
from collections.abc import AsyncIterator, Callable, MutableMapping
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.contracts.memory_entry import PyMemoryEntryCreateRequest
from animama.app.model_clients import (
    ModelClientDelta,
    ModelClientFinal,
    ModelClientModeration,
    ModelClientProviderError,
    ModelClientRequest,
    StaticModelClientRegistry,
)
from animama.app.services.model_provider_catalog_service import ModelProviderCatalogService
from animama.domain.emotions import normalize_emotional_state
from animama.domain.request_principal import RequestPrincipal
from animama.domain.usage import Usage
from animama.orm import ORMAnima, ORMAnimaChatProfile, ORMChat
from animama.orm.anima_loadout import ORMAnimaRuntimeSnapshot
from animama.orm.settings import ORMAnimaSettings
from animama.product_http.ports import install_product_ports
from animama.product_http.routes import memory as memory_routes
from animama.server import elevenlabs_service
from animama.server.config import settings
from animama.server.deps import get_current_principal
from animama.server.product_ports import LocalProductPorts
from animama.server.routers import router as api_router
from tests.product_http_support import TEST_POLICY

GOLDEN = Path(__file__).parent / "fixtures" / "chat_sse_golden"
RECORD = os.environ.get("CHAT_SSE_GOLDEN_RECORD") == "1"
CHAT_ROW = "OpenAIResponsesHTTPAgent:gpt-6-luna"
REVISION = "tr1-golden"
# A stored mood away from neutral: the turn's emotion update starts from it.
STORED_MOOD = {"joy": 12, "curiosity": 8, "caring": 6, "sadness": 2}


def structured(
    speech: str,
    *,
    tone: str = "joy",
    intensity: int = 2,
    gesture: str = "",
    remember: str | None = None,
) -> str:
    return json.dumps(
        {
            "emotional_tone": tone,
            "emotional_intensity": intensity,
            "gesture": gesture,
            "speech": speech,
            "display": None,
            "remember": remember,
        },
        ensure_ascii=True,
        separators=(",", ":"),
    )


@dataclass
class ScriptedModel:
    """Answers chat turns from a script, and title and compaction prompts with fixed text."""

    replies: list[str | Exception] = field(default_factory=list)
    moderation: ModelClientModeration | None = None
    # When set, a chat turn streams its first part and then waits for this event.
    hold: asyncio.Event | None = None
    cancelled: bool = False
    requests: list[ModelClientRequest] = field(default_factory=list)

    async def stream(self, request: ModelClientRequest) -> AsyncIterator[ModelClientDelta]:
        self.requests.append(request)
        task = request.prompt.metadata.get("task")
        if task == "chat-title":
            text = "Morning Tea"
        elif task == "chat-compaction":
            text = "Summary: the owner and Mika talked about tea."
        else:
            reply = self.replies.pop(0)
            if isinstance(reply, Exception):
                raise reply
            text = reply
            if self.hold is not None:
                # Stream the first sentence and part of the next, then wait.
                cut = text.index("S", text.index(". ")) + 1
                yield ModelClientDelta(kind="text_delta", text=text[:cut])
                try:
                    await self.hold.wait()
                except asyncio.CancelledError:
                    self.cancelled = True
                    raise
                text = text[cut:]
        yield ModelClientDelta(kind="text_delta", text=text)
        yield ModelClientDelta(
            kind="final",
            final=ModelClientFinal(
                text=text,
                usage=Usage(input_tokens=11, output_tokens=7, total_tokens=18),
                input_moderation=self.moderation if task is None else None,
            ),
        )
        yield ModelClientDelta(kind="done")

    async def aclose(self) -> None:
        return None


class FakeElevenLabs:
    """The ElevenLabs SDK surface chat TTS uses: voice lookup, socket tokens and streamed PCM."""

    def __init__(self) -> None:
        self.voices = SimpleNamespace(get=lambda voice_id: SimpleNamespace(voice_id=voice_id, labels={}))
        self.tokens = SimpleNamespace(single_use=SimpleNamespace(create=lambda **_: SimpleNamespace(token="tts-token")))
        self.text_to_speech = SimpleNamespace(stream=self._stream)
        self.spoken: list[str] = []

    def _stream(self, voice_id: str, **kwargs: Any) -> Any:
        self.spoken.append(kwargs["text"])
        return iter([b"\x01\x00" * 4800, b"\x02\x00" * 100])


def normalize(stream: str, *names: str) -> str:
    """Replace the only values that differ between runs: test IDs, random suffixes and row IDs.

    Speech frames come from separate tasks, so where they fall among the reply's
    frames depends on timing (``tts.session`` may even precede the text). They keep
    their own order and move to just before the final ``run.completed``.
    """

    for index, value in enumerate(names):
        stream = stream.replace(value, f"<name-{index}>")
    stream = re.sub(r"(run-status-[A-Za-z0-9_.:<>-]*?-)[0-9a-f]{8}\b", r"\1<hex>", stream)
    stream = re.sub(r'"message_id": \d+', '"message_id": "<id>"', stream)
    frames = [frame for frame in stream.split("\n\n") if frame]
    speech = [frame for frame in frames if "\nevent: tts." in f"\n{frame}"]
    others = [frame for frame in frames if "\nevent: tts." not in f"\n{frame}"]
    if others and "\nevent: run.completed\n" in f"\n{others[-1]}\n":
        frames = [*others[:-1], *speech, others[-1]]
    else:
        frames = [*others, *speech]
    return "".join(f"{frame}\n\n" for frame in frames)


def assert_golden(name: str, stream: str, world: ChatWorld) -> None:
    path = GOLDEN / f"{name}.sse"
    normalized = normalize(stream, world.anima_id, world.owner)
    if RECORD:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(normalized)
        return
    assert path.is_file(), f"record {path.name} with CHAT_SSE_GOLDEN_RECORD=1"
    assert normalized == path.read_text()


@dataclass
class ChatWorld:
    """One owner with one Anima on a local app whose provider boundary is scripted."""

    app: FastAPI
    factory: async_sessionmaker[AsyncSession]
    model: ScriptedModel
    owner: str
    anima_id: str
    elevenlabs: FakeElevenLabs

    def client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(transport=httpx.ASGITransport(app=self.app), base_url="http://test")

    def body(self, run: str, message: str = "Good morning!", **values: Any) -> dict[str, Any]:
        return {
            "message": message,
            "run_id": f"run-{run}",
            "chat_id": f"chat-{run}-{self.anima_id}",
            "runtime_revision": REVISION,
            **values,
        }

    async def turn(self, run: str, message: str = "Good morning!", **values: Any) -> str:
        async with self.client() as client:
            response = await client.post(f"/v1/animas/{self.anima_id}/chat:sse", json=self.body(run, message, **values))
        assert response.status_code == 200, response.text
        return response.text


@pytest.fixture
async def world(
    async_session_factory: async_sessionmaker[AsyncSession],
    monkeypatch: pytest.MonkeyPatch,
    set_runtime_credentials: Callable[..., None],
) -> AsyncIterator[ChatWorld]:
    owner = f"golden-owner-{uuid4().hex[:8]}"
    anima_id = f"golden-anima-{uuid4().hex[:8]}"
    async with async_session_factory() as session:
        await ModelProviderCatalogService(
            model_providers=SQLAlchemyModelProviderRepository(session), uow=SQLAlchemyUnitOfWork(session)
        ).sync_from_registry()
        session.add(ORMAnima(id=anima_id, user_id=owner, display_name="Mika", emotional_state=dict(STORED_MOOD)))
        await session.flush()
        repositories = SQLAlchemyProductRepositories(session)
        await memory_routes.create_memory_entry(
            PyMemoryEntryCreateRequest(
                anima_id=anima_id,
                expected_aggregate_revision=1,
                type="file",
                name="IDENTITY.md",
                content="# Mika\n\nWarm and curious; loves tea.\n",
                description="Who Mika is",
            ),
            repositories=repositories,
            policy=TEST_POLICY,
            user=RequestPrincipal(id=owner),
        )
        await memory_routes.repair_anima_memories(
            anima_id, repositories=repositories, policy=TEST_POLICY, user=RequestPrincipal(id=owner)
        )
        session.add(ORMAnimaChatProfile(anima_id=anima_id, default_model_provider_id=CHAT_ROW))
        session.add(
            ORMAnimaSettings(
                user_id=owner,
                anima_id=anima_id,
                preferences={"speech": {"elevenlabs": {"primary_voice": {"voice_id": "voice-mika"}}}},
            )
        )
        session.add(
            ORMAnimaRuntimeSnapshot(
                id=f"snapshot-{uuid4().hex}",
                owner_user_id=owner,
                anima_id=anima_id,
                loadout_revision=1,
                effective_revision=REVISION,
                catalog_digest="0" * 64,
                catalog={"gestures": [{"semantic_key": "wave", "name": "Wave", "description": "A friendly wave"}]},
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        await session.commit()

    model = ScriptedModel()
    app = FastAPI()
    app.include_router(api_router)
    app.state.session_factory = async_session_factory
    # The process settings, so code reading either the app's or the global settings agrees.
    app.state.runtime_settings = settings
    app.state.model_client_registry = StaticModelClientRegistry({"OpenAIResponsesHTTPAgent": model})
    install_product_ports(app, LocalProductPorts(app))

    async def principal() -> RequestPrincipal:
        return RequestPrincipal(id=owner)

    app.dependency_overrides[get_current_principal] = principal
    fake = FakeElevenLabs()
    set_runtime_credentials(ELEVENLABS_API_KEY="golden-key")
    monkeypatch.setattr(elevenlabs_service, "get_elevenlabs_client", lambda: fake)
    elevenlabs_service.clear_elevenlabs_voice_access_cache()
    # The emotion tie-break is random; the first candidate keeps transcripts stable.
    monkeypatch.setattr("animama.app.primary_emotion_update.random.choice", lambda values: values[0])
    try:
        yield ChatWorld(app, async_session_factory, model, owner, anima_id, fake)
    finally:
        async with async_session_factory() as session:
            await session.execute(delete(ORMAnima).where(ORMAnima.id == anima_id))
            await session.execute(delete(ORMAnimaSettings).where(ORMAnimaSettings.user_id == owner))
            await session.commit()


async def test_reply_with_emotion_gesture_memory_title_and_notice(world: ChatWorld) -> None:
    world.model.replies.append(
        structured("Good morning! Shall we have tea?", gesture="wave", remember="The owner starts the day with tea.")
    )
    assert_golden("reply", await world.turn("reply"), world)


ELEVENLABS_REALTIME = {"tts": {"enabled": True, "provider": "elevenlabs", "model_id": "eleven_flash_v2_5"}}
ELEVENLABS_FINALIZED = {"tts": {"enabled": True, "provider": "elevenlabs", "model_id": "eleven_v3"}}


async def test_realtime_speech_sends_a_session_and_phoneme_payloads(world: ChatWorld) -> None:
    world.model.replies.append(structured("Hello there. The kettle is on.", tone="joy"))
    assert_golden("tts-realtime", await world.turn("tts-realtime", dispatch_options=ELEVENLABS_REALTIME), world)


async def test_finalized_speech_streams_audio_with_the_stored_mood(world: ChatWorld) -> None:
    world.model.replies.append(structured("Hello there. The kettle is on.", tone="joy", intensity=3))
    assert_golden("tts-finalized", await world.turn("tts-finalized", dispatch_options=ELEVENLABS_FINALIZED), world)
    # The provider spoke the prepared text, with the emotional prefix eleven_v3 takes.
    assert world.elevenlabs.spoken


async def test_flagged_moderation_adds_the_crisis_card(world: ChatWorld) -> None:
    world.model.moderation = ModelClientModeration(status="result", flagged_categories=("self-harm/intent",))
    world.model.replies.append(structured("I am here with you. You are not alone.", tone="sadness"))
    assert_golden("crisis", await world.turn("crisis", message="I feel hopeless today"), world)


async def test_a_provider_failure_ends_the_turn_with_an_error_frame(world: ChatWorld) -> None:
    world.model.replies.append(ModelClientProviderError("Fixture provider unavailable", code="fixture_provider_failed"))
    assert_golden("provider-error", await world.turn("provider-error"), world)


async def test_a_second_turn_in_the_chat_skips_the_notice_and_title(world: ChatWorld) -> None:
    world.model.replies.extend([structured("Good morning!"), structured("Of course. Green or black?", tone="surprise")])
    await world.turn("follow-up")
    assert_golden("follow-up", await world.turn("follow-up", message="Tea, please."), world)
    async with world.factory() as session:
        chat = (await session.execute(select(ORMChat).where(ORMChat.anima_id == world.anima_id))).scalar_one()
        mood = select(ORMAnima.emotional_state).where(ORMAnima.id == world.anima_id)
        stored = (await session.execute(mood)).scalar_one()
    # Both turns were recorded in one titled chat, and the mood moved from the stored one.
    assert (chat.title, chat.next_turn) == ("Morning Tea", 5)
    assert stored != normalize_emotional_state(STORED_MOOD)


async def test_a_client_disconnect_stops_every_turn_task(world: ChatWorld) -> None:
    world.model.hold = asyncio.Event()
    world.model.replies.append(structured("First sentence. Second sentence."))
    received: list[bytes] = []
    disconnected = asyncio.Event()
    sent = False

    async def receive() -> dict[str, Any]:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": json.dumps(world.body("disconnect")).encode(), "more_body": False}
        await disconnected.wait()
        return {"type": "http.disconnect"}

    async def send(message: MutableMapping[str, Any]) -> None:
        if message["type"] == "http.response.body" and message.get("body"):
            received.append(message["body"])
            # Leave once the first sentence has arrived.
            if b"user.response" in message["body"]:
                disconnected.set()

    path = f"/v1/animas/{world.anima_id}/chat:sse"
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
        "headers": [(b"host", b"test"), (b"content-type", b"application/json")],
        "client": ("127.0.0.1", 50000),
        "server": ("test", 80),
    }
    await asyncio.wait_for(world.app(scope, receive, send), timeout=10)

    assert_golden("disconnect", b"".join(received).decode(), world)
    assert world.model.cancelled
    await asyncio.sleep(0)
    assert not [
        task for task in asyncio.all_tasks() if not task.done() and task.get_name().startswith("direct-chat-")
    ], "chat tasks outlived the request"
