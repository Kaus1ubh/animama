from __future__ import annotations

import time
from typing import Any

import pytest

from animama.adapters.parsers.dispatch import parse_user_file
from animama.app.chat import DirectChatPromptAssembler
from animama.app.services.user_file_overview import (
    MAX_OVERVIEW_DESCRIPTION_CHARS,
    MAX_OVERVIEW_OUTLINE_ITEMS,
    build_user_file_overview,
    deserialize_user_file_overview,
    serialize_user_file_overview,
)
from animama.domain.user_file import STATUS_READY, UserFile
from animama.domain.user_file_processing import ParsedUserFileDocument, UserFileOutlineItem
from animama.product_http.chat.turn_setup import _attachment_prompt_context
from tests.user_file_fixtures import IMAGE_PAGE, pdf_bytes, pptx_bytes, simple_docx, text_page, xlsx_bytes


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


def test_source_outline_takes_precedence_over_markdown_headings() -> None:
    document = _document(
        "# Markdown fallback\n\nThis document explains uploaded-file processing and search behavior.",
        parser_name="pypdfium2",
        metadata={"format": "pdf"},
        source_outline=(
            UserFileOutlineItem(level=1, title="Native title"),
            UserFileOutlineItem(level=2, title="Native section"),
        ),
    )

    overview = build_user_file_overview(filename="paper.pdf", document=document)

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
        metadata={"format": "md"},
    )

    overview = build_user_file_overview(filename="notes.md", document=document)

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
        parser_name="pypdfium2",
        metadata={"format": "pdf"},
        source_outline=items,
        source_outline_truncated=True,
    )

    overview = build_user_file_overview(filename="large.pdf", document=document)

    assert len(overview.outline) <= MAX_OVERVIEW_OUTLINE_ITEMS
    assert all(item.level == 6 for item in overview.outline)
    assert all(len(item.title) <= 200 for item in overview.outline)
    assert overview.outline_truncated is True


def test_short_plain_text_uses_complete_text_without_fabricating_outline() -> None:
    text = "A concise plain-text project note with no structural headings."

    overview = build_user_file_overview(filename="note.txt", document=_document(text))

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

    first = build_user_file_overview(filename="long.txt", document=document)
    second = build_user_file_overview(filename="long.txt", document=document)

    assert first == second
    assert first.method == "extractive"
    assert "Quartz planning" in first.description
    assert len(first.description) <= MAX_OVERVIEW_DESCRIPTION_CHARS
    assert first.outline == ()


def test_json_object_and_array_receive_shape_aware_overviews() -> None:
    object_overview = build_user_file_overview(
        filename="object.json",
        document=_document('{"alpha": 1, "beta": 2}', parser_name="stdlib-json", metadata={"format": "json"}),
    )
    array_overview = build_user_file_overview(
        filename="array.json",
        document=_document('[{"name": "A", "value": 1}]', parser_name="stdlib-json", metadata={"format": "json"}),
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
    )

    assert overview.method == "xml"
    assert [(item.level, item.title) for item in overview.outline] == [
        (1, "root"),
        (2, "item"),
        (2, "meta"),
    ]


def test_table_only_documents_receive_table_overviews() -> None:
    tsv = build_user_file_overview(
        filename="data.tsv",
        document=parse_user_file(payload=b"name\tvalue\nalpha\t1\nbeta\t2\n", filename="data.tsv", extension=".tsv"),
    )

    assert tsv.method == "table"
    assert [item.title for item in tsv.outline] == ["Table 1", "Columns: name, value", "Rows: 2"]
    assert "2 data rows" in tsv.description


def test_overview_of_hostile_heading_lines_takes_linear_time() -> None:
    """Lines built to make a backtracking heading pattern slow keep the server responsive (spec R1.6)."""

    prose = "This report explains the budget for the coming year in plain words. " * 8
    hostile = "\n".join(
        ("# a" + " " * 20_000 + "x", "## " + "a " * 10_000 + "#", "# " + "[" * 20_000, "```" + " " * 20_000 + "x")
    )
    text = f"{prose}\n\n{hostile}\n\n{prose}"

    started = time.monotonic()
    for document in (_document(text), _document(text, metadata={"format": "md"})):
        build_user_file_overview(filename="hostile.txt", document=document)

    assert time.monotonic() - started < 1


def test_empty_document_uses_the_filename_fallback() -> None:
    empty_overview = build_user_file_overview(filename="empty.txt", document=_document(""))

    assert empty_overview.method == "fallback_excerpt"
    assert empty_overview.description == "Uploaded document empty.txt."


