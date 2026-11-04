"""Observable private-stage limits, restart recovery and ownership."""

import multiprocessing
from datetime import UTC, datetime, timedelta
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import uuid4

import pytest

from animama.app.services.content_package_staging import PackageStageService, StageLimits
from animama.domain.content_catalog import ContentConflictError
from tests.test_content_package_v3_archive import sound_package, write_package


def stages(tmp_path: Path, **limits: int) -> PackageStageService:
    return PackageStageService(tmp_path / "imports", tmp_path / "exports", limits=StageLimits(**limits))


@pytest.mark.parametrize("filename", ["one.animama", "one.txt", "one.zip.exe"])
def test_stage_rejects_non_zip_filenames_before_allocation(tmp_path: Path, filename: str) -> None:
    service = stages(tmp_path)
    with pytest.raises(ContentConflictError, match="package_stage_input_invalid"):
        service.create_import("owner", "operation", filename, 10)
    assert not list(tmp_path.rglob("record.json"))


def test_stage_accepts_uppercase_zip_filename(tmp_path: Path) -> None:
    assert stages(tmp_path).create_import("owner", "operation", "one.ZIP", 10).filename == "one.ZIP"


def test_import_and_export_share_two_stage_limit_across_service_instances(tmp_path: Path) -> None:
    first, second = stages(tmp_path), stages(tmp_path)
    first.create_import("owner", "operation", "one.zip", 10)
    second.create_export("owner", "two.zip", 20)
    with pytest.raises(ContentConflictError, match="package_stage_limit"):
        first.create_import("owner", "third", "three.zip", 30)
    assert second.create_export("other-owner", "independent.zip", 20)


def test_quota_pressure_reclaims_only_inactive_finished_downloads(tmp_path: Path) -> None:
    service = stages(tmp_path)
    exported = service.create_export("owner", "shared.zip", 10)
    with service.acquire("owner", exported.stage_id, "export") as lease:
        lease.set_state("completed")
    pending = service.create_import("owner", "one", "one.zip", 10)
    # A finished cache remains available for retry while no new slot is needed.
    service.sweep_expired("owner")
    with service.acquire("owner", exported.stage_id, "export"):
        with pytest.raises(ContentConflictError, match="package_stage_limit"):
            service.create_import("owner", "two", "two.zip", 10)
    fresh = stages(tmp_path).create_import("owner", "two", "two.zip", 10)
    assert fresh.stage_id != exported.stage_id
    assert service.status("owner", pending.stage_id)[0].operation_id == "one"
    with pytest.raises(ContentConflictError, match="package_stage_unavailable"):
        service.status("owner", exported.stage_id, "export")


def test_finished_download_reclamation_also_releases_byte_quota(tmp_path: Path) -> None:
    service = stages(tmp_path, max_total_bytes=20)
    exported = service.create_export("owner", "shared.zip", 12)
    with service.acquire("owner", exported.stage_id, "export") as lease:
        lease.set_state("completed")
    assert service.create_import("owner", "next", "next.zip", 15)


def test_completed_imports_are_not_reclaimed_without_acknowledgment(tmp_path: Path) -> None:
    service = stages(tmp_path)
    for index in range(2):
        record = service.create_import("owner", str(index), f"{index}.zip", 10)
        with service.acquire("owner", record.stage_id) as lease:
            lease.set_state("completed")
    with pytest.raises(ContentConflictError, match="package_stage_limit"):
        service.create_import("owner", "next", "next.zip", 10)


def test_aggregate_archive_reservation_is_checked_before_creation(tmp_path: Path) -> None:
    service = stages(tmp_path, max_total_bytes=20)
    service.create_import("owner", "operation", "one.zip", 12)
    with pytest.raises(ContentConflictError, match="package_stage_quota"):
        service.create_export("owner", "two.zip", 9)
    assert len(list((tmp_path / "exports").rglob("record.json"))) == 0


def test_allocation_retry_retains_random_identity_and_rejects_changed_input(tmp_path: Path) -> None:
    service = stages(tmp_path)
    first = service.create_import("owner", "../../operation", "one.zip", 10)
    assert service.create_import("owner", "../../operation", "one.zip", 10) == first
    assert "operation" not in first.stage_id
    with pytest.raises(ContentConflictError, match="package_operation_conflict"):
        service.create_import("owner", "../../operation", "changed.zip", 10)


