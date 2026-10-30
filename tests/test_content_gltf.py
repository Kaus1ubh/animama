from __future__ import annotations

import base64
import json
import math
import struct
from copy import deepcopy
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest

from animama.app.services import content_gltf
from animama.app.services.content_file_validation import ContentFileInvalidError as ContentFileInvalidError
from animama.app.services.content_gltf import (
    MAX_VRM_BINARY_BYTES,
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


def _sparse_vrm(*, with_base_view: bool = False) -> tuple[dict[str, Any], bytearray]:
    """A VRM 1.0 GLB whose one morph-style accessor stores two of four vectors sparsely."""
    indices = struct.pack("<2H", 1, 3)
    values = struct.pack("<6f", 0.1, 0.2, 0.3, 0.4, 0.5, 0.6)
    binary = bytearray(indices + values)
    document = _vrm_document("1.0")
    document["buffers"] = [{"byteLength": len(binary)}]
    document["bufferViews"] = [
        {"buffer": 0, "byteOffset": 0, "byteLength": len(indices)},
        {"buffer": 0, "byteOffset": len(indices), "byteLength": len(values)},
    ]
    accessor: dict[str, Any] = {
        "componentType": 5126,
        "count": 4,
        "type": "VEC3",
        "sparse": {
            "count": 2,
            "indices": {"bufferView": 0, "componentType": 5123},
            "values": {"bufferView": 1},
        },
    }
    if with_base_view:
        base = struct.pack("<12f", *([0.0] * 12))
        document["bufferViews"].append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(base)})
        binary.extend(base)
        document["buffers"][0]["byteLength"] = len(binary)
        accessor["bufferView"] = 2
    document["accessors"] = [accessor]
    return document, binary


def _validate_vrm(document: dict[str, Any], binary: bytes | bytearray) -> dict[str, Any]:
    source = _glb_source(document, bytes(binary))
    return validate_vrm_stream(content=BytesIO(source), size_bytes=len(source))[1]


@pytest.mark.parametrize("with_base_view", [False, True])
def test_vrm_validator_accepts_bounded_sparse_accessors(with_base_view: bool) -> None:
    document, binary = _sparse_vrm(with_base_view=with_base_view)

    metadata = _validate_vrm(document, binary)

    assert metadata["accessor_count"] == 1
    assert metadata["buffer_view_count"] == (3 if with_base_view else 2)


def _rewrite_indices(binary: bytearray, *values: int) -> None:
    binary[0:4] = struct.pack("<2H", *values)


@pytest.mark.parametrize(
    ("mutate", "reason"),
    [
        pytest.param(
            lambda d, b: d["accessors"][0]["sparse"].update(count=0), "vrm_invalid_structure", id="count-zero"
        ),
        pytest.param(
            lambda d, b: d["accessors"][0]["sparse"].update(count=5), "vrm_invalid_structure", id="count-above-accessor"
        ),
        pytest.param(
            lambda d, b: d["accessors"][0]["sparse"]["indices"].update(componentType=5126),
            "vrm_invalid_structure",
            id="float-indices",
        ),
        pytest.param(
            lambda d, b: d["accessors"][0]["sparse"]["indices"].update(componentType=5122),
            "vrm_invalid_structure",
            id="signed-indices",
        ),
        pytest.param(lambda d, b: _rewrite_indices(b, 3, 1), "vrm_invalid_structure", id="decreasing-indices"),
        pytest.param(lambda d, b: _rewrite_indices(b, 1, 1), "vrm_invalid_structure", id="duplicate-indices"),
        pytest.param(lambda d, b: _rewrite_indices(b, 1, 4), "vrm_invalid_structure", id="index-out-of-range"),
        pytest.param(
            lambda d, b: d["accessors"][0]["sparse"]["indices"].update(bufferView=9),
            "vrm_binary_range",
            id="missing-indices-view",
        ),
        pytest.param(
            lambda d, b: d["accessors"][0]["sparse"]["values"].update(byteOffset=4),
            "vrm_binary_range",
            id="values-past-view",
        ),
        pytest.param(
            lambda d, b: d["accessors"][0]["sparse"]["indices"].update(byteOffset=1),
            "vrm_binary_range",
            id="misaligned-indices",
        ),
        pytest.param(
            lambda d, b: d["bufferViews"][0].update(byteStride=4),
            "vrm_invalid_structure",
            id="strided-indices-view",
        ),
        pytest.param(
            lambda d, b: d["accessors"][0]["sparse"].pop("values"), "vrm_invalid_structure", id="missing-values"
        ),
        pytest.param(
            lambda d, b: d["accessors"][0]["sparse"].pop("indices"), "vrm_invalid_structure", id="missing-indices"
        ),
    ],
)
def test_vrm_validator_rejects_malformed_sparse_accessors(mutate: Any, reason: str) -> None:
    document, binary = _sparse_vrm()
    mutate(document, binary)

    with pytest.raises(ContentFileInvalidError) as error:
        _validate_vrm(document, binary)

    assert error.value.reason == reason


