"""Read PPTX uploads with python-pptx (spec R2.4).

Slides are read in order. Each slide becomes a level-1 heading with its title,
or "Slide N" when it has none, followed by its text frames and tables in shape
order (group shapes included) and its speaker notes under a "Notes" label.
Paragraphs of body and content placeholders, which hold a slide's bullet
points, become list items. Date, footer and slide-number placeholders, charts,
pictures, media and embedded objects are not read, and nothing runs.
"""

from __future__ import annotations

from typing import Any

from animama.adapters.parsers.markdown_builder import MarkdownBuilder, inline_text, table_cell, trim_table
from animama.adapters.parsers.office_package import open_office_package, refuse_unreadable_package
from animama.adapters.parsers.rejections import rejected
from animama.domain.user_file_processing import NO_SEARCHABLE_TEXT_ERROR, ParsedUserFileDocument

# python-pptx reports a line break inside a paragraph as a vertical tab.
_LINE_BREAK = "\v"


def parse_pptx_user_file(*, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
    """Read a presentation's slides into Markdown; slide headings form the outline.

    A presentation without any text is refused: its headings would only be the
    made-up slide numbers.
    """

    stream = open_office_package(payload, extension)
    import pptx
    from pptx.enum.shapes import PP_PLACEHOLDER
    from pptx.exc import PackageNotFoundError
    from pptx.shapes.group import GroupShape

    try:
        presentation = pptx.Presentation(stream)
    except Exception as exc:
        # python-pptx raises ValueError for a package whose main part is not a presentation.
        refuse_unreadable_package(exc, extension, wrong_kind=(ValueError, PackageNotFoundError))
    reader = _SlideReader(
        group_class=GroupShape,
        bulleted={
            PP_PLACEHOLDER.BODY,
            PP_PLACEHOLDER.OBJECT,
            PP_PLACEHOLDER.VERTICAL_BODY,
            PP_PLACEHOLDER.VERTICAL_OBJECT,
        },
        skipped={PP_PLACEHOLDER.DATE, PP_PLACEHOLDER.FOOTER, PP_PLACEHOLDER.HEADER, PP_PLACEHOLDER.SLIDE_NUMBER},
    )
    slide_count = 0
    for slide_count, slide in enumerate(presentation.slides, start=1):
        reader.read_slide(slide, slide_count)
    if not reader.builder.has_content:
        raise rejected(NO_SEARCHABLE_TEXT_ERROR, "NoSearchableText")
    return reader.builder.document(
        parser_name="python-pptx",
        metadata={
            "parser": "python-pptx",
            "filename": filename,
            "extension": extension,
            "format": "pptx",
            "slide_count": slide_count,
            "table_count": len(reader.builder.tables),
        },
    )


class _SlideReader:
    """Add each slide's heading, shapes and notes to one builder."""

    def __init__(self, *, group_class: type[Any], bulleted: set[Any], skipped: set[Any]) -> None:
        self.builder = MarkdownBuilder()
        self._group_class = group_class
        self._bulleted = bulleted
        self._skipped = skipped

    def read_slide(self, slide: Any, number: int) -> None:
        title_shape = slide.shapes.title
        title = _frame_text(title_shape.text_frame) if title_shape is not None and title_shape.has_text_frame else ""
        if inline_text(title):
            self.builder.heading(1, title)
        else:
            self.builder.heading(1, f"Slide {number}", content=False)
        for shape in slide.shapes:
            if title_shape is None or shape.shape_id != title_shape.shape_id:
                self._read_shape(shape, number)
        notes = slide.notes_slide.notes_text_frame if slide.has_notes_slide else None
        paragraphs = [_paragraph_text(paragraph) for paragraph in notes.paragraphs] if notes is not None else []
        if any(text.strip() for text in paragraphs):
            self.builder.label("Notes")
            for text in paragraphs:
                self.builder.paragraph(text)

    def _read_shape(self, shape: Any, slide_number: int) -> None:
        # isinstance, not shape_type: python-pptx raises for a shape type it does not recognize.
        if isinstance(shape, self._group_class):
            for child in shape.shapes:
                self._read_shape(child, slide_number)
        elif shape.has_table:
            rows, _first_row, _first_column = trim_table(
                [[table_cell(cell.text) for cell in row.cells] for row in shape.table.rows]
            )
            self.builder.table(rows, source="pptx", slide=slide_number)
        elif shape.has_text_frame:
            placeholder = _placeholder_type(shape)
            if placeholder in self._skipped:
                return
            for paragraph in shape.text_frame.paragraphs:
                if placeholder in self._bulleted:
                    self.builder.list_item(_paragraph_text(paragraph), depth=paragraph.level)
                else:
                    self.builder.paragraph(_paragraph_text(paragraph))


def _placeholder_type(shape: Any) -> Any:
    """The shape's placeholder type, or ``None`` for an ordinary shape or an unreadable type."""

    if not shape.is_placeholder:
        return None
    try:
        return shape.placeholder_format.type
    except (KeyError, ValueError):
        return None


def _paragraph_text(paragraph: Any) -> str:
    return str(paragraph.text).replace(_LINE_BREAK, "\n")


def _frame_text(text_frame: Any) -> str:
    return " ".join(_paragraph_text(paragraph) for paragraph in text_frame.paragraphs)


__all__ = ["parse_pptx_user_file"]
