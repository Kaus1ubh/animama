from __future__ import annotations

from animama.app.services.typed_content_service import TypedCatalogItem
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentKind,
    ContentScope,
    ContentSource,
    ContentStatus,
)
from animama.domain.content_documents import (
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
        "/v1/music-tracks": "PyMusicTrack",
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
    )
    document = ParticleEffectDocumentV1(
        kind=ContentKind.PARTICLE_EFFECT,
        name="Hearts",
        files=(
            ContentFileDeclarationV1(path="particle.json", role="manifest"),
            ContentFileDeclarationV1(path="textures/heart.png", role="texture"),
        ),
    )

    response = typed_content_response(TypedCatalogItem(item=item, document=document))

    assert {file.file_ref: file.logical_path for file in response.files} == {
        "descriptor-ref": "hearts.json",
        "manifest-ref": "particle.json",
        "texture-ref": "textures/heart.png",
    }
