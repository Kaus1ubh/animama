"""Read HTML uploads with the standard library's HTML parser (spec R2.2).

Headings, paragraphs, lists, tables and link text are kept in document order.
Scripts, styles, ``noscript``, templates, inline SVG and all markup are
dropped; link targets and images are not kept. Nothing on the page is fetched
or run.
"""

from __future__ import annotations

import codecs
import re
from dataclasses import dataclass
from html.parser import HTMLParser
from typing import Any

from animama.adapters.parsers.markdown_builder import MarkdownBuilder, inline_text, table_cell, trim_table
from animama.domain.user_file_processing import ParsedUserFileDocument

_SKIPPED_ELEMENTS = frozenset({"script", "style", "noscript", "template", "svg"})
_HEADING_LEVELS = {f"h{level}": level for level in range(1, 7)}
# Elements that end the text before them and start a new block.
_BLOCK_ELEMENTS = frozenset(
    {
        "address",
        "article",
        "aside",
        "blockquote",
        "body",
        "center",
        "dd",
        "details",
        "dialog",
        "div",
        "dl",
        "dt",
        "fieldset",
        "figcaption",
        "figure",
        "footer",
        "form",
        "header",
        "hr",
        "html",
        "main",
        "nav",
        "p",
        "section",
        "summary",
    }
)
_CELL_ELEMENTS = frozenset({"td", "th"})
# Whitespace HTML collapses; a no-break space is content, but reads as a plain space.
_HTML_WHITESPACE = re.compile(r"[ \t\n\r\f]+")
# A charset declared in a <meta> tag, in either of its two forms.
_META_CHARSET = re.compile(rb"""<meta[^>]+charset\s*=\s*["']?\s*([A-Za-z0-9._:-]+)""", re.IGNORECASE)
_CHARSET_SCAN_BYTES = 4096
_BYTE_ORDER_MARKS = (
    (codecs.BOM_UTF8, "utf-8"),
    (codecs.BOM_UTF16_LE, "utf-16-le"),
    (codecs.BOM_UTF16_BE, "utf-16-be"),
)
# Browsers decode these labels with a superset encoding (the WHATWG Encoding
# Standard): Latin-1 and ASCII pages as Windows-1252, whose 0x80-0x9F bytes are
# punctuation, and legacy CJK labels with the Windows code pages that extend them.
_BROWSER_SUPERSETS = {
    "ascii": "cp1252",
    "iso8859-1": "cp1252",
    "iso8859-9": "cp1254",
    "shift_jis": "cp932",
    "euc_kr": "cp949",
    "gb2312": "gbk",
    "big5": "big5hkscs",
}


