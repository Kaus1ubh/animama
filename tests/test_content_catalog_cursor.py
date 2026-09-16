from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta

from animama.app.services.content_catalog_cursor import (
    content_catalog_page,
    decode_content_catalog_cursor,
)


@dataclass
class Row:
    item_id: str
    name: str
    updated_at: datetime | None = None


def test_name_cursor_pages_merged_candidates_without_offset_drift() -> None:
    rows = [Row("3", "Charlie"), Row("1", "Alpha"), Row("2", "Bravo")]
    first, cursor = content_catalog_page(rows, cursor=None, sort="name", limit=2)
    assert [row.item_id for row in first] == ["1", "2"]
    assert cursor is not None

    second, next_cursor = content_catalog_page(
        rows,
        cursor=decode_content_catalog_cursor(cursor, sort="name"),
        sort="name",
        limit=2,
    )
    assert [row.item_id for row in second] == ["3"]
    assert next_cursor is None


def test_updated_cursor_is_descending_and_stable() -> None:
    now = datetime.now(UTC)
    rows = [
        Row("old", "Old", now - timedelta(days=1)),
        Row("new", "New", now),
    ]
    first, cursor = content_catalog_page(rows, cursor=None, sort="updated", limit=1)
    assert [row.item_id for row in first] == ["new"]
    assert cursor is not None
    second, _ = content_catalog_page(
        rows,
        cursor=decode_content_catalog_cursor(cursor, sort="updated"),
        sort="updated",
        limit=1,
    )
    assert [row.item_id for row in second] == ["old"]
