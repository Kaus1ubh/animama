from __future__ import annotations

import pytest

from animama.app.services.anima_loadout_service import AnimaLoadoutService
from animama.domain.anima_loadout import AnimaLoadoutError
from tests.typed_loadout_support import (
    add_typed_item,
    catalog_source,
    cleanup_loadout_fixture,
    create_loadout_fixture,
)


@pytest.mark.asyncio
async def test_music_loadout_enforces_one_autoplay_and_no_duplicate_track(async_session) -> None:  # noqa: ANN001
    fixture = await create_loadout_fixture(async_session)
    first = await add_typed_item(
        async_session,
        fixture,
        kind="music_track",
        name="First Track",
        metadata={
            "duration_seconds": 30,
            "codec": "audio/mpeg",
            "defaults": {"loop": True, "gain": 0.8, "autoplay": False},
        },
    )
    second = await add_typed_item(
        async_session,
        fixture,
        kind="music_track",
        name="Second Track",
        metadata={
            "duration_seconds": 45,
            "codec": "audio/mpeg",
            "defaults": {"loop": False, "gain": 1, "autoplay": False},
        },
    )
    service = AnimaLoadoutService(async_session)

    async def add(item, revision: int, key: str) -> None:  # noqa: ANN001
        intent = {
            "operation": "add",
            "source": catalog_source(item),
            "enabled": True,
            "autoplay": True,
        }
        plan = await service.plan(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
            family="music_track",
            expected_revision=revision,
            intent=intent,
        )
        await service.commit(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
            family="music_track",
            expected_revision=revision,
            intent=intent,
            plan_digest=plan.digest,
            idempotency_key=key,
        )

    try:
        await add(first, 1, "music-first")
        await add(second, 2, "music-second")
        loadout = await service.read_model(
            user_id=fixture.user_id,
            anima_id=fixture.anima_id,
        )
        assert [track.name for track in loadout.music_tracks if track.autoplay] == ["Second Track"]

        with pytest.raises(AnimaLoadoutError, match="music_track_already_equipped"):
            await service.plan(
                user_id=fixture.user_id,
                anima_id=fixture.anima_id,
                family="music_track",
                expected_revision=3,
                intent={
                    "operation": "add",
                    "source": catalog_source(second),
                    "enabled": True,
                    "autoplay": False,
                },
            )
    finally:
        await cleanup_loadout_fixture(async_session, fixture)
