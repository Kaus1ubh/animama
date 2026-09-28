from __future__ import annotations

import hashlib
import json
import os
import runpy
import sys
import tarfile
from pathlib import Path

import pytest

from alembic.script import ScriptDirectory
from animama.runtime import cli, resources


def test_runtime_resource_audit_has_schema_and_starter_resources() -> None:
    evidence = resources.audit_resources()
    assert evidence["migration_count"] == 1
    assert evidence["sql_count"] == 2
    assert evidence["gesture_count"] == 46
    assert evidence["starter_policy"] == "builtin:starter-loadout"
    assert evidence["effect_count"] > 0
    assert evidence["local_http_schema_version"] == 1


def test_sql_runtime_resource_contains_product_seeds_directly() -> None:
    seed_root = resources.runtime_resource("sql")
    assert seed_root == Path(__file__).resolve().parents[1] / "alembic/seeds"
    assert sorted(path.name for path in seed_root.iterdir()) == [
        "01-seed-model-providers.sql",
        "02-seed-avatars.sql",
    ]


def test_frozen_resource_does_not_fall_back_to_the_checkout(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    with pytest.raises(FileNotFoundError, match="Required packaged resource"):
        resources.runtime_resource("sql")


def test_resource_names_cannot_select_arbitrary_checkout_files() -> None:
    with pytest.raises(ValueError, match="Unknown runtime resource"):
        resources.runtime_resource("../../.env")


@pytest.mark.parametrize("host", ["0.0.0.0", "192.168.1.2", "example.com"])
def test_cli_cannot_publish_private_fastapi(host: str) -> None:
    with pytest.raises(SystemExit) as error:
        cli.main(["serve", "--host", host, "--port", "12345"])
    assert error.value.code == 2


def test_cli_never_accepts_credentials_as_arguments() -> None:
    with pytest.raises(SystemExit):
        cli.parser().parse_args(["database", "bootstrap", "--password", "not-a-real-secret"])


def test_document_worker_is_unavailable_until_verified_pack_support(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("ANIMAMA_DOCUMENT_WORKER_EXECUTABLE", "/not/trusted")
    assert cli.main(["worker", "user-files"]) == cli.FEATURE_UNAVAILABLE
    assert json.loads(capsys.readouterr().out) == {"code": "feature_unavailable", "feature": "document-processing"}


def test_document_delegate_rechecks_the_fixed_path_digest_and_isolates_pyinstaller(tmp_path, monkeypatch):
    root = tmp_path.resolve()
    executable = root / "Animama Document Worker.app/Contents/MacOS/animama-document-worker"
    executable.parent.mkdir(parents=True)
    executable.write_bytes(b"test fixture, never executed")
    monkeypatch.setattr(sys, "platform", "darwin")
    monkeypatch.setenv("ANIMAMA_DOCUMENT_WORKER_ROOT", str(root))
    monkeypatch.setenv("ANIMAMA_DOCUMENT_WORKER_EXECUTABLE", str(executable))
    monkeypatch.setenv("ANIMAMA_DOCUMENT_WORKER_EXECUTABLE_SHA256", hashlib.sha256(executable.read_bytes()).hexdigest())
    calls = []
    monkeypatch.setattr(os, "execve", lambda *args: calls.append(args))
    assert cli.main(["worker", "user-files"]) == 0
    assert calls[0][0] == executable
    assert calls[0][1] == [str(executable)]
    assert calls[0][2]["PYINSTALLER_RESET_ENVIRONMENT"] == "1"

    calls.clear()
    executable.write_bytes(b"changed fixture")
    with pytest.raises(RuntimeError, match="document_worker_digest_invalid"):
        cli.main(["worker", "user-files"])
    monkeypatch.setenv("ANIMAMA_DOCUMENT_WORKER_EXECUTABLE", str(root / "arbitrary-program"))
    with pytest.raises(RuntimeError, match="document_worker_path_invalid"):
        cli.main(["worker", "user-files"])
    assert calls == []


def test_pack_writer_emits_deterministic_ustar_and_rechecks_input_custody(tmp_path):
    writer = runpy.run_path(
        str(Path(__file__).resolve().parents[1] / "src/backend/packaging/desktop/archive_feature_pack.py")
    )["archive"]
    source = tmp_path / "source"
    source.mkdir()
    file = source / "fixture.json"
    file.write_bytes(b"{}")
    inventory = [{"path": file.name, "size_bytes": 2, "sha256": hashlib.sha256(b"{}").hexdigest(), "mode": "0644"}]
    first, second = tmp_path / "first.tar", tmp_path / "second.tar"
    writer(source, inventory, first)
    writer(source, inventory, second)
    assert first.read_bytes() == second.read_bytes()
    with tarfile.open(first) as archive:
        entries = archive.getmembers()
        assert len(entries) == 1
        assert entries[0].isfile() and entries[0].name == "fixture.json"
        assert entries[0].pax_headers == {}
        assert entries[0].mode == 0o644
        extracted = archive.extractfile(entries[0])
        assert extracted is not None
        assert extracted.read() == b"{}"
    file.write_bytes(b"[]")
    with pytest.raises(ValueError, match="digest mismatch"):
        writer(source, inventory, second)
    file.unlink()
    file.symlink_to(first)
    with pytest.raises(ValueError, match="escapes its root"):
        writer(source, inventory, second)


def test_document_worker_resources_are_frozen_and_offline_only(tmp_path, monkeypatch):
    from animama.runtime import document_worker

    with pytest.raises(RuntimeError, match="requires_frozen_resources"):
        document_worker.configure_resources()
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    with pytest.raises(RuntimeError, match="resources_missing"):
        document_worker.configure_resources()
    for name in ("docling", "tiktoken"):
        directory = tmp_path / "document-resources" / name
        directory.mkdir(parents=True)
        (directory / "fixture").write_bytes(b"resource inventory fixture")
    for name in (
        "ANIMAMA_DOCLING_ARTIFACTS_PATH",
        "TIKTOKEN_CACHE_DIR",
        "HF_HUB_OFFLINE",
        "HF_HUB_DISABLE_TELEMETRY",
        "TRANSFORMERS_OFFLINE",
        "ANIMAMA_USER_FILE_DOCLING_ENABLE_OCR",
    ):
        monkeypatch.setenv(name, "fixture")
    assert document_worker.configure_resources() == tmp_path / "document-resources"
    assert os.environ["HF_HUB_OFFLINE"] == "1"
    assert os.environ["TRANSFORMERS_OFFLINE"] == "1"
    assert os.environ["ANIMAMA_USER_FILE_DOCLING_ENABLE_OCR"] == "0"


def test_bootstrap_preserves_sql_comments_and_literal_semicolons() -> None:
    from unittest.mock import Mock

    from animama.server import db_bootstrap

    cursor = Mock()
    sql = "-- One seed; this comment is not another command\nSELECT 'a;b'; SELECT 2;"
    db_bootstrap._exec_sql_statements(cursor, sql)
    cursor.execute.assert_called_once_with(sql, prepare=False)


def test_desktop_json_schemas_are_valid() -> None:
    from jsonschema import Draft202012Validator

    root = Path(__file__).resolve().parents[1] / "src/frontend/desktop/runtime"
    for name in ("desktop-runtime.schema.json", "feature-pack.schema.json"):
        Draft202012Validator.check_schema(json.loads((root / name).read_text()))


async def test_desktop_readiness_is_private_bounded_and_absent_from_openapi(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    from types import SimpleNamespace

    from httpx import ASGITransport, AsyncClient

    from animama.server.app import create_local_app
    from animama.server.config import Settings

    token = "a" * 64
    monkeypatch.setenv("ANIMAMA_DESKTOP_BUILD_ID", "b" * 64)
    # A released app version differs from the API schema version (0.1.0).
    monkeypatch.setenv("ANIMAMA_DESKTOP_APP_VERSION", "0.1.1")
    monkeypatch.setenv("ANIMAMA_PROCESS_START_TOKEN", "11111111-1111-4111-8111-111111111111")
    app = create_local_app(
        runtime_settings=Settings(
            animama_public_origin="http://localhost:8000",
            animama_content_root=tmp_path / "content",
            animama_data_root=tmp_path / "data",
            animama_desktop_control_token=token,
            animama_desktop_renderer_capability="r" * 64,
        )
    )
    assert "/_desktop/health" not in app.openapi()["paths"]
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://localhost:8000") as client:
        for headers in ({}, {"X-Animama-Desktop-Control": "wrong"}, {"X-Animama-Internal-Token": token}):
            response = await client.get("/_desktop/health", headers=headers)
            assert response.status_code == 404
            assert token not in response.text
        starting = await client.get("/_desktop/health", headers={"X-Animama-Desktop-Control": token})
        assert (starting.status_code, starting.json()) == (503, {"detail": "runtime_starting"})
        # Failed startup reconciliation is terminal for this process, so the
        # supervisor receives a specific code instead of waiting for its deadline.
        app.state.local_bootstrap_state = SimpleNamespace(principal_id="desktop-owner", content_ready=False)
        failed = await client.get("/_desktop/health", headers={"X-Animama-Desktop-Control": token})
        assert (failed.status_code, failed.json()) == (503, {"detail": {"code": "content_startup_failed"}})
        app.state.local_bootstrap_state.content_ready = True
        app.state.local_http_lifecycle.mark_ready("desktop-owner")
        ready = await client.get("/_desktop/health", headers={"X-Animama-Desktop-Control": token})
        assert ready.status_code == 200
        assert ready.json() == {
            "schema_version": 1,
            "runtime_version": "0.1.1",
            "build_id": "b" * 64,
            "alembic_head": ScriptDirectory.from_config(resources.alembic_config()).get_current_head(),
            "installation_principal_id": "desktop-owner",
            "local_http_schema_version": 1,
            "process_id": os.getpid(),
            "process_start_token": "11111111-1111-4111-8111-111111111111",
        }


async def test_avatar_cleanup_shutdown_wakes_an_idle_owned_worker() -> None:
    import asyncio

    from animama.workers.avatar_upload_cleanup import AvatarUploadCleanupWorker

    worker = AvatarUploadCleanupWorker(database_url="unused", interval_seconds=3600, batch_size=1)
    waiting = asyncio.create_task(worker._wait_for_next_cleanup())
    await worker.stop()
    await asyncio.wait_for(waiting, timeout=1)
