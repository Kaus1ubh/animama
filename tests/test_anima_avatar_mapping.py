from __future__ import annotations

from animama.adapters.mappers.anima_map import anima_update_request_to_domain
from animama.domain.anima import Anima
from animama.domain.avatar import Avatar
from animama.server.schemas.anima import PyAnimaUpdate, PyAnimaUpdateRequest


def test_anima_update_request_to_domain_clears_avatar_when_explicitly_null() -> None:
    existing = Anima(
        id="anima-1",
        avatar=Avatar(
            id="avt_sample_a1n",
            name="Annie",
            file_path="/shared/avatars/AvatarSample_A_1_New.vrm",
        ),
    )
    req = PyAnimaUpdateRequest(anima=PyAnimaUpdate(avatar_id=None))

    updated = anima_update_request_to_domain(req, existing)

    assert updated.avatar is None
