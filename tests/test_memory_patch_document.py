from __future__ import annotations

import pytest

from animama.app.services.memory_patch_document import (
    MemoryPatchDocumentError,
    parse_memory_patch_document,
    render_memory_patch_document,
)


@pytest.mark.parametrize(
    ("description", "expected_line"),
    [
        (None, "description: null"),
        ("", "description: null"),
        ("  ", "description: null"),
        ('People: Alice and "Bob"', 'description: "People: Alice and \\"Bob\\""'),
        ("First line\nSecond line", 'description: "First line\\nSecond line"'),
        ("First column\tSecond column", 'description: "First column\\tSecond column"'),
        (r"Notes in C:\memories", r'description: "Notes in C:\\memories"'),
        ("Résumé and 日本語", 'description: "Résumé and 日本語"'),
    ],
)
def test_memory_patch_document_round_trips_descriptions(
    description: str | None,
    expected_line: str,
) -> None:
    body = "# Memory\n\n---\n\nBody frontmatter-like separator.\n"

    rendered = render_memory_patch_document(description=description, content=body)
    parsed = parse_memory_patch_document(rendered)

    assert rendered.splitlines()[1] == expected_line
    expected_description = (description.strip() or None) if description is not None else None
    assert parsed.description == expected_description
    assert parsed.content == body


def test_memory_patch_document_preserves_empty_body() -> None:
    rendered = render_memory_patch_document(description="Empty file", content="")

    assert rendered == '---\ndescription: "Empty file"\n---\n'
    assert parse_memory_patch_document(rendered).content == ""


@pytest.mark.parametrize(
    "document",
    [
        "# Missing header",
        "description: null\n---\nBody",
        "---\ndescription: null",
        "---\ndescription: null\nextra: true\n---\nBody",
        '---\ndescription: null\ndescription: "duplicate"\n---\nBody',
        "---\ndescription: unquoted\n---\nBody",
        "---\ndescription: 42\n---\nBody",
        "---\ndescription: true\n---\nBody",
        '---\ndescription: {"nested": true}\n---\nBody',
        "---\ndescription: null\r\n---\r\nBody",
    ],
)
def test_memory_patch_document_rejects_noncanonical_headers(document: str) -> None:
    with pytest.raises(MemoryPatchDocumentError):
        parse_memory_patch_document(document)
