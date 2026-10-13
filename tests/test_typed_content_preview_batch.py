from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import func, select, update

from animama.domain.request_principal import RequestPrincipal
from animama.orm.content_catalog import ORMContentPreview, ORMContentPreviewFile
from animama.product_http.routes import content
from animama.server.deps import get_current_principal
from tests.anima_creation_service_support import anima_creation_fixture
from tests.local_http_client import local_client


def _catalog_root(item) -> dict[str, Any]:  # noqa: ANN001
    return {
        "kind": item.kind.value,
        "source": {"type": "catalog", "catalog_item_id": item.id},
    }


async def test_preview_batch_deduplicates_overlapping_catalog_and_builtin_closures(
    async_session,
    tmp_path,
    monkeypatch,  # noqa: ANN001
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        await fixture.add_action_support(async_session)
        app = fixture.app(async_session, monkeypatch)
        app.include_router(content.router)
        current_user = {"id": fixture.owner}

        async def user() -> RequestPrincipal:
            return RequestPrincipal(id=current_user["id"])

        app.dependency_overrides[get_current_principal] = user
        client = local_client(app)
        gesture = fixture.items["gesture"]
        sound = fixture.items["sound"]
        idle = fixture.items["idle"]
        try:
            response = await client.post(
                "/v1/content/previews:prepare",
                json={
                    "schema_version": 1,
                    "roots": [
                        _catalog_root(gesture),
                        _catalog_root(gesture),
                        _catalog_root(sound),
                        {
                            "kind": "idle_style",
                            "source": {
                                "type": "builtin",
                                "content_id": idle.logical_key,
                                "version": 1,
                            },
                        },
                        {
                            "kind": "sound_effect",
                            "source": {"type": "catalog", "catalog_item_id": "missing-item"},
                        },
                    ],
                },
            )
            assert response.status_code == 200
            body = response.json()
            assert body["complete"] is False
            assert len(body["roots"]) == 3
            assert body["lease"] is not None
            assert {item["item_id"] for item in body["items"]} == {
                gesture.id,
                sound.id,
                idle.id,
            }
            assert len({file["file_ref"] for file in body["lease"]["files"]}) == len(body["lease"]["files"])
            assert await async_session.scalar(select(func.count()).select_from(ORMContentPreview)) == 1
            assert await async_session.scalar(select(func.count()).select_from(ORMContentPreviewFile)) == len(
                body["lease"]["files"]
            )

            delivered = await client.get(body["lease"]["files"][0]["url"])
            assert delivered.status_code == 200
            current_user["id"] = "another-owner"
            hidden = await client.get(body["lease"]["files"][0]["url"])
            assert hidden.status_code == 404
            current_user["id"] = fixture.owner

            await async_session.execute(
                update(ORMContentPreview)
                .where(ORMContentPreview.id == body["lease"]["preview_id"])
                .values(expires_at=datetime.now(UTC) - timedelta(seconds=1))
            )
            await async_session.commit()
            expired = await client.get(body["lease"]["files"][0]["url"])
            assert expired.status_code == 404
        finally:
            await client.aclose()


async def test_preview_batch_issues_no_lease_when_every_root_fails(
    async_session,
    tmp_path,
    monkeypatch,  # noqa: ANN001
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        client = local_client(app)
        try:
            before = await async_session.scalar(select(func.count()).select_from(ORMContentPreview))
            response = await client.post(
                "/v1/content/previews:prepare",
                json={
                    "schema_version": 1,
                    "roots": [
                        {
                            "kind": "particle_effect",
                            "source": {"type": "catalog", "catalog_item_id": "missing-item"},
                        },
                        {
                            "kind": "sound_effect",
                            "source": {"type": "builtin", "content_id": "builtin:missing", "version": 1},
                        },
                    ],
                },
            )
            assert response.status_code == 200
            assert response.json()["lease"] is None
            assert response.json()["roots"] == []
            assert await async_session.scalar(select(func.count()).select_from(ORMContentPreview)) == before
        finally:
            await client.aclose()
