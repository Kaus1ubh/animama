"""Chat turns over a real database with a scripted model (shared-routes ExecPlan, Phase 5).

``seed_chat_owner`` gives an owner an Anima ready to chat, and ``ScriptedModel``
answers its turns, titles and compaction prompts. The golden transcripts and the
chat-turn guard tests share them.
"""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.contracts.memory_entry import PyMemoryEntryCreateRequest
from animama.app.model_clients import ModelClientDelta, ModelClientFinal, ModelClientModeration, ModelClientRequest
from animama.app.services.model_provider_catalog_service import ModelProviderCatalogService
from animama.domain.request_principal import RequestPrincipal
from animama.domain.usage import Usage
from animama.orm import ORMAnima, ORMAnimaChatProfile
from animama.orm.anima_loadout import ORMAnimaRuntimeSnapshot
from animama.orm.settings import ORMAnimaSettings
from animama.product_http.routes import memory as memory_routes
from tests.product_http_support import TEST_POLICY

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
    holding: asyncio.Event = field(default_factory=asyncio.Event)
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
                self.holding.set()
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


async def seed_chat_owner(
    factory: async_sessionmaker[AsyncSession], *, owner: str, anima_id: str, revision: str = REVISION
) -> None:
    """An owner's Anima ready to chat: its mood, memory files, chat model, voice and mounted ``revision``."""

    async with factory() as session:
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
                effective_revision=revision,
                catalog_digest="0" * 64,
                catalog={"gestures": [{"semantic_key": "wave", "name": "Wave", "description": "A friendly wave"}]},
                expires_at=datetime.now(UTC) + timedelta(hours=1),
            )
        )
        await session.commit()


async def remove_chat_owner(factory: async_sessionmaker[AsyncSession], *, owner: str, anima_id: str) -> None:
    async with factory() as session:
        await session.execute(delete(ORMAnima).where(ORMAnima.id == anima_id))
        await session.execute(delete(ORMAnimaSettings).where(ORMAnimaSettings.user_id == owner))
        await session.commit()
