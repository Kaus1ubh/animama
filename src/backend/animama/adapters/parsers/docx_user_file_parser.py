"""Read DOCX uploads with python-docx (spec R2.3).

The body is read in document order: paragraphs, tables, and the paragraphs and
tables inside content controls. The Title style becomes a level-1 heading and
"Heading N" level N + 1, so a titled document keeps its hierarchy; a style
based on a heading style counts as that heading. Numbered and bulleted
paragraphs become list items and tables become Markdown tables. Tracked
insertions read as text and tracked deletions do not. Headers, footers,
footnotes, comments, text boxes, images and embedded objects are not read, and
nothing in the document runs.
"""

from __future__ import annotations

import re
from collections.abc import Iterator
from typing import TYPE_CHECKING, Any

from animama.adapters.parsers.markdown_builder import MAX_LIST_DEPTH, MarkdownBuilder, table_cell, trim_table
from animama.adapters.parsers.office_package import open_office_package, refuse_unreadable_package
from animama.domain.user_file_processing import ParsedUserFileDocument

if TYPE_CHECKING:
    from docx.document import Document

_W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
_PARAGRAPH = f"{_W}p"
_TABLE = f"{_W}tbl"
_ROW = f"{_W}tr"
_CELL = f"{_W}tc"
_RUN = f"{_W}r"
# Containers whose children read as if they stood in the container's place.
_TRANSPARENT_CONTAINERS = frozenset({f"{_W}sdt", f"{_W}sdtContent", f"{_W}customXml"})
# A run inside one of these is not part of the paragraph's visible text.
_HIDDEN_RUN_CONTAINERS = frozenset({f"{_W}del", f"{_W}moveFrom", f"{_W}txbxContent", _PARAGRAPH})

_HEADING_STYLE = re.compile(r"heading\s*([1-9])")
_LIST_STYLE = re.compile(r"list (bullet|number)(?: ([2-9]))?")
# Table-of-contents entries repeat the headings with page numbers.
_TABLE_OF_CONTENTS_STYLE = re.compile(r"toc(?: heading|\s*[1-9])")
_MAX_STYLE_CHAIN = 16
# Word's limit; a larger span or offset is malformed.
_MAX_TABLE_COLUMNS = 63


