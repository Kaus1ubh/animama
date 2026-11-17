"""Check an Office upload's ZIP package before any Office library opens it (spec R2.7, R2.8, R3.2).

DOCX, PPTX and XLSX files are ZIP packages of XML parts, each stored or
deflated. The libraries that read them unpack a part whole through
:mod:`zipfile`, which inflates as much as the part's compressed data yields
before trimming it to the size the ZIP directory records, so a recorded size
bounds nothing by itself. The check therefore refuses compression methods
Office never uses, bounds the recorded sizes, and then inflates every part once,
a small chunk at a time, refusing a part as soon as it outgrows its recorded
size. Every later read is then bounded by recorded sizes that hold.
"""

from __future__ import annotations

import struct
import zipfile
import zlib
from collections.abc import Sequence
from io import BytesIO
from typing import NoReturn

from animama.adapters.parsers.rejections import (
    damaged_document,
    encrypted_document,
    extension_mismatch,
    is_entity_expansion_error,
    rejected,
    xml_entities,
)

MAX_PACKAGE_ENTRIES = 10_000
"""Most parts a package may hold; real documents hold tens to a few thousand."""
MAX_PACKAGE_UNCOMPRESSED_BYTES = 256 * 1024 * 1024
"""Most bytes all parts together may unpack to."""
MAX_PART_COMPRESSION_RATIO = 100
"""Most a part larger than :data:`COMPRESSION_RATIO_MIN_BYTES` may expand; document XML stays far below it."""
COMPRESSION_RATIO_MIN_BYTES = 1024 * 1024
"""Parts up to this size are not ratio-checked: small, repetitive XML compresses very well."""

OLE_COMPOUND_FILE_SIGNATURE = bytes.fromhex("D0CF11E0A1B11AE1")
"""The header of an OLE compound file: an encrypted Office package, or a legacy ``.doc``, ``.xls`` or ``.ppt``."""
UNSUPPORTED_COMPRESSION_REASON = "The document uses a ZIP compression method that Office files do not use."
PART_SIZE_MISMATCH_REASON = "The document contains a part that unpacks to more than its recorded size."

_ZIP_SIGNATURE = b"PK"
# General-purpose flag bit 0 marks an encrypted ZIP entry.
_ENCRYPTED_ENTRY_FLAG = 0x1
_OFFICE_COMPRESSION_METHODS = frozenset({zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED})
_INFLATE_CHUNK_BYTES = 64 * 1024
_LOCAL_HEADER_SIGNATURE = b"PK\x03\x04"
_LOCAL_HEADER_BYTES = 30
# Office encrypts a package into an "EncryptedPackage" stream of a compound file.
# The file's directory is a run of 128-byte entries, each starting with its
# UTF-16LE name, whose length in bytes (with the terminator) sits at offset 64.
_ENCRYPTED_PACKAGE_NAME = "EncryptedPackage".encode("utf-16-le") + b"\x00\x00"
_DIRECTORY_ENTRY_BYTES = 128
_DIRECTORY_NAME_LENGTH = struct.Struct("<H")
_DIRECTORY_NAME_LENGTH_OFFSET = 64


def open_office_package(payload: bytes, extension: str) -> BytesIO:
    """Return ``payload`` as a stream once its header and every part pass the checks.

    Raises :class:`~animama.app.ports.user_file_parser_port.UserFileParseRejectedError`
    for an encrypted document, content that is not a ZIP package, a damaged
    package, or one that unpacks past its recorded sizes or the bounds.
    """

    if payload.startswith(OLE_COMPOUND_FILE_SIGNATURE):
        # A compound file is either an encrypted package or a legacy binary document under this extension.
        raise encrypted_document() if holds_encrypted_package(payload) else extension_mismatch(extension)
    if not payload.startswith(_ZIP_SIGNATURE):
        raise extension_mismatch(extension)
    try:
        with zipfile.ZipFile(BytesIO(payload)) as archive:
            entries = archive.infolist()
    except (zipfile.BadZipFile, EOFError, ValueError, struct.error) as exc:
        raise damaged_document(extension) from exc
    check_package_entries(payload, entries, extension)
    return BytesIO(payload)


