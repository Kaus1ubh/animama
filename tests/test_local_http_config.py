from __future__ import annotations

from dataclasses import FrozenInstanceError
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
