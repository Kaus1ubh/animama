"""Filesystem mutation outcomes across failure, restart, and later manual writes."""

from __future__ import annotations

import hashlib
import json
import os
import struct
from dataclasses import asdict
from io import BytesIO
from pathlib import Path

import pytest

from animama.adapters.content_store import FilesystemContentStore, mutations
from animama.domain.content_catalog import (
    CatalogContentEntry,
    CatalogContentFile,
    ContentConflictError,
    ContentIntegrityError,
    ContentKind,
    ContentPathError,
    ContentScope,
    ContentSource,
    PreparedPackageEntry,
    PreparedPackageFile,
)
from animama.utils import files
from tests.filesystem_links import link_directory, require_symlinks


def vrma(label: str) -> bytes:
    """Build a small structurally valid animation whose revision varies by label."""

    value = {
        "asset": {"version": "2.0"},
        "extensions": {"VRMC_vrm_animation": {"specVersion": "1.0"}},
        "extras": {"label": label},
    }
    document = json.dumps(value).encode()
    document += b" " * (-len(document) % 4)
    return (
        struct.pack("<4sII", b"glTF", 2, 20 + len(document)) + struct.pack("<II", len(document), 0x4E4F534A) + document
    )


def store_at(root: Path) -> FilesystemContentStore:
    """Use separate private/local roots, as allowed by native and Compose configuration."""

    for name in ("included", "local", "operations"):
        (root / name).mkdir(exist_ok=True)
    return FilesystemContentStore(
        included_root=root / "included", local_root=root / "local", operations_root=root / "operations"
    )


def begin(store: FilesystemContentStore, operation: str = "operation") -> str:
    return store.begin_mutation(
        operation_id=operation, user_id="owner", request_digest=hashlib.sha256(operation.encode()).hexdigest()
    )


def save(store: FilesystemContentStore, name: str, label: str) -> None:
    store.save_standalone(
        kind=ContentKind.GESTURE,
        relative_locator=f"gestures/{name}.vrma",
        payload=vrma(label),
        operation_id=f"save-{name}-{label}",
    )


def catalog_entry(store: FilesystemContentStore) -> CatalogContentEntry:
    """Freeze the scan as the catalog would before admitting Delete."""

    scanned = store.scan(ContentSource.LOCAL)[0]
    return CatalogContentEntry(
        id="item",
        source=scanned.source,
        scope=ContentScope.OWNER,
        owner_user_id="owner",
        kind=scanned.kind,
        relative_locator=scanned.relative_locator,
        display_name=scanned.display_name,
        status=scanned.status,
        revision_sha256=scanned.revision_sha256,
        files=tuple(
            CatalogContentFile(file_ref=str(index), item_id="item", source=scanned.source, **asdict(file))
            for index, file in enumerate(scanned.files)
        ),
    )


def package(name: str, label: str) -> PreparedPackageEntry:
    payload = vrma(label)
    return PreparedPackageEntry(
        kind=ContentKind.GESTURE,
        relative_locator=f"gestures/{name}.vrma",
        files=(PreparedPackageFile(relative_path=f"{name}.vrma", handle=BytesIO(payload), size_bytes=len(payload)),),
    )


@pytest.mark.parametrize("commit", [False, True])
def test_restart_uses_catalog_commit_decision_and_cleanup_is_idempotent(tmp_path: Path, commit: bool) -> None:
    store = store_at(tmp_path)
    save(store, "wave", "before")
    journal_id = begin(store)
    save(store, "wave", "after")
    recovered = store_at(tmp_path)
    pending = recovered.pending_mutations()
    assert [(item.journal_id, item.user_id, item.operation_id) for item in pending] == [
        (journal_id, "owner", "operation")
    ]
    recovered.recover_mutations(committed_journal_ids={journal_id} if commit else set())
    assert (tmp_path / "local/gestures/wave.vrma").read_bytes() == vrma("after" if commit else "before")
    assert recovered.pending_mutations() == ()
    assert not list((tmp_path / "local/.animama-mutations").rglob("*.original"))
    recovered.finalize_mutation(journal_id=journal_id, commit=commit)


