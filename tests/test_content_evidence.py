from __future__ import annotations

from sqlalchemy import func, select

from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.orm.anima_loadout import ORMAnimaRuntimeSnapshot
from animama.orm.content_catalog import ORMContentPreview
from tests.anima_creation_service_support import anima_creation_fixture
from tests.local_http_client import local_client


def _root(item, *, kind: str | None = None, revision: str | None = None) -> dict:  # noqa: ANN001
    return {
        "kind": kind or item.kind.value,
        "source": {
            "item_id": item.id,
            "revision_sha256": revision or item.revision_sha256,
        },
    }


async def test_batch_evidence_reads_catalog_once_and_writes_nothing(
    async_session,
    tmp_path,
    monkeypatch,  # noqa: ANN001
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        await fixture.add_action_support(async_session)
        original = SQLAlchemyContentCatalog.list_visible
        reads = 0

        async def counted(self, *, user_id: str):  # noqa: ANN001, ANN202
            nonlocal reads
            reads += 1
            return await original(self, user_id=user_id)

        monkeypatch.setattr(SQLAlchemyContentCatalog, "list_visible", counted)
        app = fixture.app(async_session, monkeypatch)
        before_previews = await async_session.scalar(select(func.count()).select_from(ORMContentPreview))
        before_runtimes = await async_session.scalar(select(func.count()).select_from(ORMAnimaRuntimeSnapshot))
        client = local_client(app)
        try:
            gesture = fixture.items["gesture"]
            response = await client.post(
                "/v1/content/evidence:resolve",
                json={"schema_version": 1, "roots": [_root(gesture) for _ in range(120)]},
            )
            assert response.status_code == 200
            body = response.json()
            assert body["complete"] is True
            assert len(body["roots"]) == 1
            assert set(body["combined_expected_source_revisions"]) == {
                fixture.items["gesture"].id,
                fixture.items["sound"].id,
            }
            assert reads == 1
            assert await async_session.scalar(select(func.count()).select_from(ORMContentPreview)) == before_previews
            assert (
                await async_session.scalar(select(func.count()).select_from(ORMAnimaRuntimeSnapshot)) == before_runtimes
            )
        finally:
            await client.aclose()


async def test_batch_evidence_reports_stale_kind_and_hidden_roots_without_substitution(
    async_session,
    tmp_path,
    monkeypatch,  # noqa: ANN001
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        client = local_client(app)
        item = fixture.items["gesture"]
        try:
            stale_response = await client.post(
                "/v1/content/evidence:resolve",
                json={"schema_version": 1, "roots": [_root(item, revision="b" * 64)]},
            )
            assert stale_response.status_code == 200
            stale = stale_response.json()
            assert stale["complete"] is False
            assert stale["roots"] == []
            assert stale["diagnostics"][0]["code"] == "source_revision_changed"
            assert stale["diagnostics"][0]["expected_revision_sha256"] == "b" * 64
            assert stale["diagnostics"][0]["current_revision_sha256"] == item.revision_sha256

            wrong_kind_response = await client.post(
                "/v1/content/evidence:resolve",
                json={"schema_version": 1, "roots": [_root(item, kind="reaction")]},
            )
            assert wrong_kind_response.status_code == 200
            assert wrong_kind_response.json()["diagnostics"][0]["code"] == "source_kind_mismatch"

            response = await client.post(
                "/v1/content/evidence:resolve",
                json={
                    "schema_version": 1,
                    "roots": [
                        _root(item, revision="b" * 64),
                        _root(item, kind="reaction"),
                        {
                            "kind": "gesture",
                            "source": {"item_id": "hidden-item", "revision_sha256": "a" * 64},
                        },
                    ],
                },
            )
            assert response.status_code == 200
            body = response.json()
            assert body["complete"] is False
            assert body["roots"] == []
            codes = {item["code"] for item in body["diagnostics"]}
            assert codes == {"root_declaration_conflict", "source_unavailable"}
            hidden = next(item for item in body["diagnostics"] if item["root_key"] == "catalog:hidden-item")
            assert hidden["item_id"] is None
            assert hidden["current_revision_sha256"] is None
        finally:
            await client.aclose()


async def test_batch_evidence_rejects_delivery_and_unknown_fields(
    async_session,
    tmp_path,
    monkeypatch,  # noqa: ANN001
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = fixture.app(async_session, monkeypatch)
        client = local_client(app)
        try:
            root = _root(fixture.items["local-avatar"])
            root["source"]["url"] = "file:///tmp/avatar.vrm"
            response = await client.post(
                "/v1/content/evidence:resolve",
                json={"schema_version": 1, "roots": [root]},
            )
            assert response.status_code == 422
        finally:
            await client.aclose()
