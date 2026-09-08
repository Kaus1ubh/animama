from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from animama.server.config import Settings
from animama.server.local_runtime import (
    CONTENT_TYPE_DIRECTORIES,
    LocalRuntimeConfigurationError,
    initialize_local_runtime,
)


def _settings(content_root: Path, data_root: Path) -> Settings:
    return Settings(animama_content_root=content_root, animama_data_root=data_root)


def test_local_roots_are_disjoint(tmp_path: Path) -> None:
    with pytest.raises(ValidationError, match="must be disjoint"):
        _settings(tmp_path / "state", tmp_path / "state" / "private")


def test_initialize_local_runtime_creates_the_approved_skeleton(tmp_path: Path) -> None:
    paths = initialize_local_runtime(_settings(tmp_path / "content", tmp_path / "data"))

    assert paths.included_root.is_dir()
    assert {path.relative_to(paths.included_root).as_posix() for path in paths.included_type_roots} == set(
        CONTENT_TYPE_DIRECTORIES
    )
    assert {path.relative_to(paths.local_root).as_posix() for path in paths.local_type_roots} == set(
        CONTENT_TYPE_DIRECTORIES
    )
    assert paths.included_licenses_root.is_dir()
    assert paths.user_files_root.is_dir()
    assert paths.uploads_staging_root.is_dir()
    assert paths.imports_staging_root.is_dir()
    assert paths.exports_staging_root.is_dir()
    assert paths.operations_root.is_dir()
    assert paths.runtime_root.is_dir()
    assert paths.derivatives_root.is_dir()
    assert paths.reconciliation_root.is_dir()

    for removed_name in ("libraries", "drop-ins", "staging", "imports", "exports"):
        assert not (paths.local_root / removed_name).exists()


def test_symlinked_root_is_rejected(tmp_path: Path) -> None:
    real_content = tmp_path / "real-content"
    real_content.mkdir()
    content_link = tmp_path / "content-link"
    content_link.symlink_to(real_content, target_is_directory=True)

    # Settings resolves the root. Exercise the real-directory check on a nested
    # Included path instead, which must never be replaced by a symlink.
    settings = _settings(content_link, tmp_path / "data")
    included_target = real_content / "included-target"
    included_target.mkdir()
    (real_content / "included").symlink_to(included_target, target_is_directory=True)

    with pytest.raises(LocalRuntimeConfigurationError, match="Included content root must be a real directory"):
        initialize_local_runtime(settings)


def test_symlinked_managed_subdirectory_is_rejected(tmp_path: Path) -> None:
    content_root = tmp_path / "content"
    local_root = content_root / "local"
    local_root.mkdir(parents=True)
    outside = tmp_path / "outside"
    outside.mkdir()
    (local_root / "gestures").symlink_to(outside, target_is_directory=True)

    with pytest.raises(LocalRuntimeConfigurationError, match="Local type root gestures must be a real directory"):
        initialize_local_runtime(_settings(content_root, tmp_path / "data"))


def test_immutable_included_roots_are_never_created_or_write_probed(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    core = tmp_path / "bundle" / "core"
    (core / "licenses").mkdir(parents=True)
    settings = Settings(
        animama_content_root=tmp_path / "state" / "content",
        animama_local_content_root=tmp_path / "state" / "content" / "local",
        animama_data_root=tmp_path / "state" / "data",
        animama_included_content_sources_json=json.dumps([{"id": "core", "version": "v1", "root": str(core)}]),
    )
    original_mkdir = Path.mkdir

    def guarded_mkdir(directory: Path, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
        assert not directory.is_relative_to(core)
        original_mkdir(directory, *args, **kwargs)

    monkeypatch.setattr(Path, "mkdir", guarded_mkdir)
    core.chmod(0o555)
    try:
        paths = initialize_local_runtime(settings)
        assert paths.included_sources[0].mount_id == "core@v1"
        assert paths.local_root.is_dir()
        assert list(core.iterdir()) == [core / "licenses"]
        assert not (settings.animama_content_root / "included").exists()
    finally:
        core.chmod(0o755)


@pytest.mark.parametrize("case", ["missing", "linked", "overlap", "no_core", "unknown_pack", "duplicate"])
def test_invalid_immutable_sources_fail_before_creating_user_state(tmp_path: Path, case: str) -> None:
    core = tmp_path / "core"
    core.mkdir()
    entries = [{"id": "core", "version": "v1", "root": str(core)}]
    local = tmp_path / "local"
    if case == "missing":
        entries[0]["root"] = str(tmp_path / "missing")
    elif case == "linked":
        linked = tmp_path / "linked"
        linked.symlink_to(core, target_is_directory=True)
        entries[0]["root"] = str(linked)
    elif case == "overlap":
        local = core
    elif case == "no_core":
        entries[0]["id"] = "other"
    elif case == "unknown_pack":
        entries[0]["pack_id"] = "not-a-pack"
    else:
        entries.append(dict(entries[0]))
    settings = Settings(
        animama_content_root=tmp_path / "content",
        animama_local_content_root=local,
        animama_data_root=tmp_path / "data",
        animama_included_content_sources_json=json.dumps(entries),
    )
    with pytest.raises(LocalRuntimeConfigurationError, match="Invalid immutable"):
        initialize_local_runtime(settings)
    assert not (tmp_path / "data").exists()
