from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

import pytest
import pytest_asyncio
from sqlalchemy import delete, select

from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.memory_episode_repo import SQLAlchemyMemoryEpisodeRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.app.services.memory_entry_service import MemoryEntryNotFoundError, MemoryEntryService
from animama.app.services.memory_episode_service import (
    MemoryEpisodeConflictError,
    MemoryEpisodeService,
    MemoryEpisodeValidationError,
    render_daily_episode_file,
)
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_DIRECTORY
from animama.domain.memory_episode import (
    MEMORY_EPISODE_LOG_ENTRY_KIND,
    MEMORY_EPISODE_STATUS_PENDING,
    MEMORY_EPISODE_STATUS_PROCESSED,
    MemoryEpisodeItem,
    episode_path_for_date,
)
from animama.orm import Base, ORMMemoryEntry, ORMMemoryEntryVersion, ORMMemoryEpisodeItem, ORMUserSettings
from animama.server.routers.chat.session_services import SessionBackedMemoryEpisodeRecorder


@pytest_asyncio.fixture
async def clean_memory_episode_rows(async_session):
    await async_session.execute(delete(ORMMemoryEpisodeItem))
    await async_session.execute(delete(ORMMemoryEntryVersion))
    await async_session.execute(delete(ORMMemoryEntry))
    await async_session.commit()
    yield
    await async_session.execute(delete(ORMMemoryEpisodeItem))
    await async_session.execute(delete(ORMMemoryEntryVersion))
    await async_session.execute(delete(ORMMemoryEntry))
    await async_session.commit()


def _memory_entry_service(async_session) -> MemoryEntryService:  # noqa: ANN001
    return MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
    )