def parse_html_user_file(*, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
    """Read an HTML page into Markdown; headings ``h1``-``h6`` become the outline."""

    text, encoding = decode_html(payload)
    reader = _HtmlReader()
    reader.feed(text)
    reader.close()
    metadata: dict[str, Any] = {
        "parser": "stdlib",
        "filename": filename,
        "extension": extension,
        "format": "html",
        "encoding": encoding,
    }
    title = inline_text("".join(reader.title_parts))
    if title:
        metadata["title"] = title
    return reader.builder.document(parser_name="stdlib-html", metadata=metadata)


def decode_html(payload: bytes) -> tuple[str, str]:
    """Decode a page by its byte-order mark, else its ``<meta>`` charset, else UTF-8.

    Bytes the encoding cannot decode become replacement characters, and a
    charset that names no usable text encoding falls back to UTF-8. Returns the
    text and the name of the encoding used.
    """

    for mark, encoding in _BYTE_ORDER_MARKS:
        if payload.startswith(mark):
            return payload[len(mark) :].decode(encoding, errors="replace"), encoding
    declared = _META_CHARSET.search(payload[:_CHARSET_SCAN_BYTES])
    declared_encoding = _declared_encoding(declared.group(1).decode("ascii")) if declared is not None else None
    if declared_encoding is not None:
        try:
            return payload.decode(declared_encoding, errors="replace"), declared_encoding
        except (LookupError, UnicodeError):
            # Python codecs that are not text encodings (base64, zlib, rot13) or refuse all input (undefined).
            pass
    return payload.decode("utf-8", errors="replace"), "utf-8"


def _declared_encoding(label: str) -> str | None:
    try:
        name = codecs.lookup(label).name
    except LookupError:
        return None
    name = _BROWSER_SUPERSETS.get(name, name)
    # A declaration read as ASCII cannot describe a UTF-16 or UTF-32 page.
    if name.startswith(("utf-16", "utf-32")):
        return None
    return name


@dataclass(slots=True)
class _List:
    ordered: bool
    count: int


class _HtmlReader(HTMLParser):
    """Turn parser events into Markdown blocks.

    Inline text collects into lines (``<br>`` starts a new one) until a block
    element ends the block. Only the outermost table makes rows: a nested
    table's cells add their text to the outer cell.
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.builder = MarkdownBuilder()
        self.title_parts: list[str] = []
        self._skipped_depth = 0
        self._in_title = False
        self._lines: list[list[str]] = [[]]
        self._heading_level: int | None = None
        self._in_list_item = False
        self._preformatted_depth = 0
        self._lists: list[_List] = []
        self._table_depth = 0
        self._rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in _SKIPPED_ELEMENTS:
            self._skipped_depth += 1
        if self._skipped_depth:
            return
        if tag == "title":
            self._in_title = True
        elif self._table_depth:
            self._table_start(tag)
        elif tag == "table":
            self._flush()
            self._table_depth = 1
        elif tag in _HEADING_LEVELS:
            self._flush()
            self._heading_level = _HEADING_LEVELS[tag]
        elif tag in ("ul", "ol"):
            self._flush()
            self._lists.append(_List(ordered=tag == "ol", count=_list_start(attrs) - 1))
        elif tag == "li":
            self._flush()
            self._in_list_item = True
        elif tag == "br":
            self._lines.append([])
        elif tag == "pre":
            self._flush()
            self._preformatted_depth += 1
        elif tag in _BLOCK_ELEMENTS:
            self._flush()

    def handle_endtag(self, tag: str) -> None:
        if self._skipped_depth:
            if tag in _SKIPPED_ELEMENTS:
                self._skipped_depth -= 1
            return
        if tag == "title":
            self._in_title = False
        elif self._table_depth:
            self._table_end(tag)
        elif tag in _HEADING_LEVELS or tag in _BLOCK_ELEMENTS:
            self._flush()
        elif tag == "li":
            self._flush()
            self._in_list_item = False
        elif tag in ("ul", "ol"):
            self._flush()
            self._in_list_item = False
            if self._lists:
                self._lists.pop()
        elif tag == "pre":
            self._flush()
            self._preformatted_depth = max(0, self._preformatted_depth - 1)

    def handle_data(self, data: str) -> None:
        if self._skipped_depth:
            return
        if self._in_title:
            self.title_parts.append(data)
        elif self._table_depth:
            if self._cell is not None:
                self._cell.append(data)
        elif self._preformatted_depth:
            # Preformatted text keeps its own line breaks and spacing.
            *first, last = data.split("\n")
            for line in first:
                self._lines[-1].append(line)
                self._lines.append([])
            self._lines[-1].append(last)
        else:
            self._lines[-1].append(data)

    def close(self) -> None:
        super().close()
        if self._table_depth:
            self._table_depth = 0
            self._end_table()
        self._flush()

    def _flush(self) -> None:
        """End the current block: emit the collected text as a heading, list item or paragraph."""

        lines = ["".join(parts).replace("\xa0", " ") for parts in self._lines]
        self._lines = [[]]
        if self._preformatted_depth:
            text = "\n".join(lines)
        else:
            collapsed = (_HTML_WHITESPACE.sub(" ", line).strip() for line in lines)
            text = "\n".join(line for line in collapsed if line)
        if not text.strip():
            # An empty heading ends; a list item waits for its text, as in <li><p>text</p></li>.
            self._heading_level = None
            return
        if self._heading_level is not None:
            self.builder.heading(self._heading_level, text)
            self._heading_level = None
        elif self._in_list_item:
            current = self._lists[-1] if self._lists else _List(ordered=False, count=0)
            current.count += 1
            self.builder.list_item(
                text, depth=max(len(self._lists) - 1, 0), number=current.count if current.ordered else None
            )
            self._in_list_item = False
        else:
            self.builder.paragraph(text)

    def _table_start(self, tag: str) -> None:
        if tag == "table":
            self._table_depth += 1
            self._cell_break()
        elif self._table_depth == 1 and tag == "tr":
            self._end_row()
            self._row = []
        elif self._table_depth == 1 and tag in _CELL_ELEMENTS:
            self._end_cell()
            if self._row is None:
                self._row = []
            self._cell = []
        else:
            # Inside a cell, block boundaries (and a nested table's cells) separate words.
            self._cell_break()

    def _table_end(self, tag: str) -> None:
        if tag == "table":
            self._table_depth -= 1
            if self._table_depth == 0:
                self._end_table()
            else:
                self._cell_break()
        elif self._table_depth == 1 and tag in _CELL_ELEMENTS:
            self._end_cell()
        elif self._table_depth == 1 and tag == "tr":
            self._end_row()
        else:
            self._cell_break()

    def _cell_break(self) -> None:
        if self._cell is not None:
            self._cell.append(" ")

    def _end_cell(self) -> None:
        if self._cell is not None and self._row is not None:
            self._row.append(table_cell("".join(self._cell).replace("\xa0", " ")))
        self._cell = None

    def _end_row(self) -> None:
        self._end_cell()
        if self._row is not None:
            self._rows.append(self._row)
        self._row = None

    def _end_table(self) -> None:
        self._end_row()
        rows, _first_row, _first_column = trim_table(self._rows)
        self._rows = []
        self.builder.table(rows, source="html")


def _list_start(attrs: list[tuple[str, str | None]]) -> int:
    """The number of an ordered list's first item (its ``start`` attribute), else 1."""

    for name, value in attrs:
        if name == "start" and value is not None and value.strip().lstrip("-").isdigit():
            return int(value.strip())
    return 1


__all__ = ["decode_html", "parse_html_user_file"]