def test_vrm_validator_accepts_zero_filled_accessors_within_the_binary_limit() -> None:
    document, binary = _sparse_vrm()
    del document["accessors"][0]["sparse"]
    assert _validate_vrm(document, binary)["accessor_count"] == 1

    document["accessors"][0]["count"] = MAX_VRM_BINARY_BYTES // 12 + 1
    with pytest.raises(ContentFileInvalidError) as error:
        _validate_vrm(document, binary)
    assert error.value.reason == "vrm_structure_limit"


def test_vrm_validator_caps_the_combined_size_of_sparse_accessors(monkeypatch: pytest.MonkeyPatch) -> None:
    """Sparse accessors sharing one base, index and value view still count separately."""
    monkeypatch.setattr(content_gltf, "MAX_VRM_BINARY_BYTES", 100)
    document, binary = _sparse_vrm(with_base_view=True)
    assert _validate_vrm(document, binary)["accessor_count"] == 1

    document["accessors"] = [deepcopy(document["accessors"][0]) for _ in range(3)]
    with pytest.raises(ContentFileInvalidError) as error:
        _validate_vrm(document, binary)
    assert error.value.reason == "vrm_structure_limit"


def test_vrm_validator_checks_webp_texture_sources() -> None:
    document = _vrm_document("1.0")
    document["images"] = []
    document["textures"] = [{"extensions": {"EXT_texture_webp": {"source": 0}}}]

    with pytest.raises(ContentFileInvalidError) as error:
        source = _json_only_glb(document)
        validate_vrm_stream(content=BytesIO(source), size_bytes=len(source))

    assert error.value.reason == "vrm_invalid_structure"


def test_vrma_validator_still_rejects_sparse_accessors() -> None:
    document, binary = _fixture_document(buffer_uri=None)
    document["accessors"][1]["sparse"] = {
        "count": 1,
        "indices": {"bufferView": 0, "componentType": 5125},
        "values": {"bufferView": 1},
    }

    with pytest.raises(ContentFileInvalidError) as error:
        _canonical(_glb_source(document, binary))

    assert error.value.reason == "vrma_invalid_structure"


INCLUDED_AVATARS = sorted((Path(__file__).resolve().parents[1] / "content/included/avatars").glob("*.vrm"))


@pytest.mark.parametrize("path", INCLUDED_AVATARS, ids=lambda path: path.name)
def test_included_avatars_pass_the_vrm_validator(path: Path) -> None:
    """The optimized Included Avatars use sparse and all-zero morph targets and WebP textures."""
    with path.open("rb") as content:
        metadata = validate_vrm_stream(content=content, size_bytes=path.stat().st_size)[1]

    assert metadata["vrm_spec"] == "1.0"
    # Shipped through `pnpm -s vrm:optimize`; a larger file was not optimized.
    assert path.stat().st_size <= 5_000_000


def test_included_avatars_are_the_two_starters() -> None:
    assert [path.name for path in INCLUDED_AVATARS] == ["Andrew.vrm", "Annie.vrm"]
