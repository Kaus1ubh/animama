"""Read PDF text layers with pypdfium2 (spec R2.6, R2.7).

Each page's text layer is read in the order the PDF stores it, without layout
analysis or OCR. Pages are separated by a blank line, and the metadata records
where each page's text lies in the result (``pdf_pages``, character offsets
``[start, end)``) and which pages had no selectable text
(``pdf_skipped_pages``), so later steps can name the pages a passage came from
and the pages that could not be read. A PDF without any selectable text is
refused. Bookmarks, when the PDF has them, give the outline; the text itself has
no headings. Nothing in the PDF runs: PDFium reads it without forms or scripts.
"""

from __future__ import annotations

from typing import Any

from animama.adapters.parsers.markdown_builder import MAX_HEADING_LEVEL, clean_text, escape_line_starts, inline_text
from animama.adapters.parsers.rejections import (
    NO_PDF_TEXT_REASON,
    damaged_document,
    encrypted_document,
    extension_mismatch,
    rejected,
)
from animama.domain.user_file_processing import ParsedUserFileDocument, UserFileOutlineItem

PDF_SIGNATURE = b"%PDF-"
PAGE_SEPARATOR = "\n\n"
MAX_OUTLINE_ITEMS = 1_000
"""Most bookmarks kept as the outline; the overview keeps far fewer."""


def parse_pdf_user_file(*, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
    """Read every page's text layer; refuse a password-protected PDF or one without selectable text."""

    if not payload.startswith(PDF_SIGNATURE):
        raise extension_mismatch(extension)
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    try:
        pdf = pdfium.PdfDocument(payload)
    except pdfium.PdfiumError as exc:
        # A PDF that needs a password, or uses a security handler PDFium cannot open.
        if exc.err_code in (pdfium_c.FPDF_ERR_PASSWORD, pdfium_c.FPDF_ERR_SECURITY):
            raise encrypted_document() from exc
        raise damaged_document(extension) from exc
    try:
        page_texts = [_page_text(pdf, index) for index in range(len(pdf))]
        outline, outline_truncated = _bookmarks(pdf)
    except pdfium.PdfiumError as exc:
        raise damaged_document(extension) from exc
    finally:
        pdf.close()

    parts: list[str] = []
    pages: list[dict[str, int]] = []
    skipped: list[int] = []
    offset = 0
    for number, text in enumerate(page_texts, start=1):
        if not text:
            skipped.append(number)
            continue
        if parts:
            offset += len(PAGE_SEPARATOR)
        pages.append({"page": number, "start": offset, "end": offset + len(text)})
        parts.append(text)
        offset += len(text)
    if not parts:
        raise rejected(NO_PDF_TEXT_REASON, "NoSelectableText")
    return ParsedUserFileDocument(
        text=PAGE_SEPARATOR.join(parts),
        parser_name="pypdfium2",
        metadata={
            "parser": "pypdfium2",
            "filename": filename,
            "extension": extension,
            "format": "pdf",
            "page_count": len(page_texts),
            "pdf_pages": pages,
            "pdf_skipped_pages": skipped,
        },
        source_outline=outline,
        source_outline_truncated=outline_truncated,
    )


def _page_text(pdf: Any, index: int) -> str:
    """One page's text layer, or an empty string when the page has no selectable text.

    A line that would read as a Markdown heading or code fence is escaped: PDF
    text has no reliable headings.
    """

    page = pdf[index]
    try:
        text_page = page.get_textpage()
        try:
            text = clean_text(text_page.get_text_range()).strip()
        finally:
            text_page.close()
    finally:
        page.close()
    return escape_line_starts(text)


def _bookmarks(pdf: Any) -> tuple[tuple[UserFileOutlineItem, ...], bool]:
    """The PDF's bookmarks as outline items, and whether the list was cut at :data:`MAX_OUTLINE_ITEMS`."""

    items: list[UserFileOutlineItem] = []
    for bookmark in pdf.get_toc():
        if len(items) >= MAX_OUTLINE_ITEMS:
            return tuple(items), True
        title = inline_text(bookmark.get_title())
        if title:
            items.append(UserFileOutlineItem(level=min(bookmark.level + 1, MAX_HEADING_LEVEL), title=title))
    return tuple(items), False


__all__ = ["MAX_OUTLINE_ITEMS", "PAGE_SEPARATOR", "PDF_SIGNATURE", "parse_pdf_user_file"]
