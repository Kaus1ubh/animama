from __future__ import annotations

from unittest.mock import AsyncMock, Mock

import pytest

from animama.app.ports.content_catalog import ContentCatalog
from animama.app.services.content_catalog_service import ContentCatalogService
from animama.app.services.typed_content_service import (
    TypedCatalogItem,
    TypedContentResolutionContext,
    TypedContentService,
)
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
)
from animama.domain.content_documents import (
    ContentDependencyV1,
    ContentFileDeclarationV1,
    ParticleEffectDocumentV1,
)
from animama.server.app import app
from animama.server.schemas.typed_content import typed_content_response


def test_creator_families_expose_typed_list_get_save_and_preview_contracts() -> None:
    schema = app.openapi()
    paths = schema["paths"]
    families = {
        "/v1/gestures": "PyGesture",
        "/v1/reactions": "PyReaction",
        "/v1/particle-effects": "PyParticleEffect",
        "/v1/avatar-effects": "PyAvatarEffect",
        "/v1/scene-effects": "PySceneEffect",
        "/v1/sound-effects": "PySoundEffect",
        "/v1/idle-styles": "PyIdleStyle",
    }

    for family, model in families.items():
        singular = paths[f"{family}/{{item_id}}"]
        assert "get" in paths[family]
        assert "get" in singular
        assert "put" in paths[f"{family}/{{entry_name}}"]
        assert "post" in paths[f"{family}/{{item_id}}:preview"]
        response = singular["get"]["responses"]["200"]["content"]["application/json"]["schema"]
        assert response["$ref"].endswith(f"/{model}")

    # The neutral catalog is infrastructure, not a generic creator or Preview
    # contract. Product saves and previews must choose an exact typed family.
    assert "put" not in paths.get("/v1/content/items/{kind}/{entry_name}", {})
    assert "/v1/content/items/{item_id}:preview" not in paths


def test_openapi_product_models_are_discriminated_and_forbid_loose_fields() -> None:
    models = app.openapi()["components"]["schemas"]

    assert models["PyGesture"]["additionalProperties"] is False
    assert models["PyGesture"]["properties"]["kind"]["const"] == "gesture"
    assert {"semantic_key", "implementation", "config"} <= set(models["PyGesture"]["properties"])

    assert models["PyReaction"]["additionalProperties"] is False
    assert models["PyReaction"]["properties"]["kind"]["const"] == "reaction"
    assert {"emotion", "intensity", "implementation"} <= set(models["PyReaction"]["properties"])

    preview = models["PyTypedContentPreview"]
    assert preview["additionalProperties"] is False
    assert "item" in preview["properties"]
    assert "supports" in preview["properties"]
    assert "idle_playback" in preview["properties"]
    assert "pool_overrides" not in models["PyIdleStyleIntent"]["properties"]
    assert "/v1/gestures/{item_id}/idle-playback" in app.openapi()["paths"]


def test_support_families_have_no_direct_anima_equipment_routes() -> None:
    paths = app.openapi()["paths"]
    forbidden = ("pose-clips", "particle-effects", "avatar-effects", "scene-effects", "sound-effects")
    assert not any(path.startswith("/v1/animas/") and any(family in path for family in forbidden) for path in paths)


def test_batch_evidence_and_preview_contracts_remain_separate() -> None:
    schema = app.openapi()
    paths = schema["paths"]
    models = schema["components"]["schemas"]

    assert "post" in paths["/v1/content/evidence:resolve"]
    assert "post" in paths["/v1/content/previews:prepare"]
    assert models["PyContentEvidenceRequest"]["additionalProperties"] is False
    assert models["PyContentPreviewsPrepareRequest"]["additionalProperties"] is False
    evidence = models["PyContentEvidenceResponse"]["properties"]
    preview = models["PyContentPreviewsPrepareResponse"]["properties"]
    assert {"roots", "combined_expected_source_revisions", "diagnostics"} <= set(evidence)
    assert "lease" not in evidence and "files" not in evidence
    assert {"roots", "items", "diagnostics", "lease"} <= set(preview)


