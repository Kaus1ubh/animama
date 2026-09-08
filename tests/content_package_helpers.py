from __future__ import annotations

import json
import struct
from pathlib import Path

from animama.adapters.content_store import FilesystemContentStore
from animama.adapters.repositories.sqlalchemy.content_catalog_repo import SQLAlchemyContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.content_package_service import ContentPackageService
from animama.app.services.content_save_service import ContentSaveService
from animama.domain.content_catalog import ContentKind
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime


def vrma(label: str) -> bytes:
    """Build a minimal VRM Animation GLB fixture with stable distinct bytes."""

    document = json.dumps(
        {
            "asset": {"version": "2.0"},
            "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
            "extras": {"label": label},
        },
        separators=(",", ":"),
    ).encode()
    document += b" " * (-len(document) % 4)
    return (
        struct.pack("<4sII", b"glTF", 2, 20 + len(document)) + struct.pack("<II", len(document), 0x4E4F534A) + document
    )


def package_services(async_session, tmp_path: Path):  # noqa: ANN001, ANN202
    """Create the real filesystem/catalog/package service graph for a test."""

    paths = initialize_local_runtime(
        Settings(
            animama_content_root=tmp_path / "content",
            animama_data_root=tmp_path / "data",
        )
    )
    store = FilesystemContentStore(
        included_root=paths.included_root,
        local_root=paths.local_root,
        operations_root=paths.operations_root,
    )
    catalog = SQLAlchemyContentCatalog(async_session)
    content = ContentCatalogService(
        store=store,
        catalog=catalog,
    )
    saves = ContentSaveService(content=content)
    packages = ContentPackageService(
        content=content,
        exports_root=paths.exports_staging_root,
    )
    return paths, catalog, content, saves, packages


async def save_wave(saves: ContentSaveService, *, label: str = "original"):  # noqa: ANN202
    """Save one self-describing standalone Gesture through the public service."""

    return await saves.save_standalone(
        user_id="package-owner",
        kind=ContentKind.GESTURE,
        entry_name="Friendly Wave",
        filename="wave.vrma",
        payload=vrma(label),
        metadata_sidecar=json.dumps(
            {
                "schema_version": 1,
                "id": "local:gesture:friendly-wave",
                "name": "Friendly Wave",
                "description": "A portable wave fixture.",
                "provenance": {
                    "creator": "Animama test suite",
                    "license": "fixture-only",
                },
            }
        ).encode(),
        operation_id=f"save-wave-{label}",
        catalog_item_id=None,
        expected_revision=None,
    )
