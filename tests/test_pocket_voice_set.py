"""The Animama-hosted Pocket voice set: tracked manifest, acquisition and downloader catalog."""

from __future__ import annotations

import hashlib
import importlib.util
import io
import json
import sys
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/models/pocket_voices.py"
spec = importlib.util.spec_from_file_location("pocket_voice_set", SCRIPT)
assert spec and spec.loader
voice_set = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = voice_set
spec.loader.exec_module(voice_set)
store = voice_set.store

from animama.app.services.model_asset_service import load_packaged_asset_catalog  # noqa: E402


def selection() -> list[dict[str, Any]]:
    voices: list[dict[str, Any]] = json.loads((ROOT / "scripts/voices/selection.json").read_text())["voices"]
    return voices


def test_tracked_set_holds_the_hosted_voices_and_notices() -> None:
    manifest = voice_set.load_manifest()
    names = {entry["path"] for entry in manifest["files"]}
    hosted = {
        f"{v['id']}.safetensors" for v in selection() if v["delivery"] == "download" or v["source"].startswith("vctk-")
    }
    assert names == hosted | {"ATTRIBUTION.md", "README.md"}
    assert len(hosted) == 36
    for entry in manifest["files"]:
        if entry["source"].get("kind") == "release":
            voice = entry["path"]
            assert entry["source"]["url"] == (
                f"https://downloads.animama.ai/models/pocket-tts-voices/{entry['sha256']}/{voice}"
            )
    # The tracked notices are the published bytes.
    for name in ("ATTRIBUTION.md", "README.md"):
        data = (ROOT / "models/pocket-tts-voices" / name).read_bytes()
        entry = next(e for e in manifest["files"] if e["path"] == name)
        assert (entry["size"], entry["sha256"]) == (len(data), hashlib.sha256(data).hexdigest())


@pytest.mark.parametrize("change", ["extra", "missing", "source", "digest", "license"])
def test_manifest_rejects_unreviewed_voice_entries(tmp_path: Path, change: str) -> None:
    value = json.loads(voice_set.DEFAULT_MANIFEST.read_text())
    release = next(e for e in value["files"] if e["source"].get("kind") == "release")
    if change == "extra":
        value["files"].append({**release, "path": "unlisted.safetensors"})
    elif change == "missing":
        value["files"].remove(release)
    elif change == "source":
        release["source"] = {"kind": "release", "url": "https://example.com/x.safetensors"}
    elif change == "digest":
        release["source"]["url"] = release["source"]["url"].replace(release["sha256"], "0" * 64)
    else:
        value["license"] = "CC-BY-NC-4.0"
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(value))
    with pytest.raises(store.ModelStoreError):
        voice_set.load_manifest(path)


def test_acquisition_downloads_release_and_hugging_face_sources(tmp_path: Path) -> None:
    value = json.loads(voice_set.DEFAULT_MANIFEST.read_text())
    content = {}
    for entry in value["files"]:
        data = f"{entry['path']} fixture".encode()
        content[entry["path"]] = data
        entry["size"], entry["sha256"] = len(data), hashlib.sha256(data).hexdigest()
        if entry["source"].get("kind") == "release":
            entry["source"]["url"] = (
                f"https://downloads.animama.ai/models/pocket-tts-voices/{entry['sha256']}/{entry['path']}"
            )
        elif "local" in entry["source"]:
            (tmp_path / entry["path"]).write_bytes(data)
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(value))
    manifest = voice_set.load_manifest(path)
    urls = []

    def transport(url: str) -> io.BytesIO:
        urls.append(url)
        return io.BytesIO(content[url.rsplit("/", 1)[1]])

    result = store.acquire(manifest, tmp_path / "store", transport=transport)
    assert {p.name for p in result.iterdir()} == set(content)
    assert any(url.startswith("https://downloads.animama.ai/models/") for url in urls)
    assert any(url.startswith("https://huggingface.co/kyutai/") for url in urls)


def test_downloadable_voices_are_pinned_in_the_packaged_catalog() -> None:
    manifest = {e["path"]: e for e in voice_set.load_manifest()["files"]}
    assets = {a.id: a for a in load_packaged_asset_catalog().assets if a.id.startswith("pocket-voice-")}
    downloadable = [v for v in selection() if v["delivery"] == "download"]
    assert set(assets) == {f"pocket-voice-{v['id']}" for v in downloadable}
    assert len(assets) == 36
    for voice in downloadable:
        asset, entry = assets[f"pocket-voice-{voice['id']}"], manifest[f"{voice['id']}.safetensors"]
        (file,) = asset.files
        assert (asset.size, file.sha256, asset.license_ref) == (entry["size"], entry["sha256"], "CC-BY-4.0")
        assert file.url == (
            f"https://downloads.animama.ai/models/pocket-tts-voices/{entry['sha256']}/{voice['id']}.safetensors"
        )
