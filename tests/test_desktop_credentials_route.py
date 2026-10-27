"""The private desktop credential route: authentication, browser isolation and redaction.

Electron main replaces the backend's runtime credentials with
``PUT /_desktop/credentials``. The route must exist only in the embedded desktop
composition, answer only the per-launch control token, refuse anything a
browser could send, and never reflect or log a key value.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import AsyncIterator, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi import FastAPI

from animama.server.app import create_local_app
from animama.server.config import Settings
from animama.server.runtime_credentials import runtime_credentials
from tests.route_support import served_routes

PORT = 41234
ORIGIN = f"http://127.0.0.1:{PORT}"
CONTROL = "c" * 64
RENDERER = "r" * 64
SENTINEL = "sk-SENTINEL-" + "s" * 40
ROUTE = "/_desktop/credentials"
# Exactly what Electron main's fetch sends (captured from Node and Electron 45.0.0).
NODE_FETCH = {
    "x-animama-desktop-control": CONTROL,
    "content-type": "application/json",
    "accept": "*/*",
    "accept-language": "*",
    "sec-fetch-mode": "cors",
    "user-agent": "node",
}


def _settings(tmp_path: Path, *, desktop: bool) -> Settings:
    return Settings(
        animama_public_origin=ORIGIN if desktop else "http://localhost:8000",
        animama_content_root=tmp_path / "content",
        animama_data_root=tmp_path / "data",
        **(
            {"animama_desktop_renderer_capability": RENDERER, "animama_desktop_control_token": CONTROL}
            if desktop
            else {}
        ),
    )


@pytest.fixture
def desktop_app(tmp_path: Path) -> FastAPI:
    return create_local_app(runtime_settings=_settings(tmp_path, desktop=True))


@pytest.fixture
async def client(desktop_app: FastAPI) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(desktop_app), base_url=ORIGIN) as http:
        yield http


@pytest.fixture
def captured_logs(caplog: pytest.LogCaptureFixture) -> Iterator[pytest.LogCaptureFixture]:
    caplog.set_level(logging.DEBUG)
    yield caplog


def _body(credentials: Any, *, generation: Any = None, **extra: Any) -> bytes:
    if generation is None:
        generation = runtime_credentials.snapshot().generation + 1
    return json.dumps({"schema_version": 1, "generation": generation, "credentials": credentials, **extra}).encode()


def _assert_never_reflected(
    response: httpx.Response, logs: pytest.LogCaptureFixture, capsys: pytest.CaptureFixture[str]
) -> None:
    captured = capsys.readouterr()
    for text in (response.text, logs.text, captured.out, captured.err, repr(dict(response.headers))):
        assert SENTINEL not in text
    assert "access-control-allow-origin" not in response.headers


async def test_delivery_replaces_the_store_and_acknowledges_its_generation(
    client: httpx.AsyncClient, captured_logs: pytest.LogCaptureFixture, capsys: pytest.CaptureFixture[str]
) -> None:
    environment_before = dict(os.environ)
    generation = runtime_credentials.snapshot().generation + 1

    response = await client.put(
        ROUTE,
        content=_body(
            {"OPENAI_API_KEY": SENTINEL, "ANIMAMA_CONNECTION_C1_API_KEY": "sk-connection"}, generation=generation
        ),
        headers=NODE_FETCH,
    )

    assert response.status_code == 200
    assert response.json() == {"schema_version": 1, "generation": generation}
    assert response.headers["cache-control"] == "no-store"
    assert runtime_credentials.snapshot().get("OPENAI_API_KEY") == SENTINEL
    assert runtime_credentials.snapshot().get("ANIMAMA_CONNECTION_C1_API_KEY") == "sk-connection"
    assert dict(os.environ) == environment_before
    _assert_never_reflected(response, captured_logs, capsys)


async def test_a_gemini_key_is_applied_and_removed_without_a_restart(client: httpx.AsyncClient) -> None:
    generation = runtime_credentials.snapshot().generation + 1
    added = await client.put(
        ROUTE, content=_body({"GEMINI_API_KEY": SENTINEL}, generation=generation), headers=NODE_FETCH
    )

    assert added.status_code == 200
    assert runtime_credentials.current().get("GEMINI_API_KEY") == SENTINEL

    removed = await client.put(ROUTE, content=_body({}, generation=generation + 1), headers=NODE_FETCH)

    assert removed.status_code == 200
    assert runtime_credentials.current().get("GEMINI_API_KEY") is None


async def test_an_empty_delivery_removes_every_key(client: httpx.AsyncClient) -> None:
    runtime_credentials.reset({"OPENAI_API_KEY": SENTINEL, "ELEVENLABS_API_KEY": SENTINEL})

    response = await client.put(ROUTE, content=_body({}), headers=NODE_FETCH)

    assert response.status_code == 200
    assert runtime_credentials.snapshot().names() == frozenset()


async def test_an_older_generation_is_refused_without_changing_the_store(client: httpx.AsyncClient) -> None:
    current = runtime_credentials.snapshot().generation + 5
    await client.put(ROUTE, content=_body({"OPENAI_API_KEY": "sk-new"}, generation=current), headers=NODE_FETCH)

    for stale in (current, current - 1):
        response = await client.put(
            ROUTE, content=_body({"OPENAI_API_KEY": SENTINEL}, generation=stale), headers=NODE_FETCH
        )
        assert response.status_code == 409
        assert response.json() == {"detail": {"code": "credentials_generation_stale"}}
    assert runtime_credentials.snapshot().get("OPENAI_API_KEY") == "sk-new"


@pytest.mark.parametrize(
    "headers",
    [
        {},
        {"x-animama-desktop-control": ""},
        {"x-animama-desktop-control": "c" * 63},
        {"x-animama-desktop-control": "c" * 65},
        {"x-animama-desktop-control": "d" * 64},
        {"x-animama-desktop-control": RENDERER},
        {"cookie": f"animama_renderer_capability={RENDERER}"},
        {"x-animama-desktop-control": "ć" * 64},
    ],
    ids=["missing", "empty", "short", "long", "wrong", "renderer-capability", "renderer-cookie", "non-ascii"],
)
async def test_anything_but_the_control_token_is_indistinguishable_from_absence(
    client: httpx.AsyncClient,
    headers: dict[str, str],
    captured_logs: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    before = runtime_credentials.snapshot()
    request_headers = {**{k: v for k, v in NODE_FETCH.items() if k != "x-animama-desktop-control"}, **headers}
    raw = [(name.encode(), value.encode("utf-8")) for name, value in request_headers.items()]

    response = await client.put(ROUTE, content=_body({"OPENAI_API_KEY": SENTINEL}), headers=raw)

    assert response.status_code == 404
    assert runtime_credentials.snapshot() is before
    _assert_never_reflected(response, captured_logs, capsys)


async def test_a_duplicated_control_header_is_refused(client: httpx.AsyncClient) -> None:
    before = runtime_credentials.snapshot()
    headers = [(name.encode(), value.encode()) for name, value in NODE_FETCH.items()]
    headers.append((b"x-animama-desktop-control", CONTROL.encode()))

    response = await client.put(ROUTE, content=_body({"OPENAI_API_KEY": SENTINEL}), headers=headers)

    assert response.status_code == 400
    assert runtime_credentials.snapshot() is before


@pytest.mark.parametrize(
    "browser_headers",
    [
        {"origin": ORIGIN},
        {"origin": "https://attacker.example"},
        {"origin": "null"},
        {"sec-fetch-site": "same-origin"},
        {"sec-fetch-site": "cross-site"},
        {"sec-fetch-site": "none"},
        {"sec-fetch-dest": "empty"},
    ],
    ids=["app-origin", "foreign-origin", "null-origin", "same-origin", "cross-site", "site-none", "dest-empty"],
)
async def test_browser_originated_requests_are_refused_even_with_the_token(
    client: httpx.AsyncClient, browser_headers: dict[str, str]
) -> None:
    before = runtime_credentials.snapshot()

    response = await client.put(
        ROUTE, content=_body({"OPENAI_API_KEY": SENTINEL}), headers={**NODE_FETCH, **browser_headers}
    )

    assert response.status_code == 404
    assert runtime_credentials.snapshot() is before
    assert "access-control-allow-origin" not in response.headers


CONTROL_ROUTES = [
    ("GET", "/_desktop/health"),
    ("POST", "/_desktop/runtime:quiesce"),
    ("POST", "/_desktop/feature-packs/document-processing:removal-check"),
    ("PUT", ROUTE),
]


@pytest.mark.parametrize(("method", "path"), CONTROL_ROUTES, ids=[path for _, path in CONTROL_ROUTES])
@pytest.mark.parametrize(
    "browser_headers",
    [{"origin": ORIGIN}, {"sec-fetch-site": "same-origin"}, {"sec-fetch-dest": "empty"}],
    ids=["origin", "fetch-site", "fetch-dest"],
)
async def test_every_control_route_refuses_a_browser_context(
    desktop_app: FastAPI, method: str, path: str, browser_headers: dict[str, str]
) -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(desktop_app), base_url=ORIGIN) as http:
        response = await http.request(method, path, content=b"{}", headers={**NODE_FETCH, **browser_headers})

    assert response.status_code == 404
    assert not desktop_app.state.local_http_lifecycle.quiescing


@pytest.mark.parametrize(("method", "path"), CONTROL_ROUTES[:2], ids=[path for _, path in CONTROL_ROUTES[:2]])
async def test_existing_control_routes_still_answer_electron_main(desktop_app: FastAPI, method: str, path: str) -> None:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(desktop_app), base_url=ORIGIN) as http:
        response = await http.request(method, path, headers=NODE_FETCH)

    # Health reports startup progress before bootstrap; quiesce succeeds. Neither is hidden.
    assert response.status_code in {200, 503}
    assert response.json() != {"error": "not_found"}


def test_the_route_parses_no_body_model(desktop_app: FastAPI) -> None:
    route = next(route for route in served_routes(desktop_app) if getattr(route, "path", None) == ROUTE)

    assert route.body_field is None  # type: ignore[attr-defined]


def test_backend_rules_match_the_desktop_vault() -> None:
    """A drift between these rules would make every desktop key delivery fail.

    Desktop measures length in UTF-16 code units and the backend in code
    points, so the backend is at most more permissive for non-BMP text.
    """

    from animama.app.model_clients.credential_store import (
        _INVALID_VALUE_CHARACTER,
        MANAGED_CREDENTIAL_ENV_PATTERN,
        MAX_CONNECTION_CREDENTIALS,
        MAX_CREDENTIAL_LENGTH,
        is_deliverable_credential_env,
    )

    root = Path(__file__).resolve().parents[1] / "src/frontend"
    shared = (root / "shared/desktop-runtime.ts").read_text()
    vault = (root / "desktop/src/main-process/runtime/vault.ts").read_text()
    pattern = re.search(r"connectionCredentialPattern =\s*/(.+?)/u;", shared)
    limit = re.search(r"maxConnectionCredentials = (\d+);", shared)
    start = vault.index("export function validateCredential(")
    validator = vault[start : vault.index("\n}\n", start)]
    length = re.search(r"value\.length > (\d+)", validator)
    characters = re.search(r"/(\[\\x00-\\x20\\x7f\])/u\.test\(value\)", validator)

    assert pattern and pattern.group(1) == MANAGED_CREDENTIAL_ENV_PATTERN.pattern
    assert limit and int(limit.group(1)) == MAX_CONNECTION_CREDENTIALS
    assert length and int(length.group(1)) == MAX_CREDENTIAL_LENGTH
    assert characters and characters.group(1) == _INVALID_VALUE_CHARACTER.pattern
    # Every provider key the vault delivers is one the backend accepts.
    environment = re.search(r"const providerEnvironment[^{]*\{(.+?)\};", vault, re.DOTALL)
    assert environment
    delivered = set(re.findall(r'"([A-Z_]+)"', environment.group(1)))
    assert delivered == {"OPENAI_API_KEY", "ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "GEMINI_API_KEY"}
    assert all(is_deliverable_credential_env(name) for name in delivered)


@pytest.mark.parametrize("host", ["localhost:41234", "evil.test", f"127.0.0.1:{PORT + 1}", "attacker.test:41234"])
async def test_a_rebound_host_is_refused(desktop_app: FastAPI, host: str) -> None:
    before = runtime_credentials.snapshot()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(desktop_app), base_url=f"http://{host}") as rebound:
        response = await rebound.put(ROUTE, content=_body({"OPENAI_API_KEY": SENTINEL}), headers=NODE_FETCH)

    assert response.status_code == 421
    assert runtime_credentials.snapshot() is before


async def test_a_cors_preflight_gets_no_cors_grant(client: httpx.AsyncClient) -> None:
    response = await client.options(
        ROUTE,
        headers={
            "origin": "https://attacker.example",
            "access-control-request-method": "PUT",
            "access-control-request-headers": "x-animama-desktop-control,content-type",
        },
    )

    assert response.status_code == 404
    assert not any(name.startswith("access-control-") for name in response.headers)


@pytest.mark.parametrize("method", ["GET", "POST", "PATCH", "DELETE"])
async def test_other_methods_never_change_the_store(client: httpx.AsyncClient, method: str) -> None:
    before = runtime_credentials.snapshot()

    response = await client.request(method, ROUTE, content=_body({"OPENAI_API_KEY": SENTINEL}), headers=NODE_FETCH)

    assert response.status_code == 405
    assert SENTINEL not in response.text
    assert runtime_credentials.snapshot() is before


@pytest.mark.parametrize(
    "content_type", ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]
)
async def test_only_json_is_accepted(client: httpx.AsyncClient, content_type: str) -> None:
    before = runtime_credentials.snapshot()

    response = await client.put(
        ROUTE, content=_body({"OPENAI_API_KEY": SENTINEL}), headers={**NODE_FETCH, "content-type": content_type}
    )

    assert response.status_code == 415
    assert response.json() == {"detail": {"code": "credentials_media_type"}}
    assert runtime_credentials.snapshot() is before


def _raw(text: str) -> bytes:
    return text.encode()


MALFORMED: dict[str, bytes] = {
    "not-json": _raw(f"{SENTINEL}"),
    "truncated": _raw(f'{{"schema_version":1,"generation":99,"credentials":{{"OPENAI_API_KEY":"{SENTINEL}"'),
    "array": _raw(f'["{SENTINEL}"]'),
    "duplicate-key": _raw(
        f'{{"schema_version":1,"generation":99,"credentials":{{"OPENAI_API_KEY":"a","OPENAI_API_KEY":"{SENTINEL}"}}}}'
    ),
    "duplicate-top-level": _raw(
        f'{{"schema_version":1,"generation":99,"generation":100,"credentials":{{"OPENAI_API_KEY":"{SENTINEL}"}}}}'
    ),
    "unknown-field": _raw(
        f'{{"schema_version":1,"generation":99,"credentials":{{"OPENAI_API_KEY":"{SENTINEL}"}},"extra":"{SENTINEL}"}}'
    ),
    "missing-generation": _raw(f'{{"schema_version":1,"credentials":{{"OPENAI_API_KEY":"{SENTINEL}"}}}}'),
    "schema-version-2": _raw(f'{{"schema_version":2,"generation":99,"credentials":{{"OPENAI_API_KEY":"{SENTINEL}"}}}}'),
    "schema-version-bool": _raw(
        f'{{"schema_version":true,"generation":99,"credentials":{{"OPENAI_API_KEY":"{SENTINEL}"}}}}'
    ),
    "generation-string": _raw(
        f'{{"schema_version":1,"generation":"99","credentials":{{"OPENAI_API_KEY":"{SENTINEL}"}}}}'
    ),
    "generation-float": _raw(
        f'{{"schema_version":1,"generation":9.5,"credentials":{{"OPENAI_API_KEY":"{SENTINEL}"}}}}'
    ),
    "generation-bool": _raw(
        f'{{"schema_version":1,"generation":true,"credentials":{{"OPENAI_API_KEY":"{SENTINEL}"}}}}'
    ),
    "generation-zero": _raw(f'{{"schema_version":1,"generation":0,"credentials":{{"OPENAI_API_KEY":"{SENTINEL}"}}}}'),
    "credentials-list": _raw(f'{{"schema_version":1,"generation":99,"credentials":["{SENTINEL}"]}}'),
    "value-number": _raw('{"schema_version":1,"generation":99,"credentials":{"OPENAI_API_KEY":12345}}'),
    "value-null": _raw('{"schema_version":1,"generation":99,"credentials":{"OPENAI_API_KEY":null}}'),
    "invalid-utf8": b'{"schema_version":1,"generation":99,"credentials":{"OPENAI_API_KEY":"\xff\xfe'
    + SENTINEL.encode()
    + b'"}}',
    "deep-nesting": _raw("[" * 100_000 + SENTINEL + "]" * 100_000)[: 400 * 1024],
}


@pytest.mark.parametrize("body", list(MALFORMED.values()), ids=list(MALFORMED))
async def test_malformed_deliveries_are_refused_without_reflecting_input(
    client: httpx.AsyncClient,
    body: bytes,
    captured_logs: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    before = runtime_credentials.snapshot()

    response = await client.put(ROUTE, content=body, headers=NODE_FETCH)

    assert response.status_code == 400
    assert response.json() == {"detail": {"code": "credentials_invalid"}}
    assert runtime_credentials.snapshot() is before
    _assert_never_reflected(response, captured_logs, capsys)


@pytest.mark.parametrize(
    "credentials",
    [
        {"PATH": SENTINEL},
        {"PYTHONPATH": SENTINEL},
        {"DYLD_INSERT_LIBRARIES": SENTINEL},
        {"LD_PRELOAD": SENTINEL},
        {"ANIMAMA_DATABASE_URL": SENTINEL},
        {"ANIMAMA_DESKTOP_CONTROL_TOKEN": SENTINEL},
        {"DEEPSEEK_API_KEY": SENTINEL},
        {"openai_api_key": SENTINEL},
        {"ANIMAMA_CONNECTION_" + "A" * 65 + "_API_KEY": SENTINEL},
        {"OPENAI_API_KEY": SENTINEL + " "},
        {"OPENAI_API_KEY": SENTINEL + "\n"},
        {"OPENAI_API_KEY": ""},
        {"OPENAI_API_KEY": "x" * 8193},
        {f"ANIMAMA_CONNECTION_C{index}_API_KEY": SENTINEL for index in range(33)},
    ],
    ids=[
        "path",
        "pythonpath",
        "dyld",
        "ld-preload",
        "database-url",
        "control-token",
        "unmanaged-provider",
        "lowercase",
        "overlong-name",
        "trailing-space",
        "newline",
        "empty",
        "overlong-value",
        "too-many-connections",
    ],
)
async def test_unsafe_names_and_values_are_refused_and_never_reach_the_environment(
    client: httpx.AsyncClient,
    credentials: dict[str, str],
    captured_logs: pytest.LogCaptureFixture,
    capsys: pytest.CaptureFixture[str],
) -> None:
    environment_before = dict(os.environ)
    before = runtime_credentials.snapshot()

    response = await client.put(ROUTE, content=_body(credentials), headers=NODE_FETCH)

    assert response.status_code == 400
    assert response.json() == {"detail": {"code": "credentials_invalid"}}
    assert runtime_credentials.snapshot() is before
    assert dict(os.environ) == environment_before
    _assert_never_reflected(response, captured_logs, capsys)


async def test_the_largest_valid_delivery_is_accepted(client: httpx.AsyncClient) -> None:
    credentials = {f"ANIMAMA_CONNECTION_C{index}_API_KEY": "k" * 8192 for index in range(32)}
    credentials.update({"OPENAI_API_KEY": "o" * 8192, "ELEVENLABS_API_KEY": "e" * 8192})

    response = await client.put(ROUTE, content=_body(credentials), headers=NODE_FETCH)

    assert response.status_code == 200
    assert len(runtime_credentials.snapshot().names()) == 34


async def test_an_oversized_body_is_refused_before_parsing(
    client: httpx.AsyncClient, captured_logs: pytest.LogCaptureFixture, capsys: pytest.CaptureFixture[str]
) -> None:
    before = runtime_credentials.snapshot()
    body = _body({"OPENAI_API_KEY": SENTINEL}, padding="p" * (512 * 1024))

    response = await client.put(ROUTE, content=body, headers=NODE_FETCH)

    assert response.status_code == 413
    assert response.json() == {"detail": {"code": "credentials_too_large"}}
    assert runtime_credentials.snapshot() is before
    _assert_never_reflected(response, captured_logs, capsys)


async def test_an_oversized_streamed_body_without_length_is_refused(client: httpx.AsyncClient) -> None:
    before = runtime_credentials.snapshot()

    async def chunks() -> AsyncIterator[bytes]:
        for _ in range(9):
            yield b" " * (64 * 1024)
        yield _body({"OPENAI_API_KEY": SENTINEL})

    response = await client.put(ROUTE, content=chunks(), headers=NODE_FETCH)

    assert response.status_code == 413
    assert runtime_credentials.snapshot() is before


async def test_the_route_is_private_to_the_desktop_composition(tmp_path: Path) -> None:
    self_host = create_local_app(runtime_settings=_settings(tmp_path, desktop=False))
    before = runtime_credentials.snapshot()

    assert ROUTE not in {getattr(route, "path", None) for route in served_routes(self_host)}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(self_host), base_url="http://localhost:8000") as http:
        response = await http.put(ROUTE, content=_body({"OPENAI_API_KEY": SENTINEL}), headers=NODE_FETCH)

    assert response.status_code == 404
    assert runtime_credentials.snapshot() is before


def test_the_route_is_not_in_the_openapi_schema(desktop_app: FastAPI) -> None:
    desktop_app.openapi_schema = None
    assert ROUTE not in desktop_app.openapi()["paths"]


def test_the_desktop_server_writes_no_access_log(monkeypatch: pytest.MonkeyPatch) -> None:
    import uvicorn

    from animama.local.http.server import serve

    options: dict[str, Any] = {}
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: options.update(kwargs))
    serve(FastAPI(), host="127.0.0.1", port=PORT)

    assert options["access_log"] is False
