"""Identifiers derived from content names in any script (spec R11)."""

from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path

import pytest

from animama.app.services.content_names import name_hash
from animama.app.services.content_package_import import _path_name
from animama.app.services.content_save_service import readable_entry_name
from animama.domain.content_catalog import ContentConflictError

REPOSITORY = Path(__file__).resolve().parents[1]
FIXTURE = REPOSITORY / "src/frontend/web/src/lib/content/fixtures/name-identifiers.json"
# Patterns from content_kind_registry.py that web-proposed identifiers must satisfy.
SEMANTIC_KEY = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
LOGICAL_KEY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9:._-]{0,191}$")


def _rows() -> list[dict[str, str]]:
    rows: list[dict[str, str]] = json.loads(FIXTURE.read_text())["names"]
    return rows


@pytest.mark.parametrize("row", _rows(), ids=lambda row: row["name"])
def test_web_and_backend_agree_on_name_identifiers(row: dict[str, str]) -> None:
    assert name_hash(row["name"]) == row["hash"]
    assert readable_entry_name(row["name"]) == row["entryName"]
    assert SEMANTIC_KEY.fullmatch(row["semanticKey"])
    assert LOGICAL_KEY.fullmatch(f"local:gesture:{row['slug']}")


def test_ascii_names_keep_their_entry_names() -> None:
    assert readable_entry_name("Heart Hands") == "heart-hands"
    assert readable_entry_name("  Calm_Idle.v2 ") == "calm-idle.v2"


def test_names_in_other_scripts_get_distinct_entry_names() -> None:
    names = ["おじぎ", "お辞儀", "인사", "鞠躬", "Bow おじぎ"]
    entries = [readable_entry_name(name) for name in names]
    assert len(set(entries)) == len(names)
    assert readable_entry_name("Café") == "cafe"
    assert readable_entry_name(unicodedata.normalize("NFD", "ガ")) == readable_entry_name("ガ")
    assert readable_entry_name("おじぎ　") == readable_entry_name("おじぎ")


@pytest.mark.parametrize("name", ["", "   ", "!!!", "../x", ".hidden"])
def test_invalid_ascii_names_are_still_rejected(name: str) -> None:
    with pytest.raises(ContentConflictError) as error:
        readable_entry_name(name)
    assert error.value.code == "invalid_entry_name"


def test_imported_paths_keep_names_in_other_scripts_apart() -> None:
    assert _path_name("Heart Hands") == "heart-hands"
    paths = {_path_name(name) for name in ["おじぎ", "お辞儀", "인사"]}
    assert len(paths) == 3
    assert all(re.fullmatch(r"content-[0-9a-z]{7}", path) for path in paths)
    assert _path_name("Bow おじぎ") == f"bow-{name_hash('Bow おじぎ')}"
