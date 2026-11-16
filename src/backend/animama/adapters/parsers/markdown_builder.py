"""Build the Markdown text, outline and tables that every structured parser returns.

Parsers add blocks in reading order: headings, paragraphs, list items, labels
and tables. Headings are the only lines that start with ``#``: a paragraph line
that would read as a heading or open a code fence is escaped, so later steps
can trust the text's headings to be the document's.
"""

from __future__ import annotations

import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from animama.domain.user_file_processing import ParsedUserFileDocument, UserFileOutlineItem, markdown_table

MAX_HEADING_LEVEL = 6
MAX_LIST_DEPTH = 8
"""Deepest list nesting kept; deeper items stay at this depth."""
MAX_SUMMARY_HEADER_CELLS = 32
"""Header cells kept in a table's summary; an overview names only the first few."""

_WHITESPACE = re.compile(r"\s+")
# Control characters other than tab and newline never belong in extracted text.
_CONTROL_CHARACTERS = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
# Lines that would read as a heading or a code fence: exactly what
# MARKDOWN_ATX_HEADING_RE and MARKDOWN_FENCE_RE accept, in linear time.
_HEADING_LINE_START = re.compile(r"^( {0,3})(#{1,6})(?=[ \t]|$)", re.MULTILINE)
_FENCE_LINE_START = re.compile(r"^([ \t]*)(`{3}|~{3})", re.MULTILINE)


def inline_text(value: str) -> str:
    """Collapse all whitespace, including line breaks, to single spaces."""

    return _WHITESPACE.sub(" ", clean_text(value)).strip()


def clean_text(value: str) -> str:
    """Normalize line breaks, drop control characters and trailing spaces, and trim blank edge lines."""

    text = _CONTROL_CHARACTERS.sub("", value.replace("\r\n", "\n").replace("\r", "\n"))
    return "\n".join(line.rstrip() for line in text.split("\n")).strip("\n")


def escape_line_starts(text: str) -> str:
    """Escape each line that would otherwise read as a Markdown heading or code fence."""

    return _FENCE_LINE_START.sub(r"\1\\\2", _HEADING_LINE_START.sub(r"\1\\\2", text))


def table_cell(value: str) -> str:
    """One table cell on one line, with its pipes escaped so they do not split the row."""

    return inline_text(value).replace("|", "\\|")


def table_summary(rows: Sequence[Sequence[str]], table_index: int, **details: Any) -> dict[str, Any]:
    """Describe a table without repeating its cells, which the Markdown text already holds.

    ``header`` is the first row's cells (at most :data:`MAX_SUMMARY_HEADER_CELLS`)
    and ``data_row_count`` counts the rows below it. Chunking reads the rows
    from the text; the summary only feeds the file's overview.
    """

    return {
        "table_index": table_index,
        "header": list(rows[0][:MAX_SUMMARY_HEADER_CELLS]) if rows else [],
        "data_row_count": max(0, len(rows) - 1),
        **details,
    }


def trim_table(rows: Sequence[Sequence[str]]) -> tuple[list[list[str]], int, int]:
    """Drop fully empty rows and columns at the table's edges; empty rows and columns inside stay.

    Returns the trimmed rows, padded to one width, with the zero-based indexes
    of the first kept row and column.
    """

    filled = [index for index, row in enumerate(rows) if any(cell for cell in row)]
    if not filled:
        return [], 0, 0
    first_row, last_row = filled[0], filled[-1]
    kept = rows[first_row : last_row + 1]
    used_columns = [index for row in kept for index, cell in enumerate(row) if cell]
    first_column, last_column = min(used_columns), max(used_columns)
    width = last_column - first_column + 1
    trimmed = [list(row[first_column : last_column + 1]) for row in kept]
    return [row + [""] * (width - len(row)) for row in trimmed], first_row, first_column


@dataclass(frozen=True, slots=True)
class _Block:
    text: str
    # Set for list items: their nesting depth and whether they are numbered.
    depth: int | None = None
    ordered: bool = False


