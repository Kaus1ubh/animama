"""Crisis-resource table validation and region resolution (spec R5)."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from animama.app.safety.crisis_resources import (
    CrisisResourceTableError,
    load_crisis_resource_table,
    region_from_locale,
    resolve_crisis_region,
)
from animama.server.config import Settings


def test_bundled_table_covers_minimum_regions_with_review_records() -> None:
    table = load_crisis_resource_table()
    codes = {region.code for region in table.regions}
    assert {"US", "CA", "GB", "IE", "AU"} <= codes
    for region in (*table.regions, table.fallback):
        assert region.verified_on is not None
    for region in table.regions:
        assert region.source_url is not None
        assert region.services and all(service.contacts for service in region.services)
        assert region.emergency_number
    assert table.region("US").services[0].contacts[0].value == "988"


@pytest.mark.parametrize(
    ("preferred", "locale", "expected"),
    [
        ("GB", "en-US", "GB"),
        (None, "en-US", "US"),
        (None, "fr_CA", "CA"),
        (None, "en", "fallback"),
        (None, None, "fallback"),
        ("ZZ", "en-US", "fallback"),
        ("au", None, "AU"),
    ],
)
def test_region_resolution(preferred: str | None, locale: str | None, expected: str) -> None:
    table = load_crisis_resource_table()
    assert resolve_crisis_region(table, preferred_region=preferred, locale=locale).code == expected


def test_region_from_locale_ignores_scripts() -> None:
    assert region_from_locale("zh-Hant-TW") == "TW"
    assert region_from_locale("") is None


def _write(tmp_path: Path, payload: object) -> Path:
    path = tmp_path / "table.json"
    path.write_text(json.dumps(payload), encoding="utf-8")
    return path


def test_operator_table_replaces_bundled_table(tmp_path: Path) -> None:
    path = _write(
        tmp_path,
        {
            "version": 1,
            "regions": [
                {
                    "code": "DE",
                    "label": "Germany",
                    "emergency_number": "112",
                    "services": [
                        {
                            "name": "TelefonSeelsorge",
                            "contacts": [{"kind": "phone", "label": "Call 0800 111 0 111", "value": "08001110111"}],
                        }
                    ],
                    "source_url": "https://www.telefonseelsorge.de/",
                    "verified_on": "2026-09-25",
                }
            ],
            "fallback": {
                "code": "fallback",
                "label": "Other regions",
                "services": [],
                "source_url": None,
                "verified_on": "2026-09-25",
            },
        },
    )
    assert load_crisis_resource_table(path).region("DE").label == "Germany"


@pytest.mark.parametrize(
    "payload",
    [
        {"version": 1, "regions": [], "fallback": {}},
        {"version": 2},
        "not a table",
    ],
)
def test_invalid_operator_table_fails_clearly(tmp_path: Path, payload: object) -> None:
    path = _write(tmp_path, payload)
    with pytest.raises(CrisisResourceTableError, match=str(path)):
        load_crisis_resource_table(path)


def test_invalid_operator_table_fails_settings_at_startup(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    path = _write(tmp_path, {"version": 1})
    with pytest.raises(ValueError, match="ANIMAMA_CRISIS_RESOURCES_PATH"):
        Settings(crisis_resources_path=path)


def test_chat_contacts_require_https(tmp_path: Path) -> None:
    table = json.loads(
        (Path(__file__).parents[1] / "src/backend/animama/resources/crisis-resources.v1.json").read_text()
    )
    table["regions"][0]["services"][0]["contacts"][2]["value"] = "http://example.com/chat"
    with pytest.raises(CrisisResourceTableError):
        load_crisis_resource_table(_write(tmp_path, table))
