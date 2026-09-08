from __future__ import annotations

import json
import struct
from pathlib import Path

from sqlalchemy import delete

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.domain.content_catalog import ContentStatus
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime


def _glb() -> bytes:
    document = json.dumps(
        {
            "asset": {"version": "2.0"},
            "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
        },
        separators=(",", ":"),
    ).encode()
    document += b" " * (-len(document) % 4)
    return (
        struct.pack("<4sII", b"glTF", 2, 20 + len(document)) + struct.pack("<II", len(document), 0x4E4F534A) + document
    )


async def test_rescan_handles_add_edit_rename_invalid_and_delete(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    store = FilesystemContentStore(
        included_root=paths.included_root,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )
    service = ContentCatalogService(
        store=store,
        catalog=SQLAlchemyContentCatalog(async_session),
    )
    wave = paths.local_root / "gestures/wave.vrma"
    wave.write_bytes(_glb())

    first = await service.rescan(user_id="owner-a", include_included=False)
    first_item = next(item for item in first.items if item.relative_locator == "gestures/wave.vrma")
    assert first_item.status is ContentStatus.VALID

    renamed = paths.local_root / "gestures/hello.vrma"
    wave.rename(renamed)
    (paths.local_root / "pose-clips/broken.json").write_text("{", encoding="utf-8")
    second = await service.rescan(user_id="owner-a", include_included=False)
    renamed_item = next(item for item in second.items if item.relative_locator == "gestures/hello.vrma")
    broken = next(item for item in second.items if item.relative_locator == "pose-clips/broken.json")
    assert renamed_item.id == first_item.id
    assert renamed_item.revision_sha256 != first_item.revision_sha256
    assert broken.status is ContentStatus.INVALID
    assert second.summaries[0].valid == 1
    assert second.summaries[0].invalid == 1

    renamed.unlink()
    third = await service.rescan(user_id="owner-a", include_included=False)
    missing = next(item for item in third.items if item.id == first_item.id)
    assert missing.status is ContentStatus.MISSING
    assert broken.id in {item.id for item in third.items}

    await async_session.execute(
        delete(ORMContentCatalogItem).where(ORMContentCatalogItem.id.in_([item.id for item in third.items]))
    )
    await async_session.commit()
