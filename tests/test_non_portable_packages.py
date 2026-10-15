"""Non-portable content never leaves an installation as files (spec R3, R5)."""

from __future__ import annotations

import hashlib
import json
import shutil
from pathlib import Path
from uuid import uuid4
from zipfile import ZipFile

import pytest
from sqlalchemy import delete, select

from animama.adapters.repositories.sqlalchemy.anima_aggregate_uow import SQLAlchemyAnimaAggregateUnitOfWork
from animama.adapters.repositories.sqlalchemy.anima_package_source_repo import SQLAlchemyAnimaPackageSourceRepository
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.anima_creation_contract import CreateAnimaRequest
from animama.app.contracts.content_package import PackageManifest
from animama.app.services.anima_creation_sources import item_ref
from animama.app.services.anima_package_source_service import AnimaPackageSourceService
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService
from animama.domain.content_catalog import ContentConflictError, ContentKind, ContentSource
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


async def test_content_packages_refuse_non_portable_items_and_carry_no_references(
    async_session, tmp_path: Path
) -> None:  # noqa: ANN001
    paths, _catalog, content, _saves, packages = package_services(async_session, tmp_path)
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
    owner = "package-owner"
    try:
        items = {item.relative_locator: item for item in (await content.rescan(user_id=owner)).items}
        sway, own = items["gestures/sway"], items["gestures/own"]

        # A non-portable root is refused by name, in the summary and on prepare.
        with pytest.raises(ContentConflictError) as refused:
            await packages.summarize(user_id=owner, item_ids=(sway.id,))
        assert refused.value.code == "package_non_portable" and refused.value.items == ("Sway",)

        summary = await packages.summarize(user_id=owner, item_ids=(own.id,))
        assert summary.omitted == ()
        review = await packages.prepare_export(user_id=owner, item_ids=(own.id,), expected_digest=summary.digest)
        cached = await packages.get_export(user_id=owner, export_id=review.export_id)
        with ZipFile(cached.path) as archive:
            manifest = json.loads(archive.read("package.json"))
        assert "non_portable_references" not in manifest
        PackageManifest.model_validate(manifest)
        # Only an Anima package may name omitted items; hand-built references are refused.
        reference = {
            "kind": "gesture",
            "logical_key": "builtin:gesture:sway",
            "display_name": "Sway",
            "uses": [{"anima_slot": "idle", "pools": ["default"]}],
        }
        hostile = [
            {**manifest, "non_portable_references": [reference]},
            {
                **manifest,
                "capabilities": [*manifest["capabilities"], "animama/non-portable-references/1"],
                "non_portable_references": [reference],
            },
        ]
        for value in hostile:
            with pytest.raises(ValueError):
                PackageManifest.model_validate(value)
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
        # The seeded idle Gesture is non-portable too, so it travels as an idle reference.
        assert {use.anima_slot for ref in review.manifest.non_portable_references for use in ref.uses} == {
            "gesture",
            "idle",
        }
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
async def test_anima_export_omits_non_portable_idle_members_and_import_rebinds_them(
    async_session, tmp_path: Path, receiver_has_items: bool
) -> None:  # noqa: ANN001
    async with anima_creation_fixture(async_session, tmp_path, full_starter=True) as fixture:
        included = fixture.paths.included_root
        write_json(
            included / "licenses/inventory.json",
            {
                "rules": [
                    {"glob": "gestures/chat-glance/**", "license_id": "test", "distribution": "non-portable"},
                    {"glob": "**/*", "license_id": "test"},
                ]
            },
        )
        catalog = SQLAlchemyContentCatalog(async_session)
        content = ContentCatalogService(catalog=catalog, store=fixture.store())
        await content.rescan(user_id=fixture.owner)
        created = await fixture.service(async_session).create(user_id=fixture.owner, request=fixture.request())
        seeded = fixture.items["idle"]
        # The seed placed the Gesture in Default; add it to a cell as well.
        async_session.add(
            ORMAnimaContentBinding(
                id=str(uuid4()),
                anima_id=created["anima_id"],
                slot_key=f"idle:joy-2:{seeded.id}",
                kind="gesture",
                catalog_item_id=seeded.id,
                config={},
            )
        )
        await async_session.commit()
        packages = _packages(fixture, async_session, catalog, content)
        summary = await packages.summarize(user_id=fixture.owner, anima_id=created["anima_id"])
        assert [(item.kind, item.name) for item in summary.omitted] == [("gesture", "Chat Glance")]
        assert summary.anima is not None
        assert summary.anima.idle.default == [] and summary.anima.idle.cells == {}
        review = await packages.prepare_export(
            user_id=fixture.owner, anima_id=created["anima_id"], expected_digest=summary.digest
        )
        [reference] = review.manifest.non_portable_references
        assert [(use.anima_slot, use.pools) for use in reference.uses] == [("idle", ["default", "joy.2"])]
        cached = await packages.get_export(user_id=fixture.owner, export_id=review.export_id)
        if not receiver_has_items:
            shutil.rmtree(included / "gestures/chat-glance")
            await content.rescan(user_id=fixture.owner)
        command = await reviewed_import(
            packages, user_id=fixture.owner, archive_path=cached.path, operation_id=f"np-idle-{receiver_has_items}"
        )
        imported_review = await packages.imports.review(user_id=fixture.owner, stage_id=command["stage_id"])
        assert [item.outcome for item in imported_review.non_portable] == (
            ["rebound"] if receiver_has_items else ["unavailable"]
        )
        result = await packages.imports.commit(**command)
        slots = sorted(
            await async_session.scalars(
                select(ORMAnimaContentBinding.slot_key).where(
                    ORMAnimaContentBinding.anima_id == result.anima_id,
                    ORMAnimaContentBinding.slot_key.startswith("idle:"),
                )
            )
        )
        # An imported Anima keeps exactly its packaged pool and is never reseeded.
        assert slots == ([f"idle:default:{seeded.id}", f"idle:joy-2:{seeded.id}"] if receiver_has_items else [])


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
        scanned = await content.rescan(user_id=fixture.owner)
        # A non-portable Included Reaction in a pool blocks export; only Gestures may be omitted.
        starter = next(item for item in scanned.items if item.logical_key == "builtin:reaction:joy-1")
        request = fixture.request().model_dump()
        request["reactions"]["joy"]["2"] = [{"item_id": starter.id, "revision_sha256": starter.revision_sha256}]
        request["expected_source_revisions"][starter.id] = {
            "kind": "reaction",
            "revision_sha256": starter.revision_sha256,
        }
        created = await fixture.service(async_session).create(
            user_id=fixture.owner, request=CreateAnimaRequest.model_validate(request)
        )
        await async_session.commit()
        packages = _packages(fixture, async_session, catalog, content)
        with pytest.raises(ContentConflictError) as refused:
            await packages.summarize(user_id=fixture.owner, anima_id=created["anima_id"])
        assert refused.value.code == "package_non_portable" and refused.value.items