def test_overview_serialization_round_trips_strictly() -> None:
    overview = build_user_file_overview(
        filename="notes.md",
        document=_document(
            "# Notes\n\nThis document describes stable serialization behavior in detail.", metadata={"format": "md"}
        ),
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


# --- Overviews from every parser (spec R4.5) and skipped PDF pages (spec R2.6) ------------------------


def _deck(presentation: Any) -> None:
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    slide.shapes.title.text = "Launch Plan"
    slide.placeholders[1].text = "Ship the beta in spring with a small group of testers."


def _workbook(workbook: Any) -> None:
    workbook.active.title = "Budget"
    workbook.active.append(["Item", "Cost"])
    workbook.active.append(["Rent", 1200])


@pytest.mark.parametrize(
    ("extension", "payload", "outline"),
    [
        (".md", b"# Guide\n\n## Setup\n\nInstall the package before you start the app.", [(1, "Guide"), (2, "Setup")]),
        (
            ".html",
            b"<h1>Guide</h1><h2>Setup</h2><p>Install the package before you start the app.</p>",
            [(1, "Guide"), (2, "Setup")],
        ),
        (".docx", simple_docx("Install the package before you start the app.", heading="Setup"), [(2, "Setup")]),
        (".pptx", pptx_bytes(_deck), [(1, "Launch Plan")]),
        (".xlsx", xlsx_bytes(_workbook), [(1, "Budget")]),
    ],
)
def test_every_structured_format_gets_a_structured_overview(
    extension: str, payload: bytes, outline: list[tuple[int, str]]
) -> None:
    document = parse_user_file(payload=payload, filename=f"file{extension}", extension=extension)

    overview = build_user_file_overview(filename=f"file{extension}", document=document)

    assert overview.method == "structured"
    assert [(item.level, item.title) for item in overview.outline] == outline


def test_markdown_outlines_follow_the_format_not_the_parser_name() -> None:
    text = "# Title\n\n## Part\n\nSome descriptive prose about the parts of this particular document."

    html_document = _document(text, parser_name="stdlib-html", metadata={"format": "html"})

    html = build_user_file_overview(filename="page.html", document=html_document)
    plain = build_user_file_overview(filename="notes.txt", document=_document(text))

    assert html.method == "structured" and [item.title for item in html.outline] == ["Title", "Part"]
    # A plain-text file's "#" lines are its own text, not headings.
    assert plain.method == "extractive" and plain.outline == ()


def test_stored_docling_overviews_still_read() -> None:
    """Overviews the retired Docling worker stored still reach the Anima unchanged."""

    stored = {
        "version": 1,
        "description": "Annual Report. Revenue grew in every region.",
        "outline": [{"level": 1, "title": "Annual Report"}, {"level": 2, "title": "Results"}],
        "method": "structured",
        "outline_truncated": False,
    }

    overview = deserialize_user_file_overview(stored)

    assert overview is not None and serialize_user_file_overview(overview) == stored


def _partly_scanned_pdf() -> ParsedUserFileDocument:
    pages = (
        text_page(b"Quarterly plan for the northern region and its budget."),
        IMAGE_PAGE,
        IMAGE_PAGE,
        text_page(b"Summary of the decisions taken at the planning meeting."),
    )
    return parse_user_file(payload=pdf_bytes(*pages), filename="plan.pdf", extension=".pdf")


@pytest.mark.parametrize(
    ("skipped", "note"),
    [
        ([2, 3], "Pages 2–3 have no selectable text."),
        ([4], "Page 4 has no selectable text."),
        ([2, 3, 5, 7, 8, 9], "Pages 2–3, 5 and 7–9 have no selectable text."),
    ],
)
def test_pdf_overview_names_the_pages_without_selectable_text(skipped: list[int], note: str) -> None:
    document = _document(
        "Quarterly plan for the northern region and its budget for the coming year.",
        parser_name="pypdfium2",
        metadata={"format": "pdf", "page_count": 10, "pdf_skipped_pages": skipped},
    )

    overview = build_user_file_overview(filename="plan.pdf", document=document)

    assert overview.description.startswith(f"{note} ")
    assert "Quarterly plan for the northern region" in overview.description


def test_skipped_pages_of_a_parsed_pdf_are_named_in_its_overview() -> None:
    document = _partly_scanned_pdf()
    assert document.metadata["pdf_skipped_pages"] == [2, 3]

    overview = build_user_file_overview(filename="plan.pdf", document=document)

    assert overview.description.startswith("Pages 2–3 have no selectable text. ")


def test_skipped_page_note_stays_within_the_description_bound() -> None:
    document = _document(
        "The plan describes every region in detail. " * 40,
        parser_name="pypdfium2",
        metadata={"format": "pdf", "page_count": 2000, "pdf_skipped_pages": list(range(2, 2001, 2))},
    )

    overview = build_user_file_overview(filename="plan.pdf", document=document)

    assert len(overview.description) <= MAX_OVERVIEW_DESCRIPTION_CHARS
    assert overview.description.startswith("Pages 2, 4, 6")
    assert "more pages have no selectable text." in overview.description
    assert "The plan describes every region" in overview.description
    assert deserialize_user_file_overview(serialize_user_file_overview(overview)) == overview


@pytest.mark.parametrize("skipped", [None, [], "2", [0, -1, True, "3"]])
def test_missing_or_malformed_skipped_pages_add_no_note(skipped: object) -> None:
    metadata: dict[str, Any] = {"format": "pdf"}
    if skipped is not None:
        metadata["pdf_skipped_pages"] = skipped
    text = "Quarterly plan for the northern region and its budget for the coming year."

    overview = build_user_file_overview(
        filename="plan.pdf", document=_document(text, parser_name="pypdfium2", metadata=metadata)
    )

    assert overview.description == text


def test_skipped_pages_reach_the_anima_in_the_attached_files_prompt_section() -> None:
    overview = build_user_file_overview(filename="plan.pdf", document=_partly_scanned_pdf())
    user_file = UserFile(
        id="file-plan",
        user_id="user-1",
        storage_locator="user-files/user-1/file-plan/original",
        original_filename="plan.pdf",
        normalized_extension=".pdf",
        declared_size_bytes=1024,
        status=STATUS_READY,
        metadata={"overview": serialize_user_file_overview(overview)},
    )

    prompt = DirectChatPromptAssembler().assemble(
        user_message="What is on page 2?",
        anima_identity="Identity",
        attached_files=(_attachment_prompt_context(user_file, chunk_count=2),),
    )

    request_context = prompt.messages[-2]["content"]
    assert isinstance(request_context, str)
    assert request_context.startswith("# List of attached user-uploaded files")
    assert 'description: "Pages 2–3 have no selectable text. ' in request_context