class MarkdownBuilder:
    """Collect a document's blocks in reading order and render them as Markdown.

    ``has_content`` turns true once a block holds the document's own text.
    Headings a parser makes up, such as a slide number, do not count, so a
    parser can tell a document with nothing to search.
    """

    def __init__(self) -> None:
        self._blocks: list[_Block] = []
        self._outline: list[UserFileOutlineItem] = []
        self._tables: list[dict[str, Any]] = []
        self.has_content = False

    @property
    def tables(self) -> list[dict[str, Any]]:
        """Summaries of the tables added so far (see :func:`table_summary`), with the details given to :meth:`table`."""

        return self._tables

    def heading(self, level: int, title: str, *, content: bool = True) -> None:
        """Add a heading and its outline entry; ``content=False`` marks a heading the parser made up."""

        text = inline_text(title)
        if not text:
            return
        level = min(max(level, 1), MAX_HEADING_LEVEL)
        self._blocks.append(_Block(f"{'#' * level} {text}"))
        self._outline.append(UserFileOutlineItem(level=level, title=text))
        self.has_content = self.has_content or content

    def paragraph(self, text: str) -> None:
        """Add a paragraph; its line breaks stay."""

        cleaned = clean_text(text)
        if cleaned.strip():
            self._blocks.append(_Block(escape_line_starts(cleaned)))
            self.has_content = True

    def list_item(self, text: str, *, depth: int = 0, number: int | None = None) -> None:
        """Add a bulleted item, or a numbered one when ``number`` is given, nested ``depth`` levels deep."""

        item = inline_text(text)
        if not item:
            return
        depth = min(max(depth, 0), MAX_LIST_DEPTH)
        marker = "-" if number is None else f"{number}."
        self._blocks.append(_Block(f"{'  ' * depth}{marker} {item}", depth=depth, ordered=number is not None))
        self.has_content = True

    def label(self, text: str) -> None:
        """Add a bold label line, such as the one before a slide's notes; it is not document text."""

        label = inline_text(text)
        if label:
            self._blocks.append(_Block(f"**{label}**"))

    def table(self, rows: Sequence[Sequence[str]], **details: Any) -> None:
        """Add a Markdown table whose first row is the header; ``rows`` are already :func:`table_cell` text.

        The table is also summarized in :attr:`tables` with its index and ``details``.
        """

        if not rows or not any(cell for row in rows for cell in row):
            return
        self._blocks.append(_Block(markdown_table(rows)))
        self._tables.append(table_summary(rows, len(self._tables), **details))
        self.has_content = True

    def text(self) -> str:
        """Render the blocks: items of one list share lines, other blocks are separated by a blank line."""

        parts: list[str] = []
        previous: _Block | None = None
        # Whether the current list's top-level items are numbered.
        list_ordered = False
        for block in self._blocks:
            if block.depth is not None:
                continues_list = previous is not None and previous.depth is not None
                if continues_list and (block.depth > 0 or block.ordered == list_ordered):
                    parts.append("\n")
                elif parts:
                    parts.append("\n\n")
                if block.depth == 0 or not continues_list:
                    list_ordered = block.ordered
            elif parts:
                parts.append("\n\n")
            parts.append(block.text)
            previous = block
        return "".join(parts)

    def document(self, *, parser_name: str, metadata: dict[str, Any]) -> ParsedUserFileDocument:
        """Return the parsed document with this builder's text, outline and tables."""

        return ParsedUserFileDocument(
            text=self.text(),
            parser_name=parser_name,
            metadata=metadata,
            tables=self._tables or None,
            source_outline=tuple(self._outline),
        )


__all__ = [
    "MAX_HEADING_LEVEL",
    "MAX_LIST_DEPTH",
    "MAX_SUMMARY_HEADER_CELLS",
    "MarkdownBuilder",
    "clean_text",
    "escape_line_starts",
    "inline_text",
    "table_cell",
    "table_summary",
    "trim_table",
]
