"""animaPoseClip/2.0 admission agrees with the frontend parser's vocabulary and fixtures."""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest

from animama.app.services.content_package_capabilities import derive_capabilities
from animama.app.services.idle_clip_validation import (
    V2_EASES,
    V2_HAND_ADJUSTMENT_LIMITS,
    V2_HAND_PRESETS,
    V2_JOINT_COMPONENTS,
    V2_LIMITS,
    V2_MIN_SPACING_SECONDS,
    V2_VALUE_BOUNDS,
    validate_clip_v2_timeline,
)
from animama.domain.content_documents import ContentDocumentError
from tests.test_content_package_capabilities import _document

CLIP_FIXTURES = Path(__file__).parents[1] / "src/frontend/web/src/lib/avatar/poses/animaPoseClip/fixtures"


def test_vocabulary_matches_the_frontend_joint_model() -> None:
    vocabulary = json.loads((CLIP_FIXTURES / "v2-vocabulary.json").read_text())
    assert {joint: list(components) for joint, components in V2_JOINT_COMPONENTS.items()} == vocabulary["joints"]
    assert V2_HAND_PRESETS == set(vocabulary["handPresets"])
    assert V2_HAND_ADJUSTMENT_LIMITS == vocabulary["handAdjustmentLimits"]
    assert V2_EASES == set(vocabulary["eases"])
    assert V2_MIN_SPACING_SECONDS == vocabulary["minSpacingSeconds"]
    assert V2_LIMITS == vocabulary["limits"]
    assert V2_VALUE_BOUNDS == vocabulary["valueBounds"]


def test_shared_valid_clip_is_admitted() -> None:
    clip = json.loads((CLIP_FIXTURES / "compatibility-valid-v2.json").read_text())
    assert validate_clip_v2_timeline(clip) == 2


def test_package_requires_the_2_0_capability_and_its_base_pose(tmp_path: Path) -> None:
    clip = json.loads((CLIP_FIXTURES / "compatibility-valid-v2.json").read_text())
    document = _document(
        "gesture",
        implementation={"kind": "anima_clip", "file_role": "sequence"},
        files=[{"path": "action.json", "role": "sequence"}],
    )
    path = tmp_path / "action.json"
    path.write_text(json.dumps(clip))
    requirements = derive_capabilities(document.kind, document, {"action.json": path})
    assert set(requirements) == {"animaPoseClip/2.0", "animama/builtin-pose/1/relaxedRest"}

    clip["joints"]["head"]["flexion"][1]["beat"] = "missing"
    path.write_text(json.dumps(clip))
    with pytest.raises(ContentDocumentError):
        derive_capabilities(document.kind, document, {"action.json": path})


@pytest.mark.parametrize(
    ("seconds", "ticks"),
    # Reference values from the frontend: Math.round(Number(x.toFixed(4)) * 1e4).
    [(0.00045, 4), (-0.00045, -4), (1.23456, 12346), (0.1 + 0.2, 3000), (2.00005, 20000), (-1.99995, -19999)],
)
def test_times_round_like_saved_frontend_files(seconds: float, ticks: int) -> None:
    from animama.app.services.idle_clip_validation import _v2_ticks

    assert _v2_ticks(seconds, "time") == ticks


def _contact(**fields: object) -> dict[str, object]:
    return {"bone": "rightHand", "target": "head", "beat": "raise", "from": 0, "to": 0} | fields


@pytest.mark.parametrize(
    ("clip_patch", "field"),
    [
        ({"duration": 1e30}, "duration"),
        ({"beats": [{"id": "start", "label": "Start", "time": 1e30}]}, "beats[0].time"),
        ({"contacts": [_contact(bone=["head"])]}, "contacts[0].bone"),
        ({"contacts": [_contact(target={"x": 1})]}, "contacts[0].target"),
        ({"contacts": [_contact(to=1e30)]}, "contacts[0].to"),
    ],
)
def test_hostile_values_are_rejected_not_raised(clip_patch: dict[str, object], field: str) -> None:
    clip = json.loads((CLIP_FIXTURES / "compatibility-valid-v2.json").read_text()) | clip_patch
    with pytest.raises(ContentDocumentError, match=rf"Gesture clip {re.escape(field)} "):
        validate_clip_v2_timeline(clip)


def test_lengths_count_utf16_units_like_the_frontend() -> None:
    clip = json.loads((CLIP_FIXTURES / "compatibility-valid-v2.json").read_text())
    # JSON can carry a lone surrogate; JavaScript counts it as one unit.
    lone = json.loads('"\\ud800"')
    clip["beats"][0]["label"] = lone * 80
    assert validate_clip_v2_timeline(clip) == 2
    clip["beats"][0]["label"] = lone * 81
    with pytest.raises(ContentDocumentError, match=r"beats\[0\]\.label is too long"):
        validate_clip_v2_timeline(clip)
    # An emoji is two units.
    clip["beats"][0]["label"] = "\U0001f600" * 41
    with pytest.raises(ContentDocumentError, match=r"beats\[0\]\.label is too long"):
        validate_clip_v2_timeline(clip)
