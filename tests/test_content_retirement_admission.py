"""Retired local content stays decodable without remaining product content."""

from __future__ import annotations

from unittest.mock import AsyncMock, Mock

import pytest
from pydantic import TypeAdapter

from animama.app.services.typed_content_service import TypedContentService
from animama.domain.content_catalog import (
    CatalogContentEntry,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
    SavedContent,
)
from animama.server.app import app


def retired_item(kind: ContentKind) -> CatalogContentEntry:
    """Represent a formerly valid persisted row without depending on its bytes."""

    return CatalogContentEntry(
        id="retired-item",
        source=ContentSource.LOCAL,
        scope=ContentScope.OWNER,
        owner_user_id="owner",
        kind=kind,
        relative_locator="music/old.mp3" if kind is ContentKind.MUSIC_TRACK else "pose-clips/old.json",
        display_name="Old content",
        status=ContentStatus.VALID,
        revision_sha256="a" * 64,
        files=(),
        metadata={},
    )


def test_retired_families_have_no_public_product_contract() -> None:
    schema = app.openapi()
    assert not any("music-tracks" in path or "pose-clips" in path for path in schema["paths"])
    models = schema["components"]["schemas"]
    assert "PyMusicTrack" not in models and "PyPoseClip" not in models
    assert "music_tracks" not in models["PyAnimaLoadout"]["properties"]
    assert "music_tracks" not in models["PyAnimaRuntime"]["properties"]
    assert "pose_clip" not in models["SourceRevision"]["properties"]["kind"]["enum"]


@pytest.mark.parametrize("kind", [ContentKind.POSE_CLIP, ContentKind.MUSIC_TRACK])
async def test_retired_rows_are_decodable_but_not_typed_library_items(kind: ContentKind) -> None:
    item = retired_item(kind)
    saved = SavedContent("old-save", item)
    adapter = TypeAdapter(SavedContent)
    assert adapter.validate_python(adapter.dump_python(saved, mode="json")) == saved
    catalog = Mock()
    catalog.list_visible = AsyncMock(return_value=[item])
    service = TypedContentService(catalog=catalog, content=Mock())
    assert await service.list_kind(user_id="owner", kind=kind) == ()


@pytest.mark.parametrize("kind", [ContentKind.POSE_CLIP, ContentKind.MUSIC_TRACK])
async def test_old_save_receipt_replays_but_fresh_retired_save_is_rejected(async_session, tmp_path, kind):
    from io import BytesIO

    from animama.app.services.local_content_mutations import mutation_digest
    from animama.domain.content_catalog import ContentConflictError
    from tests.content_package_helpers import package_services

    paths, catalog, _, saves, _ = package_services(async_session, tmp_path)
    payload = b"historical original bytes"
    filename = "old.json" if kind is ContentKind.POSE_CLIP else "old.mp3"
    digest = mutation_digest(
        {
            "operation": "save_standalone",
            "kind": kind.value,
            "entry_name": "Old content",
            "filename": filename,
            "size": len(payload),
            "metadata": None,
            "catalog_item_id": None,
            "expected_revision": None,
            "declared_content_type": None,
            "creation_context": False,
            "portrait_source": None,
        },
        (BytesIO(payload),),
    )
    original = SavedContent("old-save", retired_item(kind))
    async with catalog.mutation_transaction():
        await catalog.record_mutation_receipt(
            user_id="owner",
            operation_id="old-save",
            request_digest=digest,
            result={"value": TypeAdapter(SavedContent).dump_python(original, mode="json")},
        )
    command = {
        "user_id": "owner",
        "kind": kind,
        "entry_name": "Old content",
        "filename": filename,
        "payload": payload,
        "metadata_sidecar": None,
        "catalog_item_id": None,
        "expected_revision": None,
    }
    assert await saves.save_standalone(**command, operation_id="old-save") == original
    with pytest.raises(ContentConflictError, match="content_kind_retired"):
        await saves.save_standalone(**command, operation_id="new-save")
    assert not any(path.is_file() for path in paths.local_root.rglob("*"))


@pytest.mark.parametrize("kind", [ContentKind.POSE_CLIP, ContentKind.MUSIC_TRACK])
async def test_old_import_receipt_does_not_revalidate_retired_package(async_session, tmp_path, kind):
    from io import BytesIO

    from animama.app.services.content_package_service import ImportedContentPackage
    from animama.app.services.local_content_mutations import mutation_digest
    from tests.content_package_helpers import package_services

    paths, catalog, _, _, packages = package_services(async_session, tmp_path)
    archive = tmp_path / "historical.zip"
    original_bytes = b"old package need not satisfy the current manifest validator"
    archive.write_bytes(original_bytes)
    original = ImportedContentPackage((retired_item(kind),), ())
    async with catalog.mutation_transaction():
        await catalog.record_mutation_receipt(
            user_id="owner",
            operation_id="old-import",
            request_digest=mutation_digest(
                {"operation": "import", "collision": "keep_both"}, (BytesIO(original_bytes),)
            ),
            result={"value": TypeAdapter(ImportedContentPackage).dump_python(original, mode="json")},
        )
    status = await packages.imports.operation_status(user_id="owner", operation_id="old-import")
    assert status.state == "completed" and status.result is not None
    assert status.result.schema_version == 0
    assert status.result.items[0].item_id == original.items[0].id
    assert status.result.items[0].kind == kind.value
    assert not any(path.is_file() for path in paths.local_root.rglob("*"))


def test_legacy_action_save_result_preserves_retired_dependency_without_public_admission() -> None:
    from dataclasses import replace

    from animama.server.schemas.typed_content import legacy_saved_content_response

    item = replace(
        retired_item(ContentKind.POSE_CLIP),
        kind=ContentKind.GESTURE,
        relative_locator="gestures/old-action",
        metadata={
            "content_type": "gesture",
            "name": "Old Action",
            "semantic_key": "old_action",
            "implementation": {
                "kind": "anima_clip",
                "technical_source": {"type": "content_dependency", "ref": "local:clip:old"},
            },
            "dependencies": [{"ref": "local:clip:old", "content_type": "pose_clip"}],
        },
    )
    result = legacy_saved_content_response(TypedContentService.parse(item))
    assert result["kind"] == "gesture"
    assert result["dependencies"] == [
        {"ref": "local:clip:old", "kind": "pose_clip", "item_id": None, "alias": None, "config": {}}
    ]
