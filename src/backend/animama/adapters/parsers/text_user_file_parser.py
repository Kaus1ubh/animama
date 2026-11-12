"""Read plain-text uploads with the standard library: text, JSON, TSV and XML.

This module imports only the standard library, the domain types and the parser
port, so the parse child that runs it starts quickly and small.
"""

from __future__ import annotations

import csv
import json
from io import StringIO
from typing import Any
from xml.etree import ElementTree

from animama.app.ports.user_file_parser_port import UserFileParseRejectedError
from animama.domain.user_file_processing import ParsedUserFileDocument, markdown_table

LIGHTWEIGHT_EXTENSIONS = frozenset({".txt", ".rst", ".org", ".json", ".tsv", ".xml"})
"""Formats :func:`parse_lightweight_user_file` reads."""


def parse_lightweight_user_file(*, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
    """Read a plain-text format with standard-library checks.

    Raises :class:`UserFileParseRejectedError` for JSON or XML that does not parse.
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
        try:
            ElementTree.fromstring(text)
        except ElementTree.ParseError as exc:
            raise UserFileParseRejectedError("Invalid XML document") from exc
        return ParsedUserFileDocument(
            text=text.strip(),
            parser_name="stdlib-xml",
            metadata={**metadata, "format": "xml"},
        )

    if normalized_extension == ".tsv":
        rows = list(csv.reader(StringIO(text), delimiter="\t"))
        return ParsedUserFileDocument(
            text=markdown_table(rows),
            parser_name="stdlib-tsv",
            metadata={**metadata, "format": "tsv", "table_only": True, "row_count": len(rows)},
            tables=[{"table_index": 0, "rows": rows, "source": "tsv"}],
        )

    return ParsedUserFileDocument(
        text=text.strip(),
        parser_name="stdlib-text",
        metadata={**metadata, "format": normalized_extension.lstrip(".") or "text"},
    )


def _decode_text_payload(payload: bytes) -> str:
    try:
        return payload.decode("utf-8")
    except UnicodeDecodeError:
        return payload.decode("utf-8", errors="replace")


__all__ = ["LIGHTWEIGHT_EXTENSIONS", "parse_lightweight_user_file"]
