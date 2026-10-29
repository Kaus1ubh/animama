"""Per-owner Avatar settings (wind and materials): the local routes, Local saves and packages."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import replace
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import pytest
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.avatar_setting_override_repo import (
    SQLAlchemyAvatarSettingOverrideRepository,
)
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.contracts.avatar_settings import AvatarSettingsUpdate
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.avatar_settings_service import AvatarSettingsService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService, ExportedContentPackage
from animama.app.services.content_save_service import ContentSaveService
from animama.domain.content_catalog import CatalogContentEntry, ContentKind, ContentNotFoundError, ContentStatus
from animama.domain.request_principal import RequestPrincipal
from animama.orm.avatar_setting_override import ORMAvatarSettingOverride
from animama.product_http.ports import ProductContent, install_product_ports
from animama.server.deps import get_current_principal
from animama.server.product_ports import LocalProductPorts
from animama.server.routers import avatar_settings
from tests.anima_creation_service_support import AnimaCreationFixture, anima_creation_fixture, vrm, write_json
from tests.content_package_helpers import reviewed_export, reviewed_import
from tests.local_http_client import local_client

DEFAULTS = {
    "spring_mode": "automatic",
    "spring_mode_source": "default",
    "wind_strength": 100,
    "wind_strength_source": "default",
    "material_mode": "automatic",
    "material_mode_source": "default",
}


def _app(fixture: AnimaCreationFixture, session: AsyncSession, monkeypatch: pytest.MonkeyPatch) -> FastAPI:
    """The fixture's local test app with the local settings routes mounted."""

    app = fixture.app(session, monkeypatch)
    app.include_router(avatar_settings.router)
    return app


def _service(session: AsyncSession) -> AvatarSettingsService:
    return AvatarSettingsService(
        catalog=SQLAlchemyContentCatalog(session), overrides=SQLAlchemyAvatarSettingOverrideRepository(session)
    )


async def _stored(session: AsyncSession, owner: str, item_id: str) -> tuple[str | None, str | None] | None:
    row = (
        await session.execute(
            select(ORMAvatarSettingOverride.spring_mode, ORMAvatarSettingOverride.material_mode).where(
                ORMAvatarSettingOverride.owner_user_id == owner,
                ORMAvatarSettingOverride.avatar_item_id == item_id,
            )
        )
    ).one_or_none()
    return None if row is None else (row.spring_mode, row.material_mode)


async def _rescan(session: AsyncSession, fixture: AnimaCreationFixture) -> dict[str, CatalogContentEntry]:
    content = ContentCatalogService(catalog=SQLAlchemyContentCatalog(session), store=fixture.store())
    items = {item.id: item for item in (await content.rescan(user_id=fixture.owner)).items}
    for name, item in fixture.items.items():
        fixture.items[name] = items[item.id]
    return items


def _packages(session: AsyncSession, fixture: AnimaCreationFixture, *, settings_store: bool) -> ContentPackageService:
    """A package service with or without the Avatar settings store (a composition that keeps none).

    Each composition stages under its own roots, so the per-owner stage limit
    applies to each separately.
    """

    catalog = SQLAlchemyContentCatalog(session)
    staging = fixture.paths.exports_staging_root.parent / ("stored" if settings_store else "unstored")
    return ContentPackageService(
        content=ContentCatalogService(catalog=catalog, store=fixture.store()),
        exports_root=staging / "exports",
        imports_root=staging / "imports",
        anima_sources=AnimaPackageSourceService(
            catalog=catalog, sources=SQLAlchemyAnimaPackageSourceRepository(session)
        ),
        uow=SQLAlchemyAnimaAggregateUnitOfWork(session),
        default_model_provider_id=fixture.provider,
        avatar_setting_overrides=SQLAlchemyAvatarSettingOverrideRepository(session) if settings_store else None,
    )


def _avatar_sidecar(exported: ExportedContentPackage) -> dict[str, Any]:
    """The exported Avatar's portable sidecar document."""

    with ZipFile(exported.path) as archive:
        manifest = json.loads(archive.read("package.json"))
        (entry,) = [value for value in manifest["entries"] if value["kind"] == "avatar"]
        (metadata,) = [file for file in entry["files"] if file["role"] == "metadata"]
        document: dict[str, Any] = json.loads(archive.read(metadata["archive_path"]))
        return document