def test_restart_reclaims_interrupted_initial_record_before_another_allocation(tmp_path: Path) -> None:
    service = stages(tmp_path)
    first = service.create_import("owner", "one", "one.zip", 4)
    with service.acquire("owner", first.stage_id) as lease:
        orphan = lease.directory.parent / uuid4().hex
        orphan.mkdir()
        (orphan / f".record-{uuid4().hex}.tmp").write_bytes(b"interrupted initial record")
    restarted = stages(tmp_path)
    second = restarted.create_import("owner", "two", "two.zip", 4)
    assert second.stage_id != first.stage_id
    assert not orphan.exists()


def test_active_stage_cannot_be_deleted_or_acquired_by_another_service(tmp_path: Path) -> None:
    first, second = stages(tmp_path), stages(tmp_path)
    record = first.create_import("owner", "operation", "one.zip", 10)
    with first.acquire("owner", record.stage_id):
        assert second.status("owner", record.stage_id)[1] is True
        with pytest.raises(ContentConflictError, match="package_stage_active"):
            second.discard("owner", record.stage_id)
    assert second.status("owner", record.stage_id)[1] is False


def test_sequential_parts_retry_and_changed_or_out_of_order_conflicts(tmp_path: Path) -> None:
    service = stages(tmp_path, part_bytes=4)
    record = service.create_import("owner", "operation", "one.zip", 6)
    first = service.append_part("owner", record.stage_id, 0, BytesIO(b"abcd"))
    assert (first.received_bytes, first.next_part_index, first.complete) == (4, 1, False)
    assert service.append_part("owner", record.stage_id, 0, BytesIO(b"abcd")) == first
    with pytest.raises(ContentConflictError, match="package_part_changed"):
        service.append_part("owner", record.stage_id, 0, BytesIO(b"xxxx"))
    with pytest.raises(ContentConflictError, match="package_part_out_of_order"):
        service.append_part("owner", record.stage_id, 2, BytesIO(b"ef"))
    final = service.append_part("owner", record.stage_id, 1, BytesIO(b"ef"))
    assert (final.received_bytes, final.next_part_index, final.complete) == (6, 2, True)
    with service.acquire("owner", record.stage_id) as lease:
        assert lease.archive_path.read_bytes() == b"abcdef"
        assert lease.seal_archive()[0] == 6


@pytest.mark.parametrize("payload", [b"abc", b"abcde"])
def test_bad_part_length_leaves_no_acknowledged_bytes(tmp_path: Path, payload: bytes) -> None:
    service = stages(tmp_path, part_bytes=4)
    record = service.create_import("owner", "operation", "one.zip", 8)
    with pytest.raises(ContentConflictError, match="package_part_size_invalid"):
        service.append_part("owner", record.stage_id, 0, BytesIO(payload))
    with service.acquire("owner", record.stage_id) as lease:
        assert lease.record.received_bytes == 0
        assert lease.archive_path.read_bytes() == b""


def test_restart_removes_unacknowledged_tail_before_sealing_completed_upload(tmp_path: Path) -> None:
    service = stages(tmp_path, part_bytes=4)
    record = service.create_import("owner", "operation", "one.zip", 4)
    service.append_part("owner", record.stage_id, 0, BytesIO(b"abcd"))
    with service.acquire("owner", record.stage_id) as lease:
        with lease.archive_path.open("ab") as archive:
            archive.write(b"unacknowledged crash tail")
    restarted = stages(tmp_path, part_bytes=4)
    with restarted.acquire("owner", record.stage_id) as lease:
        assert lease.seal_archive()[0] == 4
        assert lease.archive_path.read_bytes() == b"abcd"


