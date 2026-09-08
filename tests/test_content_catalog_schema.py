from __future__ import annotations

from sqlalchemy import inspect


async def test_orm_schema_has_one_neutral_typed_content_catalog(async_session) -> None:  # noqa: ANN001
    connection = await async_session.connection()

    def inspect_schema(sync_connection):  # noqa: ANN001, ANN202
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
