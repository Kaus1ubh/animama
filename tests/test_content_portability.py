"""Non-portable Included content is derived by the scanner, never by descriptors."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import pytest

from animama.adapters.content_store import FilesystemContentStore
from animama.app.services import content_portability
from animama.app.services.content_portability import (
    PRIVATE_PACK_IDS,
    RESTRICTED_RESOURCES,
    parse_restricted_manifest,
    portability,
    restricted_sha256,
)
from animama.domain.content_catalog import CatalogContentEntry, ContentScope, ContentSource, ScannedContentEntry
from animama.domain.content_sources import IncludedContentSource
from animama.server.config import Settings
from animama.server.local_runtime import LocalRuntimeConfigurationError, initialize_local_runtime
from tests.test_local_content_store import _glb

ROOT = Path(__file__).parents[1]

_RULE = {
    "creator": "Fixture",
    "license_id": "LicenseRef-Fixture",
    "provenance": "Fixture",
    "redistribution_review": "pending",
}


def _inventory(root: Path, *rules: dict[str, object]) -> None:
    (root / "licenses").mkdir(parents=True, exist_ok=True)
    (root / "licenses/inventory.json").write_text(json.dumps({"schema_version": 1, "rules": list(rules)}))


def _gesture(root: Path, name: str, *, provenance: dict[str, object] | None = None) -> bytes:
    folder = root / "gestures" / name
    folder.mkdir(parents=True)
    payload = _glb(name)
    (folder / f"{name}.vrma").write_bytes(payload)
    document: dict[str, object] = {
        "schema_version": 1,
        "content_type": "gesture",
        "content_id": f"builtin:gesture:{name}",
        "version": 1,
        "semantic_key": name,
        "name": name.title(),
        "implementation": {"kind": "vrma", "file_role": "animation"},
        "files": [{"path": f"{name}.vrma", "role": "animation"}],
        "dependencies": [],
    }
    if provenance is not None:
        document["provenance"] = provenance
    (folder / f"{name}.meta.json").write_text(json.dumps(document))
    return payload


def _entry(scanned: ScannedContentEntry) -> CatalogContentEntry:
    return CatalogContentEntry(
        id=scanned.relative_locator,
        source=scanned.source,
        scope=ContentScope.INCLUDED,
        owner_user_id=None,
        kind=scanned.kind,
        relative_locator=scanned.relative_locator,
        display_name=scanned.display_name,
        status=scanned.status,
        revision_sha256=scanned.revision_sha256,
        files=(),
        provenance=scanned.provenance,
    )


def _by_locator(entries: list[ScannedContentEntry]) -> dict[str, str]:
    return {entry.relative_locator: portability(_entry(entry)) for entry in entries}


def test_a_non_portable_mount_marks_its_entries_and_descriptors_cannot_change_that(tmp_path: Path) -> None:
    core, pack, local = (tmp_path / name for name in ("core", "pack", "local"))
    local.mkdir()
    _inventory(core, {"glob": "**/*", **_RULE})
    _inventory(pack, {"glob": "**", "distribution": "non-portable", **_RULE})
    _gesture(core, "claims", provenance={"distribution": "non-portable"})
    _gesture(pack, "wave", provenance={"distribution": "portable"})
    _gesture(pack, "bow", provenance={"note": "no distribution key"})
    store = FilesystemContentStore(
        included_root=core,
        local_root=local,
        operations_root=tmp_path / "operations",
        included_sources=(
            IncludedContentSource("core", "v1", core),
            IncludedContentSource("mixamo-motion", "v1", pack, "mixamo-motion"),
        ),
        restricted_sha256=frozenset(),
    )

    assert _by_locator(store.scan(ContentSource.INCLUDED)) == {
        "gestures/claims": "portable",
        "gestures/wave": "non-portable",
        "gestures/bow": "non-portable",
    }


def test_local_entries_are_restricted_only_by_byte_match(tmp_path: Path) -> None:
    included, local = tmp_path / "included", tmp_path / "local"
    included.mkdir()
    restricted = _gesture(local, "copied", provenance={"distribution": "portable"})
    _gesture(local, "claims", provenance={"distribution": "non-portable"})
    store = FilesystemContentStore(
        included_root=included,
        local_root=local,
        operations_root=tmp_path / "operations",
        restricted_sha256=frozenset({hashlib.sha256(restricted).hexdigest()}),
    )

    assert _by_locator(store.scan(ContentSource.LOCAL)) == {
        "gestures/copied": "non-portable",
        "gestures/claims": "portable",
    }


def test_the_tracked_manifest_parses_and_malformed_manifests_fail() -> None:
    assert isinstance(restricted_sha256(), frozenset)
    for value in ({"schema_version": 2, "files": []}, {"schema_version": 1, "files": [{"sha256": "abc"}]}):
        with pytest.raises(ValueError):
            parse_restricted_manifest(value)


def test_every_private_pack_manifest_and_the_preview_deny_list_are_restricted() -> None:
    resources = ROOT / "src/backend/animama/resources"
    expected: set[str] = set()
    for name, pack_id in RESTRICTED_RESOURCES:
        value = json.loads((resources / name).read_text(encoding="utf-8"))
        assert value.get("pack_id") == pack_id
        expected |= parse_restricted_manifest(value, pack_id=pack_id)
    assert {pack_id for _, pack_id in RESTRICTED_RESOURCES} - {None} == set(PRIVATE_PACK_IDS)
    assert restricted_sha256() == frozenset(expected)


def test_restricted_hashes_are_the_union_of_every_resource(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    first, second = "a" * 64, "b" * 64
    (tmp_path / "one.json").write_text(
        json.dumps({"schema_version": 1, "pack_id": "one", "files": [{"sha256": first}]})
    )
    (tmp_path / "deny.json").write_text(json.dumps({"schema_version": 1, "files": [{"sha256": second}]}))
    (tmp_path / "broken.json").write_text(
        json.dumps({"schema_version": 1, "pack_id": "two", "files": [{"sha256": "x"}]})
    )
    monkeypatch.setattr(content_portability, "files", lambda _package: tmp_path)
    try:
        restricted_sha256.cache_clear()
        monkeypatch.setattr(content_portability, "RESTRICTED_RESOURCES", (("one.json", "one"), ("deny.json", None)))
        assert restricted_sha256() == frozenset({first, second})
        restricted_sha256.cache_clear()
        monkeypatch.setattr(content_portability, "RESTRICTED_RESOURCES", (("one.json", "one"), ("broken.json", "two")))
        with pytest.raises(ValueError, match="hash"):
            restricted_sha256()
    finally:
        restricted_sha256.cache_clear()


def test_a_manifest_for_another_pack_is_refused() -> None:
    value = {"schema_version": 1, "pack_id": "mixamo-motion", "files": []}
    assert parse_restricted_manifest(value, pack_id="mixamo-motion") == frozenset()
    with pytest.raises(ValueError):
        parse_restricted_manifest(value, pack_id="wow-comedy-sfx")


@pytest.mark.parametrize("pack_id", ["mixamo-motion", "wow-comedy-sfx"])
def test_runtime_accepts_each_private_pack_identity(tmp_path: Path, pack_id: str) -> None:
    core, pack = tmp_path / "core", tmp_path / "pack"
    _inventory(core, {"glob": "**/*", **_RULE})
    _inventory(pack, {"glob": "**", "distribution": "non-portable", **_RULE})

    def settings(declared: str) -> Settings:
        sources = [
            {"id": "core", "version": "v1", "root": str(core)},
            {"id": pack_id, "version": "v1", "root": str(pack), "pack_id": declared},
        ]
        return Settings(
            animama_content_root=tmp_path / "content",
            animama_data_root=tmp_path / "data",
            animama_local_content_root=tmp_path / "local",
            animama_included_content_sources_json=json.dumps(sources),
        )

    paths = initialize_local_runtime(settings(pack_id))
    assert [source.pack_id for source in paths.included_sources] == [None, pack_id]
    with pytest.raises(LocalRuntimeConfigurationError):
        initialize_local_runtime(settings("unknown-pack"))


def test_an_unknown_or_mixed_distribution_fails_closed(tmp_path: Path) -> None:
    core, local = tmp_path / "core", tmp_path / "local"
    local.mkdir()
    _inventory(
        core,
        {"glob": "gestures/typo/**", "distribution": "non_portable", **_RULE},
        {"glob": "gestures/mixed/*.vrma", "distribution": "non-portable", **_RULE},
        {"glob": "gestures/mixed/**", "distribution": "excluded", **_RULE},
        {"glob": "**", **_RULE},
    )
    for name in ("typo", "mixed", "plain"):
        _gesture(core, name)
    store = FilesystemContentStore(
        included_root=core, local_root=local, operations_root=tmp_path / "operations", restricted_sha256=frozenset()
    )

    assert _by_locator(store.scan(ContentSource.INCLUDED)) == {
        "gestures/typo": "non-portable",
        "gestures/mixed": "non-portable",
        "gestures/plain": "portable",
    }
