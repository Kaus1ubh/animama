from __future__ import annotations

from sqlalchemy import inspect


async def test_orm_schema_has_one_neutral_typed_content_catalog(async_session) -> None:
    connection = await async_session.connection()

    def inspect_schema(sync_connection):
        inspector = inspect(sync_connection)
        return set(inspector.get_table_names())

    tables = await connection.run_sync(inspect_schema)
    assert {
        "content_catalog_items",
        "content_catalog_files",
        "content_catalog_dependencies",
        "content_previews",
        "content_preview_files",
        "anima_content_bindings",
        "anima_loadouts",
        "anima_runtime_snapshots",
        "anima_loadout_mutation_receipts",
    } <= tables
    assert {
        "local_content_catalog_items",
        "local_content_catalog_files",
        "local_content_catalog_dependencies",
        "local_content_previews",
        "local_content_preview_files",
        "anima_local_content_bindings",
        "content_items",
        "content_releases",
        "content_blobs",
        "content_file_uploads",
        "content_object_cleanups",
        "content_release_files",
        "content_release_dependencies",
        "content_preview_snapshots",
        "gesture_semantic_key_reservations",
        "anima_gesture_bindings",
        "anima_reaction_bindings",
        "anima_idle_style_bindings",
        "anima_music_track_bindings",
        "anima_appearance_bindings",
        "anima_runtime_file_memberships",
    }.isdisjoint(tables)


async def test_pose_is_catalog_content_but_not_an_equippable_loadout_kind(async_session) -> None:
    """The database admits poses only in the content catalog, never an Anima slot."""
    connection = await async_session.connection()

    def inspect_constraints(sync_connection):
        inspector = inspect(sync_connection)
        return (
            inspector.get_check_constraints("content_catalog_items"),
            inspector.get_check_constraints("anima_content_bindings"),
        )

    catalog_checks, binding_checks = await connection.run_sync(inspect_constraints)
    assert any("'pose'" in constraint["sqltext"] for constraint in catalog_checks)
    assert all("'pose'" not in constraint["sqltext"] for constraint in binding_checks)
