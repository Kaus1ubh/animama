"""animaPoseClip/1.0 clips are rejected with one clear reason (ADR 0016)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest
from fastapi import APIRouter, FastAPI
from httpx import ASGITransport, AsyncClient

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services.clip_format import PACKAGE_CLIP_FORMAT_HINT
from animama.domain.content_catalog import (
    ContentConflictError,
    ContentKind,
    ContentSource,
    ContentStatus,
    ContentValidationError,
)
from animama.server.config import Settings
from animama.server.local_runtime import initialize_local_runtime
from animama.server.routers.content_packages import PackageRoute

RETIRED_CLIP = {
    "schema": "animaPoseClip/1.0",
    "id": "old",
    "name": "Old",
    "duration": 1,
    "poses": {"a": {"expressions": {"happy": 1}}},
    "poseKeyframes": [{"time": 0, "pose": "a"}],
}


def _store(tmp_path: Path) -> tuple[FilesystemContentStore, Path]:
    paths = initialize_local_runtime(
        Settings(animama_content_root=tmp_path / "content", animama_data_root=tmp_path / "data")
    )
    store = FilesystemContentStore(
        included_root=paths.included_root, local_root=paths.local_root, operations_root=paths.operations_root
    )
    return store, paths.local_root


def _scanned(store: FilesystemContentStore, locator: str) -> Any:
    return {item.relative_locator: item for item in store.scan(ContentSource.LOCAL)}[locator]


def _write(root: Path, relative: str, value: Any) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value), encoding="utf-8")


def test_scan_rejects_a_retired_clip_whose_sequence_role_is_implied(tmp_path: Path) -> None:
    store, local = _store(tmp_path)
    _write(local, "reactions/odd/clip.json", RETIRED_CLIP)
    _write(
        local,
        "reactions/odd/odd.meta.json",
        {
            "schema_version": 1,
            "content_type": "reaction",
            "id": "local:reaction:odd",
            "name": "Odd",
            "implementation": {"kind": "anima_clip"},
            "files": [{"path": "clip.json", "role": "sequence"}],
        },
    )
    scanned = _scanned(store, "reactions/odd")
    assert scanned.status is ContentStatus.INVALID
    assert [diagnostic.code for diagnostic in scanned.diagnostics] == ["clip_format_unsupported"]


def test_scan_rejects_a_legacy_action_whose_motion_is_a_retired_pose_clip(tmp_path: Path) -> None:
    store, local = _store(tmp_path)
    _write(local, "pose-clips/old.json", {**RETIRED_CLIP, "id": "local:pose-clip:old"})
    _write(
        local,
        "gestures/legacy/legacy.meta.json",
        {
            "schema_version": 1,
            "content_type": "gesture",
            "content_id": "local:gesture:legacy",
            "name": "Legacy",
            "semantic_key": "legacy",
            "implementation": {
                "kind": "anima_clip",
                "technical_source": {"type": "content_dependency", "ref": "local:pose-clip:old"},
            },
            "dependencies": [{"ref": "local:pose-clip:old", "content_type": "pose_clip"}],
        },
    )
    scanned = _scanned(store, "gestures/legacy")
    assert scanned.status is ContentStatus.INVALID
    assert [diagnostic.code for diagnostic in scanned.diagnostics] == ["clip_format_unsupported"]
    assert "retired animaPoseClip/1.0 format" in scanned.diagnostics[0].message


def test_scan_rejects_a_retired_clip_when_the_descriptor_lists_no_files(tmp_path: Path) -> None:
    store, local = _store(tmp_path)
    _write(local, "gestures/nofiles/nofiles.json", RETIRED_CLIP)
    _write(
        local,
        "gestures/nofiles/nofiles.meta.json",
        {
            "schema_version": 1,
            "content_type": "gesture",
            "content_id": "local:gesture:nofiles",
            "name": "No files",
            "semantic_key": "nofiles",
            "implementation": {"kind": "anima_clip"},
            "dependencies": [],
        },
    )
    scanned = _scanned(store, "gestures/nofiles")
    assert scanned.status is ContentStatus.INVALID
    assert [diagnostic.code for diagnostic in scanned.diagnostics] == ["clip_format_unsupported"]


@pytest.mark.parametrize(
    ("implementation", "files"),
    [
        ({"kind": "anima_clip", "file_role": "sequence"}, [{"path": "old.json", "role": "sequence"}]),
        ({"kind": "anima_clip"}, [{"path": "old.json", "role": "sequence"}]),
        ({"kind": "anima_clip"}, None),
    ],
)
def test_save_refuses_a_retired_clip_with_its_reason(
    tmp_path: Path, implementation: dict[str, str], files: list[dict[str, str]] | None
) -> None:
    store, local = _store(tmp_path)
    descriptor = {
        "schema_version": 1,
        "content_type": "gesture",
        "id": "local:gesture:old",
        "name": "Old",
        "semantic_key": "old",
        "implementation": implementation,
        **({"files": files} if files else {}),
    }
    with pytest.raises(ContentValidationError, match="retired animaPoseClip/1.0 format"):
        store.save_descriptor_entry(
            kind=ContentKind.GESTURE,
            relative_locator="gestures/old",
            descriptor=json.dumps(descriptor).encode(),
            companion_files={"old.json": json.dumps(RETIRED_CLIP).encode()},
            operation_id="save-retired-clip",
        )
    assert not (local / "gestures/old/old.json").exists()


async def test_package_routes_name_the_retired_format_with_a_fixed_message() -> None:
    router = APIRouter(route_class=PackageRoute)

    @router.post("/probe")
    async def probe() -> None:
        raise ContentConflictError("clip_format_unsupported")

    app = FastAPI()
    app.include_router(router)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/probe")
    assert response.status_code == 409
    assert response.json() == {"detail": {"code": "clip_format_unsupported", "message": PACKAGE_CLIP_FORMAT_HINT}}
