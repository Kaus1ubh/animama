from __future__ import annotations

from pathlib import Path

from animama.adapters.content_store import ContentWatcher
from animama.domain.content_catalog import ContentSource
from tests.filesystem_links import link_directory


def test_watcher_classifies_registered_roots_without_resolving_symlinks(tmp_path: Path) -> None:
    included = tmp_path / "included"
    local = tmp_path / "local"
    included.mkdir()
    local.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "kept.vrma").write_bytes(b"glTF")
    linked = local / "gestures"
    link_directory(linked, outside)
    watcher = ContentWatcher(included_root=included, local_root=local)

    # The initial snapshot records the link itself but never enters it.
    assert linked.absolute() in watcher._signatures
    assert (linked / "kept.vrma").absolute() not in watcher._signatures

    assert watcher._classify_changed_path(str(linked / "wave.vrma")) == (
        ContentSource.LOCAL,
        "gestures/wave.vrma",
    )
    assert watcher._classify_changed_path(str(outside / "wave.vrma")) is None


def test_watcher_ignores_reads_but_records_durable_file_changes(tmp_path: Path) -> None:
    included = tmp_path / "included"
    local = tmp_path / "local"
    included.mkdir()
    local.mkdir()
    existing = local / "gestures" / "wave.vrma"
    existing.parent.mkdir()
    existing.write_bytes(b"original")
    watcher = ContentWatcher(included_root=included, local_root=local)

    # Opening/reading a runtime file does not change its durable signature.
    assert existing.read_bytes() == b"original"
    assert watcher._record_if_changed(str(existing)) is None

    existing.write_bytes(b"updated bytes")
    assert watcher._record_if_changed(str(existing)) == (
        ContentSource.LOCAL,
        "gestures/wave.vrma",
    )
    assert watcher._record_if_changed(str(existing)) is None

    created = local / "gestures" / "point.vrma"
    created.write_bytes(b"new")
    assert watcher._record_if_changed(str(created)) == (
        ContentSource.LOCAL,
        "gestures/point.vrma",
    )

    created.unlink()
    assert watcher._record_if_changed(str(created)) == (
        ContentSource.LOCAL,
        "gestures/point.vrma",
    )
    assert watcher._record_if_changed(str(created)) is None


def test_watcher_ignores_hidden_paths_that_the_scanner_never_reads(tmp_path: Path) -> None:
    included = tmp_path / "included"
    local = tmp_path / "local"
    included.mkdir()
    local.mkdir()
    watcher = ContentWatcher(included_root=included, local_root=local)
    hidden = [
        local / ".animama-mutations" / "journal" / "0.original",
        local / ".animama-mutations",
        local / ".animama-import-operation" / "gestures" / "wave.vrma",
        local / "gestures" / ".animama-restore-0123",
        local / "gestures" / ".DS_Store",
    ]
    for path in hidden:
        path.parent.mkdir(parents=True, exist_ok=True)
        if not path.exists():
            path.write_bytes(b"journal bytes")
        # Mutation journals, staging and restores change on every Local write.
        assert watcher._record_if_changed(str(path)) is None

    # An interrupted multi-file save marker is the one hidden name scans report.
    marker = local / "scene-effects" / "scene" / ".animama-operation"
    marker.parent.mkdir(parents=True)
    marker.write_text("{}")
    assert watcher._record_if_changed(str(marker)) == (
        ContentSource.LOCAL,
        "scene-effects/scene/.animama-operation",
    )
