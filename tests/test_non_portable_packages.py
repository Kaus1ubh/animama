"""Non-portable content never leaves an installation as files (spec R3, R5)."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from typing import Any
from zipfile import ZipFile

import pytest
from sqlalchemy import delete, select, update

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.anima_creation_contract import CreateAnimaRequest
from animama.app.contracts.content_package import PackageManifest
from animama.app.services.anima_creation_sources import item_ref
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService
from animama.app.services.non_portable_packages import restore_idle_refs, strip_idle_refs
from animama.domain.content_catalog import ContentConflictError, ContentKind, ContentSource
from animama.orm.anima_loadout import ORMAnimaLoadout
from animama.orm.content_catalog import ORMAnimaContentBinding, ORMContentCatalogItem
from tests.anima_creation_service_support import anima_creation_fixture, write_json
from tests.content_package_helpers import package_services, reviewed_import, vrma
from tests.test_content_gltf import _fixture_document, _glb_source

_RULE = {"creator": "Fixture", "license_id": "fixture-only", "provenance": "Fixture"}


def _motion(label: str) -> bytes:
    """A playable VRMA with a finite timeline and distinct bytes per label."""

    document, binary = _fixture_document(buffer_uri=None)
    document["extras"] = {"label": label}
    return _glb_source(document, binary)


def _restrict(monkeypatch: pytest.MonkeyPatch, *payloads: bytes) -> None:
    """Stand in for the tracked Mixamo-motion manifest."""

    hashes = frozenset(hashlib.sha256(payload).hexdigest() for payload in payloads)
    monkeypatch.setattr("animama.adapters.content_store.filesystem_store.manifest_sha256", lambda: hashes)


def _gesture(root: Path, name: str, payload: bytes) -> None:
    folder = root / "gestures" / name
    folder.mkdir(parents=True)
    (folder / "motion.vrma").write_bytes(payload)
    write_json(
        folder / f"{name}.meta.json",
        {
            "schema_version": 1,
            "content_type": "gesture",
            "content_id": f"builtin:gesture:{name}",
            "name": name.title(),
            "semantic_key": name,
            "implementation": {"kind": "vrma", "file_role": "animation"},
            "files": [{"path": "motion.vrma", "role": "animation"}],
        },
    )


def _style(root: Path, pools: dict[str, Any]) -> None:
    refs = sorted(
        set(pools.get("default_pool", []))
        | {
            ref
            for levels in pools.get("cells", {}).values()
            for cell in levels.values()
            for ref in cell.get("gestures", [])
        }
    )
    write_json(
        root / "idle-styles/mixed/mixed.json",
        {
            "schema_version": 2,
            "content_type": "idle_style",
            "content_id": "local:idle-style:mixed",
            "name": "Mixed",
            "default_pool": pools.get("default_pool", []),
            "cells": pools.get("cells", {}),
            "dependencies": [{"ref": ref, "content_type": "gesture"} for ref in refs],
        },
    )


def test_idle_refs_strip_and_restore_round_trip() -> None:
    projection: dict[str, Any] = {
        "default_pool": ["builtin:gesture:sway", "local:gesture:own"],
        "cells": {"joy": {"2": {"mode": "pool", "gestures": ["builtin:gesture:sway"]}, "3": {"mode": "none"}}},
        "dependencies": [
            {"ref": "builtin:gesture:sway", "content_type": "gesture"},
            {"ref": "local:gesture:own", "content_type": "gesture"},
        ],
    }
    stripped = strip_idle_refs(projection, {"builtin:gesture:sway"})
    assert stripped["default_pool"] == ["local:gesture:own"]
    assert stripped["cells"] == {"joy": {"3": {"mode": "none"}}}
    assert stripped["dependencies"] == [{"ref": "local:gesture:own", "content_type": "gesture"}]
    restored = restore_idle_refs(stripped, {"builtin:gesture:sway": ["default", "joy.2"]})
    assert sorted(restored["default_pool"]) == sorted(projection["default_pool"])
    assert restored["cells"]["joy"]["2"] == {"mode": "pool", "gestures": ["builtin:gesture:sway"]}
    assert {edge["ref"] for edge in restored["dependencies"]} == {"builtin:gesture:sway", "local:gesture:own"}


async def test_content_export_and_import_handle_non_portable_items(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths, catalog, content, _saves, packages = package_services(async_session, tmp_path)
    write_json(
        paths.included_licenses_root / "inventory.json",
        {
            "schema_version": 1,
            "rules": [{"glob": "gestures/**", "distribution": "non-portable", **_RULE}, {"glob": "**", **_RULE}],
        },
    )
    _gesture(paths.included_root, "sway", _motion("sway"))
    local = paths.local_root
    _gesture(local, "own", _motion("own"))
    for path in (local / "gestures/own").iterdir():
        if path.suffix == ".json":
            document = json.loads(path.read_text())
            document["content_id"] = "local:gesture:own"
            write_json(path, document)
    _style(
        local,
        {
            "default_pool": ["builtin:gesture:sway", "local:gesture:own"],
            "cells": {"joy": {"2": {"mode": "pool", "gestures": ["builtin:gesture:sway"]}}},
        },
    )
    owner = "package-owner"
    try:
        items = {item.relative_locator: item for item in (await content.rescan(user_id=owner)).items}
        sway, style = items["gestures/sway"], items["idle-styles/mixed"]

        # A non-portable root is refused by name, in the summary and on prepare.
        with pytest.raises(ContentConflictError) as refused:
            await packages.summarize(user_id=owner, item_ids=(sway.id,))
        assert refused.value.code == "package_non_portable" and refused.value.items == ("Sway",)

        # A portable Idle Style drops the non-portable Gesture and records where it was used.
        summary = await packages.summarize(user_id=owner, item_ids=(style.id,))
        assert [(item.kind, item.name) for item in summary.omitted] == [("gesture", "Sway")]
        review = await packages.prepare_export(user_id=owner, item_ids=(style.id,), expected_digest=summary.digest)
        cached = await packages.get_export(user_id=owner, export_id=review.export_id)
        with ZipFile(cached.path) as archive:
            names = archive.namelist()
            manifest = json.loads(archive.read("package.json"))
        assert all("sway" not in name for name in names)
        assert sway.files[0].sha256 not in {entry["sha256"] for e in manifest["entries"] for entry in e["files"]}
        [reference] = manifest["non_portable_references"]
        assert reference["logical_key"] == "builtin:gesture:sway"
        assert reference["uses"][0]["pools"] == ["default", "joy.2"]
        PackageManifest.model_validate(manifest)
        # Hand-built packages are validated too: capability, duplicates and use targets.
        style_entry = next(entry["package_entry_id"] for entry in manifest["entries"] if entry["kind"] == "idle_style")
        own_entry = next(entry["package_entry_id"] for entry in manifest["entries"] if entry["kind"] == "gesture")

        def uses(*values: dict[str, object]) -> dict[str, object]:
            return {**manifest, "non_portable_references": [{**reference, "uses": list(values)}]}

        hostile = [
            {**manifest, "capabilities": []},
            {**manifest, "non_portable_references": [reference, reference]},
            uses({"entry_id": own_entry, "pools": ["default"]}),
            uses({"entry_id": style_entry, "pools": ["bogus.9"]}),
            uses({"anima_slot": "gesture", "semantic_key": "sway"}),
            uses({"anima_slot": "gesture"}),
            {**manifest, "non_portable_references": [{**reference, "kind": "avatar"}]},
        ]
        for value in hostile:
            with pytest.raises(ValueError):
                PackageManifest.model_validate(value)

        # Rebound where this installation has the same non-portable item.
        command = await reviewed_import(packages, user_id=owner, archive_path=cached.path, operation_id="np-rebind")
        imported_review = await packages.imports.review(user_id=owner, stage_id=command["stage_id"])
        assert [(item.name, item.outcome) for item in imported_review.non_portable] == [("Sway", "rebound")]
        result = await packages.imports.commit(**command)
        new_style = next(item for item in result.items if item.kind is ContentKind.IDLE_STYLE)
        imported = await catalog.get_visible_item(item_id=new_style.item_id, user_id=owner)
        assert "builtin:gesture:sway" in imported.metadata["default_pool"]
        assert sway.id in imported.dependency_item_ids

        # Falls back in an installation without the non-portable item.
        _paths, receiver_catalog, receiver, _saves, receiver_packages = package_services(
            async_session, tmp_path / "receiver"
        )
        await receiver.rescan(user_id=owner)
        command = await reviewed_import(
            receiver_packages, user_id=owner, archive_path=cached.path, operation_id="np-fallback"
        )
        fallback_review = await receiver_packages.imports.review(user_id=owner, stage_id=command["stage_id"])
        assert [(item.name, item.outcome) for item in fallback_review.non_portable] == [("Sway", "unavailable")]
        result = await receiver_packages.imports.commit(**command)
        new_style = next(item for item in result.items if item.kind is ContentKind.IDLE_STYLE)
        imported = await receiver_catalog.get_visible_item(item_id=new_style.item_id, user_id=owner)
        assert all("sway" not in ref for ref in imported.metadata["default_pool"])
        assert "joy" not in imported.metadata.get("cells", {})
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


async def test_restricted_bytes_are_refused_on_save_and_import(
    async_session, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:  # noqa: ANN001
    paths, _catalog, content, saves, packages = package_services(async_session, tmp_path)
    owner = "package-owner"
    restricted = vrma("restricted")
    try:
        saved = await saves.save_standalone(
            user_id=owner,
            kind=ContentKind.GESTURE,
            entry_name="Copied",
            filename="copied.vrma",
            payload=restricted,
            metadata_sidecar=json.dumps({"schema_version": 1, "id": "local:gesture:copied", "name": "Copied"}).encode(),
            operation_id="save-before-manifest",
            catalog_item_id=None,
            expected_revision=None,
        )
        summary = await packages.summarize(user_id=owner, item_ids=(saved.item.id,))
        review = await packages.prepare_export(user_id=owner, item_ids=(saved.item.id,), expected_digest=summary.digest)
        cached = await packages.get_export(user_id=owner, export_id=review.export_id)

        # The same bytes become restricted (as when the tracked manifest gains them).
        _restrict(monkeypatch, restricted)
        _paths2, _catalog2, _content2, saves, packages = package_services(async_session, tmp_path / "second")
        with pytest.raises(ContentConflictError) as refused:
            await saves.save_standalone(
                user_id=owner,
                kind=ContentKind.GESTURE,
                entry_name="Copied again",
                filename="again.vrma",
                payload=restricted,
                metadata_sidecar=None,
                operation_id="save-restricted",
                catalog_item_id=None,
                expected_revision=None,
            )
        assert refused.value.code == "content_non_portable"
        with pytest.raises(ContentConflictError) as rejected:
            await reviewed_import(packages, user_id=owner, archive_path=cached.path, operation_id="import-restricted")
        assert rejected.value.code == "package_non_portable" and rejected.value.items == ("Copied",)
        assert restricted.hex() not in str(rejected.value)
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


@pytest.mark.parametrize("receiver_has_items", [True, False])
async def test_anima_export_omits_explicit_non_portable_gestures_and_import_rebinds_them(
    async_session, tmp_path: Path, receiver_has_items: bool
) -> None:  # noqa: ANN001
    async with anima_creation_fixture(async_session, tmp_path, full_starter=True) as fixture:
        write_json(
            fixture.paths.included_root / "licenses/inventory.json",
            {
                "rules": [
                    {"glob": "gestures/**", "license_id": "test", "distribution": "non-portable"},
                    {"glob": "**/*", "license_id": "test"},
                ]
            },
        )
        catalog = SQLAlchemyContentCatalog(async_session)
        content = ContentCatalogService(catalog=catalog, store=fixture.store())
        visible = (await content.rescan(user_id=fixture.owner)).items
        starters = [
            item for item in visible if item.source is ContentSource.INCLUDED and item.kind is ContentKind.GESTURE
        ][:2]
        assert len(starters) == 2 and all(item.provenance["distribution"] == "non-portable" for item in starters)
        request = fixture.request().model_dump()
        request["gestures"] = [
            {"semantic_key": item.metadata["semantic_key"], "source": item_ref(item)} for item in starters
        ]
        request["expected_source_revisions"].update(
            {item.id: {"kind": "gesture", "revision_sha256": item.revision_sha256} for item in starters}
        )
        created = await fixture.service(async_session).create(
            user_id=fixture.owner, request=CreateAnimaRequest.model_validate(request)
        )
        sources = AnimaPackageSourceService(
            catalog=catalog, sources=SQLAlchemyAnimaPackageSourceRepository(async_session)
        )
        packages = ContentPackageService(
            content=content,
            exports_root=fixture.paths.exports_staging_root,
            imports_root=fixture.paths.imports_staging_root,
            anima_sources=sources,
            uow=SQLAlchemyAnimaAggregateUnitOfWork(async_session),
            default_model_provider_id=fixture.provider,
        )
        summary = await packages.summarize(user_id=fixture.owner, anima_id=created["anima_id"])
        assert summary.omitted and {item.kind for item in summary.omitted} == {"gesture"}
        assert summary.anima is not None and not summary.anima.gestures
        review = await packages.prepare_export(
            user_id=fixture.owner, anima_id=created["anima_id"], expected_digest=summary.digest
        )
        assert {use.anima_slot for ref in review.manifest.non_portable_references for use in ref.uses} == {"gesture"}
        assert not any(entry.kind is ContentKind.GESTURE for entry in review.manifest.entries)
        cached = await packages.get_export(user_id=fixture.owner, export_id=review.export_id)
        if not receiver_has_items:
            shutil.rmtree(fixture.paths.included_root / "gestures")
            await content.rescan(user_id=fixture.owner)
        command = await reviewed_import(
            packages, user_id=fixture.owner, archive_path=cached.path, operation_id=f"np-anima-{receiver_has_items}"
        )
        imported_review = await packages.imports.review(user_id=fixture.owner, stage_id=command["stage_id"])
        outcomes = {item.outcome for item in imported_review.non_portable}
        assert outcomes == ({"rebound"} if receiver_has_items else {"unavailable"})
        result = await packages.imports.commit(**command)
        bound = list(
            await async_session.scalars(
                select(ORMAnimaContentBinding.catalog_item_id).where(
                    ORMAnimaContentBinding.anima_id == result.anima_id, ORMAnimaContentBinding.kind == "gesture"
                )
            )
        )
        included = {
            item.id
            for item in await catalog.list_visible(user_id=fixture.owner)
            if item.source is ContentSource.INCLUDED and item.kind is ContentKind.GESTURE
        }
        if receiver_has_items:
            assert bound and set(bound) <= included and len(bound) == len(summary.omitted)
        else:
            assert not bound


async def test_prepare_rechecks_portability_after_the_summary(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths, _catalog, content, _saves, packages = package_services(async_session, tmp_path)
    inventory = paths.included_licenses_root / "inventory.json"
    write_json(inventory, {"schema_version": 1, "rules": [{"glob": "**", **_RULE}]})
    _gesture(paths.included_root, "sway", _motion("sway"))
    owner = "package-owner"
    try:
        items = {item.relative_locator: item for item in (await content.rescan(user_id=owner)).items}
        summary = await packages.summarize(user_id=owner, item_ids=(items["gestures/sway"].id,))
        write_json(
            inventory,
            {"schema_version": 1, "rules": [{"glob": "**", "distribution": "non-portable", **_RULE}]},
        )
        with pytest.raises(ContentConflictError) as refused:
            await packages.prepare_export(
                user_id=owner, item_ids=(items["gestures/sway"].id,), expected_digest=summary.digest
            )
        assert refused.value.code == "package_non_portable"
        assert not list(paths.exports_staging_root.rglob("*.zip"))
    finally:
        await async_session.rollback()
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


def _packages(fixture, async_session, catalog, content):  # noqa: ANN001, ANN202
    sources = AnimaPackageSourceService(catalog=catalog, sources=SQLAlchemyAnimaPackageSourceRepository(async_session))
    return ContentPackageService(
        content=content,
        exports_root=fixture.paths.exports_staging_root,
        imports_root=fixture.paths.imports_staging_root,
        anima_sources=sources,
        uow=SQLAlchemyAnimaAggregateUnitOfWork(async_session),
        default_model_provider_id=fixture.provider,
    )


@pytest.mark.parametrize("receiver_has_items", [True, False])
async def test_anima_export_omits_implicit_starter_gestures_and_idle_style(
    async_session, tmp_path: Path, receiver_has_items: bool
) -> None:  # noqa: ANN001
    async with anima_creation_fixture(async_session, tmp_path, full_starter=True) as fixture:
        included = fixture.paths.included_root
        # The shipped Mixamo Idle Style is v2 and pools Gestures; mirror that.
        (included / "idle-styles/starter/calm.vrma").unlink()
        write_json(
            included / "idle-styles/starter/starter.json",
            {
                "schema_version": 2,
                "content_type": "idle_style",
                "content_id": "builtin:idle-style:starter",
                "name": "Starter Idle",
                "default_pool": ["builtin:gesture:shy-finger-poke-loop"],
                "cells": {},
                "dependencies": [{"ref": "builtin:gesture:shy-finger-poke-loop", "content_type": "gesture"}],
            },
        )
        write_json(
            included / "licenses/inventory.json",
            {
                "rules": [
                    {"glob": "gestures/**", "license_id": "test", "distribution": "non-portable"},
                    {"glob": "idle-styles/**", "license_id": "test", "distribution": "non-portable"},
                    {"glob": "**/*", "license_id": "test"},
                ]
            },
        )
        catalog = SQLAlchemyContentCatalog(async_session)
        content = ContentCatalogService(catalog=catalog, store=fixture.store())
        await content.rescan(user_id=fixture.owner)
        created = await fixture.service(async_session).create(user_id=fixture.owner, request=fixture.request())
        # Make every starter Gesture and the starter Idle Style implicit choices.
        loadout = await async_session.get(ORMAnimaLoadout, created["anima_id"])
        assert loadout is not None
        reaction_exclusions = [row for row in loadout.starter_exclusions if row["slot"] == "reaction"]
        await async_session.execute(
            update(ORMAnimaLoadout)
            .where(ORMAnimaLoadout.anima_id == created["anima_id"])
            .values(starter_exclusions=reaction_exclusions, idle_style_empty=False)
        )
        await async_session.commit()
        packages = _packages(fixture, async_session, catalog, content)
        summary = await packages.summarize(user_id=fixture.owner, anima_id=created["anima_id"])
        kinds = [item.kind for item in summary.omitted]
        assert kinds.count("idle_style") == 1 and kinds.count("gesture") > 1
        assert summary.anima is not None and summary.anima.idle_style is None and not summary.anima.gestures
        review = await packages.prepare_export(
            user_id=fixture.owner, anima_id=created["anima_id"], expected_digest=summary.digest
        )
        cached = await packages.get_export(user_id=fixture.owner, export_id=review.export_id)
        if not receiver_has_items:
            shutil.rmtree(included / "gestures")
            shutil.rmtree(included / "idle-styles")
            await content.rescan(user_id=fixture.owner)
        command = await reviewed_import(
            packages, user_id=fixture.owner, archive_path=cached.path, operation_id=f"np-implicit-{receiver_has_items}"
        )
        imported_review = await packages.imports.review(user_id=fixture.owner, stage_id=command["stage_id"])
        assert {item.outcome for item in imported_review.non_portable} == (
            {"rebound"} if receiver_has_items else {"unavailable"}
        )
        result = await packages.imports.commit(**command)
        rows = list(
            await async_session.scalars(
                select(ORMAnimaContentBinding).where(ORMAnimaContentBinding.anima_id == result.anima_id)
            )
        )
        idle = [row for row in rows if row.kind == "idle_style"]
        gestures = [row for row in rows if row.kind == "gesture"]
        if receiver_has_items:
            starter_idle = next(
                item
                for item in await catalog.list_visible(user_id=fixture.owner)
                if item.logical_key == "builtin:idle-style:starter"
            )
            assert [row.catalog_item_id for row in idle] == [starter_idle.id]
            assert len(gestures) == kinds.count("gesture")
        else:
            assert not idle and not gestures


async def test_anima_export_refuses_other_non_portable_bindings(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    async with anima_creation_fixture(async_session, tmp_path, full_starter=True) as fixture:
        write_json(
            fixture.paths.included_root / "licenses/inventory.json",
            {
                "rules": [
                    {"glob": "reactions/**", "license_id": "test", "distribution": "non-portable"},
                    {"glob": "**/*", "license_id": "test"},
                ]
            },
        )
        catalog = SQLAlchemyContentCatalog(async_session)
        content = ContentCatalogService(catalog=catalog, store=fixture.store())
        await content.rescan(user_id=fixture.owner)
        created = await fixture.service(async_session).create(user_id=fixture.owner, request=fixture.request())
        await async_session.execute(
            update(ORMAnimaLoadout).where(ORMAnimaLoadout.anima_id == created["anima_id"]).values(starter_exclusions=[])
        )
        await async_session.commit()
        packages = _packages(fixture, async_session, catalog, content)
        with pytest.raises(ContentConflictError) as refused:
            await packages.summarize(user_id=fixture.owner, anima_id=created["anima_id"])
        assert refused.value.code == "package_non_portable" and refused.value.items
