"""Canonical validation accepts opaque stage streams and always reclaims scratch."""

from __future__ import annotations

import asyncio
import hashlib
import io
import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import cast
from zipfile import ZipFile

import pytest

from animama.adapters.package_inspection import TemporaryPackageInspector
from animama.app.contracts.content_package_staging import StageLimits, StageRecord
from animama.app.ports.content_package_staging import PackageStageLease
from animama.app.services.local_content_mutations import _finish_owned_work
from animama.app.services.package_inspection import inspect_package
from animama.domain.content_catalog import ContentConflictError
from tests.test_content_package_v3_archive import sound_package


@dataclass
class StreamLease:
    record: StageRecord
    payload: bytes

    def open_archive(self) -> io.BytesIO:
        return io.BytesIO(self.payload)


def lease() -> StreamLease:
    manifest, members = sound_package()
    with io.BytesIO() as output:
        with ZipFile(output, "w") as archive:
            archive.writestr("package.json", json.dumps(manifest))
            for name, content in members.items():
                archive.writestr(name, content)
        payload = output.getvalue()
    now = datetime.now(UTC)
    return StreamLease(
        StageRecord(
            stage_id="stage",
            user_id="owner",
            kind="import",
            state="uploaded",
            filename="sound.zip",
            operation_id="import",
            expected_bytes=len(payload),
            reserved_bytes=len(payload),
            actual_bytes=len(payload),
            archive_sha256=hashlib.sha256(payload).hexdigest(),
            created_at=now,
            expires_at=now + timedelta(minutes=1),
        ),
        payload,
    )


@pytest.mark.parametrize("failure", [None, "archive-budget", "expansion-budget", "hash", "publication"])
def test_opaque_stream_inspection_preserves_budgets_and_cleans_on_every_exit(
    tmp_path: Path, failure: str | None
) -> None:
    source = lease()
    limits = StageLimits(
        max_archive_bytes=1 if failure == "archive-budget" else 1024**2,
        max_expanded_bytes=1 if failure == "expansion-budget" else 1024**2,
    )
    if failure == "hash":
        source.payload += b"changed"
    inspector = TemporaryPackageInspector(limits=limits, temporary_root=tmp_path)

    def inspect() -> None:
        with inspector.inspect(cast(PackageStageLease, source)) as package:
            assert package.manifest.root_entry_ids == ["sound"]
            with package.entries["sound"].open_file("tone.wav") as handle:
                assert handle.read(4) == b"RIFF"
            assert list(tmp_path.iterdir())
            if failure == "publication":
                raise RuntimeError("publication failed")

    if failure:
        with pytest.raises(RuntimeError if failure == "publication" else ContentConflictError):
            inspect()
    else:
        inspect()
    assert not list(tmp_path.iterdir())


async def test_cancellation_finishes_inspection_use_before_removing_temporary_bytes(tmp_path: Path) -> None:
    source = lease()
    inspector = TemporaryPackageInspector(limits=StageLimits(), temporary_root=tmp_path)
    entered, resume = asyncio.Event(), asyncio.Event()

    async def operation() -> None:
        async with inspect_package(inspector, cast(PackageStageLease, source)) as package:
            entered.set()
            await resume.wait()
            with package.entries["sound"].open_file("tone.wav") as handle:
                assert handle.read(4) == b"RIFF"

    task = asyncio.create_task(_finish_owned_work(operation()))
    await entered.wait()
    task.cancel()
    await asyncio.sleep(0)
    task.cancel()
    assert not task.done() and list(tmp_path.iterdir())
    resume.set()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert not list(tmp_path.iterdir())
