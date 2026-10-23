from __future__ import annotations

from dataclasses import replace
from uuid import uuid4

from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.owner_profile_bootstrap import SQLAlchemyOwnerProfileBootstrapAdapter
from animama.adapters.repositories.sqlalchemy.settings_repo import SQLAlchemyUserSettingsRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.ports.owner_profile_bootstrap_port import OwnerProfileBootstrapResult
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.owner_bootstrap_service import (
    PROFILE_MEMORY_PATH,
    PROFILE_TEMPLATE_V2,
    OwnerBootstrapPolicy,
    OwnerBootstrapService,
)
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE
from animama.domain.settings import UserSettings

POLICY = OwnerBootstrapPolicy(
    profile_template_version="2",
    starter_anima_ids=("starter:annie", "starter:andrew"),
)


class FakeStarters:
    def __init__(self) -> None:
        self.owners: list[str] = []

    async def ensure(self, *, user_id: str, request):  # noqa: ANN001
        self.owners.append(user_id)
        return {
            "complete": True,
            "starters": [
                {"starter_id": "starter:annie"},
                {"starter_id": "starter:andrew"},
            ],
        }


def _service(session, starters: FakeStarters) -> OwnerBootstrapService:  # noqa: ANN001
    return OwnerBootstrapService(
        profiles=SQLAlchemyOwnerProfileBootstrapAdapter(SQLAlchemyUserProfileRepository(session)),
        user_settings=SQLAlchemyUserSettingsRepository(session),
        memory_entries=SQLAlchemyMemoryEntryRepository(session),
        starters=starters,
        uow=SQLAlchemyUnitOfWork(session),
    )


async def test_owner_bootstrap_is_idempotent_preserves_edits_and_isolates_two_owners(async_session) -> None:
    first_owner = f"owner-{uuid4()}"
    second_owner = f"owner-{uuid4()}"
    starters = FakeStarters()
    service = _service(async_session, starters)

    assert (await service.ensure(owner_id=first_owner, policy=POLICY)).ready
    profiles = SQLAlchemyUserProfileRepository(async_session)
    settings = SQLAlchemyUserSettingsRepository(async_session)
    memories = SQLAlchemyMemoryEntryRepository(async_session)

    first_profile = await profiles.get_profile(first_owner)
    assert first_profile is not None
    await profiles.update_profile(replace(first_profile, display_name="Keep Me"))
    await settings.upsert(UserSettings(user_id=first_owner, theme="custom"))
    memory = MemoryEntryService(
        memory_entries=memories,
        uow=SQLAlchemyUnitOfWork(async_session),
        commit_on_write=False,
    )
    profile_memory = await memories.get_entry_by_path(
        user_id=first_owner,
        anima_id=None,
        normalized_path=PROFILE_MEMORY_PATH.casefold(),
        type=MEMORY_ENTRY_TYPE_FILE,
    )
    assert profile_memory is not None
    assert profile_memory.name == profile_memory.path == "PROFILE.md"
    assert profile_memory.description == "User profile"
    await memory.put_file_by_path(
        user_id=first_owner,
        path=PROFILE_MEMORY_PATH,
        content="# My edited profile\n",
        kind=profile_memory.kind,
        description=profile_memory.description,
        metadata=profile_memory.metadata,
        expected_version=profile_memory.version,
    )
    await async_session.commit()

    assert (await service.ensure(owner_id=first_owner, policy=POLICY)).ready
    assert (await service.ensure(owner_id=second_owner, policy=POLICY)).ready

    assert (await profiles.get_profile(first_owner)).display_name == "Keep Me"  # type: ignore[union-attr]
    assert (await settings.get(first_owner)).theme == "custom"  # type: ignore[union-attr]
    preserved = await memories.get_entry_by_path(
        user_id=first_owner,
        anima_id=None,
        normalized_path=PROFILE_MEMORY_PATH.casefold(),
        type=MEMORY_ENTRY_TYPE_FILE,
    )
    assert preserved is not None and preserved.content == "# My edited profile\n"

    second_profile = await profiles.get_profile(second_owner)
    assert second_profile is not None and second_profile.display_name is None
    second_memory = await memories.get_entry_by_path(
        user_id=second_owner,
        anima_id=None,
        normalized_path=PROFILE_MEMORY_PATH.casefold(),
        type=MEMORY_ENTRY_TYPE_FILE,
    )
    assert second_memory is not None and second_memory.content == PROFILE_TEMPLATE_V2
    assert (second_memory.metadata or {})["installation_bootstrap"]["template_version"] == "2"
    assert (
        await memories.get_entry_by_path(
            user_id=second_owner,
            anima_id=None,
            normalized_path="does-not-exist.md",
            type=MEMORY_ENTRY_TYPE_FILE,
        )
        is None
    )
    assert starters.owners == [first_owner, first_owner, second_owner]


class FlakyProfilePort:
    def __init__(self) -> None:
        self.calls = 0

    async def ensure(self, *, owner_id: str) -> OwnerProfileBootstrapResult:
        self.calls += 1
        if self.calls == 1:
            raise RuntimeError("injected")
        return OwnerProfileBootstrapResult(created=True)


async def test_owner_bootstrap_reports_bounded_failure_and_retries(async_session) -> None:
    owner_id = f"owner-{uuid4()}"
    profiles = FlakyProfilePort()
    service = OwnerBootstrapService(
        profiles=profiles,
        user_settings=SQLAlchemyUserSettingsRepository(async_session),
        memory_entries=SQLAlchemyMemoryEntryRepository(async_session),
        starters=FakeStarters(),
        uow=SQLAlchemyUnitOfWork(async_session),
    )

    first = await service.ensure(owner_id=owner_id, policy=POLICY)
    second = await service.ensure(owner_id=owner_id, policy=POLICY)
    assert first.failed_steps == ("local_profile",)
    assert second.ready


def test_profile_template_v2_is_the_owner_profile_shape() -> None:
    headings = [line for line in PROFILE_TEMPLATE_V2.splitlines() if line.startswith("#")]
    assert headings == [
        "# About me",
        "## Basics",
        "## Life right now",
        "## People",
        "## Interests",
        "## Goals",
        "## Routines",
        "## How I like to be treated",
    ]
