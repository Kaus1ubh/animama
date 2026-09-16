from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select

from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.owner_bootstrap_service import PROFILE_MEMORY_KIND, PROFILE_MEMORY_PATH
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE
from animama.domain.user_profile import UserProfile, UserProfileInvalidError
from animama.local.installation_model import ORMInstallationSettings
from animama.orm.memory_entry import ORMMemoryEntry, ORMMemoryEntryVersion
from animama.server.installation_personalization import (
    InstallationBootstrapIncompleteError,
    InstallationPersonalizationService,
    render_profile_document,
)


async def _seed_personalization(session, owner_id: str) -> None:  # noqa: ANN001
    await session.execute(delete(ORMInstallationSettings))
    session.add(ORMInstallationSettings(id=1, installation_principal_id=owner_id))
    profiles = SQLAlchemyUserProfileRepository(session)
    await profiles.create_profile(UserProfile(user_id=owner_id))
    memory = MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(session),
        uow=SQLAlchemyUnitOfWork(session),
        commit_on_write=False,
    )
    await memory.put_file_by_path(
        user_id=owner_id,
        path=PROFILE_MEMORY_PATH,
        content=render_profile_document(None),
        kind=PROFILE_MEMORY_KIND,
        description="Private installation-owner profile",
        metadata={
            "installation_bootstrap": {
                "template_version": "1",
                "managed_entry_version": 1,
            }
        },
        expected_version=0,
    )
    await session.commit()


async def _profile_memory(session, owner_id: str):  # noqa: ANN001
    return await SQLAlchemyMemoryEntryRepository(session).get_entry_by_path(
        user_id=owner_id,
        anima_id=None,
        normalized_path=PROFILE_MEMORY_PATH,
        type=MEMORY_ENTRY_TYPE_FILE,
    )


async def test_onboarding_is_atomic_idempotent_and_preserves_later_user_memory_edits(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    service = InstallationPersonalizationService(async_session)

    completed = await service.complete_onboarding(principal_id=owner_id, display_name="  Ada   Lovelace ")
    assert completed.display_name == "Ada Lovelace"
    installation = await async_session.get(ORMInstallationSettings, 1, populate_existing=True)
    profile = await SQLAlchemyUserProfileRepository(async_session).get_profile(owner_id)
    entry = await _profile_memory(async_session, owner_id)
    assert installation is not None and installation.first_run_completed_at == completed.first_run_completed_at
    assert profile is not None and profile.display_name == "Ada Lovelace"
    assert entry is not None and entry.version == 2
    assert entry.content == render_profile_document("Ada Lovelace")
    assert entry.metadata["installation_bootstrap"]["managed_entry_version"] == 2

    replay = await service.complete_onboarding(principal_id=owner_id, display_name="Ignored retry")
    assert replay == completed
    assert (await _profile_memory(async_session, owner_id)).version == 2

    entry = await _profile_memory(async_session, owner_id)
    assert entry is not None
    memory = MemoryEntryService(
        memory_entries=SQLAlchemyMemoryEntryRepository(async_session),
        uow=SQLAlchemyUnitOfWork(async_session),
    )
    await memory.put_file_by_path(
        user_id=owner_id,
        path=PROFILE_MEMORY_PATH,
        content="# I edited this myself\n",
        kind=entry.kind,
        description=entry.description,
        metadata=entry.metadata,
        expected_version=entry.version,
    )
    changed = await service.update_display_name(principal_id=owner_id, display_name="Grace")
    assert changed.display_name == "Grace"
    preserved = await _profile_memory(async_session, owner_id)
    assert preserved is not None and preserved.version == 3
    assert preserved.content == "# I edited this myself\n"


async def test_precommit_failure_rolls_back_profile_memory_and_timestamp(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)

    async def fail_before_commit() -> None:
        raise RuntimeError("injected failure")

    with pytest.raises(RuntimeError, match="injected failure"):
        await InstallationPersonalizationService(async_session, before_commit=fail_before_commit).complete_onboarding(
            principal_id=owner_id,
            display_name="Ada",
        )

    installation = await async_session.get(ORMInstallationSettings, 1, populate_existing=True)
    profile = await SQLAlchemyUserProfileRepository(async_session).get_profile(owner_id)
    entry = await _profile_memory(async_session, owner_id)
    assert installation is not None and installation.first_run_completed_at is None
    assert profile is not None and profile.display_name is None
    assert entry is not None and entry.version == 1 and entry.content == render_profile_document(None)


@pytest.mark.parametrize("name", [None, "", " \t ", "x" * 81])
async def test_invalid_onboarding_name_leaves_setup_incomplete(async_session, name) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)

    with pytest.raises(UserProfileInvalidError):
        await InstallationPersonalizationService(async_session).complete_onboarding(
            principal_id=owner_id, display_name=name
        )

    installation = await async_session.get(ORMInstallationSettings, 1, populate_existing=True)
    profile = await SQLAlchemyUserProfileRepository(async_session).get_profile(owner_id)
    entry = await _profile_memory(async_session, owner_id)
    assert installation is not None and installation.first_run_completed_at is None
    assert profile is not None and profile.display_name is None
    assert entry is not None and entry.version == 1


