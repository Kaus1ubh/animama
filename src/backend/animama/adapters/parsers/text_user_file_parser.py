"""Read plain-text uploads: text, Markdown, JSON, CSV, TSV and XML.

Everything here uses the standard library except XML, which is checked with
defusedxml, imported only for ``.xml`` files. That keeps the parse child that
runs this module quick to start and small.
"""

from __future__ import annotations

import csv
import json
from io import StringIO
from typing import Any
from xml.etree.ElementTree import ParseError

from animama.adapters.parsers.markdown_builder import table_cell, table_summary
from animama.adapters.parsers.rejections import xml_entities
from animama.app.ports.user_file_parser_port import UserFileParseRejectedError
from animama.domain.user_file_processing import ParsedUserFileDocument, markdown_outline, markdown_table

TEXT_EXTENSIONS = frozenset({".txt", ".md", ".rst", ".org", ".json", ".csv", ".tsv", ".xml"})
"""Formats :func:`parse_text_user_file` reads."""

_TABLE_DELIMITERS = {".csv": ",", ".tsv": "\t"}


def parse_text_user_file(*, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
    """Read a plain-text format.

    Text keeps its content. Markdown also gives its ATX headings as the outline.
    JSON is reformatted, CSV and TSV become a Markdown table with one line per
    row, and XML keeps its text once it parses. Raises
    :class:`UserFileParseRejectedError` for JSON, CSV, TSV or XML that does not
    parse, and for XML that declares entities.
    """

    text = _decode_text_payload(payload)
    normalized_extension = extension.lower()
    metadata: dict[str, Any] = {
        "parser": "stdlib",
        "filename": filename,
        "extension": normalized_extension,
    }

    if normalized_extension == ".json":
        try:
            parsed = json.loads(text)
        except json.JSONDecodeError as exc:
            raise UserFileParseRejectedError(f"Invalid JSON document: {exc.msg}") from exc
        return ParsedUserFileDocument(
            text=json.dumps(parsed, indent=2, sort_keys=True, ensure_ascii=False),
            parser_name="stdlib-json",
            metadata={**metadata, "format": "json"},
        )

    if normalized_extension == ".xml":
        _check_xml(text)
        return ParsedUserFileDocument(
            text=text.strip(),
            parser_name="stdlib-xml",
            metadata={**metadata, "format": "xml"},
        )

    if normalized_extension in _TABLE_DELIMITERS:
        table_format = normalized_extension[1:]
        try:
            reader = csv.reader(StringIO(text), delimiter=_TABLE_DELIMITERS[normalized_extension])
            rows = [[_table_text(cell) for cell in row] for row in reader]
        except csv.Error as exc:
            raise UserFileParseRejectedError(f"Invalid {table_format.upper()} document: {exc}") from exc
        return ParsedUserFileDocument(
            text=markdown_table(rows),
            parser_name=f"stdlib-{table_format}",
            metadata={**metadata, "format": table_format, "table_only": True, "row_count": len(rows)},
            tables=[table_summary(rows, 0, source=table_format)] if rows else None,
        )

    stripped = text.strip()
    return ParsedUserFileDocument(
        text=stripped,
        parser_name="stdlib-text",
        metadata={**metadata, "format": normalized_extension.lstrip(".") or "text"},
        source_outline=markdown_outline(stripped) if normalized_extension == ".md" else (),
    )


def _table_text(cell: str) -> str:
    """A CSV or TSV cell as table text on one line: a line break or pipe in it would split its row."""

    if "|" in cell or "\n" in cell or "\r" in cell:
        return table_cell(cell)
    # Most cells need nothing else, and a large table has millions of them.
    return cell.strip()


def _check_xml(text: str) -> None:
    """Refuse XML that does not parse, or that declares entities or loads external content (spec R3.3).

    The text itself is kept as written; parsing only proves it is XML. With
    entity declarations refused there is nothing to expand and nothing to fetch.
    """

    from defusedxml import DefusedXmlException
    from defusedxml.ElementTree import fromstring

    try:
        fromstring(text)
    except DefusedXmlException as exc:
        raise xml_entities() from exc
    except ParseError as exc:
        raise UserFileParseRejectedError("Invalid XML document") from exc


def _decode_text_payload(payload: bytes) -> str:
    """Decode UTF-8 text without its byte-order mark, which Excel's "CSV UTF-8" and Windows editors write."""

    try:
        return payload.decode("utf-8-sig")
    except UnicodeDecodeError:
        return payload.decode("utf-8-sig", errors="replace")


__all__ = ["TEXT_EXTENSIONS", "parse_text_user_file"]
