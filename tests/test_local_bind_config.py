from __future__ import annotations

from pathlib import Path

import pytest

from animama.server.config import Settings
from animama.server.local_runtime import LocalRuntimeConfigurationError, is_loopback_host, validate_local_bindings


def _settings(tmp_path: Path, **overrides: object) -> Settings:
    return Settings(
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
        **overrides,
    )


@pytest.mark.parametrize("host", ["localhost", "animama-test.localhost", "127.0.0.1", "::1", "[::1]"])
def test_loopback_hosts_are_recognized(host: str) -> None:
    assert is_loopback_host(host)


@pytest.mark.parametrize("host", ["0.0.0.0", "::", "192.168.1.4", "animama.example.com", ""])
def test_exposed_hosts_are_not_loopback(host: str) -> None:
    assert not is_loopback_host(host)


def test_native_fastapi_rejects_lan_bind(tmp_path: Path) -> None:
    settings = _settings(tmp_path, animama_local_bind_host="0.0.0.0")
    with pytest.raises(LocalRuntimeConfigurationError, match="ANIMAMA_LOCAL_BIND_HOST"):
        validate_local_bindings(settings)


def test_native_fastapi_allows_loopback_bind(tmp_path: Path) -> None:
    validate_local_bindings(_settings(tmp_path))
