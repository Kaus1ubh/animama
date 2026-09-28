"""Offline fixtures for the optional Pocket voice-cloning encoder model set."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/models/pocket_cloning.py"
spec = importlib.util.spec_from_file_location("pocket_cloning_setup", SCRIPT)
assert spec and spec.loader
cloning = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cloning)
store = cloning.store


@pytest.fixture
def inventory(tmp_path):
    value = json.loads(cloning.DEFAULT_MANIFEST.read_bytes())
    content = {}
    for entry in value["files"]:
        data = (entry["path"] + " fixture\r\n\x1a").encode()
        content[entry["path"]] = data
        entry["size"] = len(data)
        entry["sha256"] = hashlib.sha256(data).hexdigest()
        if "local" in entry["source"]:
            (tmp_path / entry["path"]).write_bytes(data)
    path = tmp_path / "cloning-manifest.json"
    path.write_text(json.dumps(value))
    calls = []

    def transport(url):
        calls.append(url)
        return io.BytesIO(content[url.rsplit("/", 1)[1]])

    return SimpleNamespace(
        manifest=cloning.load_manifest(path),
        content=content,
        transport=transport,
        calls=calls,
        root=tmp_path / "store",
        path=path,
    )


def test_checked_in_manifest_pins_the_reviewed_cloning_encoder():
    manifest = cloning.load_manifest()
    encoder = next(entry for entry in manifest["files"] if entry["path"] == cloning.ENCODER)
    assert encoder["source"] == {
        "repository": "KevinAHM/pocket-tts-onnx",
        "revision": "58a6d00cf13d239b6748cb0769f35c580a8f606c",
        "path": f"onnx/english_2026-04/{cloning.ENCODER}",
    }
    assert encoder["size"] == 39768446
    assert encoder["sha256"] == "853e2ca623b8782d94c3745ec6133bfdff7ce33d9b11128bd29ea03f28d76e3d"


def test_acquires_a_separate_namespace_and_reuses_offline(inventory):
    i = inventory
    result = store.acquire(i.manifest, i.root, transport=i.transport)
    assert result == i.root / "pocket-tts-voice-cloning" / i.manifest["digest"]
    assert {p.name for p in result.iterdir()} == set(i.content)
    assert i.calls == [
        "https://huggingface.co/KevinAHM/pocket-tts-onnx/resolve/"
        "58a6d00cf13d239b6748cb0769f35c580a8f606c/onnx/english_2026-04/mimi_encoder.onnx"
    ]
    assert store.acquire(i.manifest, i.root, offline=True, transport=lambda _: pytest.fail("network")) == result
    assert store.verify(i.manifest, i.root) == result


@pytest.mark.parametrize(
    "change", ["path", "source", "revision", "model", "license", "hash", "uppercase_hash", "prefixed_hash", "extra"]
)
def test_manifest_rejects_unreviewed_contract(inventory, change):
    i = inventory
    value = json.loads(i.path.read_bytes())
    encoder = next(entry for entry in value["files"] if entry["path"] == cloning.ENCODER)
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
        cloning.load_manifest(i.path)


def test_does_not_accept_the_base_parakeet_manifest():
    with pytest.raises(store.ModelStoreError, match="unsupported"):
        cloning.load_manifest(store.DEFAULT_MANIFEST)


def test_cli_missing_and_verified_path_use_selected_root(inventory, capsys):
    i = inventory
    args = ["path", "--manifest", str(i.path), "--root", str(i.root)]
    assert cloning.main(args) == 2
    assert "pocket_cloning.py acquire" in capsys.readouterr().err
    result = store.acquire(i.manifest, i.root, transport=i.transport)
    assert cloning.main(args) == 0
    assert capsys.readouterr().out.strip() == str(result)
