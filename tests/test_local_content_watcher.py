from __future__ import annotations

from pathlib import Path

from animama.adapters.content_store import ContentWatcher
from animama.domain.content_catalog import ContentSource


def test_watcher_classifies_registered_roots_without_resolving_symlinks(tmp_path: Path) -> None:
    included = tmp_path / "included"
    local = tmp_path / "local"
    included.mkdir()
    local.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    linked = local / "gestures"
    linked.symlink_to(outside, target_is_directory=True)
    watcher = ContentWatcher(included_root=included, local_root=local)

    assert watcher._classify_changed_path(str(linked / "wave.vrma")) == (  # noqa: SLF001
        ContentSource.LOCAL,
        "gestures/wave.vrma",
    )
    assert watcher._classify_changed_path(str(outside / "wave.vrma")) is None  # noqa: SLF001


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
    assert watcher._record_if_changed(str(existing)) is None  # noqa: SLF001

    existing.write_bytes(b"updated bytes")
    assert watcher._record_if_changed(str(existing)) == (  # noqa: SLF001
        ContentSource.LOCAL,
        "gestures/wave.vrma",
    )
    assert watcher._record_if_changed(str(existing)) is None  # noqa: SLF001

    created = local / "gestures" / "point.vrma"
    created.write_bytes(b"new")
    assert watcher._record_if_changed(str(created)) == (  # noqa: SLF001
        ContentSource.LOCAL,
        "gestures/point.vrma",
    )

    created.unlink()
    assert watcher._record_if_changed(str(created)) == (  # noqa: SLF001
        ContentSource.LOCAL,
        "gestures/point.vrma",
    )
    assert watcher._record_if_changed(str(created)) is None  # noqa: SLF001
