"""Offline command-boundary checks for explicit release-only model acquisition."""

from __future__ import annotations

import importlib.util
import json
import subprocess
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("release_model_inputs", ROOT / "scripts/models/release_inputs.py")
assert spec and spec.loader
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


@pytest.fixture
def commands(monkeypatch, tmp_path):
    calls = []

    def run(command, **kwargs):
        calls.append((command, kwargs))
        return SimpleNamespace(stdout=str(tmp_path / "verified-core") + "\n")

    monkeypatch.setattr(release.subprocess, "run", run)
    return calls


def test_bootstraps_unpublished_models_and_only_reviewed_vctk_sources(commands, tmp_path):
    release.acquire_release_inputs(root=tmp_path / "models", work=tmp_path / "work")
    argv = [command for command, _ in commands]
    assert any(
        command[1:4] == ["scripts/models/parakeet.py", "acquire", "--source"] and "upstream" in command
        for command in argv
    )
    assert any(command[1:4] == ["scripts/models/pocket_cloning.py", "acquire", "--source"] for command in argv)
    encode = next(command for command in argv if "encode" in command)
    selected = json.loads((ROOT / "scripts/voices/selection.json").read_text())["voices"]
    assert encode[:4] == ["uv", "run", "--locked", "--script"]
    assert encode[encode.index("--only") + 1 :] == sorted(
        {v["source"] for v in selected if v["source"].startswith("vctk-")}
    )
    assert len(encode[encode.index("--only") + 1 :]) == 24
    assert "--rehash" not in encode
    projection = next(command for command in argv if "release" in command)
    assert projection[-2:] == ["--model-inputs", str(tmp_path / "verified-core")]
    assert argv[-1][1:5] == ["scripts/models/pocket_voices.py", "acquire", "--offline", "--import-from"]
    assert str(tmp_path / "work/import-voice-set") in argv[-1]
    assert all(kwargs["env"]["ANIMAMA_MODEL_ROOT"] == str(tmp_path / "models") for _, kwargs in commands)


def test_verified_producer_inventory_bypasses_encoding(commands, tmp_path):
    release.acquire_release_inputs(
        root=tmp_path / "models", work=tmp_path / "work", import_voices=tmp_path / "existing"
    )
    argv = [command for command, _ in commands]
    assert not any("scripts/voices/voices.py" in command for command in argv)
    assert "--offline" in argv[-1] and str(tmp_path / "existing") in argv[-1]


def test_changed_generated_inventory_stops_before_import(monkeypatch, tmp_path):
    calls = []

    def run(command, **kwargs):
        calls.append(command)
        if command[0] == "git" and sum(item[0] == "git" for item in calls) == 2:
            raise subprocess.CalledProcessError(1, command)
        return SimpleNamespace(stdout=str(tmp_path / "verified-core"))

    monkeypatch.setattr(release.subprocess, "run", run)
    with pytest.raises(subprocess.CalledProcessError):
        release.acquire_release_inputs(root=tmp_path / "models", work=tmp_path / "work")
    assert not any("scripts/models/pocket_voices.py" in command for command in calls)


def test_release_workflow_preserves_model_candidates_and_requires_browser_and_model_credentials():
    workflow = (ROOT / ".github/workflows/release-desktop-macos.yml").read_text()
    assert "python3 scripts/models/release_inputs.py" in workflow
    assert workflow.index("pnpm exec playwright install chromium") < workflow.index("- run: pnpm web:test")
    assert "inputs.distribution == 'r2' && secrets.ANIMAMA_R2_" not in workflow
    assert "path: src/frontend/desktop/release/publish/" in workflow
    assert "does not produce" in workflow and "release-scan.json" in workflow
