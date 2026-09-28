"""Tiny offline browser speech store fixtures; also runnable on native Windows."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/models/browser_speech.py"
spec = importlib.util.spec_from_file_location("browser_speech_setup", SCRIPT)
assert spec and spec.loader
browser = importlib.util.module_from_spec(spec)
spec.loader.exec_module(browser)
store = browser.store


@pytest.fixture
def inventory(tmp_path):
    value = json.loads(browser.DEFAULT_MANIFEST.read_bytes())
    content = {}
    for entry in value["files"]:
        data = (entry["path"] + " fixture\r\n\x1a").encode()
        content[entry["path"]] = data
        entry["size"] = len(data)
        entry["sha256"] = hashlib.sha256(data).hexdigest()
        if entry["source"].get("kind") == "release":
            voice = entry["path"].removesuffix(".safetensors")
            entry["source"]["url"] = f"{browser.RELEASE_VOICE_PREFIX}{entry['sha256']}/{voice}.safetensors"
    path = tmp_path / "browser-manifest.json"
    path.write_text(json.dumps(value))
    calls = []
    by_url = {download_url(entry): entry["path"] for entry in value["files"]}

    def transport(url):
        calls.append(url)
        return io.BytesIO(content[by_url[url]])

    return SimpleNamespace(
        manifest=browser.load_manifest(path),
        content=content,
        transport=transport,
        calls=calls,
        root=tmp_path / "store",
        path=path,
    )


def download_url(entry: dict[str, Any]) -> str:
    source = entry["source"]
    if source.get("kind") == "release":
        return str(source["url"])
    return f"https://huggingface.co/{source['repository']}/resolve/{source['revision']}/{source['path']}"


def shipped_voices() -> list[dict[str, Any]]:
    voices: list[dict[str, Any]] = json.loads((browser.REPOSITORY / "scripts/voices/selection.json").read_text())[
        "voices"
    ]
    return voices


def test_pinned_sources_flat_store_and_offline_reuse(inventory):
    i = inventory
    result = store.acquire(i.manifest, i.root, transport=i.transport)
    assert result == i.root / "browser-speech" / i.manifest["digest"]
    assert {p.name for p in result.iterdir()} == set(i.content)
    assert i.calls == [download_url(entry) for entry in i.manifest["files"]]
    assert store.acquire(i.manifest, i.root, offline=True, transport=lambda _: pytest.fail("network")) == result
    assert store.verify(i.manifest, i.root) == result


def test_pinned_april_bundle_and_voice_states(inventory):
    targets = {entry["path"]: entry["target"] for entry in inventory.manifest["files"]}
    assert targets["flow_lm_flow.onnx"] == "models/pocket-tts/flow_lm_flow.onnx"
    assert targets["mimi_decoder.onnx"] == "models/pocket-tts/mimi_decoder.onnx"
    assert targets["bundle.json"] == "models/pocket-tts/bundle.json"
    voices = {voice["id"] for voice in shipped_voices() if voice["delivery"] == "core"}
    assert voices == {"eve", "azelma"}
    assert "mary" not in voices  # Downloaded on demand since 2026-09-27.
    for voice in voices:
        assert targets[f"{voice}.safetensors"] == f"models/pocket-tts/voices/{voice}.safetensors"
    assert "voices.bin" not in targets
    assert "mimi_encoder.onnx" not in targets
    assert len(targets) == len(voices) + 8


def test_self_encoded_voices_come_only_from_the_release_host(inventory):
    kinds = {}
    for entry in inventory.manifest["files"]:
        if not entry["target"].startswith("models/pocket-tts/voices/"):
            continue
        source = entry["source"]
        kinds[entry["path"]] = source.get("kind", "huggingface")
        assert entry["license"] in {"CC-BY-4.0", "CC0-1.0"}
        if source.get("kind") == "release":
            voice = entry["path"].removesuffix(".safetensors")
            assert source["url"] == (
                f"https://downloads.animama.ai/models/pocket-tts-voices/{entry['sha256']}/{voice}.safetensors"
            )
    expected = {
        f"{v['id']}.safetensors": "release" if v["source"].startswith("vctk-") else "huggingface"
        for v in shipped_voices()
        if v["delivery"] == "core"
    }
    assert kinds == expected


def test_nested_legacy_import_preserves_files(inventory, tmp_path):
    i = inventory
    legacy = tmp_path / "public-onnx"
    for entry in i.manifest["files"]:
        target = legacy / entry["target"]
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(i.content[entry["path"]])
    result = store.acquire(i.manifest, i.root, offline=True, import_from=legacy, import_field="target")
    for entry in i.manifest["files"]:
        assert (legacy / entry["target"]).read_bytes() == (result / entry["path"]).read_bytes()
    assert not i.calls


def test_versions_coexist_and_concurrent_acquisition_downloads_once(inventory):
    i = inventory
    with ThreadPoolExecutor(max_workers=2) as pool:
        jobs = [pool.submit(store.acquire, i.manifest, i.root, transport=i.transport) for _ in range(2)]
    original = jobs[0].result()
    assert original == jobs[1].result()
    assert len(i.calls) == len(i.manifest["files"])
    i.path.write_text(i.path.read_text() + "\n")
    changed = browser.load_manifest(i.path)
    next_version = store.acquire(changed, i.root, transport=i.transport)
    assert original != next_version
    assert store.verify(i.manifest, i.root) == original
    assert store.verify(changed, i.root) == next_version


def test_parakeet_and_browser_versions_have_separate_namespaces(inventory, tmp_path):
    i = inventory
    parakeet_path = tmp_path / "parakeet-manifest.json"
    value = json.loads(store.DEFAULT_MANIFEST.read_bytes())
    data = b"tiny parakeet"
    for entry in value["files"]:
        entry["size"] = len(data)
        entry["sha256"] = hashlib.sha256(data).hexdigest()
        if "local" in entry["source"]:
            (tmp_path / entry["path"]).write_bytes(data)
    parakeet_path.write_text(json.dumps(value))
    parakeet = store.load_manifest(parakeet_path)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(store.acquire, i.manifest, i.root, transport=i.transport)
        second = pool.submit(store.acquire, parakeet, i.root, transport=lambda _: io.BytesIO(data))
    assert first.result().parent.name == "browser-speech"
    assert second.result().parent.name == "parakeet-tdt-0.6b-v2"
    assert store.verify(parakeet, i.root) == second.result()
    assert store.verify(i.manifest, i.root) == first.result()
    with pytest.raises(store.ModelStoreError, match="unsupported"):
        browser.load_manifest(parakeet_path)
    with pytest.raises(store.ModelStoreError, match="unsupported"):
        store.load_manifest(i.path)


@pytest.mark.parametrize(
    "change",
    ["release-source", "unselected-voice", "noncommercial-voice", "missing-voice"],
)
def test_manifest_rejects_unreviewed_voice_entries(inventory, change):
    i = inventory
    value = json.loads(i.path.read_bytes())
    entry = next(e for e in value["files"] if e["path"] == "eve.safetensors")
    if change == "release-source":
        entry["source"] = {"kind": "release", "url": "https://downloads.animama.ai/models/other"}
    elif change == "unselected-voice":
        entry["path"] = "unlisted.safetensors"
        entry["target"] = "models/pocket-tts/voices/unlisted.safetensors"
    elif change == "noncommercial-voice":
        entry["license"] = "CC-BY-NC-4.0"
    else:
        value["files"].remove(entry)
    i.path.write_text(json.dumps(value))
    with pytest.raises(store.ModelStoreError):
        browser.load_manifest(i.path)


def test_release_host_is_allowed_only_for_release_sources():
    url = "https://downloads.animama.ai/models/pocket-tts-voices/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef/x.safetensors"
    store.validate_url(url, hosts=store.RELEASE_HOSTS)
    with pytest.raises(store.ModelStoreError):
        store.validate_url(url)
    with pytest.raises(store.ModelStoreError):
        store.validate_url("https://huggingface.co/x", hosts=store.RELEASE_HOSTS)


@pytest.mark.parametrize("change", ["path", "target", "source", "revision", "license", "notice", "hash", "size"])
def test_manifest_rejects_unreviewed_contract(inventory, change):
    i = inventory
    value = json.loads(i.path.read_bytes())
    entry = value["files"][0]
    if change == "path":
        entry["path"] = "../outside"
    elif change == "target":
        entry["target"] = "models/../outside"
    elif change == "source":
        entry["source"]["repository"] = "arbitrary/other"
    elif change == "revision":
        entry["source"]["revision"] = "main"
    elif change == "license":
        entry["license"] = "MIT"
    elif change == "notice":
        value["notices"][0]["path"] = "../notice"
    elif change == "hash":
        entry["sha256"] = "invalid"
    else:
        entry["size"] = True
    i.path.write_text(json.dumps(value))
    with pytest.raises(store.ModelStoreError):
        browser.load_manifest(i.path)


def test_retained_notice_hash_is_verified(inventory):
    value = json.loads(inventory.path.read_bytes())
    value["notices"][0]["sha256"] = "0" * 64
    inventory.path.write_text(json.dumps(value))
    with pytest.raises(store.ModelStoreError, match="mismatch"):
        browser.load_manifest(inventory.path)


def test_interrupted_staging_is_removed_and_existing_corruption_is_not_repaired(inventory):
    i = inventory
    calls = 0

    def interrupted(url):
        nonlocal calls
        calls += 1
        if calls == 3:
            raise ConnectionResetError("fixture interruption after readonly outputs")
        return i.transport(url)

    with pytest.raises(ConnectionResetError):
        store.acquire(i.manifest, i.root, transport=interrupted)
    assert not list((i.root / "browser-speech").glob("*.partial-*"))
    result = store.acquire(i.manifest, i.root, transport=i.transport)
    corrupt = result / "bundle.json"
    corrupt.chmod(0o644)
    corrupt.write_bytes(b"bad")
    with pytest.raises(store.ModelStoreError, match="not changed"):
        store.acquire(i.manifest, i.root, transport=lambda _: pytest.fail("network"))
    assert corrupt.read_bytes() == b"bad"


def test_nested_import_rejects_linked_directory(inventory, tmp_path):
    i = inventory
    legacy = tmp_path / "onnx"
    legacy.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    try:
        (legacy / "models").symlink_to(outside, target_is_directory=True)
    except OSError as exc:
        if sys.platform == "win32" and exc.winerror == 1314:
            pytest.skip("Windows symlink privilege unavailable; common store junction tests cover reparse handling")
        raise
    with pytest.raises(store.ModelStoreError, match="symlink"):
        store.acquire(i.manifest, i.root, offline=True, import_from=legacy, import_field="target")
    assert not list(outside.iterdir())


def test_cli_missing_and_verified_path_use_selected_root(inventory, capsys):
    i = inventory
    args = ["path", "--manifest", str(i.path), "--root", str(i.root), "--offline"]
    assert browser.main(args) == 2
    assert "browser_speech.py acquire" in capsys.readouterr().err
    result = store.acquire(i.manifest, i.root, transport=i.transport)
    assert browser.main(args) == 0
    assert capsys.readouterr().out.strip() == str(result)
    (result / "unexpected").write_bytes(b"extra")
    assert browser.main(args) == 1
    assert "unexpected model inventory" in capsys.readouterr().err


def test_reviewed_pocket_legacy_huggingface_cdn_redirect():
    store.validate_url("https://cdn-lfs-us-1.hf.co/repos/model?signature=fixture")
    with pytest.raises(store.ModelStoreError):
        store.validate_url("https://cdn-lfs-us-1.hf.co.evil.example/repos/model")