def _episode_service(async_session) -> MemoryEpisodeService:  # noqa: ANN001
    return MemoryEpisodeService(
        memory_episodes=SQLAlchemyMemoryEpisodeRepository(async_session),
        memory_entries=_memory_entry_service(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
    )


def _occurred(hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 1, 1, hour, minute, tzinfo=timezone.utc)


def test_episode_path_generation_and_orm_metadata() -> None:
    assert episode_path_for_date(date(2026, 1, 1)) == "episodes/2026/01/2026-01-01.md"
    with pytest.raises(ValueError):
        episode_path_for_date(datetime(2026, 1, 1, tzinfo=timezone.utc))
    assert "memory_episode_items" in Base.metadata.tables
    table = Base.metadata.tables["memory_episode_items"]
    assert {"id", "user_id", "local_date", "episode_path", "text", "status"}.issubset(table.c.keys())


def test_daily_episode_rendering_checks_processed_items_only() -> None:
    items = [
        MemoryEpisodeItem(
            id="mei-processed",
            user_id="user-1",
            source_anima_id=None,
            source_chat_id=None,
            source_run_id=None,
            source_message_id=None,
            occurred_at=_occurred(12),
            local_date=date(2026, 1, 1),
            local_timezone="UTC",
            episode_path=episode_path_for_date(date(2026, 1, 1)),
            kind="chat_turn",
            text="Already integrated.",
            status=MEMORY_EPISODE_STATUS_PROCESSED,
        ),
        MemoryEpisodeItem(
            id="mei-pending",
            user_id="user-1",
            source_anima_id=None,
            source_chat_id=None,
            source_run_id=None,
            source_message_id=None,
            occurred_at=_occurred(11),
            local_date=date(2026, 1, 1),
            local_timezone="UTC",
            episode_path=episode_path_for_date(date(2026, 1, 1)),
            kind="chat_turn",
            text="Still pending.",
            status=MEMORY_EPISODE_STATUS_PENDING,
        ),
    ]

    assert render_daily_episode_file(local_date=date(2026, 1, 1), items=items) == (
        "# Episodes for 2026-01-01\n"
        "\n"
        "- [ ] <!-- episode:mei-pending --> Still pending.\n"
        "- [x] <!-- episode:mei-processed --> Already integrated.\n"
    )


@pytest.mark.asyncio
async def test_create_episode_item_lazily_creates_daily_file_and_parent_directories(
    async_session,
    clean_memory_episode_rows,
) -> None:
    service = _episode_service(async_session)
    memory_entries = _memory_entry_service(async_session)
    user_id = f"user-{uuid.uuid4()}"
    local_day = date(2026, 1, 1)

    item = await service.create_episode_item(
        user_id=user_id,
        source_anima_id="anima-1",
        source_chat_id="chat-1",
        source_run_id="run-1",
        text="  The user started planning episodic memory.\nThey want daily logs. ",
        occurred_at=_occurred(16, 30),
        local_date=local_day,
        local_timezone="America/Toronto",
        metadata={"turn": 1},
    )

    assert item.id.startswith("mei-")
    assert item.episode_path == "episodes/2026/01/2026-01-01.md"
    assert item.text == "The user started planning episodic memory. They want daily logs."
    assert item.status == MEMORY_EPISODE_STATUS_PENDING

    daily_file = await memory_entries.get_entry_by_path(user_id=user_id, path=item.episode_path)
    assert daily_file.kind == MEMORY_EPISODE_LOG_ENTRY_KIND
    assert daily_file.content == (
        "# Episodes for 2026-01-01\n"
        "\n"
        f"- [ ] <!-- episode:{item.id} --> The user started planning episodic memory. They want daily logs.\n"
    )
    assert daily_file.metadata == {
        "source": {"type": "episodic_memory"},
        "generated": True,
        "local_date": "2026-01-01",
    }
    daily_version = await async_session.scalar(
        select(ORMMemoryEntryVersion).where(
            ORMMemoryEntryVersion.entry_id == daily_file.id,
            ORMMemoryEntryVersion.version == daily_file.version,
        )
    )
    assert daily_version is not None
    assert daily_version.change_metadata_ == {"source_type": "episodic_memory"}

    for directory_path in ("episodes", "episodes/2026", "episodes/2026/01"):
        directory = await memory_entries.get_entry_by_path(
            user_id=user_id,
            path=directory_path,
            type=MEMORY_ENTRY_TYPE_DIRECTORY,
        )
        assert directory.type == MEMORY_ENTRY_TYPE_DIRECTORY


@pytest.mark.asyncio
async def test_daily_file_refresh_is_deterministic_and_does_not_duplicate_items(
    async_session,
    clean_memory_episode_rows,
) -> None:
    service = _episode_service(async_session)
    memory_entries = _memory_entry_service(async_session)
    user_id = f"user-{uuid.uuid4()}"
    local_day = date(2026, 1, 1)

    later = await service.create_episode_item(
        user_id=user_id,
        source_chat_id="chat-1",
        source_run_id="run-later",
        text="Second in time.",
        occurred_at=_occurred(18),
        local_date=local_day,
    )
    earlier = await service.create_episode_item(
        user_id=user_id,
        source_chat_id="chat-1",
        source_run_id="run-earlier",
        text="First in time.",
        occurred_at=_occurred(9),
        local_date=local_day,
    )

    daily_file = await memory_entries.get_entry_by_path(user_id=user_id, path=episode_path_for_date(local_day))
    expected = (
        "# Episodes for 2026-01-01\n"
        "\n"
        f"- [ ] <!-- episode:{earlier.id} --> First in time.\n"
        f"- [ ] <!-- episode:{later.id} --> Second in time.\n"
    )
    assert daily_file.content == expected

    await service.refresh_daily_episode_file(user_id=user_id, local_date=local_day)
    refreshed = await memory_entries.get_entry_by_path(user_id=user_id, path=episode_path_for_date(local_day))
    assert refreshed.content == expected


@pytest.mark.asyncio
async def test_mark_items_processed_updates_daily_checkboxes(
    async_session,
    clean_memory_episode_rows,
) -> None:
    service = _episode_service(async_session)
    memory_entries = _memory_entry_service(async_session)
    user_id = f"user-{uuid.uuid4()}"
    local_day = date(2026, 1, 1)

    processed = await service.create_episode_item(
        user_id=user_id,
        source_chat_id="chat-1",
        source_run_id="run-processed",
        text="Add this to curated memory.",
        occurred_at=_occurred(10),
        local_date=local_day,
    )
    pending = await service.create_episode_item(
        user_id=user_id,
        source_chat_id="chat-1",
        source_run_id="run-pending",
        text="Temporary chatter.",
        occurred_at=_occurred(11),
        local_date=local_day,
    )

    processed_items = await service.mark_items_processed(
        user_id=user_id,
        item_ids=[processed.id],
        processed_by_run_id="memory-manager-run-1",
        processed_at=_occurred(20),
    )
    assert processed_items[0].status == MEMORY_EPISODE_STATUS_PROCESSED
    assert processed_items[0].processed_by_run_id == "memory-manager-run-1"

    daily_file = await memory_entries.get_entry_by_path(user_id=user_id, path=episode_path_for_date(local_day))
    assert daily_file.content == (
        "# Episodes for 2026-01-01\n"
        "\n"
        f"- [x] <!-- episode:{processed.id} --> Add this to curated memory.\n"
        f"- [ ] <!-- episode:{pending.id} --> Temporary chatter.\n"
    )


@pytest.mark.asyncio
async def test_blank_episode_text_is_rejected_without_creating_daily_file(
    async_session,
    clean_memory_episode_rows,
) -> None:
    service = _episode_service(async_session)
    memory_entries = _memory_entry_service(async_session)
    user_id = f"user-{uuid.uuid4()}"
    local_day = date(2026, 1, 1)

    with pytest.raises(MemoryEpisodeValidationError):
        await service.create_episode_item(
            user_id=user_id,
            source_chat_id="chat-1",
            source_run_id="run-blank",
            text=" \n ",
            occurred_at=_occurred(12),
            local_date=local_day,
        )

    with pytest.raises(MemoryEntryNotFoundError):
        await memory_entries.get_entry_by_path(user_id=user_id, path=episode_path_for_date(local_day))


@pytest.mark.asyncio
async def test_duplicate_chat_turn_run_conflicts_instead_of_duplicating_episode_rows(
    async_session,
    clean_memory_episode_rows,
) -> None:
    service = _episode_service(async_session)
    user_id = f"user-{uuid.uuid4()}"
    local_day = date(2026, 1, 1)

    await service.create_episode_item(
        user_id=user_id,
        source_chat_id="chat-1",
        source_run_id="run-1",
        text="Remember this once.",
        occurred_at=_occurred(14),
        local_date=local_day,
    )

    with pytest.raises(MemoryEpisodeConflictError):
        await service.create_episode_item(
            user_id=user_id,
            source_chat_id="chat-1",
            source_run_id="run-1",
            text="Do not remember this twice.",
            occurred_at=_occurred(15),
            local_date=local_day,
        )

    items = await service.list_episode_items(user_id=user_id, local_date=local_day, limit=None)
    assert [item.text for item in items] == ["Remember this once."]


@pytest.mark.asyncio
async def test_session_backed_memory_episode_recorder_writes_row_and_daily_file(
    async_session,
    async_session_factory,
    clean_memory_episode_rows,
) -> None:
    user_id = f"user-{uuid.uuid4()}"
    async_session.add(
        ORMUserSettings(
            user_id=user_id,
            preferences={"timezone": "UTC"},
        )
    )
    await async_session.commit()

    recorder = SessionBackedMemoryEpisodeRecorder(async_session_factory)
    item = await recorder.record_episode_item(
        user_id=user_id,
        source_anima_id="anima-1",
        source_chat_id="chat-1",
        source_run_id="run-1",
        source_message_id="message-1",
        text="The user wants this turn remembered.",
    )

    assert item.local_timezone == "UTC"
    assert item.source_message_id == "message-1"
    result = await async_session.execute(
        select(ORMMemoryEpisodeItem).where(
            ORMMemoryEpisodeItem.user_id == user_id,
            ORMMemoryEpisodeItem.source_run_id == "run-1",
        )
    )
    row = result.scalar_one()
    assert row.text == "The user wants this turn remembered."
    assert row.episode_path == item.episode_path

    file_result = await async_session.execute(
        select(ORMMemoryEntry).where(
            ORMMemoryEntry.user_id == user_id,
            ORMMemoryEntry.anima_id.is_(None),
            ORMMemoryEntry.path == item.episode_path,
        )
    )
    daily_file = file_result.scalar_one()
    assert daily_file.kind == MEMORY_EPISODE_LOG_ENTRY_KIND
    assert f"<!-- episode:{item.id} --> The user wants this turn remembered." in (daily_file.content or "")
