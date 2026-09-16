from __future__ import annotations

from typing import Any

import pytest

from animama.app.services.user_file_overview import (
    MAX_OVERVIEW_DESCRIPTION_CHARS,
    MAX_OVERVIEW_OUTLINE_ITEMS,
    build_user_file_overview,
    deserialize_user_file_overview,
    serialize_user_file_overview,
)
from animama.domain.user_file_processing import (
    ParsedUserFileDocument,
    UserFileChunkDraft,
    UserFileOutlineItem,
)


def _document(
    text: str,
    *,
    parser_name: str = "stdlib-text",
    metadata: dict[str, Any] | None = None,
    tables: list[dict[str, Any]] | None = None,
    source_outline: tuple[UserFileOutlineItem, ...] = (),
    source_outline_truncated: bool = False,
) -> ParsedUserFileDocument:
    return ParsedUserFileDocument(
        text=text,
        parser_name=parser_name,
        metadata=metadata or {"format": "txt"},
        tables=tables,
        source_outline=source_outline,
        source_outline_truncated=source_outline_truncated,
    )


def _chunk(text: str) -> UserFileChunkDraft:
    return UserFileChunkDraft(
        chunk_index=0,
        text=text,
        char_count=len(text),
        token_estimate=max(1, len(text) // 4),
        metadata={},
    )


def test_docling_source_outline_takes_precedence_over_markdown_fallback() -> None:
    document = _document(
        "# Markdown fallback\n\nThis document explains uploaded-file processing and search behavior.",
        parser_name="docling",
        metadata={"parser": "docling", "extension": ".pdf"},
        source_outline=(
            UserFileOutlineItem(level=1, title="Native title"),
            UserFileOutlineItem(level=2, title="Native section"),
        ),
    )

    overview = build_user_file_overview(filename="paper.pdf", document=document, chunks=[])

    assert overview.method == "structured"
    assert [(item.level, item.title) for item in overview.outline] == [
        (1, "Native title"),
        (2, "Native section"),
    ]
    assert overview.description.startswith("Native title. This document explains")


def test_markdown_outline_excludes_fences_normalizes_links_and_dedupes_adjacent_headings() -> None:
    document = _document(
        """# [Visible title](https://example.test)

## Repeated
## Repeated

```md
# Hidden
```

### Final\u0000 section

This document contains enough prose to describe the visible sections clearly.
""",
        parser_name="docling",
        metadata={"parser": "docling", "extension": ".md"},
    )

    overview = build_user_file_overview(filename="notes.md", document=document, chunks=[])

    assert [(item.level, item.title) for item in overview.outline] == [
        (1, "Visible title"),
        (2, "Repeated"),
        (3, "Final section"),
    ]
    assert overview.outline_truncated is False


def test_outline_limits_and_source_truncation_are_explicit() -> None:
    items = tuple(
        UserFileOutlineItem(level=20, title=f"Heading {index} " + "x" * 250)
        for index in range(MAX_OVERVIEW_OUTLINE_ITEMS + 5)
    )
    document = _document(
        "Document prose is available for a deterministic description sentence.",
        parser_name="docling",
        source_outline=items,
        source_outline_truncated=True,
    )

    overview = build_user_file_overview(filename="large.pdf", document=document, chunks=[])

    assert len(overview.outline) <= MAX_OVERVIEW_OUTLINE_ITEMS
    assert all(item.level == 6 for item in overview.outline)
    assert all(len(item.title) <= 200 for item in overview.outline)
    assert overview.outline_truncated is True


def test_short_plain_text_uses_complete_text_without_fabricating_outline() -> None:
    text = "A concise plain-text project note with no structural headings."

    overview = build_user_file_overview(filename="note.txt", document=_document(text), chunks=[])

    assert overview.method == "extractive"
    assert overview.description == text
    assert overview.outline == ()


def test_long_plain_text_samples_beginning_middle_and_end_deterministically() -> None:
    beginning = "Quartz planning describes the release dependencies and delivery milestones clearly. "
    middle = "Quartz planning identifies the integration risks and validation milestones explicitly. "
    ending = "Quartz planning records the final rollout decision and operational ownership carefully."
    text = beginning + ("padding words without punctuation " * 300) + middle
    text += "padding words without punctuation " * 300
    text += ending
    document = _document(text)

    first = build_user_file_overview(filename="long.txt", document=document, chunks=[])
    second = build_user_file_overview(filename="long.txt", document=document, chunks=[])

    assert first == second
    assert first.method == "extractive"
    assert "Quartz planning" in first.description
    assert len(first.description) <= MAX_OVERVIEW_DESCRIPTION_CHARS
    assert first.outline == ()


def test_json_object_and_array_receive_shape_aware_overviews() -> None:
    object_overview = build_user_file_overview(
        filename="object.json",
        document=_document('{"alpha": 1, "beta": 2}', parser_name="stdlib-json", metadata={"format": "json"}),
        chunks=[],
    )
    array_overview = build_user_file_overview(
        filename="array.json",
        document=_document('[{"name": "A", "value": 1}]', parser_name="stdlib-json", metadata={"format": "json"}),
        chunks=[],
    )

    assert object_overview.method == "json"
    assert [item.title for item in object_overview.outline] == ["alpha", "beta"]
    assert "2 top-level keys" in object_overview.description
    assert [(item.level, item.title) for item in array_overview.outline] == [
        (1, "Array (1 items)"),
        (2, "name"),
        (2, "value"),
    ]


def test_xml_overview_uses_root_and_unique_first_level_elements() -> None:
    overview = build_user_file_overview(
        filename="feed.xml",
        document=_document(
            '<root xmlns="urn:test"><item/><item/><meta/></root>',
            parser_name="stdlib-xml",
            metadata={"format": "xml"},
        ),
        chunks=[],
    )

    assert overview.method == "xml"
    assert [(item.level, item.title) for item in overview.outline] == [
        (1, "root"),
        (2, "item"),
        (2, "meta"),
    ]


def test_tsv_and_docling_table_only_documents_receive_table_overviews() -> None:
    tsv = build_user_file_overview(
        filename="data.tsv",
        document=_document(
            "| name | value |",
            parser_name="stdlib-tsv",
            metadata={"format": "tsv", "table_only": True},
            tables=[{"table_index": 0, "rows": [["name", "value"], ["alpha", "1"], ["beta", "2"]]}],
        ),
        chunks=[],
    )
    docling = build_user_file_overview(
        filename="tables.pdf",
        document=_document(
            "Converted table text",
            parser_name="docling",
            metadata={"parser": "docling", "extension": ".pdf", "docling": {"tables_count": 2}},
        ),
        chunks=[],
    )

    assert tsv.method == "table"
    assert [item.title for item in tsv.outline] == ["Table 1", "Columns: name, value", "Rows: 2"]
    assert "2 data rows" in tsv.description
    assert docling.method == "table"
    assert [item.title for item in docling.outline] == ["Table 1", "Table 2"]


def test_empty_document_uses_chunk_then_filename_fallback() -> None:
    chunk_overview = build_user_file_overview(
        filename="chunked.pdf",
        document=_document("", parser_name="docling"),
        chunks=[_chunk("Chunk text supplies the only available document description.")],
    )
    empty_overview = build_user_file_overview(
        filename="empty.txt",
        document=_document(""),
        chunks=[],
    )

    assert chunk_overview.description == "Chunk text supplies the only available document description."
    assert empty_overview.method == "fallback_excerpt"
    assert empty_overview.description == "Uploaded document empty.txt."


def test_overview_serialization_round_trips_strictly() -> None:
    overview = build_user_file_overview(
        filename="notes.md",
        document=_document(
            "# Notes\n\nThis document describes stable serialization behavior in detail.",
            parser_name="docling",
        ),
        chunks=[],
    )
    serialized = serialize_user_file_overview(overview)

    assert deserialize_user_file_overview(serialized) == overview


@pytest.mark.parametrize(
    "value",
    [
        None,
        {},
        {"version": 2, "description": "x", "outline": [], "method": "extractive", "outline_truncated": False},
        {
            "version": 1,
            "description": "x",
            "outline": [{"level": 0, "title": "Bad"}],
            "method": "extractive",
            "outline_truncated": False,
        },
        {
            "version": 1,
            "description": "x",
            "outline": [],
            "method": "unknown",
            "outline_truncated": False,
        },
    ],
)
def test_overview_deserialization_rejects_malformed_metadata(value: object) -> None:
    assert deserialize_user_file_overview(value) is None
