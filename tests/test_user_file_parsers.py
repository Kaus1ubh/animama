"""Every accepted upload format is read into Markdown with its headings (spec R2.1 to R2.8, R3.2 to R3.5).

Fixtures are built at test time (see :mod:`tests.user_file_fixtures`): the Office
libraries write Office files, PDFs are small hand-written byte strings, pypdf
encrypts one, and the hostile files are generated here.
"""

from __future__ import annotations

import datetime
import struct
import sys
import time
import tracemalloc
import zipfile
import zlib
from collections.abc import Callable
from io import BytesIO
from pathlib import Path
from typing import Any

import pytest

from animama.adapters.parsers import office_package
from animama.adapters.parsers.dispatch import SUPPORTED_EXTENSIONS, parse_user_file
from animama.adapters.parsers.markdown_builder import escape_line_starts
from animama.adapters.parsers.rejections import (
    ENCRYPTED_DOCUMENT_REASON,
    NO_PDF_TEXT_REASON,
    UNSUPPORTED_FORMAT_REASON,
    XML_ENTITIES_REASON,
    damaged_document_reason,
    extension_mismatch_reason,
)
from animama.app.ports.user_file_parser_port import UserFileParseRejectedError
from animama.app.services.user_file_service import ALLOWED_USER_FILE_EXTENSIONS
from animama.domain.user_file_processing import (
    NO_SEARCHABLE_TEXT_ERROR,
    ParsedUserFileDocument,
    UserFileOutlineItem,
    markdown_outline,
)
from tests.user_file_fixtures import (
    IMAGE_PAGE,
    W_NAMESPACE,
    docx_bytes,
    pdf_bytes,
    pptx_bytes,
    replace_part,
    rewrite_zip,
    text_page,
    xlsx_bytes,
    zip_bytes,
)

CFB_SIGNATURE = bytes.fromhex("D0CF11E0A1B11AE1")
BILLION_LAUGHS_DTD = (
    '<!DOCTYPE lolz [<!ENTITY lol "lol">'
    + "".join(f'<!ENTITY lol{i} "{("&lol;" if i == 1 else f"&lol{i - 1};") * 10}">' for i in range(1, 10))
    + "]>"
)


def _parse(payload: bytes, extension: str, filename: str | None = None) -> ParsedUserFileDocument:
    return parse_user_file(payload=payload, filename=filename or f"upload{extension}", extension=extension)


def _rejection(payload: bytes, extension: str) -> UserFileParseRejectedError:
    with pytest.raises(UserFileParseRejectedError) as rejected:
        _parse(payload, extension)
    return rejected.value


def _outline(*items: tuple[int, str]) -> tuple[UserFileOutlineItem, ...]:
    return tuple(UserFileOutlineItem(level=level, title=title) for level, title in items)


def _encrypted_pdf(*, user_password: str) -> bytes:
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter(clone_from=PdfReader(BytesIO(pdf_bytes(text_page(b"Confidential figures.")))))
    writer.encrypt(user_password=user_password, owner_password="owner-secret")
    output = BytesIO()
    writer.write(output)
    return output.getvalue()


# --- Dispatch -----------------------------------------------------------------------------------


def test_every_accepted_upload_extension_has_a_parser() -> None:
    assert SUPPORTED_EXTENSIONS == ALLOWED_USER_FILE_EXTENSIONS


def test_an_extension_outside_the_accepted_list_is_refused() -> None:
    rejected = _rejection(b"MZ\x90\x00", ".exe")

    assert rejected.reason == UNSUPPORTED_FORMAT_REASON == "This file type is not supported."


def test_the_extension_selects_the_parser_whatever_its_case() -> None:
    assert _parse(b"Plain words.", ".TXT").text == "Plain words."


# --- Plain text ---------------------------------------------------------------------------------


@pytest.mark.parametrize("extension", [".txt", ".rst", ".org"])
def test_plain_text_keeps_its_text(extension: str) -> None:
    parsed = _parse(b"\nTitle line\n\n* item one\n#+TITLE: kept as written\n", extension, "notes" + extension)

    assert parsed.text == "Title line\n\n* item one\n#+TITLE: kept as written"
    assert parsed.parser_name == "stdlib-text"
    assert parsed.metadata == {
        "parser": "stdlib",
        "filename": "notes" + extension,
        "extension": extension,
        "format": extension[1:],
    }
    assert parsed.source_outline == ()


def test_markdown_keeps_its_text_and_its_atx_headings_give_the_outline() -> None:
    markdown = (
        "# Guide\n\nIntro text.\n\n## Setup ##\n\n```bash\n# a shell comment, not a heading\n```\n\n"
        "~~~\n## also code\n~~~\n\n   ### Usage\n\n#not-a-heading\n"
    )

    parsed = _parse(markdown.encode(), ".md", "guide.md")

    assert parsed.text == markdown.strip()
    assert parsed.metadata["format"] == "md"
    assert parsed.source_outline == _outline((1, "Guide"), (2, "Setup"), (3, "Usage"))


