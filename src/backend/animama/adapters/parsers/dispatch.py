"""Choose an upload's parser by its extension; the parse child calls :func:`parse_user_file`.

Every format family has its own module, and each imports its parsing library
only when it reads a file, so a child loads only what its upload needs.
"""

from __future__ import annotations

from collections.abc import Mapping
from types import MappingProxyType
from typing import Protocol

from animama.adapters.parsers.docx_user_file_parser import parse_docx_user_file
from animama.adapters.parsers.html_user_file_parser import parse_html_user_file
from animama.adapters.parsers.pdf_user_file_parser import parse_pdf_user_file
from animama.adapters.parsers.pptx_user_file_parser import parse_pptx_user_file
from animama.adapters.parsers.rejections import UNSUPPORTED_FORMAT_REASON, missing_documents_extra, rejected
from animama.adapters.parsers.text_user_file_parser import TEXT_EXTENSIONS, parse_text_user_file
from animama.adapters.parsers.xlsx_user_file_parser import parse_xlsx_user_file
from animama.domain.user_file_processing import ParsedUserFileDocument


class UserFileParseFunction(Protocol):
    """A format family's parser: the upload's bytes, original name and lower-case extension in, Markdown out."""

    def __call__(self, *, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument: ...


_PARSERS: dict[str, UserFileParseFunction] = {
    **dict.fromkeys(TEXT_EXTENSIONS, parse_text_user_file),
    ".html": parse_html_user_file,
    ".htm": parse_html_user_file,
    ".docx": parse_docx_user_file,
    ".pptx": parse_pptx_user_file,
    ".xlsx": parse_xlsx_user_file,
    ".pdf": parse_pdf_user_file,
}
PARSERS_BY_EXTENSION: Mapping[str, UserFileParseFunction] = MappingProxyType(_PARSERS)
SUPPORTED_EXTENSIONS = frozenset(PARSERS_BY_EXTENSION)
"""Every extension a parser reads: exactly the accepted upload extensions."""

DOCUMENTS_EXTRA_MODULES = frozenset(
    {"defusedxml", "docx", "et_xmlfile", "lxml", "openpyxl", "pptx", "pypdfium2", "pypdfium2_raw", "xlsxwriter"}
)
"""Top-level modules the ``documents`` extra installs; without them only the standard-library formats read."""


def parse_user_file(*, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
    """Read one upload with the parser for its extension.

    Raises :class:`~animama.app.ports.user_file_parser_port.UserFileParseRejectedError`
    for an extension no parser reads, a format whose library is not installed,
    and content its parser refuses.
    """

    normalized = extension.lower()
    parse = PARSERS_BY_EXTENSION.get(normalized)
    if parse is None:
        raise rejected(UNSUPPORTED_FORMAT_REASON, "UnsupportedFileType")
    try:
        return parse(payload=payload, filename=filename, extension=normalized)
    except ModuleNotFoundError as exc:
        # An installation without the documents extra (or with part of it) cannot read this format.
        if (exc.name or "").partition(".")[0] not in DOCUMENTS_EXTRA_MODULES:
            raise
        raise missing_documents_extra(normalized) from exc


__all__ = [
    "DOCUMENTS_EXTRA_MODULES",
    "PARSERS_BY_EXTENSION",
    "SUPPORTED_EXTENSIONS",
    "UserFileParseFunction",
    "parse_user_file",
]
