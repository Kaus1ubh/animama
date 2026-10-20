from __future__ import annotations

import json
import uuid
from pathlib import Path
from unittest.mock import MagicMock

import psycopg
import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

from alembic.script import ScriptDirectory
from alembic.util import CommandError
from animama.runtime.resources import alembic_config
from animama.server import db_bootstrap


def test_bootstrap_reports_actual_versions_and_preserves_principal_across_reruns(
    db_url: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Use fresh databases in the suite's disposable container, never a dev stack."""

    base = make_url(db_url.replace("+asyncpg", "+psycopg"))
    admin = create_engine(base, isolation_level="AUTOCOMMIT")
    principals: list[str] = []
    try:
        for _ in range(2):
            name = f"desktop_bootstrap_{uuid.uuid4().hex}"
            with admin.connect() as connection:
                connection.exec_driver_sql(f'CREATE DATABASE "{name}" TEMPLATE template0')
            url = base.set(database=name)
            for key, value in {
                "PGHOST": url.host,
                "PGPORT": str(url.port),
                "PGUSER": url.username,
                "PGPASSWORD": url.password,
                "PGDATABASE": name,
                "PGSSLMODE": "disable",
                "ANIMAMA_DATABASE_URL": url.render_as_string(hide_password=False),
            }.items():
                monkeypatch.setenv(key, str(value))
            monkeypatch.delenv("ANIMAMA_DESKTOP_PGDATA", raising=False)
            try:
                before = db_bootstrap.inspect_database()
                assert before["alembic_head"] is None
                assert before["pgvector_version"] is None
                pristine = create_engine(url)
                try:
                    with pristine.connect() as connection:
                        assert (
                            connection.execute(
                                text("SELECT extname FROM pg_extension WHERE extname != 'plpgsql'")
                            ).all()
                            == []
                        )
                finally:
                    pristine.dispose()
                first = db_bootstrap.bootstrap_database()
                assert str(first["postgresql_version"]).startswith("16.")
                assert first["pgvector_version"]
                assert first["previous_alembic_head"] is None
                assert first["alembic_head"] == ScriptDirectory.from_config(alembic_config()).get_current_head()
                assert first["seed_versions"] == ["01-seed-model-providers.sql", "02-seed-avatars.sql"]
                principal = str(first["installation_principal_id"])
                uuid.UUID(principal)
                principals.append(principal)
                engine = create_engine(url)
                try:
                    with engine.begin() as connection:
                        catalog = connection.execute(
                            text("SELECT id, model, provider_type FROM model_providers ORDER BY id")
                        ).all()
                        assert catalog
                        avatars = connection.execute(text("SELECT id FROM avatar ORDER BY id")).all()
                        assert avatars
                        connection.execute(
                            text(
                                "INSERT INTO anima (id, user_id, display_name) VALUES ('desktop-kept', :owner, 'Kept')"
                            ),
                            {"owner": principal},
                        )
                    second = db_bootstrap.bootstrap_database()
                    assert second["installation_principal_id"] == principal
                    assert second["previous_alembic_head"] == first["alembic_head"]
                    assert second["seed_versions"] == first["seed_versions"]
                    with engine.begin() as connection:
                        assert (
                            connection.execute(
                                text("SELECT id, model, provider_type FROM model_providers ORDER BY id")
                            ).all()
                            == catalog
                        )
                        assert connection.execute(text("SELECT id FROM avatar ORDER BY id")).all() == avatars
                        assert (
                            connection.execute(text("SELECT user_id FROM anima WHERE id = 'desktop-kept'")).scalar_one()
                            == principal
                        )
                    # Retired revisions must not be silently stamped or adopted,
                    # and their failed bootstrap must never execute product seeds.
                    for legacy_revision in ("0001", "0013_content_mutation_receipts"):
                        with engine.begin() as connection:
                            connection.execute(
                                text("UPDATE alembic_version SET version_num = :revision"),
                                {"revision": legacy_revision},
                            )
                        with monkeypatch.context() as rejected:
                            run_sql = MagicMock(wraps=db_bootstrap._run_sql_file)
                            rejected.setattr(db_bootstrap, "_run_sql_file", run_sql)
                            with pytest.raises(
                                CommandError, match=f"Can't locate revision identified by '{legacy_revision}'"
                            ):
                                db_bootstrap.bootstrap_database()
                            run_sql.assert_not_called()
                        with engine.connect() as connection:
                            assert (
                                connection.execute(text("SELECT version_num FROM alembic_version")).scalar_one()
                                == legacy_revision
                            )
                            assert (
                                connection.execute(
                                    text("SELECT installation_principal_id FROM installation_settings")
                                ).scalar_one()
                                == principal
                            )
                    with engine.begin() as connection:
                        connection.execute(
                            text("UPDATE alembic_version SET version_num = :head"), {"head": first["alembic_head"]}
                        )
                        connection.execute(text("DELETE FROM installation_settings"))
                    with pytest.raises(RuntimeError, match="installation_principal_missing"):
                        db_bootstrap.bootstrap_database()
                    with engine.connect() as connection:
                        assert connection.execute(text("SELECT count(*) FROM installation_settings")).scalar_one() == 0
                finally:
                    engine.dispose()
            finally:
                with admin.connect() as connection:
                    connection.exec_driver_sql(f'DROP DATABASE "{name}" WITH (FORCE)')
    finally:
        admin.dispose()
    assert principals[0] != principals[1]


def test_desktop_database_connection_rejects_a_different_pgdata_before_mutation(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for key, value in {
        "PGHOST": "127.0.0.1",
        "PGUSER": "animama",
        "PGDATABASE": "animama",
        "ANIMAMA_DESKTOP_PGDATA": str(tmp_path / "owned"),
    }.items():
        monkeypatch.setenv(key, value)
    connection = MagicMock()
    cursor = connection.cursor.return_value.__enter__.return_value
    cursor.fetchone.return_value = (str(tmp_path / "unrelated"),)
    monkeypatch.setattr(psycopg, "connect", lambda **_kwargs: connection)
    with pytest.raises(RuntimeError, match="desktop_database_ownership_mismatch"):
        db_bootstrap.provision_desktop_database()
    connection.close.assert_called_once()
    cursor.execute.assert_called_once_with("SHOW data_directory")


def test_provision_cannot_target_an_unasserted_database(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("PGHOST", "127.0.0.1")
    monkeypatch.setenv("PGDATABASE", "animama")
    monkeypatch.delenv("ANIMAMA_DESKTOP_PGDATA", raising=False)
    with pytest.raises(RuntimeError, match="desktop_database_provision_rejected"):
        db_bootstrap.provision_desktop_database()


@pytest.mark.parametrize("quiet", [False, True])
def test_standalone_bootstrap_output(
    quiet: bool, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    """Reset suppresses the owner report; direct callers retain machine-readable JSON."""

    result = {"installation_principal_id": "fixture-owner", "seed_versions": ["fixture.sql"]}
    bootstrap = MagicMock(return_value=result)
    monkeypatch.setattr(db_bootstrap, "bootstrap_database", bootstrap)
    db_bootstrap.main(["--quiet"] if quiet else [])
    bootstrap.assert_called_once_with()
    output = capsys.readouterr().out
    if quiet:
        assert output == ""
    else:
        assert json.loads(output) == result


def test_bootstrap_rejects_missing_seed_payload(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """An incomplete runtime payload must not report a successful bootstrap."""

    monkeypatch.setattr(db_bootstrap, "runtime_resource", lambda _name: tmp_path)
    monkeypatch.setattr(db_bootstrap, "_connect_with_retries", MagicMock())
    monkeypatch.setattr("alembic.command.upgrade", MagicMock())
    with pytest.raises(RuntimeError, match="[Ss]eed"):
        db_bootstrap.bootstrap_database()


def test_avatar_seeds_retire_only_unreferenced_unmodified_defaults(db_ready: str) -> None:
    """Repeatable seed cleanup must not erase historical Anima or upload links."""
    from animama.runtime.resources import runtime_resource

    url = make_url(db_ready.replace("+asyncpg", "+psycopg"))
    with psycopg.connect(url.render_as_string(hide_password=False).replace("postgresql+psycopg", "postgresql")) as conn:
        try:
            with conn.cursor() as cur:
                cur.execute("SELECT count(*) FROM avatar")
                initial_count = cur.fetchone()
                assert initial_count is not None
                assert initial_count[0] == 0
                seeds = runtime_resource("sql").joinpath("02-seed-avatars.sql").read_text()
                cur.execute(seeds)
                cur.execute("SELECT id FROM avatar ORDER BY id")
                assert cur.fetchall() == [("avt_sample_a1n",)]
                retired = [
                    ("avt_caitlyn", "AvatarSample_Y_0"),
                    ("avt_sample_r1", "AvatarSample_R1"),
                    ("avt_sample_r2", "AvatarSample_R2"),
                    ("avt_sample_a1", "AvatarSample_A_1"),
                    ("avt_sample_y0", "AvatarSample_Y_1"),
                    ("avt_chibi_1", "AvatarChibi_1"),
                    ("avt_chibi_2", "AvatarChibi_2"),
                    ("avt_chibi_3", "AvatarChibi_3"),
                ]
                cur.executemany(
                    "INSERT INTO avatar (id,name,file_path) VALUES (%s,%s,%s)",
                    [(key, key, f"/shared/avatars/{model}.vrm") for key, model in retired],
                )
                cur.execute(
                    "INSERT INTO anima (id,user_id,display_name,avatar_id) "
                    "VALUES ('seed-ref','owner','Kept','avt_sample_a1')"
                )
                cur.execute("UPDATE avatar SET user_id = 'owner' WHERE id = 'avt_sample_y0'")
                cur.execute(
                    "INSERT INTO avatar_upload (id,user_id,storage_locator,original_filename,"
                    "declared_size_bytes,expires_at,avatar_id) "
                    "VALUES ('seed-upload','owner','fixture','fixture.vrm',1,CURRENT_TIMESTAMP,'avt_chibi_1')"
                )
                cur.execute("UPDATE avatar SET file_path = 'avatars/custom.vrm' WHERE id = 'avt_chibi_2'")
                cur.execute(
                    "INSERT INTO content_catalog_items "
                    "(id,source,scope,kind,relative_locator,display_name,status) "
                    "VALUES ('seed-mapped','included','included','avatar','avatars/kept.vrm','Kept','valid')"
                )
                cur.execute("UPDATE avatar SET catalog_item_id = 'seed-mapped' WHERE id = 'avt_chibi_3'")
                for _ in range(2):
                    cur.execute(seeds)
                    cur.execute("SELECT id FROM avatar ORDER BY id")
                    assert cur.fetchall() == [
                        ("avt_chibi_1",),
                        ("avt_chibi_2",),
                        ("avt_chibi_3",),
                        ("avt_sample_a1",),
                        ("avt_sample_a1n",),
                        ("avt_sample_y0",),
                    ]
        finally:
            conn.rollback()
