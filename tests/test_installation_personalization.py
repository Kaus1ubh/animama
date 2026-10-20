from __future__ import annotations

import asyncio
from datetime import UTC, datetime
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import delete, func, select

from animama.adapters.repositories.sqlalchemy.anima_chat_profile_repo import SQLAlchemyAnimaChatProfileRepository
from animama.adapters.repositories.sqlalchemy.anima_creation_repo import SQLAlchemyAnimaCreationRepository
from animama.adapters.repositories.sqlalchemy.companion_safety_repo import SQLAlchemyCompanionSafetyRepository
from animama.adapters.repositories.sqlalchemy.memory_entry_repo import SQLAlchemyMemoryEntryRepository
from animama.adapters.repositories.sqlalchemy.model_provider_repo import SQLAlchemyModelProviderRepository
from animama.adapters.repositories.sqlalchemy.settings_repo import SQLAlchemyUserSettingsRepository
from animama.adapters.repositories.sqlalchemy.uow import SQLAlchemyUnitOfWork
from animama.adapters.repositories.sqlalchemy.user_profile_repo import SQLAlchemyUserProfileRepository
from animama.app.ports.anima_creation_port import StarterReceipt
from animama.app.services.anima_starter_service import STARTER_ANIMA_SPECS
from animama.app.services.memory_entry_service import MemoryEntryService
from animama.app.services.owner_bootstrap_service import PROFILE_MEMORY_KIND, PROFILE_MEMORY_PATH, PROFILE_TEMPLATE_V2
from animama.domain.anima_chat_profile import AnimaChatProfile
from animama.domain.memory_entry import MEMORY_ENTRY_TYPE_FILE
from animama.domain.model_provider import ModelProvider, ModelProviderCapabilities
from animama.domain.settings import UserSettings
from animama.domain.user_profile import UserProfile, UserProfileInvalidError
from animama.local.installation_model import ORMInstallationSettings
from animama.orm import ORMAnima
from animama.orm.companion_safety import ORMCompanionSafetyState
from animama.orm.memory_entry import ORMMemoryEntry, ORMMemoryEntryVersion
from animama.server.installation_personalization import (
    AdultConfirmationRequiredError,
    InstallationBootstrapIncompleteError,
    InstallationPersonalizationService,
    OnboardingChatModelUnavailableError,
    with_preferred_name,
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
        content=with_preferred_name(PROFILE_TEMPLATE_V2, None),
        kind=PROFILE_MEMORY_KIND,
        description="Private installation-owner profile",
        metadata={
            "installation_bootstrap": {
                "template_version": "2",
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
        normalized_path=PROFILE_MEMORY_PATH.casefold(),
        type=MEMORY_ENTRY_TYPE_FILE,
    )


async def test_onboarding_is_atomic_idempotent_and_preserves_later_user_memory_edits(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    service = InstallationPersonalizationService(async_session)

    completed = await service.complete_onboarding(
        principal_id=owner_id, display_name="  Ada   Lovelace ", adult_confirmed=True
    )
    assert completed.display_name == "Ada Lovelace"
    installation = await async_session.get(ORMInstallationSettings, 1, populate_existing=True)
    profile = await SQLAlchemyUserProfileRepository(async_session).get_profile(owner_id)
    entry = await _profile_memory(async_session, owner_id)
    assert installation is not None and installation.first_run_completed_at == completed.first_run_completed_at
    assert profile is not None and profile.display_name == "Ada Lovelace"
    assert entry is not None and entry.version == 2
    assert entry.content == with_preferred_name(PROFILE_TEMPLATE_V2, "Ada Lovelace")
    assert entry.metadata["installation_bootstrap"]["managed_entry_version"] == 2

    replay = await service.complete_onboarding(
        principal_id=owner_id, display_name="Ignored retry", adult_confirmed=True
    )
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


def test_preferred_name_goes_under_basics_in_the_bootstrap_template() -> None:
    assert with_preferred_name(PROFILE_TEMPLATE_V2, None) == PROFILE_TEMPLATE_V2
    named = with_preferred_name(PROFILE_TEMPLATE_V2, "Ada Lovelace")
    assert named.replace("Preferred name: Ada Lovelace\n", "", 1) == PROFILE_TEMPLATE_V2
    assert "## Basics\nPreferred name: Ada Lovelace\n" in named


def test_preferred_name_does_not_depend_on_the_template_text() -> None:
    custom = "# Me\n\n## Things\nStuff.\n"
    assert with_preferred_name(custom, "Ada") == "# Me\nPreferred name: Ada\n\n## Things\nStuff.\n"
    assert with_preferred_name("Just text.\n", "Ada") == "Preferred name: Ada\nJust text.\n"
    renamed = with_preferred_name("# Me\nPreferred name: Ada\n", "Grace")
    assert renamed == "# Me\nPreferred name: Grace\n"
    assert with_preferred_name(renamed, None) == "# Me\n"


async def test_managed_profile_from_another_template_still_gets_the_name(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    entry = await async_session.scalar(
        select(ORMMemoryEntry).where(ORMMemoryEntry.user_id == owner_id, ORMMemoryEntry.path == PROFILE_MEMORY_PATH)
    )
    assert entry is not None
    # An older or future bootstrap template, still untouched by the owner.
    entry.content = "# About me\n\n## Details\nAnything you like.\n"
    entry.metadata_ = {"installation_bootstrap": {"template_version": "1", "managed_entry_version": 1}}
    await async_session.commit()

    await InstallationPersonalizationService(async_session).complete_onboarding(
        principal_id=owner_id, display_name="Ada", adult_confirmed=True
    )

    updated = await _profile_memory(async_session, owner_id)
    assert updated is not None and updated.version == 2
    assert updated.content == "# About me\nPreferred name: Ada\n\n## Details\nAnything you like.\n"
    assert updated.metadata["installation_bootstrap"] == {"template_version": "1", "managed_entry_version": 2}


async def test_precommit_failure_rolls_back_profile_memory_and_timestamp(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)

    async def fail_before_commit() -> None:
        raise RuntimeError("injected failure")

    with pytest.raises(RuntimeError, match="injected failure"):
        await InstallationPersonalizationService(async_session, before_commit=fail_before_commit).complete_onboarding(
            principal_id=owner_id,
            display_name="Ada",
            adult_confirmed=True,
        )

    installation = await async_session.get(ORMInstallationSettings, 1, populate_existing=True)
    profile = await SQLAlchemyUserProfileRepository(async_session).get_profile(owner_id)
    entry = await _profile_memory(async_session, owner_id)
    assert installation is not None and installation.first_run_completed_at is None
    assert profile is not None and profile.display_name is None
    assert entry is not None and entry.version == 1 and entry.content == with_preferred_name(PROFILE_TEMPLATE_V2, None)


@pytest.mark.parametrize("name", [None, "", " \t ", "x" * 81])
async def test_invalid_onboarding_name_leaves_setup_incomplete(async_session, name) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)

    with pytest.raises(UserProfileInvalidError):
        await InstallationPersonalizationService(async_session).complete_onboarding(
            principal_id=owner_id, display_name=name, adult_confirmed=True
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
    completed = await service.complete_onboarding(principal_id=owner_id, display_name="Ada", adult_confirmed=True)
    assert completed.display_name == "Ada"
    assert completed.first_run_completed_at == original_timestamp
    await async_session.refresh(installation)
    assert installation.installation_principal_id == owner_id
    assert installation.first_run_completed_at == original_timestamp
    entry = await _profile_memory(async_session, owner_id)
    assert entry is not None and entry.content == with_preferred_name(PROFILE_TEMPLATE_V2, "Ada")

    replay = await service.complete_onboarding(
        principal_id=owner_id, display_name="Ignored retry", adult_confirmed=True
    )
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
        adult_confirmed=True,
    )

    async with async_session_factory() as retry_session:
        replayed = await InstallationPersonalizationService(retry_session).complete_onboarding(
            principal_id=owner_id,
            display_name="Ignored retry",
            adult_confirmed=True,
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
            adult_confirmed=True,
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
                adult_confirmed=True,
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


async def test_first_run_requires_and_records_the_adult_confirmation(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    service = InstallationPersonalizationService(async_session)

    with pytest.raises(AdultConfirmationRequiredError):
        await service.complete_onboarding(principal_id=owner_id, display_name="Ada", adult_confirmed=False)
    assert await SQLAlchemyCompanionSafetyRepository(async_session).get_age_status(owner_id) == "unknown"

    await service.complete_onboarding(principal_id=owner_id, display_name="Ada", adult_confirmed=True)
    row = await async_session.get(ORMCompanionSafetyState, owner_id, populate_existing=True)
    assert row is not None
    assert row.age_status == "adult"
    assert row.age_status_source == "self_attestation"
    assert row.age_status_recorded_at is not None


# --- Setup model choice (chat_model_provider_id) ---------------------------------


def _chat_row(suffix: str, **overrides: Any) -> ModelProvider:
    values: dict[str, Any] = {
        "id": f"OpenAIResponsesHTTPAgent:setup-{suffix}",
        "model": f"setup-{suffix}",
        "provider_type": "OpenAIResponsesHTTPAgent",
        "model_label": f"Setup {suffix}",
        "provider_label": "OpenAI",
        "capabilities": ModelProviderCapabilities(supports_streaming=True, supports_tools=True),
    }
    values.update(overrides)
    return ModelProvider(**values)


async def _seed_setup_models(session, owner_id: str):  # noqa: ANN001
    """Creation, chosen and unrelated models; both starters plus a non-starter Anima."""

    suffix = uuid4().hex[:10]
    creation, chosen, other = (
        _chat_row(f"{suffix}-creation"),
        _chat_row(f"{suffix}-chosen", provider_type="OpenAIHTTPAgent", id=f"OpenAIHTTPAgent:setup-{suffix}"),
        _chat_row(f"{suffix}-other"),
    )
    await SQLAlchemyModelProviderRepository(session).upsert_many([creation, chosen, other])
    annie, andrew, custom = (f"anima-{name}-{suffix}" for name in ("annie", "andrew", "custom"))
    for anima_id in (annie, andrew, custom):
        session.add(ORMAnima(id=anima_id, user_id=owner_id, metadata_={}))
    await session.flush()
    profiles = SQLAlchemyAnimaChatProfileRepository(session)
    # Andrew was moved to another model; the custom Anima is not a starter.
    for anima_id, model_id in ((annie, creation.id), (andrew, other.id), (custom, creation.id)):
        await profiles.upsert(
            AnimaChatProfile(anima_id=anima_id, default_model_provider_id=model_id, metadata={"source": "anima_create"})
        )
    receipts = SQLAlchemyAnimaCreationRepository(session)
    for spec, anima_id in zip(STARTER_ANIMA_SPECS, (annie, andrew), strict=True):
        await receipts.save_starter(
            user_id=owner_id, receipt=StarterReceipt(spec.id, spec.version, "ready", anima_id, [])
        )
    await SQLAlchemyUserSettingsRepository(session).upsert(
        UserSettings(
            user_id=owner_id,
            preferences={"speech": {"tts_enabled": True}, "chat": {"markdown_enabled": False}},
        )
    )
    await session.commit()
    return {
        "creation": creation,
        "chosen": chosen,
        "other": other,
        "annie": annie,
        "andrew": andrew,
        "custom": custom,
    }


async def _pinned(session, anima_id: str) -> str:  # noqa: ANN001
    profile = await SQLAlchemyAnimaChatProfileRepository(session).get(anima_id)
    assert profile is not None
    return profile.default_model_provider_id


async def _preferences(session, owner_id: str) -> dict[str, Any]:  # noqa: ANN001
    session.expire_all()
    settings = await SQLAlchemyUserSettingsRepository(session).get(owner_id)
    assert settings is not None
    return settings.preferences


async def test_setup_model_becomes_the_chat_default_and_unchanged_starters_follow(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    seeded = await _seed_setup_models(async_session, owner_id)

    await InstallationPersonalizationService(async_session).complete_onboarding(
        principal_id=owner_id,
        display_name="Ada",
        adult_confirmed=True,
        chat_model_provider_id=f"  {seeded['chosen'].id} ",
        starter_model_provider_id=seeded["creation"].id,
    )

    assert await _preferences(async_session, owner_id) == {
        "speech": {"tts_enabled": True},
        "chat": {"markdown_enabled": False, "default_model_provider_id": seeded["chosen"].id},
    }
    assert await _pinned(async_session, seeded["annie"]) == seeded["chosen"].id
    # A starter already on another model, and a non-starter, keep their models.
    assert await _pinned(async_session, seeded["andrew"]) == seeded["other"].id
    assert await _pinned(async_session, seeded["custom"]) == seeded["creation"].id
    profile = await SQLAlchemyAnimaChatProfileRepository(async_session).get(seeded["annie"])
    assert profile is not None and profile.metadata["source"] == "onboarding_chat_model"


async def test_onboarding_without_a_setup_model_keeps_defaults_and_starters(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    seeded = await _seed_setup_models(async_session, owner_id)

    await InstallationPersonalizationService(async_session).complete_onboarding(
        principal_id=owner_id,
        display_name="Ada",
        adult_confirmed=True,
        starter_model_provider_id=seeded["creation"].id,
    )

    assert await _preferences(async_session, owner_id) == {
        "speech": {"tts_enabled": True},
        "chat": {"markdown_enabled": False},
    }
    assert await _pinned(async_session, seeded["annie"]) == seeded["creation"].id


@pytest.mark.parametrize("kind", ["missing", "inactive", "embedding", "no_streaming", "unsupported_api"])
async def test_unusable_setup_model_is_refused_and_nothing_is_applied(async_session, kind) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    seeded = await _seed_setup_models(async_session, owner_id)
    suffix = uuid4().hex[:10]
    rows = {
        "inactive": _chat_row(f"{suffix}-inactive", active=False),
        "embedding": _chat_row(f"{suffix}-embedding", model_kind="embedding"),
        "no_streaming": _chat_row(f"{suffix}-batch", capabilities=ModelProviderCapabilities(supports_streaming=False)),
        "unsupported_api": _chat_row(f"{suffix}-fake", provider_type="FakeAgent", id=f"FakeAgent:setup-{suffix}"),
    }
    row = rows.get(kind)
    if row is not None:
        await SQLAlchemyModelProviderRepository(async_session).upsert_many([row])
        await async_session.commit()
    chosen = row.id if row is not None else "OpenAIResponsesHTTPAgent:does-not-exist"

    with pytest.raises(OnboardingChatModelUnavailableError):
        await InstallationPersonalizationService(async_session).complete_onboarding(
            principal_id=owner_id,
            display_name="Ada",
            adult_confirmed=True,
            chat_model_provider_id=chosen,
            starter_model_provider_id=seeded["creation"].id,
        )

    installation = await async_session.get(ORMInstallationSettings, 1, populate_existing=True)
    profile = await SQLAlchemyUserProfileRepository(async_session).get_profile(owner_id)
    assert installation is not None and installation.first_run_completed_at is None
    assert profile is not None and profile.display_name is None
    assert await SQLAlchemyCompanionSafetyRepository(async_session).get_age_status(owner_id) != "adult"
    assert "default_model_provider_id" not in (await _preferences(async_session, owner_id))["chat"]
    assert await _pinned(async_session, seeded["annie"]) == seeded["creation"].id


async def test_completed_onboarding_replay_ignores_a_setup_model(async_session) -> None:
    owner_id = str(uuid4())
    await _seed_personalization(async_session, owner_id)
    seeded = await _seed_setup_models(async_session, owner_id)
    service = InstallationPersonalizationService(async_session)
    await service.complete_onboarding(principal_id=owner_id, display_name="Ada", adult_confirmed=True)

    await service.complete_onboarding(
        principal_id=owner_id,
        display_name="Ada",
        adult_confirmed=True,
        chat_model_provider_id=seeded["chosen"].id,
        starter_model_provider_id=seeded["creation"].id,
    )

    assert "default_model_provider_id" not in (await _preferences(async_session, owner_id))["chat"]
    assert await _pinned(async_session, seeded["annie"]) == seeded["creation"].id
