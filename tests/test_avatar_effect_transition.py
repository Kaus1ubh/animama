"""Local ``/1`` Avatar Effects convert to ``/2`` in place at the content transition."""

from __future__ import annotations

import json
from io import BytesIO
from typing import Any

import pytest
from PIL import Image
from sqlalchemy import delete

from animama.adapters.repositories.sqlalchemy.content_transition_repo import SQLAlchemyContentTransitionBindings
from animama.app.services.content_transition_service import ContentTransitionService
from animama.domain.content_catalog import CatalogContentEntry, ContentKind, ContentStatus
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services

OWNER = "avatar-effect-transition-owner"
LEGACY = {
    "schema": "animama/avatar-effect/1",
    "kind": "hover",
    "region": "emote",
    "hoverKind": "box_hover",
    "placement": "top-edge-right-corner",
    "transform": {"scale": {"x": 1.4, "y": 1.4, "z": 1}},
    "animationConfig": {"rotationRadiansPerSecond": 1.4, "rotationAmountTurns": 0.02},
    "lifetime": {"kind": "turns", "turns": 1},
    "image": "mark.png",
}


@pytest.fixture(autouse=True)
async def _cleanup(async_session):  # noqa: ANN001, ANN202
    yield
    await async_session.rollback()
    await async_session.execute(delete(ORMContentCatalogItem).where(ORMContentCatalogItem.owner_user_id == OWNER))
    await async_session.commit()


def _png() -> bytes:
    image = BytesIO()
    Image.new("RGBA", (4, 4), (200, 20, 20, 255)).save(image, format="PNG")
    return image.getvalue()


def _write(content, name: str, definition: dict[str, Any]) -> bytes:  # noqa: ANN001
    descriptor = {
        "schema_version": 1,
        "content_type": "avatar_effect",
        "content_id": f"local:avatar-effect:{name}",
        "name": name.title(),
        "description": "Kept description",
        "definition": definition,
        "files": [{"path": "mark.png", "role": "image"}],
    }
    raw = json.dumps(descriptor).encode()
    content.mutations.store.save_descriptor_entry(
        kind=ContentKind.AVATAR_EFFECT,
        relative_locator=f"vfx/avatar/{name}",
        descriptor=raw,
        companion_files={"mark.png": _png()},
    )
    return raw


def _service(content, async_session) -> ContentTransitionService:  # noqa: ANN001
    return ContentTransitionService(content=content, bindings=SQLAlchemyContentTransitionBindings(async_session))


async def _effects(catalog) -> dict[str, CatalogContentEntry]:  # noqa: ANN001
    return {
        item.logical_key: item
        for item in await catalog.list_visible(user_id=OWNER)
        if item.kind is ContentKind.AVATAR_EFFECT and item.source.value == "local" and item.logical_key
    }


async def test_local_v1_effect_converts_in_place_keeping_identity_and_original(async_session, tmp_path) -> None:  # noqa: ANN001
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    raw = _write(content, "mark", LEGACY)
    await content.rescan(user_id=OWNER)
    before = (await _effects(catalog))["local:avatar-effect:mark"]

    await _service(content, async_session).transition(user_id=OWNER)

    after = (await _effects(catalog))["local:avatar-effect:mark"]
    assert after.id == before.id
    assert after.relative_locator == before.relative_locator
    assert after.status is ContentStatus.VALID
    assert after.revision_sha256 != before.revision_sha256
    stored = json.loads((paths.local_root / "vfx/avatar/mark/mark.json").read_bytes())
    assert stored["content_id"] == "local:avatar-effect:mark"
    assert stored["description"] == "Kept description"
    assert stored["definition"] == {
        "schema": "animama/avatar-effect/2",
        "region": "emote",
        "attachment": {
            "kind": "face_landmark",
            "landmark": "top_edge",
            "position": "right_corner",
            "scale": {"x": 1.4, "y": 1.4},
        },
        "art": {"image": "mark.png"},
        "motion": {"spin": {"degreesPerSecond": 80.214091, "amountTurns": 0.02}},
    }
    assert (paths.local_root / "vfx/avatar/mark/mark.png").read_bytes() == _png()
    # The pre-conversion descriptor is retained under the transition journal.
    assert any(path.read_bytes() == raw for path in paths.operations_root.rglob("*.original"))

    # A second transition is a no-op: the same item, revision and bytes.
    await _service(content, async_session).transition(user_id=OWNER)
    again = (await _effects(catalog))["local:avatar-effect:mark"]
    assert (again.id, again.revision_sha256) == (after.id, after.revision_sha256)


async def test_malformed_v1_effect_is_recorded_and_left_untouched(async_session, tmp_path) -> None:  # noqa: ANN001
    paths, catalog, content, _, _ = package_services(async_session, tmp_path)
    raw = _write(content, "broken", {**LEGACY, "placement": "behind-head"})
    _write(content, "mark", LEGACY)
    await content.rescan(user_id=OWNER)

    await _service(content, async_session).transition(user_id=OWNER)

    effects = await _effects(catalog)
    broken = effects["local:avatar-effect:broken"]
    assert broken.status is ContentStatus.INVALID
    assert broken.diagnostics[0].code == "avatar_effect_conversion_failed"
    assert (paths.local_root / "vfx/avatar/broken/broken.json").read_bytes() == raw
    # A failing peer does not block the convertible effect.
    assert effects["local:avatar-effect:mark"].status is ContentStatus.VALID
    converted = json.loads((paths.local_root / "vfx/avatar/mark/mark.json").read_bytes())
    assert converted["definition"]["schema"] == "animama/avatar-effect/2"


async def test_unconverted_effect_is_refused_at_preview_and_reported_by_projection(async_session, tmp_path) -> None:  # noqa: ANN001
    from animama.app.services.typed_content_batch_service import CatalogTypedRoot, TypedContentBatchResolver
    from animama.app.services.typed_content_service import TypedContentService
    from animama.domain.content_documents import ContentDocumentError
    from animama.server.schemas.typed_content import PyAvatarEffect, typed_content_response

    _, catalog, content, _, _ = package_services(async_session, tmp_path)
    _write(content, "mark", LEGACY)
    await content.rescan(user_id=OWNER)
    item = (await _effects(catalog))["local:avatar-effect:mark"]

    with pytest.raises(ContentDocumentError) as raised:
        await TypedContentService(catalog=catalog, content=content).preview(
            user_id=OWNER, kind=ContentKind.AVATAR_EFFECT, item_id=item.id
        )
    assert raised.value.code == "avatar_effect_conversion_required"
    assert "content_cli" in str(raised.value)

    batch = await TypedContentBatchResolver(catalog=catalog).resolve(
        user_id=OWNER, locators=(CatalogTypedRoot(kind=ContentKind.AVATAR_EFFECT, item_id=item.id),)
    )
    assert not batch.roots
    assert [diagnostic.code for diagnostic in batch.diagnostics] == ["avatar_effect_conversion_required"]

    # Listing stays readable: the item reports the conversion instead of failing the page.
    projected = typed_content_response(TypedContentService.parse(item))
    assert isinstance(projected, PyAvatarEffect)
    assert projected.definition is None
    assert projected.definition_error == "avatar_effect_conversion_required"
