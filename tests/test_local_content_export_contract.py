from __future__ import annotations

import json
import re
from pathlib import Path
from zipfile import ZipFile

from sqlalchemy import delete

from animama.app.contracts.content_package import PACKAGE_SCHEMA
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services, reviewed_export, save_wave


async def test_export_generates_a_self_contained_boundary_manifest_without_changing_local(
    async_session, tmp_path: Path
) -> None:  # noqa: ANN001
    paths, _catalog, _content, saves, packages = package_services(async_session, tmp_path)
    try:
        saved = await save_wave(saves)
        local_before = {
            path.relative_to(paths.local_root).as_posix(): path.read_bytes()
            for path in paths.local_root.rglob("*")
            if path.is_file()
        }

        exported = await reviewed_export(
            packages,
            user_id="package-owner",
            root_item_id=saved.item.id,
        )

        assert re.fullmatch(r"content-\d{8}-\d{6}Z\.zip", exported.filename)
        assert exported.item_count == 1
        assert exported.path.is_file()
        with ZipFile(exported.path) as archive:
            manifest = json.loads(archive.read("package.json"))
            assert manifest["schema"] == PACKAGE_SCHEMA
            assert manifest["root_entry_ids"] == ["entry-0001"]
            entry = manifest["entries"][0]
            assert entry["logical_key"] == "entry-0001"
            assert {key: value for key, value in entry["license"].items() if value is not None} == {
                "creator": "Animama test suite",
                "license": "fixture-only",
            }
            assert entry["dependencies"] == []
            assert {member["role"] for member in entry["files"]} == {
                "animation",
                "metadata",
            }
            for member in entry["files"]:
                assert archive.read(member["archive_path"])
            # Deterministic ZIP timestamps and member order make the same
            # closure reproducible across export operations.
            assert [member.filename for member in archive.infolist()] == [
                *(member["archive_path"] for member in entry["files"]),
                "package.json",
            ]
            assert all(member.date_time == (1980, 1, 1, 0, 0, 0) for member in archive.infolist())

        repeated = await reviewed_export(
            packages,
            user_id="package-owner",
            root_item_id=saved.item.id,
        )
        assert repeated.package_sha256 == exported.package_sha256
        assert repeated.path.read_bytes() == exported.path.read_bytes()

        local_after = {
            path.relative_to(paths.local_root).as_posix(): path.read_bytes()
            for path in paths.local_root.rglob("*")
            if path.is_file()
        }
        assert local_after == local_before
        assert not any(path.name == "package.json" for path in paths.local_root.rglob("*"))
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()
