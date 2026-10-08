"""``animama/avatar-effect/1`` definitions convert to ``/2`` without visible change.

The golden pairs are shared with the frontend, whose temporary creator adapter
and runtime parser tests read the same file.
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest

from animama.app.contracts.avatar_effect import AvatarEffectDefinitionV2
from animama.app.services.avatar_effect_conversion import (
    convert_avatar_effect_definition,
    mirrors_offset_differently,
)
from animama.domain.content_documents import ContentDocumentError

ROOT = Path(__file__).parents[1]
PAIRS = json.loads((ROOT / "src/frontend/web/src/lib/content/fixtures/avatar-effect-conversion.json").read_text())[
    "pairs"
]
INCLUDED = ROOT / "content/included/vfx/avatar"


@pytest.mark.parametrize("pair", PAIRS, ids=[pair["name"] for pair in PAIRS])
def test_golden_pairs_convert_exactly_and_idempotently(pair: dict[str, Any]) -> None:
    converted = convert_avatar_effect_definition(pair["v1"])
    assert converted == pair["v2"]
    assert convert_avatar_effect_definition(converted) == converted
    AvatarEffectDefinitionV2.model_validate(converted)


def test_conversion_drops_legacy_fields_and_maps_radians_to_degrees() -> None:
    pair = next(pair for pair in PAIRS if pair["name"] == "edge/eye hover offset rotation sound")
    assert "lifetime" in pair["v1"]
    assert "lifetime" not in pair["v2"]
    assert pair["v2"]["attachment"]["rotationDeg"]["z"] == pytest.approx(28.64789, abs=1e-6)
    assert pair["v2"]["soundAlias"] == "pop"


def test_every_included_effect_is_the_converted_golden_definition() -> None:
    golden = {
        pair["name"].removeprefix("included/"): pair["v2"] for pair in PAIRS if pair["name"].startswith("included/")
    }
    descriptors = sorted(INCLUDED.glob("*/*.json"))
    assert len(descriptors) == len(golden) == 16
    for path in descriptors:
        definition = json.loads(path.read_text())["definition"]
        assert definition == golden[path.stem], path.stem


@pytest.mark.parametrize(
    ("definition", "field"),
    [
        ("not an object", "definition"),
        ({"schema": "animama/avatar-effect/9"}, "definition.schema"),
        ({"schema": "animama/avatar-effect/1", "kind": "shader", "image": "a.png"}, "definition.kind"),
        ({"schema": "animama/avatar-effect/1", "kind": "hover", "glow": 1}, "definition.glow"),
        (
            {"schema": "animama/avatar-effect/1", "kind": "hover", "hoverKind": "box_hover", "placement": "behind"},
            "definition.placement",
        ),
        (
            {
                "schema": "animama/avatar-effect/1",
                "kind": "hover",
                "region": "eyes",
                "hoverKind": "eye_hover",
                "transform": {"scale": {"x": 0}},
                "image": "a.png",
            },
            "definition.transform.scale.x",
        ),
        (
            {
                "schema": "animama/avatar-effect/1",
                "kind": "texture",
                "region": "eyes",
                "targetRole": "eye_iris",
                "assetShape": "single_eye",
                "applyMode": "overlay",
                "transform": {"offset": {"x": 9}},
                "image": "a.png",
            },
            "definition.attachment.offset.x",
        ),
    ],
)
def test_malformed_input_fails_with_its_field(definition: Any, field: str) -> None:
    with pytest.raises(ContentDocumentError) as raised:
        convert_avatar_effect_definition(definition)
    assert raised.value.code == "avatar_effect_conversion_failed"
    assert raised.value.field == field


def test_script_dry_run_then_write_keeps_every_other_descriptor_field(tmp_path: Path) -> None:
    pair = PAIRS[0]
    descriptor = {
        "schema_version": 1,
        "content_type": "avatar_effect",
        "content_id": "local:avatar-effect:kept",
        "name": "Kept",
        "definition": pair["v1"],
        "files": [{"path": pair["v1"]["image"], "role": "image"}],
    }
    path = tmp_path / "kept" / "kept.json"
    path.parent.mkdir()
    path.write_text(json.dumps(descriptor))
    (tmp_path / "other.json").write_text(json.dumps({"content_type": "scene_effect"}))
    script = ROOT / "scripts/content/convert_avatar_effects.py"

    dry = subprocess.run([sys.executable, script, tmp_path], capture_output=True, text=True, check=True)
    assert "would convert" in dry.stdout
    assert json.loads(path.read_text()) == descriptor

    subprocess.run([sys.executable, script, "--write", tmp_path], capture_output=True, text=True, check=True)
    written = json.loads(path.read_text())
    assert written == {**descriptor, "definition": pair["v2"]}

    again = subprocess.run([sys.executable, script, tmp_path], capture_output=True, text=True, check=True)
    assert "0 to convert, 1 already /2, 0 failed" in again.stdout


def test_script_reports_failures_with_a_nonzero_exit(tmp_path: Path) -> None:
    broken = {"content_type": "avatar_effect", "definition": {"schema": "animama/avatar-effect/1", "kind": "glow"}}
    (tmp_path / "broken.json").write_text(json.dumps(broken))
    result = subprocess.run(
        [sys.executable, ROOT / "scripts/content/convert_avatar_effects.py", "--write", tmp_path],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert "definition.kind" in result.stderr
    assert json.loads((tmp_path / "broken.json").read_text()) == broken


@pytest.mark.parametrize(
    ("definition", "changes"),
    [
        ({"kind": "hover", "hoverKind": "eye_hover", "requiresMirror": True, "offset_x": 0.01}, True),
        ({"kind": "hover", "hoverKind": "eye_hover", "requiresMirror": True, "offset_x": 0}, False),
        ({"kind": "hover", "hoverKind": "eye_hover", "requiresMirror": False, "offset_x": 0.01}, False),
        ({"kind": "hover", "hoverKind": "box_hover", "requiresMirror": True, "offset_x": 0.01}, False),
        (
            {"kind": "texture", "assetShape": "single_eye", "side": "right", "requiresMirror": True, "offset_x": 0.1},
            True,
        ),
        ({"kind": "texture", "assetShape": "single_eye", "requiresMirror": True, "offset_x": 0.1}, False),
        ({"kind": "face_anchored", "anchor": "blush", "requiresMirror": True, "offset_x": 0.1}, False),
    ],
)
def test_reports_mirrored_eye_offsets_that_now_render_differently(definition: dict[str, Any], changes: bool) -> None:
    offset_x = definition.pop("offset_x")
    legacy = {"schema": "animama/avatar-effect/1", **definition, "transform": {"offset": {"x": offset_x}}}
    assert mirrors_offset_differently(legacy) is changes
    assert all(not mirrors_offset_differently(pair["v1"]) for pair in PAIRS if pair["name"].startswith("included/"))


def test_the_definition_accepts_only_the_schema_key() -> None:
    """The Python field name ``schema_`` is not a second spelling of ``schema``."""
    from animama.app.contracts.avatar_effect import project_avatar_effect_definition

    definition = dict(PAIRS[0]["v2"])
    assert project_avatar_effect_definition(definition)[1] is None
    renamed = {"schema_": definition.pop("schema"), **definition}
    assert project_avatar_effect_definition(renamed) == (None, "avatar_effect_definition_invalid")
