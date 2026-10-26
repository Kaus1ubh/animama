"""Memory chats in the three episodic-memory arms, what each arm saved, and the recall chats (spec R5, R6).

Each memory chat runs for every configuration in every arm, on a store of its
own: a fresh owner and Anima in the benchmark database (``memory_db``),
seeded from the chat's fixture. Turns go through chat's turn executor composed
as ``chat:sse`` composes it (``product_http/chat/turn_setup.py``): the real
chat manager and turn recorder, the memory context, the memory tools and the
episode recorder, over the production repositories
(``SQLAlchemyProductRepositories``). Only the model catalog and the Anima chat
profile are stand-ins, since each turn names its configuration's row. After
the chat, the runner snapshots everything the arm saved; a fresh recall chat
on the same store then asks the chat's recall probes.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from contextlib import AbstractAsyncContextManager
from dataclasses import dataclass, field, replace
from typing import Any, cast

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from animama.adapters.repositories.sqlalchemy.product_repositories import SQLAlchemyProductRepositories
from animama.app.chat import DirectChatMemoryContextService, DirectChatTurnExecutor, RuntimeGestureDescriptor
from animama.app.chat.memory_arm import EpisodicMemoryArm
from animama.app.main_structured_response import recover_main_structured_response
from animama.app.model_clients import StaticModelClientRegistry
from animama.app.ports import ModelProviderRepository
from animama.app.services import AnimaChatProfileService
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.domain.anima_definition import (
    ANIMA_IDENTITY_KIND,
    ANIMA_IDENTITY_PATH,
    ANIMA_MEMORIES_KIND,
    ANIMA_MEMORIES_PATH,
)
from animama.domain.events import EventType
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE
from animama.domain.memory_episode import MEMORY_EPISODE_LOG_ENTRY_KIND
from animama.orm import ORMChatMessage, ORMMemoryEntry
from animama.orm.anima import ORMAnima
from animama.orm.memory_episode import ORMMemoryEpisodeItem
from animama.product_http.chat.session_services import (
    SessionBackedChatTurnRecorder,
    SessionBackedMemoryEpisodeRecorder,
    SessionBackedMemoryToolService,
)
from animama.product_http.chat.setup_helpers import chat_manager
from animama.server.config import Settings

from ..core.chat import NoAnimaProfile, SelectedModelProvider, turn_request
from ..core.model_calls import BudgetedModelClient, Clock
from ..core.turns import TurnOutcome, execute_turn
from .configs import Configuration
from .options import PROVIDER_MODERATION, memory_turn_options
from .prompt_set import MemoryChat, MemoryFixture, Persona, PromptSet

__all__ = [
    "ARM_BOTH",
    "ARM_MEMORIES_MD_ONLY",
    "ARM_REMEMBER_ONLY",
    "BenchmarkSessions",
    "MemoryContestant",
    "MemoryTurn",
    "Store",
    "memory_arms",
    "memory_cue",
    "run_memory_chats",
    "seed_store",
    "snapshot_store",
    "store_for",
]

ARM_REMEMBER_ONLY = "remember_only"
ARM_MEMORIES_MD_ONLY = "memories_md_only"
ARM_BOTH = "both"


def memory_arms(episodic_guidance: str) -> dict[str, EpisodicMemoryArm]:
    """The three arms of spec R6, in run order: (a) `remember` only, (b) MEMORIES.md only, (c) both (chat's own)."""

    return {
        ARM_REMEMBER_ONLY: EpisodicMemoryArm(anima_memories_writes=False),
        ARM_MEMORIES_MD_ONLY: EpisodicMemoryArm(remember=False, anima_memories_write_guidance=episodic_guidance),
        ARM_BOTH: EpisodicMemoryArm(),
    }


class BenchmarkSessions:
    """``TurnSessions`` over the benchmark database: the short-lived sessions chat's turn collaborators open."""

    def __init__(self, factory: async_sessionmaker[AsyncSession]) -> None:
        self._factory = factory

    def read(self) -> AbstractAsyncContextManager[AsyncSession]:
        return self._factory()

    write = read

    def repositories(self, session: AsyncSession) -> SQLAlchemyProductRepositories:
        return SQLAlchemyProductRepositories(session)


@dataclass(frozen=True, slots=True)
class Store:
    """One configuration's memory in one arm for one chat: its own owner and Anima."""

    user_id: str
    anima_id: str


def store_for(configuration: Configuration, arm: str, unit_id: str) -> Store:
    digest = hashlib.sha256(f"{configuration.label}/{arm}/{unit_id}".encode()).hexdigest()[:16]
    return Store(user_id=f"model-benchmark-{digest}", anima_id=f"model-benchmark-anima-{digest}")


async def seed_store(sessions: BenchmarkSessions, store: Store, persona: Persona, fixture: MemoryFixture) -> None:
    """Create the store's Anima with the persona's identity, its MEMORIES.md and the owner's shared files."""

    async with sessions.write() as session:
        session.add(
            ORMAnima(id=store.anima_id, display_name=persona.name, user_id=store.user_id, identity_status="ready")
        )
        await session.commit()
        repositories = sessions.repositories(session)
        entries = MemoryEntryService(
            memory_entries=repositories.memory_entries, uow=repositories.unit_of_work, animas=repositories.animas
        )
        await entries.put_file_by_path(
            user_id=store.user_id,
            anima_id=store.anima_id,
            path=ANIMA_IDENTITY_PATH,
            content=persona.identity,
            kind=ANIMA_IDENTITY_KIND,
            expected_version=0,
            expected_aggregate_revision=1,
        )
        await entries.put_file_by_path(
            user_id=store.user_id,
            anima_id=store.anima_id,
            path=ANIMA_MEMORIES_PATH,
            content=fixture.anima_memories,
            kind=ANIMA_MEMORIES_KIND,
            expected_version=0,
        )
        for memory_file in fixture.user_files:
            await entries.put_file_by_path(
                user_id=store.user_id,
                path=memory_file.path,
                content=memory_file.content,
                description=memory_file.description,
                expected_version=0,
                create_parents=True,
            )


async def snapshot_store(sessions: BenchmarkSessions, store: Store) -> dict[str, Any]:
    """Everything the store holds now: memory files (identity and episode logs left out) and episode items."""

    async with sessions.read() as session:
        files = (
            await session.execute(
                select(ORMMemoryEntry)
                .where(
                    ORMMemoryEntry.user_id == store.user_id,
                    ORMMemoryEntry.type == MEMORY_ENTRY_TYPE_FILE,
                    ORMMemoryEntry.deleted_at.is_(None),
                )
                .order_by(ORMMemoryEntry.anima_id.nulls_first(), ORMMemoryEntry.path)
            )
        ).scalars()
        episodes = (
            await session.execute(
                select(ORMMemoryEpisodeItem)
                .where(ORMMemoryEpisodeItem.user_id == store.user_id)
                .order_by(ORMMemoryEpisodeItem.occurred_at, ORMMemoryEpisodeItem.id)
            )
        ).scalars()
        return {
            "files": [
                {
                    "path": entry.path,
                    "anima": entry.anima_id is not None,
                    "kind": entry.kind,
                    "version": entry.version,
                    "description": entry.description,
                    "content": entry.content,
                }
                for entry in files
                if entry.kind not in {ANIMA_IDENTITY_KIND, MEMORY_EPISODE_LOG_ENTRY_KIND}
            ],
            "episodes": [{"text": item.text, "status": item.status} for item in episodes],
        }


async def _persisted_turn(
    sessions: BenchmarkSessions, result: TurnOutcome
) -> tuple[TurnOutcome, list[dict[str, Any]] | None]:
    """The turn as chat persisted it: its reply and recovery, and every tool call with its outcome.

    Chat records a memory turn's tool rounds, including the calls it rejected
    (an unknown tool, invalid arguments, the round limit), and how it recovered
    the reply, so these are read back rather than rebuilt from the model calls.
    A failed turn persists nothing: it is returned unchanged, and its tool
    calls are unknown (``None``), though tools that ran may have changed memory.
    """

    request = result.prepared.request
    async with sessions.read() as session:
        found = await session.execute(
            select(ORMChatMessage)
            .where(ORMChatMessage.chat_id == request.chat_id, ORMChatMessage.run_id == request.run_id)
            .order_by(ORMChatMessage.id)
        )
        rows = list(found.scalars())
    arguments: dict[str, Any] = {}
    tool_calls: list[dict[str, Any]] = []
    for row in rows:
        data = row.message_data or {}
        if row.message_type == "tool_call":
            for call in data.get("memory_tools", {}).get("tool_calls", []):
                arguments[call["id"]] = call.get("arguments")
        elif row.message_type == "tool_result":
            outcome = data.get("memory_tool_result", {})
            tool_calls.append(_tool_call(outcome, arguments.get(outcome.get("tool_call_id")), row.content or ""))
    reply_row = next((row for row in rows if row.role == "assistant" and not row.internal), None)
    if reply_row is None:
        return result, None
    reply = recover_main_structured_response(reply_row.content or "", result.prepared.output_type)
    recovery = (reply_row.message_data or {}).get("structured_recovery")
    return replace(result, reply=reply, recovery=recovery), tool_calls


def _tool_call(outcome: Mapping[str, Any], arguments: Any, output: str) -> dict[str, Any]:
    try:
        payload = json.loads(output)
    except ValueError:
        payload = {}
    code = payload.get("code") if isinstance(payload, Mapping) else None
    path = arguments.get("path", arguments.get("paths")) if isinstance(arguments, Mapping) else None
    return {"tool": outcome.get("tool_name"), "path": path, "ok": outcome.get("status") == "completed", "code": code}


@dataclass(slots=True)
class MemoryContestant:
    """One configuration and its budgeted client, shared with its core turns and their budget."""

    configuration: Configuration
    client: BudgetedModelClient


@dataclass(slots=True)
class MemoryTurn:
    """One memory-chat or recall turn to send, with what the record needs about it."""

    kind: str
    unit_id: str
    language: str
    persona: Persona
    message: str
    turn: int
    probe_id: str | None = None
    expect: tuple[str, ...] = ()
    pair_id: str | None = None
    held_out: bool = False
    extra: dict[str, Any] = field(default_factory=dict)


async def _memory_turn(
    contestant: MemoryContestant,
    arm: EpisodicMemoryArm,
    store: Store,
    unit: MemoryTurn,
    *,
    chat_id: str,
    gestures: Sequence[RuntimeGestureDescriptor],
    sessions: BenchmarkSessions,
    clock: Clock,
    settings: Settings,
) -> tuple[TurnOutcome, list[dict[str, Any]] | None]:
    configuration = contestant.configuration
    row = configuration.model_provider
    language = memory_turn_options(unit.language, configuration.effort)
    async with sessions.read() as session:
        repositories = sessions.repositories(session)
        executor = DirectChatTurnExecutor(
            registry=StaticModelClientRegistry({row.provider_type: contestant.client}),
            profile_service=cast(AnimaChatProfileService, NoAnimaProfile()),
            model_providers=cast(ModelProviderRepository, SelectedModelProvider(row)),
            chat_manager=chat_manager(repositories),
            turn_recorder=SessionBackedChatTurnRecorder(sessions),  # type: ignore[arg-type]
            memory_episode_recorder=SessionBackedMemoryEpisodeRecorder(sessions),  # type: ignore[arg-type]
            memory_context_service=DirectChatMemoryContextService(
                memory_entries=MemoryEntryService(
                    memory_entries=repositories.memory_entries,
                    uow=repositories.unit_of_work,
                    animas=repositories.animas,
                    commit_on_write=False,
                ),
                animas=repositories.animas,
            ),
            memory_tool_service=SessionBackedMemoryToolService(
                sessions,  # type: ignore[arg-type]
                max_file_bytes=settings.anima_memory_file_max_bytes,
            ),
            episodic_memory_arm=arm,
        )
        request = turn_request(
            gestures,
            anima_id=store.anima_id,
            user_id=store.user_id,
            chat_id=chat_id,
            turn_index=unit.turn,
            message=unit.message,
            model_provider_id=row.id,
            options=language.options,
            conversation_language=language.conversation_language,
            provider_moderation=PROVIDER_MODERATION,
        )
        # As in chat:sse, the setup session closes once the turn is prepared; the stream opens its own sessions.
        result = await execute_turn(
            executor,
            request,
            budget=contestant.client,
            chats=None,
            clock=clock,
            on_prepared=lambda _prepared: session.close(),
        )
    return await _persisted_turn(sessions, result)


MemoryTurnSink = Callable[[MemoryContestant, str, MemoryTurn, TurnOutcome, list[dict[str, Any]] | None], None]
"""Records one finished memory or recall turn; the run loop builds the JSON line."""
CaptureSink = Callable[[MemoryContestant, str, MemoryChat, dict[str, Any]], None]


async def run_memory_chats(
    prompt_set: PromptSet,
    contestants: Sequence[MemoryContestant],
    *,
    sessions: BenchmarkSessions,
    clock: Clock,
    on_turn: MemoryTurnSink,
    on_capture: CaptureSink,
    settings: Settings | None = None,
) -> bool:
    """Run every memory chat in every arm for every configuration; return ``False`` once the budget refused a call.

    Within a chat and arm, the configurations take each turn in turn, as in the
    scripted chats; each one's store is seeded before its first turn.
    """

    assert prompt_set.episodic_guidance is not None, "the prompt set loader requires guidance with memory chats"
    runtime_settings = settings or Settings()
    arms = memory_arms(prompt_set.episodic_guidance)
    for chat in prompt_set.memory_chats:
        persona = prompt_set.persona(chat.persona)
        fixture = prompt_set.fixture(chat.fixture)
        for arm_label, arm in arms.items():
            stores = {c.configuration.label: store_for(c.configuration, arm_label, chat.id) for c in contestants}
            for contestant in contestants:
                await seed_store(sessions, stores[contestant.configuration.label], persona, fixture)
            phases: list[list[MemoryTurn]] = [
                [
                    MemoryTurn(
                        kind="memory",
                        unit_id=chat.id,
                        language=chat.language,
                        persona=persona,
                        message=message,
                        turn=index,
                        pair_id=chat.pair_id,
                        held_out=chat.held_out,
                    )
                    for index, message in enumerate(chat.turns, start=1)
                ],
                [
                    MemoryTurn(
                        kind="recall",
                        unit_id=chat.id,
                        language=chat.language,
                        persona=persona,
                        message=probe.message,
                        turn=index,
                        probe_id=probe.id,
                        expect=probe.expect,
                        pair_id=chat.pair_id,
                        held_out=chat.held_out,
                        extra={"checklist": list(probe.checklist)},
                    )
                    for index, probe in enumerate(chat.recall, start=1)
                ],
            ]
            for phase_index, phase in enumerate(phases):
                for unit in phase:
                    for contestant in contestants:
                        label = contestant.configuration.label
                        result, calls = await _memory_turn(
                            contestant,
                            arm,
                            stores[label],
                            unit,
                            chat_id=f"{label}/{arm_label}/{chat.id}/{unit.kind}",
                            gestures=prompt_set.loadout.gestures,
                            sessions=sessions,
                            clock=clock,
                            settings=runtime_settings,
                        )
                        if result.refused:
                            return False
                        on_turn(contestant, arm_label, unit, result, calls)
                if phase_index == 0:
                    # What the arm saved, before the recall chat can add anything.
                    for contestant in contestants:
                        snapshot = await snapshot_store(sessions, stores[contestant.configuration.label])
                        on_capture(contestant, arm_label, chat, snapshot)
    return True


def memory_cue(result: TurnOutcome) -> dict[str, Any] | None:
    """The turn's memory cue as chat sent it to the client, or ``None`` when it remembered nothing."""

    for event in result.events:
        if event.type is EventType.MEMORY_UPDATED:
            cue = getattr(event.payload, "memory_cue", None)
            return dict(cue) if isinstance(cue, Mapping) else None
    return None
