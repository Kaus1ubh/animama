from __future__ import annotations

from pathlib import Path

from animama.server.app import app

REPO_ROOT = Path(__file__).resolve().parents[1]


def test_openapi_has_no_legacy_asset_or_raw_binding_routes() -> None:
    """Only typed product routes may expose catalog mutations or runtime bindings."""

    paths = set(app.openapi()["paths"])
    forbidden_fragments = (
        "/v1/assets",
        "/v1/asset-packs",
        "/runtime-assets",
        "/asset-loadout",
    )

    assert not sorted(path for path in paths if any(fragment in path for fragment in forbidden_fragments))


def test_avatar_seed_runs_after_the_orm_owned_schema() -> None:
    """A reset must not pre-create a stale subset of the Avatar columns."""

    avatar_seed = (REPO_ROOT / "src/backend/migrations/seeds/02-seed-avatars.sql").read_text()
    assert "INSERT INTO avatar" in avatar_seed
    assert "CREATE TABLE" not in avatar_seed.upper()