async def test_previously_skipped_setup_can_gain_a_name_without_resetting_owner_or_timestamp(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    installation = await async_session.get(ORMInstallationSettings, 1)
    assert installation is not None
    original_timestamp = datetime(2026, 9, 1, tzinfo=UTC)
    installation.first_run_completed_at = original_timestamp
    await async_session.commit()

    service = InstallationPersonalizationService(async_session)
    completed = await service.complete_onboarding(principal_id=owner_id, display_name="Ada")
    assert completed.display_name == "Ada"
    assert completed.first_run_completed_at == original_timestamp
    await async_session.refresh(installation)
    assert installation.installation_principal_id == owner_id
    assert installation.first_run_completed_at == original_timestamp
    entry = await _profile_memory(async_session, owner_id)
    assert entry is not None and entry.content == render_profile_document("Ada")

    replay = await service.complete_onboarding(principal_id=owner_id, display_name="Ignored retry")
    assert replay == completed
    assert (await _profile_memory(async_session, owner_id)).version == 2


async def test_lost_committed_onboarding_response_replays_from_a_new_session(
    async_session,
    async_session_factory,
) -> None:
    """A client retry after losing the 200 response must observe one durable commit."""

    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    committed = await InstallationPersonalizationService(async_session).complete_onboarding(
        principal_id=owner_id,
        display_name="Ada",
    )

    async with async_session_factory() as retry_session:
        replayed = await InstallationPersonalizationService(retry_session).complete_onboarding(
            principal_id=owner_id,
            display_name="Ignored retry",
        )
        version_count = await retry_session.scalar(
            select(func.count()).select_from(ORMMemoryEntryVersion).where(ORMMemoryEntryVersion.user_id == owner_id)
        )

    assert replayed == committed
    assert version_count == 2


async def test_onboarding_refuses_to_complete_without_bootstrap_profile_memory(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    await async_session.execute(delete(ORMMemoryEntry).where(ORMMemoryEntry.user_id == owner_id))
    await async_session.commit()

    with pytest.raises(InstallationBootstrapIncompleteError):
        await InstallationPersonalizationService(async_session).complete_onboarding(
            principal_id=owner_id,
            display_name="Ada",
        )

    installation = await async_session.get(ORMInstallationSettings, 1, populate_existing=True)
    profile = await SQLAlchemyUserProfileRepository(async_session).get_profile(owner_id)
    assert installation is not None and installation.first_run_completed_at is None
    assert profile is not None and profile.display_name is None


async def test_concurrent_completion_has_one_durable_winner(async_session, async_session_factory) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)

    async def complete(name: str):
        async with async_session_factory() as session:
            return await InstallationPersonalizationService(session).complete_onboarding(
                principal_id=owner_id,
                display_name=name,
            )

    first, second = await asyncio.gather(complete("Ada"), complete("Grace"))
    assert first == second
    async with async_session_factory() as session:
        profile = await SQLAlchemyUserProfileRepository(session).get_profile(owner_id)
        version_count = await session.scalar(
            select(func.count()).select_from(ORMMemoryEntryVersion).where(ORMMemoryEntryVersion.user_id == owner_id)
        )
    assert profile is not None and profile.display_name in {"Ada", "Grace"}
    assert version_count == 2
