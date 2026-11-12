"""Read XLSX uploads with openpyxl (spec R2.5).

Each worksheet, in workbook order, becomes a level-1 heading with its name and
a Markdown table of its cell values: the values last saved with the workbook,
never formulas. Fully empty rows and columns at a sheet's edges are trimmed.
The document is table-only, and each sheet's table is kept in ``tables`` with
its sheet name and its first row and column, so chunking can work per sheet.

The workbook is opened read-only with saved values only, without external
links or macros; openpyxl reads sheet XML through defusedxml.
"""

from __future__ import annotations

import datetime
from collections.abc import Iterator
from typing import Any

from animama.adapters.parsers.markdown_builder import MarkdownBuilder, table_cell, trim_table
from animama.adapters.parsers.office_package import (
    PACKAGE_DAMAGED_ERRORS,
    open_office_package,
    refuse_unreadable_package,
)
from animama.adapters.parsers.rejections import damaged_document, rejected, xml_entities
from animama.domain.user_file_processing import NO_SEARCHABLE_TEXT_ERROR, ParsedUserFileDocument

# Excel shows numbers with at most 15 significant digits.
_NUMBER_FORMAT = ".15g"


def parse_xlsx_user_file(*, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
    """Read every worksheet into a heading and a table; a workbook without values is refused."""

    stream = open_office_package(payload, extension)
    import openpyxl
    from defusedxml import DefusedXmlException
    from openpyxl.utils.exceptions import InvalidFileException

    try:
        workbook = openpyxl.load_workbook(stream, read_only=True, data_only=True, keep_links=False)
    except Exception as exc:
        # openpyxl reports a package without a workbook part as an OSError, and
        # wraps any error met while reading the workbook in a ValueError.
        refuse_unreadable_package(
            exc,
            extension,
            wrong_kind=(InvalidFileException, OSError),
            damaged=(ValueError,),
            entity_errors=(DefusedXmlException,),
        )
    builder = MarkdownBuilder()
    sheets: list[str] = []
    try:
        for sheet in workbook.worksheets:
            sheets.append(sheet.title)
            # The sheet name is a heading, but not text to search on its own.
            builder.heading(1, sheet.title, content=False)
            rows, first_row, first_column = trim_table(list(_sheet_rows(sheet)))
            builder.table(
                rows, source="xlsx", sheet=sheet.title, first_row=first_row + 1, first_column=first_column + 1
            )
    except DefusedXmlException as exc:
        raise xml_entities() from exc
    except PACKAGE_DAMAGED_ERRORS as exc:
        # Sheets are unpacked and parsed only now, while their rows are read.
        raise damaged_document(extension) from exc
    finally:
        workbook.close()
    if not builder.has_content:
        raise rejected(NO_SEARCHABLE_TEXT_ERROR, "NoSearchableText")
    return builder.document(
        parser_name="openpyxl",
        metadata={
            "parser": "openpyxl",
            "filename": filename,
            "extension": extension,
            "format": "xlsx",
            "table_only": True,
            "sheet_count": len(sheets),
            "sheets": sheets,
            "table_count": len(builder.tables),
        },
    )


def _sheet_rows(sheet: Any) -> Iterator[list[str]]:
    """The sheet's rows as stored, each as cell text without its trailing empty cells."""

    # Stored dimensions can be wrong, or huge for one stray cell; read the rows that exist instead.
    sheet.reset_dimensions()
    for values in sheet.iter_rows(values_only=True):
        row = [table_cell(cell_text(value)) for value in values]
        while row and not row[-1]:
            row.pop()
        yield row


def cell_text(value: object) -> str:
    """A saved cell value as Excel would show it in its general format."""

    if value is None:
        return ""
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, float):
        return format(value, _NUMBER_FORMAT)
    if isinstance(value, datetime.datetime):
        if value.time() == datetime.time():
            return value.date().isoformat()
        return value.isoformat(sep=" ", timespec="seconds")
    if isinstance(value, datetime.date | datetime.time):
        return value.isoformat()
    return str(value)


__all__ = ["cell_text", "parse_xlsx_user_file"]