def test_record_failure_rolls_back_part_but_post_replace_failure_keeps_ack(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from animama.app.services import content_package_staging as module

    service = stages(tmp_path, part_bytes=4)
    record = service.create_import("owner", "operation", "one.zip", 8)
    original = module._write_record

    def fail_before_replace(*_: Any) -> None:
        raise OSError("disk full")

    monkeypatch.setattr(module, "_write_record", fail_before_replace)
    with pytest.raises(OSError, match="disk full"):
        service.append_part("owner", record.stage_id, 0, BytesIO(b"abcd"))
    with service.acquire("owner", record.stage_id) as lease:
        assert lease.record.received_bytes == 0
        assert lease.archive_path.read_bytes() == b""

    def fail_after_replace(*args: Any) -> None:
        original(*args)
        raise OSError("unknown acknowledgment")

    monkeypatch.setattr(module, "_write_record", fail_after_replace)
    with pytest.raises(OSError, match="unknown acknowledgment"):
        service.append_part("owner", record.stage_id, 0, BytesIO(b"abcd"))
    monkeypatch.setattr(module, "_write_record", original)
    assert service.append_part("owner", record.stage_id, 0, BytesIO(b"abcd")).received_bytes == 4


def test_sealed_review_is_immutable_and_tampered_archive_rejects(tmp_path: Path) -> None:
    service = stages(tmp_path, part_bytes=4)
    record = service.create_import("owner", "operation", "one.zip", 4)
    service.append_part("owner", record.stage_id, 0, BytesIO(b"abcd"))
    with service.acquire("owner", record.stage_id) as lease:
        lease.seal_archive()
        proposal: dict[str, Any] = {"public": {"name": "A"}}
        published = lease.publish_review(proposal, "digest")
        proposal["public"]["name"] = "caller mutation"
        assert lease.record.review == {"public": {"name": "A"}}
        assert lease.publish_review({"public": {"name": "A"}}, "digest") == published
        with pytest.raises(ContentConflictError, match="package_review_changed"):
            lease.publish_review({"public": {"name": "B"}}, "changed")
        copied = lease.record
        assert copied.review is not None
        copied.review.clear()
        assert lease.record.review == {"public": {"name": "A"}}
        lease.archive_path.write_bytes(b"xxxx")
        with pytest.raises(ContentConflictError, match="package_archive_changed"):
            lease.verify_archive()


def test_sweep_preserves_active_and_unresolved_commit_then_reclaims_inactive(tmp_path: Path) -> None:
    now = datetime(2026, 9, 24, tzinfo=UTC)
    service = PackageStageService(tmp_path / "imports", tmp_path / "exports", clock=lambda: now)
    first = service.create_import("owner", "one", "one.zip", 4)
    second = service.create_import("owner", "two", "two.zip", 4)
    with service.acquire("owner", second.stage_id) as lease:
        lease.set_state("recovery_needed")
    with service.acquire("owner", first.stage_id) as lease:
        now += timedelta(minutes=31)
        service.sweep_expired()
        assert lease.directory.exists()
        assert service.status("owner", second.stage_id)[0].state == "recovery_needed"
    service.sweep_expired()
    with pytest.raises(ContentConflictError, match="package_stage_unavailable"):
        service.status("owner", first.stage_id)
    with pytest.raises(ContentConflictError, match="package_stage_active"):
        service.discard("owner", second.stage_id)


def test_sweep_rechecks_recovery_state_after_obtaining_stage_lock(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    now = datetime(2026, 9, 24, tzinfo=UTC)
    service = PackageStageService(tmp_path / "imports", tmp_path / "exports", clock=lambda: now)
    record = service.create_import("owner", "one", "one.zip", 4)
    lease = service.acquire("owner", record.stage_id)
    now += timedelta(minutes=31)
    original = service._records

    def finish_while_sweeper_reads(owner: str):
        stale = original(owner)
        lease.set_state("recovery_needed")
        lease.close()
        return stale

    monkeypatch.setattr(service, "_records", finish_while_sweeper_reads)
    service.sweep_expired()
    assert lease.directory.exists()
    assert service.status("owner", record.stage_id)[0].state == "recovery_needed"


def test_export_growth_reserves_before_write_and_competes_with_import(tmp_path: Path) -> None:
    service = stages(tmp_path, max_total_bytes=12)
    service.create_import("owner", "one", "one.zip", 4)
    export = service.create_export("owner", "two.zip", 4)
    with service.acquire("owner", export.stage_id, "export") as lease:
        lease.ensure_capacity(8)
        with pytest.raises(ContentConflictError, match="package_stage_quota"):
            lease.ensure_capacity(9)
        assert lease.record.reserved_bytes == 8


def test_expansion_drops_stale_tree_and_rejects_second_live_tree(tmp_path: Path) -> None:
    service = stages(tmp_path, max_expanded_bytes=4096)
    record = service.create_import("owner", "one", "one.zip", 4)
    with service.acquire("owner", record.stage_id) as lease:
        write_package(lease.archive_path, *sound_package())
        lease.inspection_path.mkdir()
        (lease.inspection_path / "stale").write_bytes(b"stale")
        with lease.expansion() as destination:
            assert not destination.exists()
            destination.mkdir()
            (destination / "active").write_bytes(b"active")
            with pytest.raises(ContentConflictError, match="package_stage_active"):
                with lease.expansion():
                    pass
            assert (destination / "active").exists()
        assert not lease.inspection_path.exists()


def _hold_stage(root: str, stage_id: str, ready: Any) -> None:
    service = stages(Path(root))
    with service.acquire("owner", stage_id):
        ready.send("locked")
        ready.recv()


def test_os_lease_excludes_another_process_and_releases_after_process_death(tmp_path: Path) -> None:
    service = stages(tmp_path)
    record = service.create_import("owner", "one", "one.zip", 4)
    context = multiprocessing.get_context("spawn")
    reader, writer = context.Pipe()
    child = context.Process(target=_hold_stage, args=(str(tmp_path), record.stage_id, writer))
    child.start()
    try:
        assert reader.poll(10), "child did not acquire the stage"
        assert reader.recv() == "locked"
        with pytest.raises(ContentConflictError, match="package_stage_active"):
            service.acquire("owner", record.stage_id)
        child.terminate()
        child.join(10)
        assert not child.is_alive()
        with service.acquire("owner", record.stage_id) as lease:
            assert lease.record.operation_id == "one"
    finally:
        if child.is_alive():
            child.terminate()
            child.join(10)
        reader.close()
        writer.close()


def test_disk_shortage_rejects_reservation_and_expansion_without_leaking_tree(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    service = stages(tmp_path)
    record = service.create_import("owner", "one", "one.zip", 4)
    monkeypatch.setattr(
        "animama.app.services.content_package_staging.shutil.disk_usage", lambda _: SimpleNamespace(free=0)
    )
    with pytest.raises(ContentConflictError, match="package_stage_disk_full"):
        service.create_export("owner", "two.zip", 4)
    assert not list((tmp_path / "exports").rglob("record.json"))
    with service.acquire("owner", record.stage_id) as lease:
        write_package(lease.archive_path, *sound_package())
        with pytest.raises(ContentConflictError, match="package_stage_disk_full"):
            with lease.expansion():
                pytest.fail("disk shortage must fail before inspection")
        assert not lease.inspection_path.exists()


def test_particular_archive_expansion_still_rejects_insufficient_disk_and_configured_ceiling(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from animama.app.services.content_package_archive import ContentPackageArchive

    service = stages(tmp_path, max_expanded_bytes=4096)
    record = service.create_import("owner", "bounded", "bounded.zip", 4)
    with service.acquire("owner", record.stage_id) as lease:
        write_package(lease.archive_path, *sound_package())
        required = ContentPackageArchive.expanded_size(lease.archive_path)
        monkeypatch.setattr(
            "animama.app.services.content_package_staging.shutil.disk_usage",
            lambda _: SimpleNamespace(free=required - 1),
        )
        with pytest.raises(ContentConflictError, match="package_stage_disk_full"):
            with lease.expansion():
                pytest.fail("insufficient space must fail before extraction")
        assert not lease.inspection_path.exists()
        service.limits = StageLimits(max_expanded_bytes=required - 1)
        monkeypatch.setattr(
            "animama.app.services.content_package_staging.shutil.disk_usage",
            lambda _: SimpleNamespace(free=64 * 1024**2),
        )
        with pytest.raises(ContentConflictError, match="package_expanded_size_invalid"):
            with lease.expansion():
                pytest.fail("the configured expansion ceiling remains enforced")
        assert not lease.inspection_path.exists()


def test_one_owner_never_reaches_another_owners_stage_on_shared_roots(tmp_path: Path) -> None:
    stages = PackageStageService(tmp_path / "imports", tmp_path / "exports")
    record = stages.create_import(user_id="owner-a", operation_id="op-a", filename="a.zip", expected_bytes=10)
    for attempt in (
        lambda: stages.status("owner-b", record.stage_id),
        lambda: stages.acquire("owner-b", record.stage_id),
        lambda: stages.discard("owner-b", record.stage_id),
    ):
        with pytest.raises(ContentConflictError) as refused:
            attempt()
        assert refused.value.code == "package_stage_unavailable"
    assert stages.find_import("owner-b", "op-a") is None
    # Owner a's stage is untouched.
    assert stages.status("owner-a", record.stage_id)[0].stage_id == record.stage_id
