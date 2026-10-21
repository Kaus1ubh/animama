"""Offline fixtures for the SenseVoice-Small model sets (CPU base and WebGPU add-on)."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts/models"


def load(name: str):
    spec = importlib.util.spec_from_file_location(name, SCRIPTS / f"{name}.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    # The WebGPU script imports the base script by name.
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


base = load("sensevoice")
webgpu = load("sensevoice_webgpu")
store = base.store
UPSTREAM = (
    "https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17/resolve/"
    "2365baeacb507f821a0c8120fcee3d484dba7a07/"
)


def fixture_inventory(tmp_path: Path, script) -> SimpleNamespace:
    value = json.loads(script.DEFAULT_MANIFEST.read_bytes())
    content = {}
    for entry in value["files"]:
        data = (entry["path"] + " fixture\r\n\x1a").encode()
        content[entry["path"]] = data
        entry["size"] = len(data)
        entry["sha256"] = hashlib.sha256(data).hexdigest()
        if "local" in entry["source"]:
            (tmp_path / entry["path"]).write_bytes(data)
    path = tmp_path / f"{script.MODEL_ID}-manifest.json"
    path.write_text(json.dumps(value))
    calls: list[str] = []

    def transport(url: str) -> io.BytesIO:
        calls.append(url)
        return io.BytesIO(content[url.rsplit("/", 1)[1]])

    return SimpleNamespace(
        manifest=script.load_manifest(path),
        content=content,
        transport=transport,
        calls=calls,
        root=tmp_path / "store",
        path=path,
    )


@pytest.fixture
def cpu(tmp_path):
    return fixture_inventory(tmp_path, base)


@pytest.fixture
def gpu(tmp_path):
    return fixture_inventory(tmp_path, webgpu)


def test_checked_in_manifests_pin_the_reviewed_sherpa_snapshot():
    files = {entry["path"]: entry for entry in base.load_manifest()["files"]}
    assert files["model.int8.onnx"]["size"] == 239233841
    assert files["model.int8.onnx"]["sha256"] == "c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51"
    assert files["tokens.txt"]["sha256"] == "f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc"
    assert files["metadata.json"]["source"] == {"local": "metadata.json"}
    (graph,) = (entry for entry in webgpu.load_manifest()["files"] if entry["path"] == "model.onnx")
    assert graph["size"] == 937617178
    assert graph["sha256"] == "977016bd9c79f9eb343430b5cc305e07ab64d5212dff41b0dcfa1694bee9a8cb"
    assert graph["source"] == {**base.UPSTREAM, "path": "model.onnx"}


def test_metadata_holds_the_front_end_parameters_the_graph_needs():
    metadata = json.loads((base.DEFAULT_MANIFEST.parent / "metadata.json").read_text(encoding="utf-8"))
    window = int(metadata["lfr_window_size"])
    assert (window, int(metadata["lfr_window_shift"])) == (7, 6)
    # CMVN covers the stacked features: 80 mel bins times the frame window.
    for key in ("neg_mean", "inv_stddev"):
        assert len([float(value) for value in metadata[key].split(",")]) == 80 * window
    assert {key: int(metadata[key]) for key in ("lang_ja", "lang_ko", "lang_zh", "lang_yue", "with_itn")} == {
        "lang_ja": 11,
        "lang_ko": 12,
        "lang_zh": 3,
        "lang_yue": 7,
        "with_itn": 14,
    }


def test_upstream_acquisition_reads_pinned_files_and_local_notices(cpu):
    result = store.acquire(cpu.manifest, cpu.root, transport=cpu.transport)
    assert result == cpu.root / "sensevoice-small" / cpu.manifest["digest"]
    assert {p.name for p in result.iterdir()} == set(cpu.content)
    assert cpu.calls == [UPSTREAM + "model.int8.onnx", UPSTREAM + "tokens.txt"]
    assert store.acquire(cpu.manifest, cpu.root, offline=True, transport=lambda _: pytest.fail("network")) == result


def test_default_acquisition_reads_animama_objects_for_every_file(cpu):
    result = store.acquire(cpu.manifest, cpu.root, shared_base_objects=True, transport=cpu.transport)
    assert {p.name for p in result.iterdir()} == set(cpu.content)
    assert cpu.calls == [
        f"https://downloads.animama.ai/models/sensevoice-small/{entry['sha256']}/{entry['path']}"
        for entry in cpu.manifest["files"]
    ]


def test_webgpu_set_acquires_a_separate_namespace_from_upstream_only(gpu):
    result = store.acquire(gpu.manifest, gpu.root, transport=gpu.transport)
    assert result == gpu.root / "sensevoice-small-webgpu" / gpu.manifest["digest"]
    assert gpu.calls == [UPSTREAM + "model.onnx"]
    with pytest.raises(store.ModelStoreError, match="base inventory"):
        store.acquire(gpu.manifest, gpu.root / "other", shared_base_objects=True, transport=gpu.transport)


@pytest.mark.parametrize("change", ["path", "source", "revision", "model", "license", "hash", "missing", "extra"])
def test_manifest_rejects_unreviewed_contract(cpu, change):
    value = json.loads(cpu.path.read_bytes())
    graph = next(entry for entry in value["files"] if entry["path"] == "model.int8.onnx")
    if change == "path":
        graph["path"] = "../outside.onnx"
    elif change == "source":
        graph["source"]["repository"] = "arbitrary/other"
    elif change == "revision":
        graph["source"]["revision"] = "main"
    elif change == "model":
        value["model_id"] = "sensevoice-small-webgpu"
    elif change == "license":
        value["license"] = "CC-BY-4.0"
    elif change == "hash":
        graph["sha256"] = graph["sha256"].upper()
    elif change == "missing":
        value["files"] = [entry for entry in value["files"] if entry["path"] != "metadata.json"]
    else:
        value["files"].append(dict(graph, path="model.onnx"))
    cpu.path.write_text(json.dumps(value))
    with pytest.raises(store.ModelStoreError, match="SenseVoice manifest"):
        base.load_manifest(cpu.path)


def test_each_script_rejects_the_other_set():
    with pytest.raises(store.ModelStoreError, match="unsupported"):
        webgpu.load_manifest(base.DEFAULT_MANIFEST)
    with pytest.raises(store.ModelStoreError, match="unsupported"):
        base.load_manifest(webgpu.DEFAULT_MANIFEST)


@pytest.mark.parametrize("script", [base, webgpu])
def test_cli_missing_and_verified_path_use_selected_root(tmp_path, capsys, script):
    inventory = fixture_inventory(tmp_path, script)
    args = ["path", "--manifest", str(inventory.path), "--root", str(inventory.root)]
    assert script.main(args) == 2
    assert f"{script.__name__}.py acquire" in capsys.readouterr().err
    result = store.acquire(inventory.manifest, inventory.root, transport=inventory.transport)
    assert script.main(args) == 0
    assert capsys.readouterr().out.strip() == str(result)
