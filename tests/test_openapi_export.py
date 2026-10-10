from __future__ import annotations

import http.client
import json
from pathlib import Path

import pytest

from animama.server.app import app
from animama.server.export_openapi import export_openapi, main


def test_export_openapi_is_deterministic_and_does_not_run_startup(tmp_path: Path) -> None:
    output = tmp_path / "nested" / "local-openapi.json"
    startup_marker = object()
    app.state.open_api_export_startup_marker = startup_marker

    export_openapi(output)
    first = output.read_bytes()
    export_openapi(output)

    assert output.read_bytes() == first
    assert first.endswith(b"\n")
    assert json.loads(first) == app.openapi()
    assert app.state.open_api_export_startup_marker is startup_marker
    assert not list(output.parent.glob("*.tmp"))


def test_export_openapi_cli_requires_and_writes_explicit_output(tmp_path: Path) -> None:
    output = tmp_path / "schema.json"

    assert main(["--output", str(output)]) == 0
    assert json.loads(output.read_text(encoding="utf-8"))["info"]["title"] == "Animama Local Server"


@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("/v1/animas", "post"),
        ("/v1/animas/creation-options", "get"),
        ("/v1/animas/starters:ensure", "post"),
        ("/v1/animas:validate", "post"),
    ],
)
def test_anima_creation_error_description_is_interpreter_independent(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, path: str, method: str
) -> None:
    # Python 3.14 renamed this phrase; exported contracts must stay stable.
    monkeypatch.setitem(http.client.responses, 422, "Unprocessable Content")
    monkeypatch.setattr(app, "openapi_schema", None)
    output = tmp_path / "schema.json"

    export_openapi(output)

    response = json.loads(output.read_text())["paths"][path][method]["responses"]["422"]
    assert response["description"] == "Unprocessable Entity"
    assert response["content"]["application/json"]["schema"] == {
        "$ref": "#/components/schemas/AnimaCreationErrorResponse"
    }
