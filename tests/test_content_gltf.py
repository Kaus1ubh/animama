from __future__ import annotations

import base64
import json
import math
import struct
from copy import deepcopy
from io import BytesIO
from typing import Any

import pytest

from animama.app.services.content_file_validation import ContentFileInvalidError as ContentFileInvalidError
from animama.app.services.content_gltf import (
    canonicalize_vrma_stream,
    validate_vrm_stream,
)


def _fixture_document(*, buffer_uri: str | None) -> tuple[dict[str, Any], bytes]:
    binary = struct.pack("<8f", 0, 1, 0, 0, 0, 1, 0, 0)
    buffer: dict[str, object] = {"byteLength": len(binary)}
    if buffer_uri is not None:
        buffer["uri"] = buffer_uri
    document = {
        "asset": {"version": "2.0"},
        "extensionsUsed": ["VRMC_vrm_animation"],
        "extensions": {
            "VRMC_vrm_animation": {
                "specVersion": "1.0",
                "humanoid": {"humanBones": {"hips": {"node": 0}}},
            }
        },
        "nodes": [{}],
        "buffers": [buffer],
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 8},
            {"buffer": 0, "byteOffset": 8, "byteLength": 24},
        ],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": 2, "type": "SCALAR"},
            {"bufferView": 1, "componentType": 5126, "count": 2, "type": "VEC3"},
        ],
        "animations": [
            {
                "samplers": [{"input": 0, "output": 1}],
                "channels": [
                    {
                        "sampler": 0,
                        "target": {"node": 0, "path": "translation"},
                    }
                ],
            }
        ],
    }
    return document, binary


def _json_source(document: dict[str, Any]) -> bytes:
    return json.dumps(document, separators=(",", ":")).encode()


def _glb_source(document: dict[str, Any], binary: bytes) -> bytes:
    raw_json = json.dumps(document, separators=(",", ":")).encode()
    json_chunk = raw_json + b" " * (-len(raw_json) % 4)
    binary_chunk = binary + b"\x00" * (-len(binary) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary_chunk)
    return (
        struct.pack("<4sII", b"glTF", 2, total)
        + struct.pack("<II", len(json_chunk), 0x4E4F534A)
        + json_chunk
        + struct.pack("<II", len(binary_chunk), 0x004E4942)
        + binary_chunk
    )


def _json_only_glb(document: dict[str, Any]) -> bytes:
    raw_json = json.dumps(document, separators=(",", ":")).encode()
    json_chunk = raw_json + b" " * (-len(raw_json) % 4)
    total = 12 + 8 + len(json_chunk)
    return struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<II", len(json_chunk), 0x4E4F534A) + json_chunk


def _vrm_document(spec: str) -> dict[str, Any]:
    bone_names = [
        "hips",
        "spine",
        "head",
        "leftUpperLeg",
        "leftLowerLeg",
        "leftFoot",
        "rightUpperLeg",
        "rightLowerLeg",
        "rightFoot",
        "leftUpperArm",
        "leftLowerArm",
        "leftHand",
        "rightUpperArm",
        "rightLowerArm",
        "rightHand",
    ]
    nodes = [{"name": bone} for bone in bone_names]
    if spec == "1.0":
        extension_name = "VRMC_vrm"
        extension = {
            "specVersion": "1.0",
            "humanoid": {"humanBones": {bone: {"node": index} for index, bone in enumerate(bone_names)}},
        }
    else:
        extension_name = "VRM"
        extension = {
            "specVersion": "0.0",
            "humanoid": {"humanBones": [{"bone": bone, "node": index} for index, bone in enumerate(bone_names)]},
        }
    return {
        "asset": {"version": "2.0"},
        "extensionsUsed": [extension_name],
        "extensions": {extension_name: extension},
        "nodes": nodes,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "scene": 0,
    }


def _canonical(source: bytes, *, repair: bool = False):
    return canonicalize_vrma_stream(
        content=BytesIO(source),
        size_bytes=len(source),
        repair_missing_spec_version=repair,
    )


def test_embedded_json_and_glb_have_identical_canonical_output() -> None:
    data_document, binary = _fixture_document(
        buffer_uri="data:application/octet-stream;base64,"
        + base64.b64encode(struct.pack("<8f", 0, 1, 0, 0, 0, 1, 0, 0)).decode()
    )
    glb_document, _ = _fixture_document(buffer_uri=None)

    json_result = _canonical(_json_source(data_document))
    glb_result = _canonical(_glb_source(glb_document, binary))

    assert json_result.content == glb_result.content
    assert json_result.content.startswith(b"glTF")
    assert json_result.source_container == "gltf_json_embedded"
    assert glb_result.source_container == "glb2"
    assert json_result.track_count == 1
    assert json_result.keyframe_count == 2
    assert json_result.duration_seconds == pytest.approx(1)


