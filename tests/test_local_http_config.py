from __future__ import annotations

from dataclasses import FrozenInstanceError
from pathlib import Path
from typing import Any

import pytest

from animama.local.http.config import TRANSPORT_BODY_LIMIT, DesktopAccess, LocalHTTPConfig, canonical_origin


@pytest.mark.parametrize(
    ("value", "expected", "authority"),
    [
        ("http://localhost:3000", "http://localhost:3000", "localhost:3000"),
        ("HTTP://LOCALHOST:80/", "http://localhost", "localhost"),
        ("https://LOCALHOST:443/", "https://localhost", "localhost"),
        ("https://app.example.test:8443/", "https://app.example.test:8443", "app.example.test:8443"),
        ("http://127.0.0.1:3000", "http://127.0.0.1:3000", "127.0.0.1:3000"),
        ("http://[::1]:3000/", "http://[::1]:3000", "[::1]:3000"),
        ("http://[::1]:80", "http://[::1]", "[::1]"),
    ],
)
def test_origins_have_one_canonical_authority(value: str, expected: str, authority: str) -> None:
    assert canonical_origin(value) == expected
    config = LocalHTTPConfig(public_origin=value)
    assert config.public_origin == expected
    assert config.authority == authority


@pytest.mark.parametrize(
    "value",
    [
        "",
        None,
        42,
        "null",
        "file:///application/index.html",
        "ws://localhost:3000",
        "//localhost:3000",
        "http://",
        "http://localhost/application",
        "http://localhost?override=1",
        "http://localhost?",
        "http://localhost#fragment",
        "http://localhost#",
        "http://user@localhost",
        "http://user:secret@localhost",
        "http://localhost:",
        "http://localhost:0",
        "http://localhost:-1",
        "http://localhost:65536",
        "http://localhost:not-a-port",
        "http://localhost:3000:4000",
        "http://[::1",
        "http://[::1]suffix:3000",
        "http://[::1%25lo0]:3000",
        "http://local%68ost:3000",
        "http://localhost\\@hostile.test",
        "http://local\thost:3000",
        "http://localhost:3000\n",
        " http://localhost:3000",
        "http://local host:3000",
        "http://local\x00host:3000",
        "http://local\x7fhost:3000",
        "http://localhost^hostile.test:3000",
        "http://localhost|hostile.test:3000",
        "http://localhost<hostile.test:3000",
        "http://localhost>hostile.test:3000",
        "http://lócálhost:3000",
    ],
)
def test_malformed_or_ambiguous_origins_fail_at_configuration(value: object) -> None:
    with pytest.raises(ValueError):
        canonical_origin(value)  # type: ignore[arg-type]


@pytest.mark.parametrize("credential", ["", "x" * 31, "x" * 31 + "+", "x" * 31 + "/", "x" * 31 + "\n", "é" * 32, None])
def test_desktop_credentials_require_opaque_url_safe_values(credential: object) -> None:
    with pytest.raises(ValueError):
        DesktopAccess(renderer_capability=credential, control_token="b" * 32)  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        DesktopAccess(renderer_capability="a" * 32, control_token=credential)  # type: ignore[arg-type]


def test_renderer_and_control_credentials_are_distinct_immutable_and_hidden() -> None:
    with pytest.raises(ValueError):
        DesktopAccess(renderer_capability="a" * 32, control_token="a" * 32)
    desktop = DesktopAccess(renderer_capability="renderer_capability_" + "a" * 32, control_token="control_" + "b" * 32)
    config = LocalHTTPConfig(public_origin="http://localhost:3000", desktop=desktop)
    assert desktop.renderer_capability not in repr(desktop) + repr(config)
    assert desktop.control_token not in repr(desktop) + repr(config)
    with pytest.raises(FrozenInstanceError):
        desktop.renderer_capability = "c" * 32  # type: ignore[misc]
    with pytest.raises(FrozenInstanceError):
        config.public_origin = "http://hostile.test"  # type: ignore[misc]