def test_typed_files_preserve_item_relative_logical_paths() -> None:
    item_id = "particle-item"
    files = tuple(
        CatalogContentFile(
            file_ref=file_ref,
            item_id=item_id,
            source=ContentSource.INCLUDED,
            relative_path=f"vfx/particle/quark/hearts/{relative_path}",
            role=role,
            media_type=media_type,
            size_bytes=10,
            sha256=sha256,
        )
        for file_ref, relative_path, role, media_type, sha256 in (
            ("descriptor-ref", "hearts.json", "descriptor", "application/json", "a" * 64),
            ("manifest-ref", "particle.json", "manifest", "application/json", "b" * 64),
            ("texture-ref", "textures/heart.png", "texture", "image/png", "c" * 64),
        )
    )
    item = CatalogContentEntry(
        id=item_id,
        source=ContentSource.INCLUDED,
        scope=ContentScope.INCLUDED,
        owner_user_id=None,
        kind=ContentKind.PARTICLE_EFFECT,
        relative_locator="vfx/particle/quark/hearts",
        display_name="Hearts",
        status=ContentStatus.VALID,
        revision_sha256="d" * 64,
        files=files,
        metadata={"content_type": "particle_effect", "name": "Hearts"},
        dependencies=("audio/chime",),
        dependency_item_ids=("admitted-chime-id",),
    )
    document = ParticleEffectDocumentV1(
        kind=ContentKind.PARTICLE_EFFECT,
        name="Hearts",
        dependencies=(ContentDependencyV1(ref="audio/chime", kind=ContentKind.SOUND_EFFECT),),
        files=(
            ContentFileDeclarationV1(path="particle.json", role="manifest"),
            ContentFileDeclarationV1(path="textures/heart.png", role="texture"),
        ),
    )

    response = typed_content_response(TypedCatalogItem(item=item, document=document))

    # Raw parsed/save receipt projections have no caller-visible resolution context.
    assert response.model_dump()["dependencies"][0]["item_id"] is None

    assert {file.file_ref: file.logical_path for file in response.files} == {
        "descriptor-ref": "hearts.json",
        "manifest-ref": "particle.json",
        "texture-ref": "textures/heart.png",
    }


def _idle_dependency_entries() -> tuple[CatalogContentEntry, CatalogContentEntry]:
    entries = []
    for item_id, kind, locator, metadata, dependencies, dependency_ids, role in (
        (
            "style",
            ContentKind.IDLE_STYLE,
            "idle-styles/rest",
            {
                "schema_version": 2,
                "content_type": "idle_style",
                "name": "Rest",
                "default_pool": ["gestures/breathe"],
                "dependencies": [{"ref": "gestures/breathe", "content_type": "gesture"}],
            },
            ("gestures/breathe",),
            ("admitted-gesture",),
            "descriptor",
        ),
        (
            "admitted-gesture",
            ContentKind.GESTURE,
            "gestures/breathe",
            {"content_type": "gesture", "name": "Breathe"},
            (),
            (),
            "animation",
        ),
    ):
        entries.append(
            CatalogContentEntry(
                id=item_id,
                source=ContentSource.LOCAL,
                scope=ContentScope.OWNER,
                owner_user_id="owner",
                kind=kind,
                relative_locator=locator,
                display_name=item_id,
                status=ContentStatus.VALID,
                revision_sha256="a" * 64,
                metadata=metadata,
                dependencies=dependencies,
                dependency_item_ids=dependency_ids,
                files=(
                    CatalogContentFile(
                        file_ref=f"{item_id}-file",
                        item_id=item_id,
                        source=ContentSource.LOCAL,
                        relative_path=f"{locator}/source",
                        role=role,
                        media_type="application/octet-stream",
                        size_bytes=10,
                        sha256="b" * 64,
                    ),
                ),
            )
        )
    return entries[0], entries[1]


@pytest.mark.parametrize("target_visible", [True, False])
async def test_typed_list_and_get_expose_only_caller_visible_dependency_ids(target_visible: bool) -> None:
    root, target = _idle_dependency_entries()
    catalog = Mock(spec=ContentCatalog)
    catalog.list_visible = AsyncMock(return_value=[root, target] if target_visible else [root])
    catalog.get_visible_item = AsyncMock(return_value=root)
    service = TypedContentService(catalog=catalog, content=Mock(spec=ContentCatalogService))
    listed = await service.list_kind(user_id="owner", kind=ContentKind.IDLE_STYLE)
    assert len(listed) == 1
    detail = await service.get(user_id="owner", kind=ContentKind.IDLE_STYLE, item_id=root.id)
    for value in (*listed, detail):
        dependency = typed_content_response(value).dependencies[0]
        assert dependency.ref == "gestures/breathe"
        assert dependency.item_id == (target.id if target_visible else None)


def test_admitted_preview_closure_retains_ids_but_raw_receipt_parse_omits_them() -> None:
    root, target = _idle_dependency_entries()
    context = TypedContentResolutionContext({root.id: root, target.id: target})
    response = typed_content_response(context.resolve(root.id)[-1])
    assert response.dependencies[0].item_id == target.id
    receipt_response = typed_content_response(TypedContentService.parse(root))
    assert receipt_response.dependencies[0].item_id is None
