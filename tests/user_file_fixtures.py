"""Upload fixtures built at test time: Office files written by their libraries and hand-written PDFs."""

from __future__ import annotations

import zipfile
import zlib
from collections.abc import Callable
from io import BytesIO
from typing import Any

W_NAMESPACE = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

# A 1x1 grey inline image and nothing else: a scanned page without a text layer.
IMAGE_PAGE = b"q 100 0 0 100 72 600 cm BI /W 1 /H 1 /CS /G /BPC 8 ID \x80 EI Q"


def docx_bytes(build: Callable[[Any], None]) -> bytes:
    """A DOCX written by python-docx after ``build(document)``."""

    import docx

    document = docx.Document()
    build(document)
    output = BytesIO()
    document.save(output)
    return output.getvalue()


def pptx_bytes(build: Callable[[Any], None]) -> bytes:
    """A PPTX written by python-pptx after ``build(presentation)``."""

    import pptx

    presentation = pptx.Presentation()
    build(presentation)
    output = BytesIO()
    presentation.save(output)
    return output.getvalue()


def xlsx_bytes(build: Callable[[Any], None]) -> bytes:
    """An XLSX written by openpyxl after ``build(workbook)``."""

    import openpyxl

    workbook = openpyxl.Workbook()
    build(workbook)
    output = BytesIO()
    workbook.save(output)
    return output.getvalue()


def simple_docx(*paragraphs: str, heading: str = "Notes") -> bytes:
    """A DOCX with one Heading 1 followed by plain paragraphs."""

    def build(document: Any) -> None:
        document.add_heading(heading, level=1)
        for text in paragraphs:
            document.add_paragraph(text)

    return docx_bytes(build)


def zip_bytes(entries: dict[str, bytes]) -> bytes:
    """A deflated ZIP archive holding ``entries``."""

    output = BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(name, data)
    return output.getvalue()


def rewrite_zip(package: bytes, rewrite: Callable[[str, bytes], bytes]) -> bytes:
    """Return ``package`` with each entry's bytes passed through ``rewrite(name, data)``."""

    source = zipfile.ZipFile(BytesIO(package))
    return zip_bytes(
        {entry.filename: rewrite(entry.filename, source.read(entry.filename)) for entry in source.infolist()}
    )


def replace_part(package: bytes, name: str, data: bytes) -> bytes:
    """Return ``package`` with the part ``name`` replaced by ``data``."""

    return rewrite_zip(package, lambda entry, original: data if entry == name else original)


def pdf_bytes(*pages: bytes) -> bytes:
    """A minimal PDF whose pages draw the given content streams, with Helvetica as ``/F1``."""

    objects: list[bytes] = [b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"]
    pages_id = 2 + 2 * len(pages)
    kids = []
    for content in pages:
        objects.append(b"<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content))
        objects.append(
            b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >>"
            b" /Contents %d 0 R >>" % (pages_id, len(objects))
        )
        kids.append(len(objects))
    objects.append(b"<< /Type /Pages /Kids [%s] /Count %d >>" % (b" ".join(b"%d 0 R" % kid for kid in kids), len(kids)))
    objects.append(b"<< /Type /Catalog /Pages %d 0 R >>" % pages_id)
    output = BytesIO()
    output.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(output.tell())
        output.write(b"%d 0 obj\n%s\nendobj\n" % (number, body))
    xref = output.tell()
    output.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for offset in offsets:
        output.write(b"%010d 00000 n \n" % offset)
    output.write(
        b"trailer\n<< /Size %d /Root %d 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, len(objects), xref)
    )
    return output.getvalue()


def flate_bomb_pdf(mebibytes: int) -> bytes:
    """A one-page PDF whose Flate content stream inflates to ``mebibytes`` MiB of spaces after a line of text."""

    compressor = zlib.compressobj(9)
    parts = [compressor.compress(b"BT /F1 12 Tf 72 720 Td (Hello) Tj ET\n")]
    spaces = b" " * (1024 * 1024)
    parts.extend(compressor.compress(spaces) for _ in range(mebibytes))
    parts.append(compressor.flush())
    stream = b"".join(parts)
    objects = [
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length %d /Filter /FlateDecode >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Page /Parent 4 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 1 0 R >> >>"
        b" /Contents 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Catalog /Pages 4 0 R >>",
    ]
    output = BytesIO()
    output.write(b"%PDF-1.4\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(output.tell())
        output.write(b"%d 0 obj\n%s\nendobj\n" % (number, body))
    xref = output.tell()
    output.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    for offset in offsets:
        output.write(b"%010d 00000 n \n" % offset)
    output.write(b"trailer\n<< /Size %d /Root 5 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref))
    return output.getvalue()


def text_page(*lines: bytes) -> bytes:
    """A page content stream that writes each line of text below the previous one."""

    return b"BT /F1 12 Tf 72 720 Td 14 TL\n" + b"\n".join(b"(%s) Tj T*" % line for line in lines) + b"\nET"