def holds_encrypted_package(compound_file: bytes) -> bool:
    """Whether an OLE compound file's directory has an entry named ``EncryptedPackage``.

    Directory entries start on 128-byte boundaries, so a match elsewhere, such
    as the name inside a legacy document's text, does not count.
    """

    expected_length = _DIRECTORY_NAME_LENGTH.pack(len(_ENCRYPTED_PACKAGE_NAME))
    position = compound_file.find(_ENCRYPTED_PACKAGE_NAME)
    while position != -1:
        length_at = position + _DIRECTORY_NAME_LENGTH_OFFSET
        if position % _DIRECTORY_ENTRY_BYTES == 0 and compound_file[length_at : length_at + 2] == expected_length:
            return True
        position = compound_file.find(_ENCRYPTED_PACKAGE_NAME, position + 1)
    return False


def check_package_entries(payload: bytes, entries: Sequence[zipfile.ZipInfo], extension: str) -> None:
    """Refuse a package that is encrypted, too large or not compressed as Office compresses.

    The recorded sizes are checked first, which costs nothing: the part count,
    the total and each part's compression ratio. Then each part is inflated in
    chunks and refused once it outgrows its recorded size. A part never unpacks
    to more than it records, so the parts together never pass the total either.
    """

    if len(entries) > MAX_PACKAGE_ENTRIES:
        raise rejected(f"The document has more than {MAX_PACKAGE_ENTRIES:,} parts.", "PackageTooManyParts")
    total_bytes = 0
    for entry in entries:
        if entry.flag_bits & _ENCRYPTED_ENTRY_FLAG:
            raise encrypted_document()
        if entry.compress_type not in _OFFICE_COMPRESSION_METHODS:
            raise rejected(UNSUPPORTED_COMPRESSION_REASON, "UnsupportedCompression")
        total_bytes += entry.file_size
        if total_bytes > MAX_PACKAGE_UNCOMPRESSED_BYTES:
            raise rejected(
                f"The document expands to more than {MAX_PACKAGE_UNCOMPRESSED_BYTES // (1024 * 1024)} MB"
                " when unpacked.",
                "PackageTooLarge",
            )
        if (
            entry.file_size > COMPRESSION_RATIO_MIN_BYTES
            and entry.file_size > MAX_PART_COMPRESSION_RATIO * entry.compress_size
        ):
            raise rejected(
                f"The document contains a part that expands more than {MAX_PART_COMPRESSION_RATIO} times"
                " when unpacked.",
                "PackageCompressionRatio",
            )
    for entry in entries:
        if _unpacked_size(payload, entry, extension, limit=entry.file_size) > entry.file_size:
            raise rejected(PART_SIZE_MISMATCH_REASON, "PackageSizeMismatch")


def _unpacked_size(payload: bytes, entry: zipfile.ZipInfo, extension: str, *, limit: int) -> int:
    """How many bytes ``entry`` unpacks to, counting at most one chunk past ``limit``.

    A deflated part is inflated as zipfile inflates it (raw deflate, ending at
    the stream's end or its compressed size), but at most a chunk at a time.
    """

    data = _entry_data(payload, entry, extension)
    if entry.compress_type == zipfile.ZIP_STORED:
        return len(data)
    decompressor = zlib.decompressobj(-zlib.MAX_WBITS)
    size = 0
    try:
        for start in range(0, len(data), _INFLATE_CHUNK_BYTES):
            pending: bytes | memoryview = data[start : start + _INFLATE_CHUNK_BYTES]
            while pending and not decompressor.eof:
                size += len(decompressor.decompress(pending, _INFLATE_CHUNK_BYTES))
                if size > limit:
                    return size
                pending = decompressor.unconsumed_tail
            if decompressor.eof:
                return size
        # All input is in; inflate what zlib still holds, a chunk at a time.
        while not decompressor.eof:
            chunk = decompressor.decompress(b"", _INFLATE_CHUNK_BYTES)
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                return size
    except zlib.error as exc:
        raise damaged_document(extension) from exc
    return size


