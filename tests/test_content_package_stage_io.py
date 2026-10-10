"""Package services run blocking stage IO in worker threads, never on the event loop (P3-01)."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

from sqlalchemy import delete

from animama.adapters.package_inspection import LocalPackageInspector
from animama.app.services.content_package_service import ContentPackageService
from animama.orm.content_catalog import ORMContentCatalogItem
from tests.content_package_helpers import package_services, save_wave

OWNER = "package-owner"


def _on_event_loop() -> bool:
    try:
        asyncio.get_running_loop()
    except RuntimeError:
        return False
    return True


class _Watched:
    """Forward to a stage object, recording each method call made on the event loop."""

    def __init__(self, target: Any, calls: list[str], prefix: str) -> None:
        self._target, self._calls, self._prefix = target, calls, prefix

    def __getattr__(self, name: str) -> Any:
        value = getattr(self._target, name)
        if not callable(value):
            return value

        def call(*args: Any, **kwargs: Any) -> Any:
            if _on_event_loop():
                self._calls.append(f"{self._prefix}.{name}")
            result = value(*args, **kwargs)
            # Leases from acquire/reserve_export are watched as well.
            return _WatchedLease(result, self._calls) if name in {"acquire", "reserve_export"} else result

        return call


class _WatchedLease(_Watched):
    def __init__(self, lease: Any, calls: list[str]) -> None:
        super().__init__(lease, calls, "lease")

    def __enter__(self) -> _WatchedLease:
        if _on_event_loop():
            self._calls.append("lease.__enter__")
        self._target.__enter__()
        return self

    def __exit__(self, *exc: object) -> None:
        if _on_event_loop():
            self._calls.append("lease.__exit__")
        self._target.__exit__(*exc)


class _UnwrappingInspector:
    """The local inspector reads the real lease behind a watched one."""

    def __init__(self, inspector: LocalPackageInspector) -> None:
        self._inspector = inspector

    def inspect(self, lease: Any) -> Any:
        return self._inspector.inspect(lease._target if isinstance(lease, _WatchedLease) else lease)


async def test_export_and_import_never_touch_stages_on_the_event_loop(async_session, tmp_path: Path) -> None:  # noqa: ANN001
    paths, _catalog, content, saves, packages = package_services(async_session, tmp_path)
    on_loop: list[str] = []
    stages = _Watched(packages.stages, on_loop, "stages")
    watched = ContentPackageService(
        content=content,
        stages=stages,
        exports_root=paths.exports_staging_root,
        inspector=_UnwrappingInspector(LocalPackageInspector(store=content.mutations.store)),
    )
    try:
        saved = await save_wave(saves)
        summary = await watched.summarize(user_id=OWNER, item_ids=(saved.item.id,))
        review = await watched.prepare_export(user_id=OWNER, item_ids=(saved.item.id,), expected_digest=summary.digest)
        download = await watched.exports.download(user_id=OWNER, export_id=review.export_id)
        archive = download.handle.read()
        await asyncio.to_thread(download.close)

        # Stage the export as an import; the test's own staging runs in threads too.
        stage = await asyncio.to_thread(
            packages.stages.create_import,
            user_id=OWNER,
            operation_id="stage-io",
            filename="wave.zip",
            expected_bytes=len(archive),
        )
        upload = tmp_path / "upload.zip"
        upload.write_bytes(archive)
        with upload.open("rb") as source:
            await asyncio.to_thread(
                packages.stages.append_part, user_id=OWNER, stage_id=stage.stage_id, index=0, source=source
            )
        reviewed = await watched.imports.review(user_id=OWNER, stage_id=stage.stage_id)
        # A repeated review renews the stored one.
        assert (
            await watched.imports.review(user_id=OWNER, stage_id=stage.stage_id)
        ).review_digest == reviewed.review_digest
        result = await watched.imports.commit(
            user_id=OWNER, stage_id=stage.stage_id, operation_id="stage-io", review_digest=reviewed.review_digest
        )
        assert (await watched.imports.operation_status(user_id=OWNER, operation_id="stage-io")).result == result
        assert (await watched.imports.operation_status(user_id=OWNER, operation_id="unknown")).state == "not_found"

        assert on_loop == []
        # The watcher itself records an on-loop call.
        stages.find_import(OWNER, "unknown")
        assert on_loop == ["stages.find_import"]
    finally:
        await async_session.execute(delete(ORMContentCatalogItem))
        await async_session.commit()
