"""Finite Idle eligibility is derived from exact Gesture media, not guessed durations."""

from __future__ import annotations

import json
from dataclasses import asdict
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest

from animama.app.services.idle_playback import derive_idle_playback
from animama.domain.content_catalog import ContentKind
from animama.domain.content_documents import ActionImplementationV1, ContentDocumentError, GestureDocumentV1
from tests.test_content_gltf import _fixture_document, _glb_source

CASES = json.loads((Path(__file__).parent / "fixtures/idle-playback-cases.json").read_text())


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["name"])
def test_shared_finite_idle_cases(case: dict[str, Any]) -> None:
    document = GestureDocumentV1(
        kind=ContentKind.GESTURE,
        name="Idle action",
        implementation=ActionImplementationV1(kind=case["kind"]),
        config=case["config"],
    )
    if case["kind"] == "vrma":
        gltf, binary = _fixture_document(buffer_uri=None)
        data = _glb_source(gltf, binary)
    else:
        data = json.dumps(case["clip"]).encode()
    if "error" in case:
        with pytest.raises(ContentDocumentError) as error:
            derive_idle_playback(document, BytesIO(data))
        assert error.value.code == case["error"]
    else:
        assert asdict(derive_idle_playback(document, BytesIO(data))) == {
            "eligible": True,
            "reason": None,
            **case["expected"],
        }


def test_config_duration_cannot_substitute_for_exact_motion_bounds() -> None:
    document = GestureDocumentV1(kind=ContentKind.GESTURE, name="Unknown", config={"duration_seconds": 10})
    with pytest.raises(ContentDocumentError) as error:
        derive_idle_playback(document, BytesIO(b"invalid vrma"))
    assert error.value.code == "idle_motion_invalid"


@pytest.mark.parametrize("speed", [float("nan"), float("inf"), 10**400, True])
def test_nonfinite_or_unrepresentable_speed_has_a_safe_validation_error(speed: object) -> None:
    document = GestureDocumentV1(
        kind=ContentKind.GESTURE,
        name="Unsafe speed",
        config={"time_scale": speed},
        implementation=ActionImplementationV1(kind="anima_clip"),
    )
    with pytest.raises(ContentDocumentError) as error:
        derive_idle_playback(document, BytesIO(b'{"schema":"animaPoseClip/1.0","duration":1}'))
    assert error.value.code == "idle_speed_invalid"