def test_csv_becomes_a_markdown_table_like_tsv() -> None:
    csv_rows = b'name,notes\nalpha,"one, two"\nbeta,"line\none | two"\n'
    tsv_rows = b"name\tnotes\nalpha\tone, two\n"

    parsed = _parse(csv_rows, ".csv", "data.csv")
    tsv = _parse(tsv_rows, ".tsv", "data.tsv")

    assert parsed.parser_name == "stdlib-csv"
    assert parsed.metadata == {
        "parser": "stdlib",
        "filename": "data.csv",
        "extension": ".csv",
        "format": "csv",
        "table_only": True,
        "row_count": 3,
    }
    # A table summary, not the cells again: the text already holds them.
    assert parsed.tables == [{"table_index": 0, "header": ["name", "notes"], "data_row_count": 2, "source": "csv"}]
    # Each row is one line of the table, so a cell's line breaks and pipes cannot split it.
    assert parsed.text == "| name | notes |\n| --- | --- |\n| alpha | one, two |\n| beta | line one \\| two |"
    # TSV keeps its existing output; CSV takes the same path.
    assert tsv.text == "| name | notes |\n| --- | --- |\n| alpha | one, two |"
    assert tsv.metadata["table_only"] is True and tsv.parser_name == "stdlib-tsv"


def test_json_keeps_its_validated_output() -> None:
    parsed = _parse('{"b": 2, "a": ["é"]}'.encode(), ".json")

    assert parsed.text == '{\n  "a": [\n    "é"\n  ],\n  "b": 2\n}'
    assert parsed.parser_name == "stdlib-json"
    assert _rejection(b"{not json", ".json").reason.startswith("Invalid JSON document: ")


def test_xml_keeps_its_text() -> None:
    payload = b'<?xml version="1.0"?>\n<!DOCTYPE note>\n<note><to>Ana</to><body>Hi &amp; bye</body></note>\n'

    parsed = _parse(payload, ".xml", "note.xml")

    assert parsed.text == payload.decode().strip()
    assert (parsed.parser_name, parsed.metadata["format"]) == ("stdlib-xml", "xml")
    assert _rejection(b"<note><to>Ana</note>", ".xml").reason == "Invalid XML document"


