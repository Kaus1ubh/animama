"""Avatar Effect Save applies the shared ``/2`` contract before writing Local content."""

from __future__ import annotations

import json
from collections.abc import AsyncIterator
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from fastapi import FastAPI
from PIL import Image
from sqlalchemy import delete

from animama.domain.request_principal import RequestPrincipal
from animama.orm.content_catalog import ORMContentCatalogItem
from animama.server.deps import get_async_session, get_current_principal
from animama.server.routers import content, typed_content
from tests.content_package_helpers import package_services
from tests.local_http_client import local_client

FIXTURES = json.loads(
    (Path(__file__).parents[1] / "src/frontend/web/src/lib/content/fixtures/package-capabilities.json").read_text()
)["effects"]


def _png() -> bytes:
    image = BytesIO()
    Image.new("RGBA", (2, 2), (255, 100, 20, 255)).save(image, format="PNG")
    return image.getvalue()


def _form(definition_patch: dict[str, Any], *, operation_id: str) -> tuple[dict[str, str], list[Any]]:
    """Build the creator's multipart Save request for the forehead landmark fixture."""
    fixture = next(item for item in FIXTURES if item["definition"]["attachment"].get("landmark") == "forehead")
    definition = {**fixture["definition"], "art": {"image": "effect.png"}, **definition_patch}
    descriptor = {
        "schema_version": 1,
        "content_type": "avatar_effect",
        "name": "Checked",
        "definition": definition,
        "dependencies": [],
        "files": [{"path": "effect.png", "role": "image"}],
    }
    data = {
        "operation_id": operation_id,
        "descriptor_json": json.dumps(descriptor),
        "companion_paths_json": json.dumps(["effect.png"]),
    }
    return data, [("files", ("effect.png", _png(), "image/png"))]


@pytest.fixture
async def effect_api(async_session, tmp_path: Path) -> AsyncIterator[tuple[Any, Path]]:  # noqa: ANN001
    paths, *_ = package_services(async_session, tmp_path)
    application = FastAPI()
    application.include_router(content.router)
    application.include_router(typed_content.router)
    application.state.local_runtime_paths = paths

    async def owner() -> RequestPrincipal:
        return RequestPrincipal(id="effect-owner")

    async def session() -> AsyncIterator[Any]:
        yield async_session

    application.dependency_overrides[get_current_principal] = owner
    application.dependency_overrides[get_async_session] = session
    try:
        async with local_client(application) as client:
            yield client, paths.local_root
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()


@pytest.mark.parametrize(
    ("patch", "field"),
    [
        (
            {"attachment": {"kind": "face_landmark", "landmark": "forehead", "position": "behind"}},
            "definition.attachment.position",
        ),
        (
            {"attachment": {"kind": "face_landmark", "landmark": "top", "offset": {"x": "far"}, "position": "left"}},
            "definition.attachment.offset.x",
        ),
        ({"appearance": {"opacity": 2}}, "definition.appearance.opacity"),
        ({"art": {"image": "missing.png"}}, "definition.art.image"),
        ({"lifetimeSeconds": 3}, "definition.lifetimeSeconds"),
    ],
)
async def test_invalid_avatar_effect_definition_is_refused_with_its_field(
    effect_api: tuple[Any, Path], patch: dict[str, Any], field: str
) -> None:
    client, local_root = effect_api
    data, files = _form(patch, operation_id="invalid-effect")
    refused = await client.put("/v1/avatar-effects/Checked", data=data, files=files)
    assert refused.status_code == 422, refused.text
    detail = refused.json()["detail"]
    assert detail["code"] == "content_invalid"
    assert detail["reason"] == "avatar_effect_definition_invalid"
    assert detail["field"] == field
    assert detail["message"]
    # Nothing reaches the Local library when Save validation fails.
    assert not list((local_root / "vfx/avatar").rglob("*.json"))


async def test_valid_avatar_effect_definition_saves(effect_api: tuple[Any, Path]) -> None:
    client, local_root = effect_api
    data, files = _form({}, operation_id="valid-effect")
    saved = await client.put("/v1/avatar-effects/Checked", data=data, files=files)
    assert saved.status_code == 200, saved.text
    assert saved.json()["kind"] == "avatar_effect"
    stored = [json.loads(path.read_text()) for path in (local_root / "vfx/avatar").rglob("checked.json")]
    assert [document["definition"]["attachment"]["position"] for document in stored] == ["left"]


async def test_v1_avatar_effect_is_refused_with_the_conversion_hint(effect_api: tuple[Any, Path]) -> None:
    client, local_root = effect_api
    legacy = {
        "schema": "animama/avatar-effect/1",
        "kind": "hover",
        "region": "emote",
        "hoverKind": "box_hover",
        "placement": "forehead-left",
        "image": "effect.png",
    }
    data, files = _form({}, operation_id="legacy-effect")
    descriptor = json.loads(data["descriptor_json"])
    descriptor["definition"] = legacy
    data["descriptor_json"] = json.dumps(descriptor)
    refused = await client.put("/v1/avatar-effects/Checked", data=data, files=files)
    assert refused.status_code == 422, refused.text
    detail = refused.json()["detail"]
    assert detail["reason"] == "avatar_effect_conversion_required"
    assert detail["field"] == "definition.schema"
    assert "content_cli" in detail["message"] and "convert_avatar_effects.py" in detail["message"]
    assert not list((local_root / "vfx/avatar").rglob("*.json"))
