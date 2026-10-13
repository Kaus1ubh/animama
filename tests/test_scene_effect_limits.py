"""Scene Effect definitions and images are held to the shared limits.

The creator (``lib/scene-vfx/limits.ts``) and the backend read the same ranges;
``scene-effect-limits.json`` is the parity record, and the definition fixtures
are the cases both sides must accept or refuse.
"""

from __future__ import annotations

import copy
import io
import json
from pathlib import Path
from typing import Any

import pytest
from PIL import Image

from animama.app.contracts.effect_art_limits import SCENE_IMAGE_LIMITS
from animama.app.contracts.scene_effect_limits import SCENE_EFFECT_LIMITS
from animama.app.services.content_package_capabilities import derive_document_capabilities
from animama.domain.content_documents import ContentDocumentError
from tests.test_content_package_capabilities import FRONTEND, _document
from tests.test_particle_texture_limits import _store

FIXTURES = FRONTEND / "content/fixtures"
LIMITS = json.loads((FIXTURES / "scene-effect-limits.json").read_text())
ALL_LAYERS: dict[str, Any] = json.loads((FIXTURES / "scene-effect-all-layers.json").read_text())
_CASE_FILE = json.loads((FIXTURES / "scene-effect-limit-cases.json").read_text())
CASES = _CASE_FILE["cases"]
STRUCTURE_CASES = _CASE_FILE["structureCases"]
IMAGES = [{"path": "petal.png", "role": "image"}, {"path": "bokeh.png", "role": "image"}]


def _as_json(value: Any) -> Any:
    """Spell tuples as lists, as the fixture does."""
    if isinstance(value, dict):
        return {key: _as_json(child) for key, child in value.items()}
    if isinstance(value, tuple):
        return [_as_json(child) for child in value]
    return value


def _capabilities(definition: dict[str, Any]) -> tuple[str, ...]:
    return derive_document_capabilities(_document("scene_effect", definition=definition, files=IMAGES))


def test_the_limits_match_the_parity_fixture() -> None:
    assert _as_json(SCENE_EFFECT_LIMITS) == LIMITS


def test_a_definition_with_every_optional_layer_is_accepted() -> None:
    # Scene items are the effect's own images; no app resource is declared.
    assert _capabilities(copy.deepcopy(ALL_LAYERS)) == ("animama/scene-effect/1",)


@pytest.mark.parametrize("case", CASES, ids=[case["field"] for case in CASES])
def test_each_limit_is_refused(case: dict[str, Any]) -> None:
    """Refused against the field the creator's check names too."""
    with pytest.raises(ContentDocumentError) as raised:
        _capabilities(_with(case))
    assert raised.value.field == case["field"]


def _with(case: dict[str, Any]) -> dict[str, Any]:
    definition = copy.deepcopy(ALL_LAYERS)
    owner: Any = definition
    for key in case["path"][:-1]:
        owner = owner[key]
    owner[case["path"][-1]] = case["value"]
    return definition


@pytest.mark.parametrize("case", STRUCTURE_CASES, ids=[case["field"] for case in STRUCTURE_CASES])
def test_a_definition_the_layers_cannot_draw_safely_is_refused(case: dict[str, Any]) -> None:
    """Missing required booleans and non-hex colours, as the runtime parser refuses them."""
    with pytest.raises(ContentDocumentError) as raised:
        _capabilities(_with(case))
    assert raised.value.field == case["field"]


def test_save_and_scan_refuse_a_definition_over_the_limits(tmp_path: Path) -> None:
    definition = copy.deepcopy(ALL_LAYERS)
    definition["scatters"] = [copy.deepcopy(ALL_LAYERS["scatters"][0]) for _ in range(4)]
    with pytest.raises(Exception, match="scatters"):
        _save(tmp_path, {"bokeh.png": _png(16, 16), "petal.png": _png(16, 16)}, definition=definition)


def test_a_layer_image_must_be_a_registered_file() -> None:
    definition = copy.deepcopy(ALL_LAYERS)
    definition["tile"]["image"] = "missing.png"
    with pytest.raises(ContentDocumentError, match="registered package file"):
        _capabilities(definition)


def test_existing_definitions_without_the_new_layers_still_pass() -> None:
    definition = {
        key: value
        for key, value in copy.deepcopy(ALL_LAYERS).items()
        if key not in {"gradient", "tile", "screen", "scatters", "flash"}
    }
    assert _capabilities(definition) == ("animama/scene-effect/1",)


def _png(width: int, height: int) -> bytes:
    out = io.BytesIO()
    Image.new("RGBA", (width, height), (255, 200, 220, 255)).save(out, format="PNG")
    return out.getvalue()


def _save(tmp_path: Path, images: dict[str, bytes], *, definition: dict[str, Any] | None = None) -> None:
    definition = copy.deepcopy(definition or ALL_LAYERS)
    names = list(images)
    definition["tile"]["image"] = names[0]
    definition["scatters"][0]["items"][0]["image"] = names[-1]
    definition["scatters"][1]["items"][0]["image"] = names[0]
    store = _store(tmp_path)
    store.save_descriptor_entry(
        kind=_document("scene_effect").kind,
        relative_locator="vfx/scene/all-layers",
        descriptor=json.dumps(
            {
                "schema_version": 1,
                "content_type": "scene_effect",
                "name": "All layers",
                "definition": definition,
                "files": [{"path": name, "role": "image"} for name in names],
            }
        ).encode(),
        companion_files=images,
    )


def test_scene_images_within_the_limits_save(tmp_path: Path) -> None:
    _save(tmp_path, {"bokeh.png": _png(180, 180), "petal.png": _png(64, 64)})


def test_a_scene_image_larger_than_the_limit_is_refused(tmp_path: Path) -> None:
    with pytest.raises(Exception, match="4096 px"):
        _save(tmp_path, {"wide.png": _png(SCENE_IMAGE_LIMITS.max_dimension + 1, 4)})