def test_xml_that_declares_entities_is_refused_without_expanding_them(tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP-SECRET-MARKER")
    billion_laughs = f"<?xml version='1.0'?>{BILLION_LAUGHS_DTD}<lolz>&lol9;</lolz>".encode()
    external = f'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY xxe SYSTEM "{secret.as_uri()}">]><x>&xxe;</x>'.encode()

    started = time.monotonic()
    for payload in (billion_laughs, external):
        rejected = _rejection(payload, ".xml")
        assert rejected.reason == XML_ENTITIES_REASON
        assert "TOP-SECRET-MARKER" not in rejected.reason
    assert time.monotonic() - started < 5


# --- HTML ---------------------------------------------------------------------------------------

HTML_PAGE = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Trip notes</title>
<style>body { color: red }</style><script>var hidden = "<p>script text</p>";</script></head>
<body>
<noscript>Enable JavaScript</noscript>
<template><p>Template text</p></template>
<h1>Kyoto   trip</h1>
<p>We visit <a href="https://example.com/inari">Fushimi Inari</a> &amp; temples.<br>Bring cash.</p>
<h2>Packing</h2>
<ul>
  <li>Shoes<ul><li>Walking shoes</li></ul></li>
  <li>Umbrella
</ul>
<ol start="3"><li>Book hotel</li><li><p>Buy pass</p></li></ol>
<table>
  <thead><tr><th>Day</th><th>Plan</th></tr></thead>
  <tbody><tr><td>1</td><td>Gion | Pontocho<br>evening</td></tr>
  <tr><td>2</td><td><table><tr><td>Nara</td><td>deer</td></tr></table></td></tr></tbody>
</table>
<div><svg><title>icon</title><text>svg text</text></svg>Have fun!</div>
<pre>
# not a heading
  indented line
</pre>
</body></html>
"""


def test_html_keeps_headings_paragraphs_lists_tables_and_link_text_in_order() -> None:
    parsed = _parse(HTML_PAGE.encode(), ".html", "trip.html")

    assert parsed.text == (
        "# Kyoto trip\n\n"
        "We visit Fushimi Inari & temples.\nBring cash.\n\n"
        "## Packing\n\n"
        "- Shoes\n  - Walking shoes\n- Umbrella\n\n"
        "3. Book hotel\n4. Buy pass\n\n"
        "| Day | Plan |\n| --- | --- |\n| 1 | Gion \\| Pontocho evening |\n| 2 | Nara deer |\n\n"
        "Have fun!\n\n"
        "\\# not a heading\n  indented line"
    )
    assert parsed.source_outline == _outline((1, "Kyoto trip"), (2, "Packing"))
    assert parsed.parser_name == "stdlib-html"
    assert parsed.metadata["format"] == "html"
    assert parsed.metadata["title"] == "Trip notes"
    assert parsed.tables == [{"table_index": 0, "header": ["Day", "Plan"], "data_row_count": 2, "source": "html"}]
    for dropped in ("script text", "color: red", "Enable JavaScript", "Template text", "svg text", "example.com"):
        assert dropped not in parsed.text


@pytest.mark.parametrize(
    ("payload", "text", "encoding"),
    [
        (b'<meta charset="windows-1252"><p>\x93Quoted\x94 caf\xe9</p>', "“Quoted” café", "cp1252"),
        # Latin-1 labels mean Windows-1252 in browsers.
        (
            b'<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-1"><p>\x93Hi\x94</p>',
            "“Hi”",
            "cp1252",
        ),
        # Shift_JIS pages may use Windows-31J characters, such as a circled digit.
        (b'<meta charset="Shift_JIS"><p>\x87\x40\x93\xfa\x96\x7b</p>', "①日本", "cp932"),
        (b"\xef\xbb\xbf<p>caf\xc3\xa9</p>", "café", "utf-8"),
        (b"<p>caf\xe9 au lait</p>", "caf� au lait", "utf-8"),
        (b'<meta charset="no-such-codec"><p>caf\xc3\xa9</p>', "café", "utf-8"),
        # Python codecs that are not text encodings, or that refuse every input.
        (b'<meta charset="base64"><p>caf\xc3\xa9</p>', "café", "utf-8"),
        (b'<meta charset="zlib"><p>caf\xc3\xa9</p>', "café", "utf-8"),
        (b'<meta charset="hex"><p>caf\xc3\xa9</p>', "café", "utf-8"),
        (b'<meta charset="rot13"><p>caf\xc3\xa9</p>', "café", "utf-8"),
        (b'<meta charset="undefined"><p>caf\xc3\xa9</p>', "café", "utf-8"),
    ],
)
def test_html_is_decoded_with_its_declared_charset_or_utf8(payload: bytes, text: str, encoding: str) -> None:
    parsed = _parse(payload, ".htm")

    assert parsed.text == text
    assert parsed.metadata["encoding"] == encoding


# --- DOCX ---------------------------------------------------------------------------------------


def _report_docx(document: Any) -> None:
    document.add_paragraph("Quarterly Report", style="Title")
    document.add_heading("Results", level=1)
    document.add_paragraph("Revenue grew in every region.")
    document.add_paragraph("# a paragraph that only looks like a heading")
    document.add_paragraph("North", style="List Bullet")
    document.add_paragraph("Pacific coast", style="List Bullet 2")
    document.add_paragraph("South", style="List Bullet")
    document.add_paragraph("Plan", style="List Number")
    document.add_paragraph("Build", style="List Number")
    document.add_heading("Costs", level=2)
    table = document.add_table(rows=2, cols=2)
    for (row, column), value in {(0, 0): "Item", (0, 1): "Cost", (1, 0): "Rent | office", (1, 1): "1200"}.items():
        table.cell(row, column).text = value
    document.add_paragraph("Closing remark.")


def test_docx_reads_headings_paragraphs_lists_and_tables_in_document_order() -> None:
    parsed = _parse(docx_bytes(_report_docx), ".docx", "report.docx")

    assert parsed.text == (
        "# Quarterly Report\n\n"
        "## Results\n\n"
        "Revenue grew in every region.\n\n"
        "\\# a paragraph that only looks like a heading\n\n"
        "- North\n  - Pacific coast\n- South\n\n"
        "1. Plan\n2. Build\n\n"
        "### Costs\n\n"
        "| Item | Cost |\n| --- | --- |\n| Rent \\| office | 1200 |\n\n"
        "Closing remark."
    )
    assert parsed.source_outline == _outline((1, "Quarterly Report"), (2, "Results"), (3, "Costs"))
    assert parsed.parser_name == "python-docx"
    assert parsed.metadata == {
        "parser": "python-docx",
        "filename": "report.docx",
        "extension": ".docx",
        "format": "docx",
        "table_count": 1,
    }
    assert parsed.tables == [{"table_index": 0, "header": ["Item", "Cost"], "data_row_count": 1, "source": "docx"}]


def test_docx_reads_tracked_insertions_and_content_controls_but_not_deletions() -> None:
    from docx.oxml.parser import parse_xml

    def build(document: Any) -> None:
        paragraph = document.add_paragraph("Kept ")
        paragraph._p.append(
            parse_xml(
                f'<w:ins xmlns:w="{W_NAMESPACE}" w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z">'
                "<w:r><w:t>inserted</w:t></w:r></w:ins>"
            )
        )
        paragraph._p.append(
            parse_xml(
                f'<w:del xmlns:w="{W_NAMESPACE}" w:id="2" w:author="A" w:date="2026-01-01T00:00:00Z">'
                "<w:r><w:tab/><w:delText>deleted</w:delText></w:r></w:del>"
            )
        )
        document.element.body.insert(
            0,
            parse_xml(
                f'<w:sdt xmlns:w="{W_NAMESPACE}"><w:sdtContent><w:p><w:r><w:t>Inside a content control</w:t>'
                "</w:r></w:p></w:sdtContent></w:sdt>"
            ),
        )

    parsed = _parse(docx_bytes(build), ".docx")

    assert parsed.text == "Inside a content control\n\nKept inserted"


def test_docx_without_text_gives_an_empty_document() -> None:
    parsed = _parse(docx_bytes(lambda document: document.add_paragraph("")), ".docx")

    assert parsed.text == ""


# --- PPTX ---------------------------------------------------------------------------------------


def _launch_pptx(presentation: Any) -> None:
    from pptx.util import Inches

    opening = presentation.slides.add_slide(presentation.slide_layouts[0])
    opening.shapes.title.text = "Launch Plan"
    opening.placeholders[1].text_frame.text = "Spring 2026"
    opening.notes_slide.notes_text_frame.text = "Welcome everyone."

    milestones = presentation.slides.add_slide(presentation.slide_layouts[1])
    milestones.shapes.title.text = "Milestones"
    body = milestones.placeholders[1].text_frame
    body.text = "Design"
    nested = body.add_paragraph()
    nested.text = "Prototype"
    nested.level = 1
    table = milestones.shapes.add_table(2, 2, Inches(1), Inches(4), Inches(4), Inches(1)).table
    for (row, column), value in {(0, 0): "Phase", (0, 1): "Owner", (1, 0): "Build", (1, 1): "Ana"}.items():
        table.cell(row, column).text = value
    milestones.notes_slide.notes_text_frame.text = "Mention the budget.\nKeep it short."

    closing = presentation.slides.add_slide(presentation.slide_layouts[6])
    closing.shapes.add_textbox(Inches(1), Inches(1), Inches(3), Inches(1)).text_frame.text = "Questions?"
    group = closing.shapes.add_group_shape()
    group.shapes.add_textbox(Inches(1), Inches(3), Inches(3), Inches(1)).text_frame.text = "Grouped contact"


def test_pptx_reads_slides_in_order_with_titles_text_tables_and_notes() -> None:
    parsed = _parse(pptx_bytes(_launch_pptx), ".pptx", "launch.pptx")

    assert parsed.text == (
        "# Launch Plan\n\n"
        "Spring 2026\n\n"
        "**Notes**\n\nWelcome everyone.\n\n"
        "# Milestones\n\n"
        "- Design\n  - Prototype\n\n"
        "| Phase | Owner |\n| --- | --- |\n| Build | Ana |\n\n"
        "**Notes**\n\nMention the budget.\n\nKeep it short.\n\n"
        "# Slide 3\n\n"
        "Questions?\n\n"
        "Grouped contact"
    )
    assert parsed.source_outline == _outline((1, "Launch Plan"), (1, "Milestones"), (1, "Slide 3"))
    assert parsed.parser_name == "python-pptx"
    assert parsed.metadata == {
        "parser": "python-pptx",
        "filename": "launch.pptx",
        "extension": ".pptx",
        "format": "pptx",
        "slide_count": 3,
        "table_count": 1,
    }
    assert parsed.tables == [
        {"table_index": 0, "header": ["Phase", "Owner"], "data_row_count": 1, "source": "pptx", "slide": 2}
    ]


def test_pptx_whose_slides_hold_no_text_is_refused() -> None:
    def build(presentation: Any) -> None:
        presentation.slides.add_slide(presentation.slide_layouts[6])

    assert _rejection(pptx_bytes(build), ".pptx").reason == NO_SEARCHABLE_TEXT_ERROR


# --- XLSX ---------------------------------------------------------------------------------------


def _budget_xlsx() -> bytes:
    from openpyxl.styles import Font

    def build(workbook: Any) -> None:
        budget = workbook.active
        budget.title = "Budget"
        budget.append(["Item", "Cost", "When"])
        budget.append(["Rent", 1200, datetime.date(2026, 1, 5)])
        budget.append(["Food", "=B2/4", datetime.datetime(2026, 1, 5, 9, 30)])
        budget.append(["Ratio", 0.1 + 0.2, True])
        # A styled empty cell far away: stored, but only empty rows and columns lead to it.
        budget["F10"].font = Font(bold=True)
        notes = workbook.create_sheet("Notes")
        notes["B3"] = "Remember | the deposit"
        workbook.create_sheet("Blank")

    def cache_formula_result(name: str, data: bytes) -> bytes:
        # openpyxl writes no cached formula values; Excel would store the result beside the formula.
        if name == "xl/worksheets/sheet1.xml":
            return data.replace(b"<f>B2/4</f><v></v>", b"<f>B2/4</f><v>300</v>")
        return data

    return rewrite_zip(xlsx_bytes(build), cache_formula_result)


def test_xlsx_reads_each_sheet_as_a_table_of_saved_values() -> None:
    parsed = _parse(_budget_xlsx(), ".xlsx", "budget.xlsx")

    assert parsed.text == (
        "# Budget\n\n"
        "| Item | Cost | When |\n| --- | --- | --- |\n| Rent | 1200 | 2026-01-05 |\n"
        "| Food | 300 | 2026-01-05 09:30:00 |\n| Ratio | 0.3 | TRUE |\n\n"
        "# Notes\n\n"
        "| Remember \\| the deposit |\n| --- |\n\n"
        "# Blank"
    )
    assert "B2/4" not in parsed.text
    assert parsed.source_outline == _outline((1, "Budget"), (1, "Notes"), (1, "Blank"))
    assert parsed.parser_name == "openpyxl"
    assert parsed.metadata == {
        "parser": "openpyxl",
        "filename": "budget.xlsx",
        "extension": ".xlsx",
        "format": "xlsx",
        "table_only": True,
        "sheet_count": 3,
        "sheets": ["Budget", "Notes", "Blank"],
        "table_count": 2,
    }
    assert parsed.tables == [
        {
            "table_index": 0,
            "header": ["Item", "Cost", "When"],
            "data_row_count": 3,
            "source": "xlsx",
            "sheet": "Budget",
            "first_row": 1,
            "first_column": 1,
        },
        {
            "table_index": 1,
            "header": ["Remember \\| the deposit"],
            "data_row_count": 0,
            "source": "xlsx",
            "sheet": "Notes",
            "first_row": 3,
            "first_column": 2,
        },
    ]


def test_xlsx_without_cell_values_is_refused() -> None:
    def build(workbook: Any) -> None:
        workbook.active.title = "Empty"

    assert _rejection(xlsx_bytes(build), ".xlsx").reason == NO_SEARCHABLE_TEXT_ERROR


# --- PDF ----------------------------------------------------------------------------------------


def test_pdf_reads_each_page_text_layer_in_stored_order_with_page_ranges() -> None:
    payload = pdf_bytes(text_page(b"Alpha page one.", b"Second line #2."), text_page(b"Gamma page two."))

    parsed = _parse(payload, ".pdf", "paper.pdf")

    assert parsed.text == "Alpha page one.\nSecond line #2.\n\nGamma page two."
    assert parsed.parser_name == "pypdfium2"
    assert parsed.metadata == {
        "parser": "pypdfium2",
        "filename": "paper.pdf",
        "extension": ".pdf",
        "format": "pdf",
        "page_count": 2,
        "pdf_pages": [{"page": 1, "start": 0, "end": 31}, {"page": 2, "start": 33, "end": 48}],
        "pdf_skipped_pages": [],
    }
    pages = {entry["page"]: parsed.text[entry["start"] : entry["end"]] for entry in parsed.metadata["pdf_pages"]}
    assert pages == {1: "Alpha page one.\nSecond line #2.", 2: "Gamma page two."}
    assert parsed.source_outline == ()


def test_partly_scanned_pdf_keeps_the_readable_pages_and_records_the_skipped_ones() -> None:
    payload = pdf_bytes(text_page(b"# Typed cover"), IMAGE_PAGE, text_page(b"Typed summary."), IMAGE_PAGE)

    parsed = _parse(payload, ".pdf")

    # A line that only looks like a heading stays text: PDFs have no reliable headings.
    assert parsed.text == "\\# Typed cover\n\nTyped summary."
    assert parsed.metadata["page_count"] == 4
    assert parsed.metadata["pdf_skipped_pages"] == [2, 4]
    assert [entry["page"] for entry in parsed.metadata["pdf_pages"]] == [1, 3]
    third = parsed.metadata["pdf_pages"][1]
    assert parsed.text[third["start"] : third["end"]] == "Typed summary."


def test_pdf_without_selectable_text_is_refused_as_possibly_scanned() -> None:
    rejected = _rejection(pdf_bytes(IMAGE_PAGE, IMAGE_PAGE), ".pdf")

    assert rejected.reason == NO_PDF_TEXT_REASON == "This PDF has no selectable text; it may be scanned."


def test_password_protected_pdf_is_refused() -> None:
    rejected = _rejection(_encrypted_pdf(user_password="open-sesame"), ".pdf")

    assert rejected.reason == ENCRYPTED_DOCUMENT_REASON == "Encrypted or password-protected documents are not supported"


def test_pdf_restricted_only_by_an_owner_password_opens_without_one_and_is_read() -> None:
    parsed = _parse(_encrypted_pdf(user_password=""), ".pdf")

    assert parsed.text == "Confidential figures."


def test_pdf_bookmarks_give_the_outline() -> None:
    from pypdf import PdfReader, PdfWriter

    writer = PdfWriter(clone_from=PdfReader(BytesIO(pdf_bytes(text_page(b"One."), text_page(b"Two.")))))
    introduction = writer.add_outline_item("Introduction", 0)
    writer.add_outline_item("Background", 0, parent=introduction)
    writer.add_outline_item("Results", 1)
    output = BytesIO()
    writer.write(output)

    parsed = _parse(output.getvalue(), ".pdf")

    assert parsed.source_outline == _outline((1, "Introduction"), (2, "Background"), (1, "Results"))


# --- Content that does not match its extension ---------------------------------------------------


@pytest.mark.parametrize(
    ("extension", "payload"),
    [
        (".pdf", b"Just some text, not a PDF."),
        (".pdf", b"PK\x03\x04 a ZIP package"),
        (".docx", b"Just some text, not a package."),
        (".pptx", b"%PDF-1.4 not a package"),
        (".xlsx", b"<html>not a package</html>"),
    ],
)
def test_content_without_the_expected_header_is_refused(extension: str, payload: bytes) -> None:
    rejected = _rejection(payload, extension)

    assert rejected.reason == extension_mismatch_reason(extension)
    assert rejected.reason == f"The file does not match its {extension} extension."


@pytest.mark.parametrize(
    ("extension", "build"),
    [
        (".docx", lambda: pptx_bytes(_launch_pptx)),
        (".docx", lambda: zip_bytes({"readme.txt": b"An ordinary ZIP archive."})),
        (".pptx", lambda: docx_bytes(_report_docx)),
        (".xlsx", lambda: docx_bytes(_report_docx)),
        (".xlsx", lambda: zip_bytes({"readme.txt": b"An ordinary ZIP archive."})),
    ],
)
def test_another_package_under_an_office_extension_is_refused(extension: str, build: Callable[[], bytes]) -> None:
    assert _rejection(build(), extension).reason == extension_mismatch_reason(extension)


def test_macro_enabled_document_renamed_docx_is_refused() -> None:
    main = b"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
    macro_enabled = b"application/vnd.ms-word.document.macroEnabled.main+xml"
    docm = rewrite_zip(
        docx_bytes(_report_docx),
        lambda name, data: data.replace(main, macro_enabled) if name == "[Content_Types].xml" else data,
    )

    assert _rejection(docm, ".docx").reason == extension_mismatch_reason(".docx")


@pytest.mark.parametrize(
    ("extension", "payload"),
    [
        (".docx", lambda: docx_bytes(_report_docx)[:2000]),
        (".xlsx", lambda: b"PK\x03\x04 truncated"),
        (".pdf", lambda: b"%PDF-1.7\n1 0 obj << /Type /Catalog"),
        (".docx", lambda: replace_part(docx_bytes(_report_docx), "word/document.xml", b"<w:document><unclosed>")),
        # openpyxl wraps a sheet's XML error in a ValueError of its own.
        (".xlsx", lambda: replace_part(_budget_xlsx(), "xl/worksheets/sheet1.xml", b"<worksheet><unclosed>")),
    ],
)
def test_damaged_documents_are_refused(extension: str, payload: Callable[[], bytes]) -> None:
    rejected = _rejection(payload(), extension)

    assert rejected.reason == damaged_document_reason(extension)
    assert rejected.reason == f"The {extension} file is damaged or incomplete."


def _compound_file(*stream_names: str) -> bytes:
    """A minimal OLE compound file: the header sector, then a directory of the named streams."""

    def entry(name: str) -> bytes:
        encoded = name.encode("utf-16-le") + b"\x00\x00"
        return encoded.ljust(64, b"\x00") + struct.pack("<H", len(encoded)) + bytes(62)

    return CFB_SIGNATURE + bytes(504) + b"".join(entry(name) for name in ("Root Entry", *stream_names))


@pytest.mark.parametrize("extension", [".docx", ".pptx", ".xlsx"])
def test_encrypted_office_documents_are_refused(extension: str) -> None:
    # Office stores an encrypted OOXML package as an EncryptedPackage stream in an OLE compound file.
    rejected = _rejection(_compound_file("EncryptionInfo", "EncryptedPackage"), extension)

    assert rejected.reason == ENCRYPTED_DOCUMENT_REASON


@pytest.mark.parametrize(
    ("extension", "stream"), [(".docx", "WordDocument"), (".xlsx", "Workbook"), (".pptx", "PowerPoint Document")]
)
def test_legacy_binary_office_documents_under_an_xml_extension_are_refused(extension: str, stream: str) -> None:
    """A .doc, .xls or .ppt renamed to the XML format's extension is another kind of file, not an encrypted one."""

    rejected = _rejection(_compound_file(stream, "SummaryInformation"), extension)

    assert rejected.reason == extension_mismatch_reason(extension)


def test_package_with_encrypted_zip_entries_is_refused() -> None:
    package = bytearray(zip_bytes({"word/document.xml": b"ciphertext"}))
    # zipfile cannot write encrypted entries; set the "encrypted" flag in the central directory.
    central_header = package.rfind(b"PK\x01\x02")
    package[central_header + 8] |= 0x1

    assert _rejection(bytes(package), ".docx").reason == ENCRYPTED_DOCUMENT_REASON


# --- Bounds on untrusted packages and XML (R3.2, R3.3, R3.5) -------------------------------------


@pytest.mark.parametrize("extension", [".docx", ".pptx", ".xlsx"])
def test_zip_bomb_is_refused_before_any_office_library_unpacks_it(extension: str) -> None:
    bomb = zip_bytes({"[Content_Types].xml": b"<Types/>", "bomb.xml": bytes(64 * 1024 * 1024)})
    assert len(bomb) < 1024 * 1024

    started = time.monotonic()
    rejected = _rejection(bomb, extension)

    assert rejected.reason == (
        f"The document contains a part that expands more than {office_package.MAX_PART_COMPRESSION_RATIO} times"
        " when unpacked."
    )
    assert time.monotonic() - started < 2


def test_package_that_expands_past_the_total_limit_is_refused() -> None:
    # Each part stays at the 1 MiB ratio threshold, so only the total applies.
    part = bytes(office_package.COMPRESSION_RATIO_MIN_BYTES)
    count = office_package.MAX_PACKAGE_UNCOMPRESSED_BYTES // len(part) + 1
    package = zip_bytes({f"part{index}.xml": part for index in range(count)})

    rejected = _rejection(package, ".docx")

    assert rejected.reason == "The document expands to more than 256 MB when unpacked."


def test_package_with_too_many_parts_is_refused() -> None:
    package = zip_bytes({f"part{index}.xml": b"" for index in range(office_package.MAX_PACKAGE_ENTRIES + 1)})

    assert _rejection(package, ".pptx").reason == "The document has more than 10,000 parts."


def test_package_bounds_are_the_planned_constants() -> None:
    assert office_package.MAX_PACKAGE_ENTRIES == 10_000
    assert office_package.MAX_PACKAGE_UNCOMPRESSED_BYTES == 256 * 1024 * 1024
    assert office_package.MAX_PART_COMPRESSION_RATIO == 100
    assert office_package.COMPRESSION_RATIO_MIN_BYTES == 1024 * 1024


@pytest.mark.parametrize(
    ("extension", "build", "part", "template"),
    [
        (
            ".docx",
            lambda: docx_bytes(_report_docx),
            "word/document.xml",
            f'<w:document xmlns:w="{W_NAMESPACE}"><w:body><w:p><w:r><w:t>&lol9;</w:t></w:r></w:p></w:body>'
            "</w:document>",
        ),
        (
            ".pptx",
            lambda: pptx_bytes(_launch_pptx),
            "ppt/slides/slide1.xml",
            '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">&lol9;</p:sld>',
        ),
        (
            ".xlsx",
            _budget_xlsx,
            "xl/worksheets/sheet1.xml",
            '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData><row r="1">'
            '<c r="A1" t="inlineStr"><is><t>&lol9;</t></is></c></row></sheetData></worksheet>',
        ),
    ],
)
def test_billion_laughs_part_in_an_office_document_is_refused_without_expanding(
    extension: str, build: Callable[[], bytes], part: str, template: str
) -> None:
    hostile = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>{BILLION_LAUGHS_DTD}{template}'.encode()
    payload = replace_part(build(), part, hostile)

    started = time.monotonic()
    rejected = _rejection(payload, extension)

    assert rejected.reason == XML_ENTITIES_REASON
    assert time.monotonic() - started < 5


@pytest.mark.parametrize("extension", [".docx", ".pptx"])
def test_office_xml_never_loads_external_entities(extension: str, tmp_path: Path) -> None:
    secret = tmp_path / "secret.txt"
    secret.write_text("TOP-SECRET-MARKER")
    dtd = f'<!DOCTYPE x [<!ENTITY xxe SYSTEM "{secret.as_uri()}">]>'
    if extension == ".docx":
        part = "word/document.xml"
        xml = (
            f'<w:document xmlns:w="{W_NAMESPACE}"><w:body><w:p><w:r><w:t>Visible &xxe; text</w:t></w:r></w:p>'
            "</w:body></w:document>"
        )
        package = docx_bytes(_report_docx)
    else:
        part = "ppt/notesSlides/notesSlide1.xml"
        package = pptx_bytes(_launch_pptx)
        original = zipfile.ZipFile(BytesIO(package)).read(part).decode()
        xml = original.replace("Welcome everyone.", "Visible &xxe; text")
        xml = xml[xml.index("<p:notes") :]
    payload = replace_part(package, part, f'<?xml version="1.0" encoding="UTF-8"?>{dtd}{xml}'.encode())

    try:
        parsed = _parse(payload, extension)
    except UserFileParseRejectedError as rejected:
        assert "TOP-SECRET-MARKER" not in rejected.reason
    else:
        assert "Visible" in parsed.text
        assert "TOP-SECRET-MARKER" not in parsed.text


def test_office_libraries_parse_xml_without_resolving_entities() -> None:
    """python-docx and python-pptx parse with ``resolve_entities=False``; openpyxl reads sheets through defusedxml."""

    import defusedxml.ElementTree
    import openpyxl.xml
    import openpyxl.xml.functions
    from docx.oxml.parser import parse_xml as parse_docx_xml
    from pptx.oxml import parse_xml as parse_pptx_xml

    internal = b'<!DOCTYPE x [<!ENTITY greeting "EXPANDED">]><x>&greeting;</x>'
    for parse_xml in (parse_docx_xml, parse_pptx_xml):
        element = parse_xml(internal)
        assert "EXPANDED" not in "".join(element.itertext())

    assert openpyxl.xml.DEFUSEDXML is True
    assert openpyxl.xml.functions.iterparse is defusedxml.ElementTree.iterparse


def _lying_package(*, actual_bytes: int, declared_bytes: int = 1_000) -> bytes:
    """A package whose first part records ``declared_bytes`` (with a matching CRC) but inflates to ``actual_bytes``."""

    entry = zipfile.ZipInfo("[Content_Types].xml")
    entry.compress_type = zipfile.ZIP_DEFLATED
    output = BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        with archive.open(entry, "w") as writer:
            for _ in range(actual_bytes // (1024 * 1024)):
                writer.write(bytes(1024 * 1024))
        archive.writestr("word/document.xml", b"<x/>")
    package = bytearray(output.getvalue())
    crc = zlib.crc32(bytes(declared_bytes))
    # The local header keeps the CRC at 14 and the size at 22; the central directory at 16 and 24.
    for signature, crc_at, size_at in ((b"PK\x03\x04", 14, 22), (b"PK\x01\x02", 16, 24)):
        header = package.find(signature)
        struct.pack_into("<I", package, header + crc_at, crc)
        struct.pack_into("<I", package, header + size_at, declared_bytes)
    return bytes(package)


@pytest.mark.parametrize("extension", [".docx", ".pptx", ".xlsx"])
def test_part_that_inflates_past_its_recorded_size_is_refused_in_bounded_memory(extension: str) -> None:
    """zipfile would inflate such a part whole before trimming it; the guard inflates in small chunks first."""

    payload = _lying_package(actual_bytes=64 * 1024 * 1024)

    tracemalloc.start()
    try:
        rejected = _rejection(payload, extension)
        _current, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert rejected.reason == "The document contains a part that unpacks to more than its recorded size."
    assert rejected.error_type == "PackageSizeMismatch"
    assert peak < 2 * 1024 * 1024


def test_guard_inflates_honest_parts_and_accepts_them() -> None:
    package = _lying_package(actual_bytes=1024 * 1024, declared_bytes=1024 * 1024)
    archive = zipfile.ZipFile(BytesIO(package))

    stream = office_package.open_office_package(package, ".docx")

    assert stream.read() == package
    assert [entry.file_size for entry in archive.infolist()] == [1024 * 1024, 4]


@pytest.mark.parametrize("method", [zipfile.ZIP_BZIP2, zipfile.ZIP_LZMA])
def test_package_compressed_with_a_method_office_never_uses_is_refused(method: int) -> None:
    entry = zipfile.ZipInfo("[Content_Types].xml")
    entry.compress_type = method
    output = BytesIO()
    with zipfile.ZipFile(output, "w") as archive:
        archive.writestr(entry, b"<Types/>")

    rejected = _rejection(output.getvalue(), ".docx")

    assert rejected.reason == "The document uses a ZIP compression method that Office files do not use."
    assert rejected.error_type == "UnsupportedCompression"


def test_part_whose_compressed_data_is_corrupt_is_refused_as_damaged() -> None:
    package = bytearray(zip_bytes({"[Content_Types].xml": b"<Types>" + b"<Default/>" * 500 + b"</Types>"}))
    entry = zipfile.ZipFile(BytesIO(bytes(package))).infolist()[0]
    name_length, extra_length = struct.unpack_from("<HH", package, entry.header_offset + 26)
    start = entry.header_offset + 30 + name_length + extra_length
    # Deflate block type 3 does not exist.
    package[start : start + entry.compress_size] = b"\xff" * entry.compress_size

    assert _rejection(bytes(package), ".docx").reason == damaged_document_reason(".docx")


# --- Headings in Markdown text (R3.1: no input makes heading detection slow) ----------------------


HOSTILE_HEADING_LINES = (
    "# a" + " " * 20_000 + "x",
    "#" * 20_000,
    " " * 20_000 + "#",
    "# " + "#" * 20_000 + " x",
    "## " + "a " * 10_000 + "#",
    "```" + " " * 20_000 + "x",
)


def test_heading_detection_takes_linear_time_on_hostile_lines() -> None:
    text = "\n".join(HOSTILE_HEADING_LINES)

    started = time.monotonic()
    markdown_outline(text)
    escape_line_starts(text)
    _parse(text.encode(), ".md")
    _parse(text.encode(), ".txt")

    assert time.monotonic() - started < 1


def test_only_ascii_spaces_and_tabs_make_a_heading() -> None:
    text = (
        "\u3000# Ideographic indent\n\xa0# No-break indent\n#\u3000Ideographic gap\n#\xa0No-break gap\n"
        "#\tTabbed\n   # Indented\n    # Code\n## Setup ##\n# C#\n### ###\n#"
    )

    assert markdown_outline(text) == _outline((1, "Tabbed"), (1, "Indented"), (2, "Setup"), (1, "C#"))
    # Exactly the lines read as headings are escaped in extracted text.
    assert escape_line_starts(text) == (
        "\u3000# Ideographic indent\n\xa0# No-break indent\n#\u3000Ideographic gap\n#\xa0No-break gap\n"
        "\\#\tTabbed\n   \\# Indented\n    # Code\n\\## Setup ##\n\\# C#\n\\### ###\n\\#"
    )


# --- Encodings and installations -------------------------------------------------------------------


def test_text_formats_drop_a_utf8_byte_order_mark() -> None:
    """Excel's "CSV UTF-8" export, and Windows editors, start the file with U+FEFF."""

    assert _parse(b"\xef\xbb\xbfname,value\nalpha,1\n", ".csv").tables == [
        {"table_index": 0, "header": ["name", "value"], "data_row_count": 1, "source": "csv"}
    ]
    assert _parse(b'\xef\xbb\xbf{"a": 1}', ".json").text == '{\n  "a": 1\n}'
    assert _parse(b'\xef\xbb\xbf<?xml version="1.0"?><a/>', ".xml").text == '<?xml version="1.0"?><a/>'
    assert _parse(b"\xef\xbb\xbf# Notes", ".md").source_outline == _outline((1, "Notes"))


@pytest.mark.parametrize(
    ("extension", "module", "build"),
    [
        (".docx", "docx", lambda: docx_bytes(_report_docx)),
        (".pptx", "pptx", lambda: pptx_bytes(_launch_pptx)),
        (".xlsx", "openpyxl", _budget_xlsx),
        (".pdf", "pypdfium2", lambda: pdf_bytes(text_page(b"Text."))),
        (".xml", "defusedxml", lambda: b"<root/>"),
    ],
)
def test_a_missing_documents_extra_is_refused_with_a_clear_reason(
    extension: str, module: str, build: Callable[[], bytes], monkeypatch: pytest.MonkeyPatch
) -> None:
    payload = build()
    # Importing a module whose sys.modules entry is None raises ModuleNotFoundError, as if it were not installed.
    monkeypatch.setitem(sys.modules, module, None)

    rejected = _rejection(payload, extension)

    assert rejected.reason == f"This installation cannot read {extension} files: the documents extra is not installed."
    assert rejected.error_type == "DocumentsExtraMissing"