def _entry_data(payload: bytes, entry: zipfile.ZipInfo, extension: str) -> memoryview:
    """A part's compressed bytes, found through its local header as zipfile finds them."""

    offset = entry.header_offset
    header = payload[offset : offset + _LOCAL_HEADER_BYTES] if offset >= 0 else b""
    if len(header) < _LOCAL_HEADER_BYTES or not header.startswith(_LOCAL_HEADER_SIGNATURE):
        raise damaged_document(extension)
    name_length, extra_length = struct.unpack_from("<HH", header, 26)
    start = offset + _LOCAL_HEADER_BYTES + name_length + extra_length
    data = memoryview(payload)[start : start + entry.compress_size]
    if len(data) != entry.compress_size:
        raise damaged_document(extension)
    return data


PACKAGE_DAMAGED_ERRORS: tuple[type[BaseException], ...] = (
    zipfile.BadZipFile,
    zipfile.LargeZipFile,
    EOFError,
    struct.error,
    # XML syntax errors from lxml and ElementTree.
    SyntaxError,
    # An unsupported ZIP compression method.
    NotImplementedError,
)
"""Errors that mean a package's ZIP data or XML cannot be read."""
PACKAGE_WRONG_KIND_ERRORS: tuple[type[BaseException], ...] = (KeyError,)
"""Errors for a ZIP package without the parts an Office document needs, such as ``[Content_Types].xml``."""


def refuse_unreadable_package(
    error: BaseException,
    extension: str,
    *,
    wrong_kind: tuple[type[BaseException], ...] = (),
    damaged: tuple[type[BaseException], ...] = (),
    entity_errors: tuple[type[BaseException], ...] = (),
) -> NoReturn:
    """Raise the refusal for an error an Office library raised while opening a checked package.

    The error's causes count too, because a library may wrap the XML error it
    met. An entity refusal (``entity_errors``, or libxml2's expansion limit) or
    a damage error anywhere in the chain decides first; then the error itself
    is checked against the wrong-kind errors. ``wrong_kind`` and ``damaged`` add
    the library's own errors for another kind of file and for damaged content.
    Any other error is raised again unchanged and reads as an unreadable file.
    """

    chain = _error_chain(error)
    if any(isinstance(item, entity_errors) or is_entity_expansion_error(item) for item in chain):
        raise xml_entities() from error
    if any(isinstance(item, PACKAGE_DAMAGED_ERRORS + damaged) for item in chain):
        raise damaged_document(extension) from error
    if isinstance(error, PACKAGE_WRONG_KIND_ERRORS + wrong_kind):
        raise extension_mismatch(extension) from error
    raise error


def _error_chain(error: BaseException, *, limit: int = 8) -> list[BaseException]:
    """``error`` and the errors it was raised from or while handling, nearest first, as tracebacks show them."""

    chain: list[BaseException] = []
    current: BaseException | None = error
    while current is not None and len(chain) < limit and all(current is not seen for seen in chain):
        chain.append(current)
        if current.__cause__ is not None:
            current = current.__cause__
        else:
            current = None if current.__suppress_context__ else current.__context__
    return chain


__all__ = [
    "COMPRESSION_RATIO_MIN_BYTES",
    "MAX_PACKAGE_ENTRIES",
    "MAX_PACKAGE_UNCOMPRESSED_BYTES",
    "MAX_PART_COMPRESSION_RATIO",
    "OLE_COMPOUND_FILE_SIGNATURE",
    "PACKAGE_DAMAGED_ERRORS",
    "PACKAGE_WRONG_KIND_ERRORS",
    "PART_SIZE_MISMATCH_REASON",
    "UNSUPPORTED_COMPRESSION_REASON",
    "check_package_entries",
    "holds_encrypted_package",
    "open_office_package",
    "refuse_unreadable_package",
]