@pytest.mark.parametrize(
    ("uri", "reason"),
    [
        ("motion.bin", "vrma_external_resource"),
        ("https://example.test/motion.bin", "vrma_external_resource"),
        ("data:application/octet-stream;base64,not*base64", "vrma_invalid_base64"),
    ],
)
def test_json_source_rejects_external_or_invalid_buffers(
    uri: str,
    reason: str,
) -> None:
    document, _binary = _fixture_document(buffer_uri=uri)

    with pytest.raises(ContentFileInvalidError) as caught:
        _canonical(_json_source(document))

    assert caught.value.reason == reason


def test_exactly_one_animation_is_required() -> None:
    document, binary = _fixture_document(buffer_uri=None)
    document["animations"].append(deepcopy(document["animations"][0]))

    with pytest.raises(ContentFileInvalidError) as caught:
        _canonical(_glb_source(document, binary))

    assert caught.value.reason == "vrma_animation_count"


def test_accessor_ranges_and_finite_values_are_validated() -> None:
    document, binary = _fixture_document(buffer_uri=None)
    document["bufferViews"][1]["byteLength"] = 8
    with pytest.raises(ContentFileInvalidError) as range_error:
        _canonical(_glb_source(document, binary))
    assert range_error.value.reason == "vrma_binary_range"

    finite_document, _ = _fixture_document(buffer_uri=None)
    nonfinite = struct.pack("<8f", 0, 1, math.nan, 0, 0, 1, 0, 0)
    with pytest.raises(ContentFileInvalidError) as finite_error:
        _canonical(_glb_source(finite_document, nonfinite))
    assert finite_error.value.reason == "vrma_non_finite_number"


def test_animation_outputs_must_use_float_accessors() -> None:
    document, binary = _fixture_document(buffer_uri=None)
    document["accessors"][1]["componentType"] = 5123

    with pytest.raises(ContentFileInvalidError) as caught:
        _canonical(_glb_source(document, binary))

    assert caught.value.reason == "vrma_invalid_structure"


def test_glb_length_and_chunk_boundaries_are_complete() -> None:
    document, binary = _fixture_document(buffer_uri=None)
    source = _glb_source(document, binary)

    with pytest.raises(ContentFileInvalidError) as caught:
        _canonical(source[:-1])

    assert caught.value.reason == "vrma_glb_length"


def test_missing_spec_version_is_repairable_only_for_app_migration() -> None:
    document, binary = _fixture_document(buffer_uri=None)
    del document["extensions"]["VRMC_vrm_animation"]["specVersion"]
    source = _glb_source(document, binary)

    with pytest.raises(ContentFileInvalidError) as caught:
        _canonical(source)
    assert caught.value.reason == "vrma_unsupported_spec_version"

    repaired = _canonical(source, repair=True)
    assert repaired.warnings == ("app_missing_spec_version_repaired",)
    assert repaired.content.startswith(b"glTF")


@pytest.mark.parametrize("spec", ["0.0", "1.0"])
def test_vrm_validator_accepts_supported_humanoid_specs(spec: str) -> None:
    source = _json_only_glb(_vrm_document(spec))

    media_type, metadata = validate_vrm_stream(
        content=BytesIO(source),
        size_bytes=len(source),
    )

    assert media_type == "model/gltf-binary"
    assert metadata == {
        "container": "glb2",
        "vrm": True,
        "vrm_spec": spec,
        "node_count": 15,
        "buffer_view_count": 0,
        "accessor_count": 0,
    }


def test_vrm_validator_rejects_missing_or_out_of_range_humanoid_bones() -> None:
    missing = _vrm_document("1.0")
    del missing["extensions"]["VRMC_vrm"]["humanoid"]["humanBones"]["head"]
    with pytest.raises(ContentFileInvalidError) as missing_error:
        source = _json_only_glb(missing)
        validate_vrm_stream(content=BytesIO(source), size_bytes=len(source))
    assert missing_error.value.reason == "vrm_invalid_humanoid"

    invalid = _vrm_document("0.0")
    invalid["extensions"]["VRM"]["humanoid"]["humanBones"][2]["node"] = 99
    with pytest.raises(ContentFileInvalidError) as range_error:
        source = _json_only_glb(invalid)
        validate_vrm_stream(content=BytesIO(source), size_bytes=len(source))
    assert range_error.value.reason == "vrm_invalid_humanoid"