def parse_docx_user_file(*, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
    """Read a Word document's body into Markdown with its headings as the outline."""

    stream = open_office_package(payload, extension)
    import docx
    from docx.opc.exceptions import PackageNotFoundError

    try:
        document = docx.Document(stream)
    except Exception as exc:
        # python-docx raises ValueError for a package whose main part is not a Word document.
        refuse_unreadable_package(exc, extension, wrong_kind=(ValueError, PackageNotFoundError))
    reader = _DocxReader(document)
    reader.read(document.element.body)
    return reader.builder.document(
        parser_name="python-docx",
        metadata={
            "parser": "python-docx",
            "filename": filename,
            "extension": extension,
            "format": "docx",
            "table_count": len(reader.builder.tables),
        },
    )


class _DocxReader:
    """Walk a document body, keeping list numbering state across paragraphs."""

    def __init__(self, document: Document) -> None:
        from docx.text.paragraph import Paragraph

        self._document = document
        self._paragraph_class = Paragraph
        self.builder = MarkdownBuilder()
        self._ordered_levels: dict[tuple[int, int], bool | None] = {}
        self._counters: dict[int, list[int]] = {}

    def read(self, container: Any) -> None:
        for block in _blocks(container):
            if block.tag == _PARAGRAPH:
                self._paragraph(block)
            else:
                rows, _first_row, _first_column = trim_table(
                    [[table_cell(text) for text in _row_texts(row)] for row in _rows(block)]
                )
                self.builder.table(rows, source="docx")

    def _paragraph(self, element: Any) -> None:
        styles = _style_chain(self._paragraph_class(element, self._document).style)
        style_names = [(style.name or "").strip().lower() for style in styles]
        if any(_TABLE_OF_CONTENTS_STYLE.fullmatch(name) for name in style_names):
            return
        text = _paragraph_text(element)
        level = _heading_level(style_names)
        if level is not None:
            self.builder.heading(level, text)
            return
        item = self._list_item(element, styles, style_names)
        if item is None:
            self.builder.paragraph(text)
        else:
            depth, number = item
            self.builder.list_item(text, depth=depth, number=number)

    def _list_item(self, element: Any, styles: list[Any], style_names: list[str]) -> tuple[int, int | None] | None:
        """A list paragraph's depth and number (``None`` for a bullet); ``None`` for any other paragraph.

        Numbering on the paragraph or its styles decides, with the level's number
        format telling bullets from counted items. Word's "List Bullet 2" and
        "List Number 3" styles give the depth their name states.
        """

        style_list = next((match for name in style_names if (match := _LIST_STYLE.fullmatch(name))), None)
        style_depth = int(style_list.group(2)) - 1 if style_list is not None and style_list.group(2) else 0
        style_ordered = style_list is not None and style_list.group(1) == "number"
        numbering = _numbering(element, styles)
        if numbering is None:
            if style_list is None:
                return None
            return style_depth, self._next_number(-1, style_depth) if style_ordered else None
        num_id, level = numbering
        ordered = self._is_ordered(num_id, level)
        if ordered is None:
            ordered = style_ordered
        depth = min(level or style_depth, MAX_LIST_DEPTH)
        return depth, self._next_number(num_id, level) if ordered else None

    def _is_ordered(self, num_id: int, level: int) -> bool | None:
        """Whether a numbering level counts (``True``) or bullets (``False``); ``None`` when undefined."""

        key = (num_id, level)
        if key not in self._ordered_levels:
            self._ordered_levels[key] = _numbering_is_ordered(self._document, num_id, level)
        return self._ordered_levels[key]

    def _next_number(self, num_id: int, level: int) -> int:
        """Count an item of list ``num_id`` at ``level``; an item restarts the levels below it."""

        counters = self._counters.setdefault(num_id, [])
        counters.extend([0] * (level + 1 - len(counters)))
        counters[level] += 1
        del counters[level + 1 :]
        return counters[level]


def _blocks(container: Any) -> Iterator[Any]:
    """Paragraphs and tables of a body or cell in order, looking through content controls."""

    for child in container.iterchildren():
        if child.tag in (_PARAGRAPH, _TABLE):
            yield child
        elif child.tag in _TRANSPARENT_CONTAINERS:
            yield from _blocks(child)


def _rows(table: Any) -> Iterator[Any]:
    for child in table.iterchildren():
        if child.tag == _ROW:
            yield child
        elif child.tag in _TRANSPARENT_CONTAINERS:
            yield from _rows(child)


def _cells(row: Any) -> Iterator[Any]:
    for child in row.iterchildren():
        if child.tag == _CELL:
            yield child
        elif child.tag in _TRANSPARENT_CONTAINERS:
            yield from _cells(child)


def _row_texts(row: Any) -> list[str]:
    """A row's cell texts in grid order: a cell spanning columns is followed by empty ones."""

    texts = [""] * _grid_count(row, "grid_before", default=0)
    for cell in _cells(row):
        texts.append(_cell_text(cell))
        texts.extend([""] * (_grid_count(cell, "grid_span", default=1) - 1))
    return texts


def _grid_count(element: Any, name: str, *, default: int) -> int:
    """A row's skipped columns or a cell's span, bounded by Word's column limit."""

    try:
        value = getattr(element, name, default)
    except (TypeError, ValueError):
        return default
    return min(max(value, default), _MAX_TABLE_COLUMNS) if isinstance(value, int) else default


def _cell_text(cell: Any) -> str:
    """A cell's paragraphs, and any nested table's cells, as one run of text."""

    parts: list[str] = []
    for block in _blocks(cell):
        if block.tag == _PARAGRAPH:
            parts.append(_paragraph_text(block))
        else:
            parts.extend(text for row in _rows(block) for text in _row_texts(row))
    return " ".join(parts)


def _paragraph_text(paragraph: Any) -> str:
    """The paragraph's visible text, including hyperlinks, fields, content controls and tracked insertions."""

    return "".join(run.text for run in paragraph.iter(_RUN) if _is_visible_run(run, paragraph))


def _is_visible_run(run: Any, paragraph: Any) -> bool:
    parent = run.getparent()
    while parent is not None and parent is not paragraph:
        if parent.tag in _HIDDEN_RUN_CONTAINERS:
            return False
        parent = parent.getparent()
    return parent is paragraph


def _style_chain(style: Any) -> list[Any]:
    """A style and the styles it is based on, nearest first."""

    chain: list[Any] = []
    while style is not None and len(chain) < _MAX_STYLE_CHAIN and all(style != seen for seen in chain):
        chain.append(style)
        style = style.base_style
    return chain


def _heading_level(style_names: list[str]) -> int | None:
    for name in style_names:
        if name == "title":
            return 1
        match = _HEADING_STYLE.fullmatch(name)
        if match is not None:
            return int(match.group(1)) + 1
    return None


def _numbering(paragraph: Any, styles: list[Any]) -> tuple[int, int] | None:
    """The paragraph's list (``numId``) and level (``ilvl``), from the paragraph or its styles.

    ``numId`` 0 removes numbering a style would add; malformed numbering reads as none.
    """

    num_id: int | None = None
    level: int | None = None
    try:
        for properties in [paragraph.pPr, *(style.element.pPr for style in styles)]:
            numbering = properties.numPr if properties is not None else None
            if numbering is None:
                continue
            if num_id is None and numbering.numId is not None:
                num_id = numbering.numId.val
            if level is None and numbering.ilvl is not None:
                level = numbering.ilvl.val
    except (TypeError, ValueError):
        return None
    if not num_id:
        return None
    return num_id, min(max(level or 0, 0), MAX_LIST_DEPTH)


def _numbering_is_ordered(document: Document, num_id: int, level: int) -> bool | None:
    """Look up the level's number format: a bullet, a counted format, or ``None`` when undefined.

    A missing or malformed definition is undefined: the format only decides
    between a bullet and a number, so it never fails the document.
    """

    from docx.oxml.exceptions import InvalidXmlError

    try:
        numbering = document.part.numbering_part.element
        abstract_id = numbering.num_having_numId(num_id).abstractNumId.val
    except (InvalidXmlError, KeyError, NotImplementedError, ValueError):
        return None
    formats = numbering.xpath(
        f'./w:abstractNum[@w:abstractNumId="{int(abstract_id)}"]/w:lvl[@w:ilvl="{int(level)}"]/w:numFmt/@w:val'
    )
    if not formats:
        return None
    return str(formats[0]) not in ("bullet", "none")


__all__ = ["parse_docx_user_file"]