@pytest.mark.parametrize(
    "values",
    [
        {"desktop": {"renderer_capability": "a" * 32, "control_token": "b" * 32}},
        {"max_body_bytes": 0},
        {"max_body_bytes": -1},
        {"max_body_bytes": TRANSPORT_BODY_LIMIT + 1},
        {"max_body_bytes": True},
        {"max_body_bytes": 1024.0},
        {"body_timeout_seconds": 0},
        {"body_timeout_seconds": -1},
        {"body_timeout_seconds": 120.1},
        {"body_timeout_seconds": True},
        {"body_timeout_seconds": "120"},
        {"body_timeout_seconds": float("inf")},
        {"body_timeout_seconds": float("nan")},
        {"allow_same_site_fetches": "false"},
        {"allow_same_site_fetches": 1},
    ],
)
def test_configuration_rejects_invalid_types_and_unbounded_limits(values: dict[str, Any]) -> None:
    # Deliberately untyped inputs exercise the runtime configuration validator.
    with pytest.raises(ValueError):
        LocalHTTPConfig(public_origin="http://localhost:3000", **values)


def test_default_policy_retains_transport_ceiling_and_strict_same_site_admission() -> None:
    config = LocalHTTPConfig(public_origin="http://localhost:3000")
    assert config.max_body_bytes == 128 * 1024 * 1024
    assert config.body_timeout_seconds == 120
    assert config.allow_same_site_fetches is False
    assert config.desktop is None


def test_pytest_environment_isolation_contract(tmp_path: Path) -> None:
    """Exercise the real pytest harness in fresh processes with poisoned inputs."""
    import os
    import subprocess
    import sys

    import dotenv

    from animama.server.config import Settings
    from animama.server.runtime_credentials import runtime_credentials

    probe = os.environ.get("ANIMAMA_TEST_ENVIRONMENT_PROBE")
    if probe is not None:
        assert os.environ["PYTHON_DOTENV_DISABLED"] == "1"
        assert os.environ["OTEL_SDK_DISABLED"] == "1"
        assert os.environ["ANIMAMA_RUN_ASSET_SCALE_BENCHMARK"] == "1"
        assert not dotenv.load_dotenv(os.environ["ANIMAMA_TEST_DOTENV_PATH"], override=True)
        assert "ANIMAMA_TEST_DOTENV_CANARY" not in os.environ
        assert Settings().animama_data_root != Path(os.environ["ANIMAMA_TEST_POISON_DATA_ROOT"])
        assert Settings().animama_content_root == Path(__file__).resolve().parents[1] / "content"
        if probe == "offline":
            assert os.environ["OPENAI_API_KEY"] == "test-key"
            assert runtime_credentials.snapshot().get("OPENAI_API_KEY") == "test-key"
            assert "ELEVENLABS_API_KEY" not in os.environ
            assert "ANIMAMA_LIVE_OPENAI_API_KEY" not in os.environ
        else:
            assert probe == "live"
            assert os.environ["ANIMAMA_LIVE_OPENAI_API_KEY"] == "explicit-live-test-canary"
        return

    dotenv_path = tmp_path / ".env"
    dotenv_path.write_text("ANIMAMA_TEST_DOTENV_CANARY=must-not-be-loaded\nOPENAI_API_KEY=dotenv-canary\n")
    for mode in ("offline", "live"):
        environment = dict(os.environ)
        environment.pop("PYTEST_ADDOPTS", None)
        environment.pop("PYTEST_PLUGINS", None)
        environment.update(
            ANIMAMA_TEST_ENVIRONMENT_PROBE=mode,
            ANIMAMA_RUN_ASSET_SCALE_BENCHMARK="1",
            ANIMAMA_TEST_DOTENV_PATH=str(dotenv_path),
            ANIMAMA_TEST_POISON_DATA_ROOT=str(tmp_path / "maintainer-data"),
            ANIMAMA_DATA_ROOT=str(tmp_path / "maintainer-data"),
            ANIMAMA_CONTENT_ROOT=str(tmp_path / "maintainer-content"),
            OPENAI_API_KEY="inherited-provider-canary",
            ELEVENLABS_API_KEY="inherited-voice-canary",
            ANIMAMA_LIVE_OPENAI_API_KEY="explicit-live-test-canary",
            ANIMAMA_RUN_LIVE_TESTS="1" if mode == "live" else "0",
            PYTHON_DOTENV_DISABLED="0",
            OTEL_SDK_DISABLED="false",
        )
        result = subprocess.run(
            [
                sys.executable,
                "-m",
                "pytest",
                "-q",
                f"{__file__}::test_pytest_environment_isolation_contract",
                "-p",
                "no:cacheprovider",
            ],
            cwd=Path(__file__).resolve().parents[1],
            env=environment,
            capture_output=True,
            text=True,
            timeout=60,
        )
        assert result.returncode == 0, result.stdout + result.stderr
        assert "1 passed" in result.stdout


