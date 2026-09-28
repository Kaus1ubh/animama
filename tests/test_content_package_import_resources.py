"""Copied effects retain the item-relative resource names consumed by renderers."""

from __future__ import annotations

import json
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from PIL import Image
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from animama.app.services.typed_content_service import TypedContentService
from animama.domain.content_catalog import ContentKind
from animama.domain.content_documents import AvatarEffectDocumentV1, SceneEffectDocumentV1
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.server.schemas.typed_content import PyTypedContentPreview
from tests.content_package_helpers import package_services, reviewed_export, reviewed_import

FRONTEND = Path(__file__).parents[1] / "src/frontend/web/src/lib"
EFFECTS = json.loads((FRONTEND / "content/fixtures/package-capabilities.json").read_text())["effects"]


def _effect(kind: ContentKind) -> tuple[bytes, dict[str, bytes]]:
    """Use valid renderer fixtures with a texture named after its containing item."""
    image = BytesIO()
    Image.new("RGBA", (2, 2), (255, 100, 20, 255)).save(image, format="PNG")
    files = {"shared.png": image.getvalue()}
    document: dict[str, Any] = {
        "schema_version": 1,
        "content_type": kind.value,
        "content_id": f"local:{kind.value}:shared",
        "name": "Shared",
        "files": [{"path": "shared.png", "role": "image"}],
    }
    if kind is ContentKind.PARTICLE_EFFECT:
        particle = json.loads((FRONTEND / "avatar/particle-vfx/fixtures/compatibility-valid.json").read_text())
        particle["images"] = [{"uuid": "fixture-image", "url": "shared.png"}]
        particle["textures"] = [{"uuid": "fixture-texture", "image": "fixture-image"}]
        particle["materials"][0]["map"] = "fixture-texture"
        files["shared.manifest.json"] = json.dumps(particle).encode()
        document["files"] = [
            {"path": "shared.manifest.json", "role": "manifest"},
            {"path": "shared.png", "role": "texture"},
        ]
    else:
        definition = next(fixture["definition"] for fixture in EFFECTS if fixture["kind"] == kind.value)
        document["definition"] = json.loads(json.dumps(definition))
        if kind is ContentKind.AVATAR_EFFECT:
            document["definition"]["image"] = "shared.png"
        else:
            document["definition"]["marquee"].update(
                enabled=True,
                items=[{"id": "image", "kind": "image", "label": "Shared image", "image": "shared.png"}],
            )
    return json.dumps(document).encode(), files


@pytest.mark.parametrize("kind", [ContentKind.AVATAR_EFFECT, ContentKind.SCENE_EFFECT, ContentKind.PARTICLE_EFFECT])
async def test_suffix_import_preserves_effect_resource_references_and_can_export_again(
    async_session: AsyncSession, tmp_path: Path, kind: ContentKind
) -> None:
    paths, catalog, content, saves, packages = package_services(async_session, tmp_path)
    try:
        descriptor, companions = _effect(kind)
        saved = await saves.save_descriptor(
            user_id="package-owner",
            kind=kind,
            entry_name="Shared",
            descriptor=descriptor,
            companion_files=companions,
            operation_id="save-shared-effect",
            catalog_item_id=None,
            expected_revision=None,
        )
        exported = await reviewed_export(packages, user_id="package-owner", root_item_id=saved.item.id)
        command = await reviewed_import(
            packages, user_id="package-owner", archive_path=exported.path, operation_id="copy-shared-effect"
        )
        result = await packages.imports.commit(**command)
        packages.stages.discard("package-owner", command["stage_id"])
        copied = await catalog.get_visible_item(item_id=result.items[0].item_id, user_id="package-owner")
        assert copied is not None and copied.display_name == "Shared-2"
        assert copied.id != saved.item.id and copied.logical_key != saved.item.logical_key
        preview = await TypedContentService(catalog=catalog, content=content).preview(
            user_id="package-owner", kind=kind, item_id=copied.id
        )
        response = PyTypedContentPreview.from_domain(preview)
        resources = {file.logical_path for file in response.files if file.role in {"image", "texture"}}
        document = preview.item.document
        if kind is ContentKind.PARTICLE_EFFECT:
            manifest = next(file for file in copied.files if file.role == "manifest")
            particle = json.loads((paths.local_root / manifest.relative_path).read_bytes())
            referenced_images = {image["url"] for image in particle["images"]}
        else:
            assert isinstance(document, AvatarEffectDocumentV1 | SceneEffectDocumentV1)
            definition = document.definition
            assert definition is not None
            referenced_images = (
                {definition["image"]}
                if kind is ContentKind.AVATAR_EFFECT
                else {item["image"] for item in definition["marquee"]["items"]}
            )
        assert referenced_images == resources == {"shared.png"}
        assert (paths.local_root / copied.relative_locator / "shared.png").read_bytes() == companions["shared.png"]
        await content.rescan(user_id="package-owner", include_included=False)
        reexported = await reviewed_export(packages, user_id="package-owner", root_item_id=copied.id)
        assert reexported.path.is_file()
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()
