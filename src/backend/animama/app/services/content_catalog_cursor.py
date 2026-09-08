"""Opaque keyset cursors shared by typed product catalogs."""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any


@dataclass(frozen=True, slots=True)
class ContentCatalogCursor:
    """Last stable sort key returned by a typed catalog page."""

    sort: str
    item_id: str
    name: str | None = None
    updated_at: datetime | None = None


def encode_content_catalog_cursor(row: Any, *, sort: str) -> str:
    """Encode the row's stable product identity and current ordering value."""

    payload: dict[str, Any] = {
        "v": 1,
        "sort": sort,
        "item_id": str(row.item_id),
    }
    if sort == "updated":
        updated = row.updated_at or datetime.min.replace(tzinfo=timezone.utc)
        payload["updated_at"] = updated.isoformat()
    else:
        payload["name"] = str(row.name).casefold()
    return base64.urlsafe_b64encode(
        json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    ).decode().rstrip("=")


def decode_content_catalog_cursor(
    cursor: str | None,
    *,
    sort: str,
) -> ContentCatalogCursor | None:
    """Decode one cursor and reject use under a different ordering."""

    if cursor is None:
        return None
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded).decode())
        if not isinstance(payload, dict) or payload.get("v") != 1 or payload.get("sort") != sort:
            raise ValueError
        item_id = payload.get("item_id")
        if not isinstance(item_id, str) or not item_id:
            raise ValueError
        if sort == "updated":
            raw_updated = payload.get("updated_at")
            if not isinstance(raw_updated, str):
                raise ValueError
            return ContentCatalogCursor(
                sort=sort,
                item_id=item_id,
                updated_at=datetime.fromisoformat(raw_updated),
            )
        name = payload.get("name")
        if not isinstance(name, str):
            raise ValueError
        return ContentCatalogCursor(sort=sort, item_id=item_id, name=name)
    except (ValueError, TypeError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError("invalid_cursor") from exc


def content_catalog_page(
    rows: list[Any],
    *,
    cursor: ContentCatalogCursor | None,
    sort: str,
    limit: int,
) -> tuple[list[Any], str | None]:
    """Merge bounded DB/static candidates and return one stable keyset page."""

    candidates = [row for row in rows if cursor is None or _is_after(row, cursor, sort=sort)]
    candidates.sort(key=lambda row: _key(row, sort=sort), reverse=sort == "updated")
    page = candidates[:limit]
    next_cursor = (
        encode_content_catalog_cursor(page[-1], sort=sort)
        if len(candidates) > limit and page
        else None
    )
    return page, next_cursor


def _key(row: Any, *, sort: str) -> tuple[Any, str]:
    if sort == "updated":
        return (
            row.updated_at or datetime.min.replace(tzinfo=timezone.utc),
            str(row.item_id),
        )
    return (str(row.name).casefold(), str(row.item_id))


def _is_after(row: Any, cursor: ContentCatalogCursor, *, sort: str) -> bool:
    if sort == "updated":
        assert cursor.updated_at is not None
        return _key(row, sort=sort) < (cursor.updated_at, cursor.item_id)
    assert cursor.name is not None
    return _key(row, sort=sort) > (cursor.name, cursor.item_id)


__all__ = [
    "ContentCatalogCursor",
    "content_catalog_page",
    "decode_content_catalog_cursor",
    "encode_content_catalog_cursor",
]