def test_pytest_fixture_restores_environment_and_engines() -> None:
    """Close real fixture generators with fake engines, including setup failure."""
    import subprocess
    import sys
    import textwrap

    script = textwrap.dedent(
        """
        import asyncio
        import inspect
        import os
        import runpy
        from contextlib import asynccontextmanager

        os.environ['OPENAI_API_KEY'] = 'restore-provider-canary'
        os.environ['ANIMAMA_DATABASE_URL'] = 'restore-database-canary'
        os.environ['ANIMAMA_RUN_LIVE_TESTS'] = '0'
        before = dict(os.environ)
        namespace = runpy.run_path('tests/conftest.py')
        import sqlalchemy.ext.asyncio as sqlalchemy_asyncio
        import animama.hooks as hooks
        import animama.local.database as database

        original_factory = sqlalchemy_asyncio.create_async_engine
        original_database_engine = database.get_engine
        original_hook_engine = hooks.get_engine
        engines = []

        class Engine:
            disposed = False
            fail = False

            @asynccontextmanager
            async def begin(self):
                yield self

            async def exec_driver_sql(self, sql):
                if self.fail:
                    raise RuntimeError('controlled setup failure')

            async def run_sync(self, callback):
                pass

            async def dispose(self):
                self.disposed = True

        def create_engine(*args, **kwargs):
            engine = Engine()
            engines.append(engine)
            return engine

        async def verify():
            for fail in (False, True):
                saved_url = os.environ.get('ANIMAMA_DATABASE_URL')
                generator = inspect.unwrap(namespace['db_ready'])('test-database-url')
                Engine.fail = fail
                try:
                    if fail:
                        try:
                            await anext(generator)
                        except RuntimeError as error:
                            assert str(error) == 'controlled setup failure'
                        else:
                            raise AssertionError('setup failure was swallowed')
                    else:
                        assert await anext(generator) == 'test-database-url'
                        assert database.get_engine is not original_database_engine
                        database.get_engine()
                finally:
                    await generator.aclose()
                assert database.get_engine is original_database_engine
                assert hooks.get_engine is original_hook_engine
                assert os.environ.get('ANIMAMA_DATABASE_URL') == saved_url
                assert all(engine.disposed for engine in engines)

        sqlalchemy_asyncio.create_async_engine = create_engine
        try:
            asyncio.run(verify())
        finally:
            sqlalchemy_asyncio.create_async_engine = original_factory
            namespace['pytest_unconfigure']()
        assert dict(os.environ) == before
        print('fixture restoration verified')
        """
    )
    result = subprocess.run(
        [sys.executable, "-c", script],
        cwd=Path(__file__).resolve().parents[1],
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    assert "fixture restoration verified" in result.stdout