def test_active_save_ignores_legacy_completed_receipt_until_outer_success(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    save(store, "wave", "before")
    save(store, "wave", "after")
    path = tmp_path / "local/gestures/wave.vrma"
    path.write_bytes(vrma("manual-before"))
    journal_id = begin(store)
    save(store, "wave", "after")
    assert path.read_bytes() == vrma("after")
    store.finalize_mutation(journal_id=journal_id, commit=False)
    assert path.read_bytes() == vrma("manual-before")


@pytest.mark.parametrize("commit", [False, True])
def test_delayed_finalization_does_not_touch_a_newer_request_and_releases_old_handle(
    tmp_path: Path, commit: bool
) -> None:
    """Cleanup from an old command cannot claim a reused owner/operation identity."""

    old_store = store_at(tmp_path)
    save(old_store, "wave", "before")
    journal_id = begin(old_store)
    old_digest = old_store.pending_mutations()[0].request_digest
    save(old_store, "wave", "old-attempt")

    retry_store = store_at(tmp_path)
    retry_store.recover_mutations(committed_journal_ids=set())
    new_digest = hashlib.sha256(b"different-command").hexdigest()
    assert (
        retry_store.begin_mutation(operation_id="operation", user_id="owner", request_digest=new_digest) == journal_id
    )
    save(retry_store, "wave", "new-attempt")
    journal_path = tmp_path / f"operations/mutation-{journal_id}.json"
    original_journal = journal_path.read_bytes()

    old_store.finalize_mutation(journal_id=journal_id, commit=commit, expected_request_digest=old_digest)

    assert journal_path.read_bytes() == original_journal
    assert (tmp_path / "local/gestures/wave.vrma").read_bytes() == vrma("new-attempt")
    backups = list((tmp_path / f"local/.animama-mutations/{journal_id}").glob("*.original"))
    assert len(backups) == 1 and backups[0].read_bytes() == vrma("before")
    retry_store.finalize_mutation(journal_id=journal_id, commit=True, expected_request_digest=new_digest)

    # The skipped cleanup must still relinquish the old request-owned handle.
    next_journal = begin(old_store, "next-operation")
    old_store.finalize_mutation(journal_id=next_journal, commit=False)


def test_later_manual_edit_blocks_all_compensation_and_preserves_originals(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    save(store, "first", "before")
    save(store, "second", "before")
    journal_id = begin(store)
    save(store, "first", "after")
    save(store, "second", "after")
    (tmp_path / "local/gestures/second.vrma").write_bytes(vrma("manual"))
    recovered = store_at(tmp_path)
    with pytest.raises(ContentConflictError, match="content_recovery_conflict"):
        recovered.recover_mutations(committed_journal_ids=set())
    assert (tmp_path / "local/gestures/first.vrma").read_bytes() == vrma("after")
    assert (tmp_path / "local/gestures/second.vrma").read_bytes() == vrma("manual")
    originals = list((tmp_path / f"local/.animama-mutations/{journal_id}").glob("*.original"))
    assert len(originals) == 2
    assert all(file.read_bytes() == vrma("before") for file in originals)
    with pytest.raises(ContentConflictError, match="recovery_required"):
        begin(recovered, "next")


def test_committed_recovery_preserves_later_manual_edit(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    save(store, "wave", "before")
    journal_id = begin(store)
    save(store, "wave", "after")
    (tmp_path / "local/gestures/wave.vrma").write_bytes(vrma("manual"))
    store_at(tmp_path).recover_mutations(committed_journal_ids={journal_id})
    assert (tmp_path / "local/gestures/wave.vrma").read_bytes() == vrma("manual")


def test_manual_edit_during_backup_copy_is_preserved_with_recovery_evidence(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A rollback must recheck the live file after the potentially lengthy copy."""

    store = store_at(tmp_path)
    save(store, "wave", "before")
    journal_id = begin(store)
    save(store, "wave", "after")
    target = tmp_path / "local/gestures/wave.vrma"
    original_copy = mutations.copy_file

    def copy_then_edit(source: Path, destination: Path, expected: dict[str, object]) -> None:
        original_copy(source, destination, expected)
        if destination.name.startswith(".animama-restore-"):
            target.write_bytes(vrma("manual"))

    monkeypatch.setattr(mutations, "copy_file", copy_then_edit)
    with pytest.raises(ContentConflictError, match="content_recovery_conflict"):
        store.finalize_mutation(journal_id=journal_id, commit=False)
    assert target.read_bytes() == vrma("manual")
    backup = next((tmp_path / f"local/.animama-mutations/{journal_id}").glob("*.original"))
    assert backup.read_bytes() == vrma("before")
    assert [item.journal_id for item in store.pending_mutations()] == [journal_id]


def test_delete_restores_registered_bytes_after_process_restart(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    save(store, "wave", "before")
    entry = catalog_entry(store)
    begin(store)
    store.delete_entry(entry=entry)
    assert not (tmp_path / "local/gestures/wave.vrma").exists()
    store_at(tmp_path).recover_mutations(committed_journal_ids=set())
    assert (tmp_path / "local/gestures/wave.vrma").read_bytes() == vrma("before")


def test_delete_does_not_remove_manually_changed_registered_bytes(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    save(store, "wave", "before")
    entry = catalog_entry(store)
    target = tmp_path / "local/gestures/wave.vrma"
    target.write_bytes(vrma("manual"))
    journal_id = begin(store)
    with pytest.raises(ContentIntegrityError, match="changed before deletion"):
        store.delete_entry(entry=entry)
    store.finalize_mutation(journal_id=journal_id, commit=False)
    assert target.read_bytes() == vrma("manual")


def nested_entry(store: FilesystemContentStore) -> CatalogContentEntry:
    """Freeze a descriptor with a registered companion below two directories."""

    store.save_descriptor_entry(
        kind=ContentKind.REACTION,
        relative_locator="reactions/nested",
        descriptor=json.dumps(
            {
                "schema_version": 1,
                "content_type": "reaction",
                "name": "Nested",
                "files": ["motions/deep/wave.vrma"],
                "dependencies": [],
                "placement_hint": {"emotion": "joy", "intensity": 2},
            }
        ).encode(),
        companion_files={"motions/deep/wave.vrma": vrma("before")},
    )
    entry = catalog_entry(store)
    assert len(entry.files) == 2
    return entry


@pytest.mark.parametrize("commit", [False, True])
def test_delete_prunes_nested_registered_parents_and_restart_restores_bytes(tmp_path: Path, commit: bool) -> None:
    store = store_at(tmp_path)
    entry = nested_entry(store)
    root = tmp_path / "local/reactions/nested"
    before = {file.relative_path: (tmp_path / "local" / file.relative_path).read_bytes() for file in entry.files}
    journal = begin(store)
    store.delete_entry(entry=entry)
    assert not root.exists()

    recovered = store_at(tmp_path)
    recovered.recover_mutations(committed_journal_ids={journal} if commit else set())
    if commit:
        assert not root.exists()
    else:
        assert {file: (tmp_path / "local" / file).read_bytes() for file in before} == before
    assert recovered.pending_mutations() == ()


@pytest.mark.parametrize("manual_kind", ["file", "directory", "symlink"])
def test_delete_preserves_unregistered_siblings_while_pruning_registered_parents(
    tmp_path: Path, manual_kind: str
) -> None:
    store = store_at(tmp_path)
    entry = nested_entry(store)
    root = tmp_path / "local/reactions/nested"
    manual = root / "motions/manual"
    outside = tmp_path / "outside"
    outside.mkdir()
    (outside / "kept.txt").write_bytes(b"manual")
    if manual_kind == "file":
        manual.write_bytes(b"manual")
    elif manual_kind == "directory":
        manual.mkdir()
    else:
        link_directory(manual, outside)
    journal = begin(store)
    store.delete_entry(entry=entry)
    store.finalize_mutation(journal_id=journal, commit=True)

    assert not (root / "motions/deep").exists()
    assert manual.exists()
    assert (outside / "kept.txt").read_bytes() == b"manual"
    if manual_kind == "file":
        assert manual.read_bytes() == b"manual"
    elif manual_kind == "directory":
        assert list(manual.iterdir()) == []
    else:
        assert files.path_is_link(manual)


def test_descriptor_rollback_restores_stale_companions_and_original_descriptor(tmp_path: Path) -> None:
    store = store_at(tmp_path)

    def descriptor(files: list[str], label: str) -> bytes:
        return json.dumps(
            {
                "schema_version": 1,
                "content_type": "reaction",
                "name": label,
                "files": files,
                "dependencies": [],
                "placement_hint": {"emotion": "joy", "intensity": 2},
            }
        ).encode()

    original = descriptor(["first.vrma", "stale.vrma"], "Before")
    store.save_descriptor_entry(
        kind=ContentKind.REACTION,
        relative_locator="reactions/happy",
        descriptor=original,
        companion_files={"first.vrma": vrma("before"), "stale.vrma": vrma("stale")},
    )
    journal_id = begin(store)
    store.save_descriptor_entry(
        kind=ContentKind.REACTION,
        relative_locator="reactions/happy",
        descriptor=descriptor(["new.vrma"], "After"),
        companion_files={"new.vrma": vrma("new")},
    )
    entry_root = tmp_path / "local/reactions/happy"
    assert not (entry_root / "stale.vrma").exists()
    assert not (entry_root / ".animama-operation").exists()
    store.finalize_mutation(journal_id=journal_id, commit=False)
    assert (entry_root / "happy.meta.json").read_bytes() == original
    assert (entry_root / "first.vrma").read_bytes() == vrma("before")
    assert (entry_root / "stale.vrma").read_bytes() == vrma("stale")
    assert not (entry_root / "new.vrma").exists()


def test_failure_between_sidecar_and_primary_promotion_restores_both(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = store_at(tmp_path)
    save(store, "wave", "before")
    sidecar = tmp_path / "local/gestures/wave.meta.json"
    old_metadata = b'{"schema_version": 1, "name": "Before"}'
    sidecar.write_bytes(old_metadata)
    journal_id = begin(store)
    real_replace = os.replace
    primary = tmp_path / "local/gestures/wave.vrma"

    def fail_primary(source: Path, destination: Path) -> None:
        if Path(destination) == primary:
            raise OSError("primary promotion failed")
        real_replace(source, destination)

    monkeypatch.setattr(os, "replace", fail_primary)
    with pytest.raises(OSError, match="primary promotion failed"):
        store.save_standalone(
            kind=ContentKind.GESTURE,
            relative_locator="gestures/wave.vrma",
            payload=vrma("after"),
            metadata_sidecar=b'{"schema_version": 1, "name": "After"}',
        )
    monkeypatch.setattr(os, "replace", real_replace)
    store.finalize_mutation(journal_id=journal_id, commit=False)
    assert sidecar.read_bytes() == old_metadata
    assert primary.read_bytes() == vrma("before")


def test_mid_package_failure_restores_previous_entries_and_removes_new_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = store_at(tmp_path)
    save(store, "first", "before")
    journal_id = begin(store)
    real_replace = os.replace

    def fail_last(source: Path, destination: Path) -> None:
        if Path(destination) == tmp_path / "local/gestures/last.vrma":
            raise OSError("promotion failed")
        real_replace(source, destination)

    monkeypatch.setattr(os, "replace", fail_last)
    with pytest.raises(OSError, match="promotion failed"):
        store.install_package_atomic(
            entries=(package("first", "after"), package("new", "after"), package("last", "after")),
            operation_id="import",
        )
    monkeypatch.setattr(os, "replace", real_replace)
    store.finalize_mutation(journal_id=journal_id, commit=False)
    assert (tmp_path / "local/gestures/first.vrma").read_bytes() == vrma("before")
    assert not (tmp_path / "local/gestures/new.vrma").exists()
    assert not (tmp_path / "local/gestures/last.vrma").exists()


def test_crash_after_intent_before_backup_does_not_require_nonexistent_backup(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = store_at(tmp_path)
    save(store, "wave", "before")
    begin(store)

    def crash(*args, **kwargs):  # noqa: ANN002, ANN003, ANN202
        raise SystemExit("simulated process death before backup")

    monkeypatch.setattr(mutations, "copy_file", crash)
    with pytest.raises(SystemExit):
        save(store, "wave", "after")
    monkeypatch.undo()
    recovered = store_at(tmp_path)
    recovered.recover_mutations(committed_journal_ids=set())
    assert (tmp_path / "local/gestures/wave.vrma").read_bytes() == vrma("before")
    assert recovered.pending_mutations() == ()
    # Interrupted private staging must not obstruct retry with the same operation.
    journal_id = begin(recovered)
    save(recovered, "wave", "after")
    recovered.finalize_mutation(journal_id=journal_id, commit=True)
    assert (tmp_path / "local/gestures/wave.vrma").read_bytes() == vrma("after")


@pytest.mark.parametrize("kind", ["file_symlink", "parent_symlink", "corrupt_backup"])
def test_recovery_rejects_replaced_paths_without_touching_external_bytes(tmp_path: Path, kind: str) -> None:
    store = store_at(tmp_path)
    save(store, "wave", "before")
    journal_id = begin(store)
    save(store, "wave", "after")
    external = tmp_path / "external"
    external.mkdir()
    external_file = external / "wave.vrma"
    external_file.write_bytes(vrma("external"))
    target = tmp_path / "local/gestures/wave.vrma"
    if kind == "file_symlink":
        require_symlinks(tmp_path)
        target.unlink()
        target.symlink_to(external_file)
    elif kind == "parent_symlink":
        target.parent.rename(tmp_path / "displaced")
        link_directory(target.parent, external)
    else:
        next((tmp_path / f"local/.animama-mutations/{journal_id}").glob("*.original")).write_bytes(b"corrupt")
    with pytest.raises(ContentConflictError, match="content_recovery_conflict"):
        store_at(tmp_path).recover_mutations(committed_journal_ids=set())
    assert external_file.read_bytes() == vrma("external")
    assert list((tmp_path / "operations").glob("mutation-*.json"))


def test_legacy_package_without_hashes_preserves_ambiguous_current_bytes(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    save(store, "wave", "manual")
    backup = tmp_path / "local/.animama-import-backup-legacy/gestures/wave.vrma"
    backup.parent.mkdir(parents=True)
    backup.write_bytes(vrma("before"))
    (tmp_path / "operations/package-install-legacy.json").write_text(
        json.dumps({"status": "promoted", "targets": [{"paths": ["gestures/wave.vrma"]}], "promoted": [0]})
    )
    with pytest.raises(ContentConflictError, match="content_recovery_conflict"):
        store.recover_package_installs()
    assert (tmp_path / "local/gestures/wave.vrma").read_bytes() == vrma("manual")
    assert backup.read_bytes() == vrma("before")


def test_interrupted_rollback_can_resume_after_restoring_one_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    store = store_at(tmp_path)
    save(store, "first", "before")
    save(store, "second", "before")
    journal_id = begin(store)
    save(store, "first", "after")
    save(store, "second", "after")
    real_replace = os.replace

    def crash_after_restore(source: Path, destination: Path) -> None:
        real_replace(source, destination)
        if Path(destination) == tmp_path / "local/gestures/second.vrma":
            raise SystemExit("process died while restoring")

    monkeypatch.setattr(os, "replace", crash_after_restore)
    with pytest.raises(SystemExit):
        store.finalize_mutation(journal_id=journal_id, commit=False)
    monkeypatch.setattr(os, "replace", real_replace)
    store_at(tmp_path).recover_mutations(committed_journal_ids=set())
    for name in ("first", "second"):
        assert (tmp_path / f"local/gestures/{name}.vrma").read_bytes() == vrma("before")


def test_legacy_absent_target_restores_and_repeated_recovery_preserves_later_edits(tmp_path: Path) -> None:
    store = store_at(tmp_path)
    backup = tmp_path / "local/.animama-import-backup-legacy/gestures/wave.vrma"
    backup.parent.mkdir(parents=True)
    backup.write_bytes(vrma("before"))
    (tmp_path / "operations/package-install-legacy.json").write_text(
        json.dumps({"status": "promoting", "targets": [{"paths": ["gestures/wave.vrma"]}], "active_index": 0})
    )
    store.recover_package_installs()
    target = tmp_path / "local/gestures/wave.vrma"
    assert target.read_bytes() == vrma("before")
    target.write_bytes(vrma("manual"))
    store.recover_package_installs()
    assert target.read_bytes() == vrma("manual")


def test_fingerprint_refuses_a_hard_link_added_after_the_path_check(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    target = tmp_path / "wave.vrma"
    target.write_bytes(vrma("before"))

    def link_then_open(path: Path, flags: int, mode: int = 0o777) -> int:
        os.link(path, tmp_path / "alias.vrma")
        return files.open_no_follow(path, flags, mode)

    monkeypatch.setattr(mutations, "open_no_follow", link_then_open)
    with pytest.raises(ContentConflictError, match="content_recovery_conflict"):
        mutations.fingerprint(target)


def _external_tree(root: Path) -> list[str]:
    (root / "sub").mkdir(parents=True)
    (root / "keep.vrma").write_bytes(vrma("external"))
    (root / "sub/deep.vrma").write_bytes(vrma("external"))
    return sorted(path.relative_to(root).as_posix() for path in root.rglob("*"))


def test_temporary_cleanup_refuses_a_directory_link_without_touching_its_target(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    expected = _external_tree(outside)
    temporary = tmp_path / "temporary"
    link_directory(temporary, outside)

    with pytest.raises(ContentPathError):
        mutations.MutationJournal.remove_temporary(temporary)
    assert sorted(path.relative_to(outside).as_posix() for path in outside.rglob("*")) == expected


def test_package_tree_inspection_refuses_a_directory_link(tmp_path: Path) -> None:
    outside = tmp_path / "outside"
    _external_tree(outside)
    entry = tmp_path / "entry"
    entry.mkdir()
    link_directory(entry / "motions", outside)

    with pytest.raises(ContentPathError):
        FilesystemContentStore._mutation_tree_files(entry)  # noqa: SLF001
    with pytest.raises(ContentPathError):
        FilesystemContentStore._mutation_tree_files(entry / "motions")  # noqa: SLF001