async def test_settings_are_saved_per_owner_for_local_and_included_avatars(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        local_sidecar = fixture.paths.local_root / "avatars/local-avatar.meta.json"
        async with local_client(_app(fixture, async_session, monkeypatch)) as client:
            for name in ("local-avatar", "included-avatar"):
                avatar = fixture.items[name]
                path = f"/v1/avatar-content/{avatar.id}/settings"
                initial = await client.get(path)
                assert initial.status_code == 200, initial.text
                assert initial.json() == {"item_id": avatar.id, **DEFAULTS}

                wind = await client.put(path, json={"spring_mode": "springs_off"})
                assert wind.status_code == 200, wind.text
                assert wind.json() == {
                    **DEFAULTS,
                    "item_id": avatar.id,
                    "spring_mode": "springs_off",
                    "spring_mode_source": "stored",
                }
                # An omitted field keeps its stored value.
                both = await client.put(path, json={"material_mode": "simple"})
                assert both.status_code == 200, both.text
                expected = {
                    **DEFAULTS,
                    "item_id": avatar.id,
                    "spring_mode": "springs_off",
                    "spring_mode_source": "stored",
                    "material_mode": "simple",
                    "material_mode_source": "stored",
                }
                assert both.json() == expected
                assert (await client.get(path)).json() == expected
                assert await _stored(async_session, fixture.owner, avatar.id) == ("springs_off", "simple")

                # null clears one setting; automatic clears the last and removes the row.
                cleared = await client.put(path, json={"spring_mode": None})
                assert cleared.json() == {
                    **DEFAULTS,
                    "item_id": avatar.id,
                    "material_mode": "simple",
                    "material_mode_source": "stored",
                }
                assert (await client.put(path, json={"material_mode": "automatic"})).json() == {
                    "item_id": avatar.id,
                    **DEFAULTS,
                }
                assert await _stored(async_session, fixture.owner, avatar.id) is None
                unchanged = await client.put(path, json={})
                assert unchanged.status_code == 200 and unchanged.json() == {"item_id": avatar.id, **DEFAULTS}

            # Settings never write Avatar files or change a revision.
            revisions = {name: fixture.items[name].revision_sha256 for name in ("local-avatar", "included-avatar")}
            await client.put(
                f"/v1/avatar-content/{fixture.items['local-avatar'].id}/settings", json={"spring_mode": "off"}
            )
            await _rescan(async_session, fixture)
            assert {name: fixture.items[name].revision_sha256 for name in revisions} == revisions
            assert not local_sidecar.exists()

        # Each owner has their own settings for a shared Included Avatar.
        included = fixture.items["included-avatar"]
        other = await fixture.add_owner(async_session)
        assert (await _service(async_session).get(user_id=other, item_id=included.id)).spring_mode == "automatic"
        saved = await _service(async_session).save(
            user_id=other, item_id=included.id, update=AvatarSettingsUpdate(spring_mode="on")
        )
        assert saved.spring_mode == "on" and saved.spring_mode_source == "stored"
        assert await _stored(async_session, fixture.owner, included.id) is None
        assert await _stored(async_session, other, included.id) == ("on", None)


async def test_wind_strength_is_saved_as_a_percent_and_100_clears_it(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        avatar = fixture.items["local-avatar"]
        path = f"/v1/avatar-content/{avatar.id}/settings"
        async with local_client(_app(fixture, async_session, monkeypatch)) as client:
            saved = await client.put(path, json={"wind_strength": 40})
            assert saved.status_code == 200, saved.text
            assert saved.json() == {
                **DEFAULTS,
                "item_id": avatar.id,
                "wind_strength": 40,
                "wind_strength_source": "stored",
            }
            # Another setting keeps it; the default strength clears it and the row.
            assert (await client.put(path, json={"spring_mode": "on"})).json()["wind_strength"] == 40
            await client.put(path, json={"spring_mode": None})
            cleared = await client.put(path, json={"wind_strength": 100})
            assert cleared.json() == {"item_id": avatar.id, **DEFAULTS}
            assert await _stored(async_session, fixture.owner, avatar.id) is None
            for strength in (-1, 201, 1.5, "40"):
                response = await client.put(path, json={"wind_strength": strength})
                assert response.status_code == 422, strength
            assert (await client.put(path, json={"wind_strength": 0})).json()["wind_strength"] == 0
            assert (await client.put(path, json={"wind_strength": None})).json()["wind_strength_source"] == "default"


async def test_settings_routes_report_unknown_foreign_and_invalid_requests(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        avatar = fixture.items["local-avatar"]
        app = _app(fixture, async_session, monkeypatch)
        async with local_client(app) as client:
            for item_id in ("not-an-item", fixture.items["gesture"].id):
                for response in (
                    await client.get(f"/v1/avatar-content/{item_id}/settings"),
                    await client.put(f"/v1/avatar-content/{item_id}/settings", json={"spring_mode": "on"}),
                ):
                    assert response.status_code == 404, response.text
                    assert response.json()["detail"] == {"code": "content_not_found"}
            path = f"/v1/avatar-content/{avatar.id}/settings"
            for body in ({"spring_mode": "windy"}, {"material_mode": "mtoon"}, {"face_parts": None}):
                assert (await client.put(path, json=body)).status_code == 422, body
            assert (await client.put(path, json={"material_mode": "liltoon"})).status_code == 200

            # Another owner cannot read or change this owner's Local Avatar.
            other = await fixture.add_owner(async_session)
            app.dependency_overrides[get_current_principal] = lambda: RequestPrincipal(id=other)
            for response in (await client.get(path), await client.put(path, json={"spring_mode": "on"})):
                assert response.status_code == 404, response.text
        assert await _stored(async_session, fixture.owner, avatar.id) == (None, "liltoon")
        assert await _stored(async_session, other, avatar.id) is None
        with pytest.raises(ContentNotFoundError):
            await _service(async_session).get(user_id=other, item_id=avatar.id)


async def test_local_sidecars_never_carry_or_apply_settings(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        saves = ContentSaveService(
            content=ContentCatalogService(catalog=SQLAlchemyContentCatalog(async_session), store=fixture.store())
        )
        saved = await saves.save_standalone(
            user_id=fixture.owner,
            kind=ContentKind.AVATAR,
            entry_name="saved-avatar",
            filename="saved-avatar.vrm",
            payload=vrm("A saved Avatar"),
            metadata_sidecar=json.dumps({"name": "Saved", "spring_mode": "off", "material_mode": "simple"}).encode(),
            operation_id="avatar-settings-save",
            catalog_item_id=None,
            expected_revision=None,
        )
        sidecar = fixture.paths.local_root / Path(saved.item.relative_locator).with_suffix(".meta.json")
        assert json.loads(sidecar.read_text()) == {"name": "Saved"}

        # A hand-edited sidecar value is admitted but never applied.
        write_json(fixture.paths.local_root / "avatars/local-avatar.meta.json", {"spring_mode": "on"})
        await _rescan(async_session, fixture)
        avatar = fixture.items["local-avatar"]
        assert avatar.status is ContentStatus.VALID
        async with local_client(_app(fixture, async_session, monkeypatch)) as client:
            state = (await client.get(f"/v1/avatar-content/{avatar.id}/settings")).json()
        assert state == {"item_id": avatar.id, **DEFAULTS}

        write_json(fixture.paths.local_root / "avatars/local-avatar.meta.json", {"spring_mode": "windy"})
        await _rescan(async_session, fixture)
        assert fixture.items["local-avatar"].status is ContentStatus.INVALID
        assert {value.code for value in fixture.items["local-avatar"].diagnostics} == {"avatar_setting_invalid"}


async def test_package_export_writes_only_the_exporters_stored_settings(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        # A value in the source sidecar is not the exporter's setting.
        write_json(fixture.paths.local_root / "avatars/local-avatar.meta.json", {"spring_mode": "on"})
        await _rescan(async_session, fixture)
        avatar = fixture.items["local-avatar"]
        packages = _packages(async_session, fixture, settings_store=True)
        without_value = await packages.summarize(user_id=fixture.owner, item_ids=(avatar.id,))
        document = _avatar_sidecar(await reviewed_export(packages, user_id=fixture.owner, root_item_id=avatar.id))
        assert "spring_mode" not in document and "material_mode" not in document

        async with local_client(_app(fixture, async_session, monkeypatch)) as client:
            saved = await client.put(
                f"/v1/avatar-content/{avatar.id}/settings",
                json={"spring_mode": "off", "wind_strength": 60, "material_mode": "simple"},
            )
            assert saved.status_code == 200, saved.text
        # The stored settings are part of the reviewed export.
        with_value = await packages.summarize(user_id=fixture.owner, item_ids=(avatar.id,))
        assert with_value.digest != without_value.digest
        document = _avatar_sidecar(await reviewed_export(packages, user_id=fixture.owner, root_item_id=avatar.id))
        assert (document["spring_mode"], document["wind_strength"], document["material_mode"]) == ("off", 60, "simple")

        # A composition without the store exports none.
        unstored = _packages(async_session, fixture, settings_store=False)
        document = _avatar_sidecar(await reviewed_export(unstored, user_id=fixture.owner, root_item_id=avatar.id))
        assert "spring_mode" not in document and "material_mode" not in document


async def _import(
    session: AsyncSession, fixture: AnimaCreationFixture, packages: ContentPackageService, archive: Path, operation: str
) -> tuple[Any, CatalogContentEntry]:
    """Review and commit one package; return its review and the imported Avatar."""

    command = await reviewed_import(packages, user_id=fixture.owner, archive_path=archive, operation_id=operation)
    review = await packages.imports.review(user_id=fixture.owner, stage_id=command["stage_id"])
    result = await packages.imports.commit(**command)
    # Anything read below survived this rollback, so the import committed it.
    await session.rollback()
    # The replayed receipt is unchanged: it never records notices.
    assert all("notices" not in item.model_dump() for item in result.items)
    copied_id = next(item.item_id for item in result.items if item.kind is ContentKind.AVATAR)
    fixture.extra_catalog_ids.add(copied_id)
    copied = await SQLAlchemyContentCatalog(session).get_visible_item(item_id=copied_id, user_id=fixture.owner)
    assert copied is not None and copied.source.value == "local"
    sidecar = fixture.paths.local_root / Path(copied.relative_locator).with_suffix(".meta.json")
    stored_document = json.loads(sidecar.read_text())
    assert "spring_mode" not in stored_document and "material_mode" not in stored_document
    return review, copied


async def test_import_moves_packaged_settings_into_the_importers_table(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        avatar = fixture.items["included-avatar"]
        async with local_client(_app(fixture, async_session, monkeypatch)) as client:
            saved = await client.put(
                f"/v1/avatar-content/{avatar.id}/settings",
                json={"spring_mode": "springs_off", "wind_strength": 150, "material_mode": "liltoon"},
            )
            assert saved.status_code == 200, saved.text
        packages = _packages(async_session, fixture, settings_store=True)
        exported = await reviewed_export(packages, user_id=fixture.owner, root_item_id=avatar.id)

        review, copied = await _import(async_session, fixture, packages, exported.path, "avatar-settings-copy")
        assert all(item.notices == () for item in review.items)
        assert copied.id != avatar.id
        assert await _stored(async_session, fixture.owner, copied.id) == ("springs_off", "liltoon")
        state = await _service(async_session).get(user_id=fixture.owner, item_id=copied.id)
        assert (state.spring_mode, state.spring_mode_source) == ("springs_off", "stored")
        assert (state.material_mode, state.material_mode_source) == ("liltoon", "stored")
        assert (state.wind_strength, state.wind_strength_source) == (150, "stored")
        assert await _stored(async_session, fixture.owner, avatar.id) == ("springs_off", "liltoon")


async def test_a_composition_without_the_store_drops_imported_settings_with_a_notice(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        avatar = fixture.items["local-avatar"]
        async with local_client(_app(fixture, async_session, monkeypatch)) as client:
            saved = await client.put(f"/v1/avatar-content/{avatar.id}/settings", json={"material_mode": "simple"})
            assert saved.status_code == 200, saved.text
        exported = await reviewed_export(
            _packages(async_session, fixture, settings_store=True), user_id=fixture.owner, root_item_id=avatar.id
        )
        assert _avatar_sidecar(exported)["material_mode"] == "simple"

        unstored = _packages(async_session, fixture, settings_store=False)
        review, copied = await _import(async_session, fixture, unstored, exported.path, "avatar-settings-dropped")
        (avatar_item,) = [item for item in review.items if item.kind is ContentKind.AVATAR]
        assert avatar_item.notices == ("avatar_setting_not_stored",)
        assert all(item.notices == () for item in review.items if item is not avatar_item)
        assert await _stored(async_session, fixture.owner, copied.id) is None


class _PortsWithoutSettings(LocalProductPorts):
    """The local ports, but with content services that store no Avatar settings."""

    @asynccontextmanager
    async def content(self, session: AsyncSession, principal: RequestPrincipal) -> AsyncIterator[ProductContent]:
        async with super().content(session, principal) as content:
            yield replace(content, avatar_settings=None)


async def test_routes_report_a_composition_without_the_settings_store(
    async_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    async with anima_creation_fixture(async_session, tmp_path) as fixture:
        app = _app(fixture, async_session, monkeypatch)
        install_product_ports(app, _PortsWithoutSettings(app))
        path = f"/v1/avatar-content/{fixture.items['included-avatar'].id}/settings"
        async with local_client(app) as client:
            for response in (await client.get(path), await client.put(path, json={"spring_mode": "on"})):
                assert response.status_code == 503, response.text
                assert response.json()["detail"] == {"code": "avatar_settings_unavailable"}
