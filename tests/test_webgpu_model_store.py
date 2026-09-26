"""Offline fixtures for the optional Parakeet WebGPU (fp16 encoder) model set."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/models/parakeet_webgpu.py"
spec = importlib.util.spec_from_file_location("parakeet_webgpu_setup", SCRIPT)
assert spec and spec.loader
webgpu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(webgpu)
store = webgpu.store


@pytest.fixture
def inventory(tmp_path):
    value = json.loads(webgpu.DEFAULT_MANIFEST.read_bytes())
    content = {}
    for entry in value["files"]:
        data = (entry["path"] + " fixture\r\n\x1a").encode()
        content[entry["path"]] = data
        entry["size"] = len(data)
        entry["sha256"] = hashlib.sha256(data).hexdigest()
        if "local" in entry["source"]:
            (tmp_path / entry["path"]).write_bytes(data)
    path = tmp_path / "webgpu-manifest.json"
    path.write_text(json.dumps(value))
    calls = []

    def transport(url):
        calls.append(url)
        return io.BytesIO(content[url.rsplit("/", 1)[1]])

    return SimpleNamespace(
        manifest=webgpu.load_manifest(path),
        content=content,
        transport=transport,
        calls=calls,
        root=tmp_path / "store",
        path=path,
    )


def test_checked_in_manifest_pins_the_reviewed_fp16_encoder():
    manifest = webgpu.load_manifest()
    encoder = next(entry for entry in manifest["files"] if entry["path"] == webgpu.ENCODER)
    assert encoder["source"] == {
        "repository": "ysdede/parakeet-tdt-0.6b-v2-onnx",
        "revision": "db4a768f5795e0f508187a34241fbeeef6ebb0d3",
        "path": webgpu.ENCODER,
    }
    assert encoder["size"] == 1238960452
    assert encoder["sha256"] == "ad8bb0acaec339c32ffbdedb869bd60f7103d0f6c00e56c7a2c2ab57df7462a2"


def test_acquires_a_separate_namespace_and_reuses_offline(inventory):
    i = inventory
    result = store.acquire(i.manifest, i.root, transport=i.transport)
    assert result == i.root / "parakeet-tdt-0.6b-v2-webgpu" / i.manifest["digest"]
    assert {p.name for p in result.iterdir()} == set(i.content)
    assert i.calls == [
        "https://huggingface.co/ysdede/parakeet-tdt-0.6b-v2-onnx/resolve/"
        "db4a768f5795e0f508187a34241fbeeef6ebb0d3/encoder-model.fp16.onnx"
    ]
    assert store.acquire(i.manifest, i.root, offline=True, transport=lambda _: pytest.fail("network")) == result
    assert store.verify(i.manifest, i.root) == result


@pytest.mark.parametrize(
    "change", ["path", "source", "revision", "model", "license", "hash", "uppercase_hash", "prefixed_hash", "extra"]
)
def test_manifest_rejects_unreviewed_contract(inventory, change):
    i = inventory
    value = json.loads(i.path.read_bytes())
    encoder = next(entry for entry in value["files"] if entry["path"] == webgpu.ENCODER)
    if change == "path":
        encoder["path"] = "../outside.onnx"
    elif change == "source":
        encoder["source"]["repository"] = "arbitrary/other"
    elif change == "revision":
        encoder["source"]["revision"] = "main"
    elif change == "model":
        value["model_id"] = "parakeet-tdt-0.6b-v2"
    elif change == "license":
        value["license"] = "MIT"
    elif change == "hash":
        encoder["sha256"] = "invalid"
    elif change == "uppercase_hash":
        encoder["sha256"] = encoder["sha256"].upper()
    elif change == "prefixed_hash":
        encoder["sha256"] = "0x" + encoder["sha256"][2:]
    else:
        value["files"].append(dict(encoder, path="decoder_joint-model.fp16.onnx"))
    i.path.write_text(json.dumps(value))
    with pytest.raises(store.ModelStoreError):
        webgpu.load_manifest(i.path)


def test_does_not_accept_the_base_parakeet_manifest():
    with pytest.raises(store.ModelStoreError, match="unsupported"):
        webgpu.load_manifest(store.DEFAULT_MANIFEST)


def test_cli_missing_and_verified_path_use_selected_root(inventory, capsys):
    i = inventory
    args = ["path", "--manifest", str(i.path), "--root", str(i.root)]
    assert webgpu.main(args) == 2
    assert "parakeet_webgpu.py acquire" in capsys.readouterr().err
    result = store.acquire(i.manifest, i.root, transport=i.transport)
    assert webgpu.main(args) == 0
    assert capsys.readouterr().out.strip() == str(result)
