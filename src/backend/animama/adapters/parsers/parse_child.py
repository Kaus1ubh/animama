"""The ``parse-upload`` child process, which reads one uploaded file within limits.

The server never parses upload bytes itself. For each file,
:class:`~animama.adapters.parsers.isolated_user_file_parser.IsolatedUserFileParser`
starts this child, writes one request to its standard input and reads one answer
from its standard output:

- request: a JSON header line (:class:`ParseRequest`) followed by the raw
  payload until the end of input;
- answer: one JSON object, ``{"ok": true, "document": {...}}`` or
  ``{"ok": false, "reason": "<English sentence shown with the file>",
  "error_type": "<failure name for logs>"}``.

Before any parser code runs, the child refuses outbound connections and name
lookups, disables core dumps, bounds its CPU time (and, as a backstop, its
address space on Linux), keeps libraries it never needs from loading, and points
tiktoken at the encodings bundled with llama-index, so reading a file never
downloads anything (spec R1.5). The parent enforces the wall-clock and
resident-memory limits on every platform (spec R3.1).
"""

from __future__ import annotations

import importlib.util
import json
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, BinaryIO, cast

from animama.app.ports.user_file_parser_port import UserFileParseRejectedError
from animama.domain.user_file_processing import ParsedUserFileDocument, UserFileChunkDraft, UserFileOutlineItem

PARSE_UPLOAD_COMMAND = "parse-upload"
"""The runtime CLI subcommand that runs :func:`run_parse_child`."""

MAX_HEADER_BYTES = 64 * 1024
UNREADABLE_REASON = "The file could not be read."

# Libraries no parser uses that a parser library imports when installed. openpyxl
# imports numpy, whose OpenBLAS start costs about a second and reserves address
# space per CPU, enough to crash a child under a tight Linux RLIMIT_AS.
_UNNEEDED_MODULES = ("numpy",)

# The kernel's CPU-time limit only matters for a child whose parent died; while
# the parent lives, its wall-clock limit ends the child much earlier.
_CPU_LIMIT_MARGIN_SECONDS = 30
_ADDRESS_SPACE_HEADROOM_MB = 512

# Python raises these audit events for every connection, datagram and name
# lookup made through the socket module, including from C extensions.
_NETWORK_AUDIT_EVENTS = frozenset(
    {
        "socket.connect",
        "socket.getaddrinfo",
        "socket.gethostbyaddr",
        "socket.gethostbyname",
        "socket.getnameinfo",
        "socket.sendmsg",
        "socket.sendto",
    }
)


def time_limit_reason(seconds: float) -> str:
    """The failure reason for a parse that ran past its time limit."""

    return f"Reading the file took longer than {seconds:g} seconds."


def memory_limit_reason(megabytes: int) -> str:
    """The failure reason for a parse that needed more than its memory limit."""

    return f"Reading the file needed more than {megabytes} MB of memory."


class NetworkAccessBlockedError(PermissionError):
    """Raised for any outbound connection or name lookup in a parse child."""


def install_network_guard() -> None:
    """Make every outbound connection and name lookup in this process fail.

    An audit hook cannot be removed, so only a parse child calls this.
    """

    def refuse(event: str, _args: tuple[Any, ...]) -> None:
        if event in _NETWORK_AUDIT_EVENTS:
            raise NetworkAccessBlockedError(f"Reading an uploaded file may not use the network ({event})")

    sys.addaudithook(refuse)


def address_space_limit_bytes(memory_limit_mb: int) -> int:
    """The child's address-space backstop on Linux: twice the memory limit plus 512 MB.

    The parent stops a child whose resident memory passes the limit and reports
    the limit. Native code (PDFium, for one) aborts when an allocation fails, so
    a backstop at the limit itself would crash a growing child before the parent
    saw it, and the file would fail as unreadable instead. The headroom covers
    the interpreter's own address space and one sampling interval of growth.
    """

    return (2 * memory_limit_mb + _ADDRESS_SPACE_HEADROOM_MB) * 1024 * 1024


def apply_resource_limits(*, memory_limit_mb: int, timeout_seconds: float) -> None:
    """Bound this process where the kernel can, so the bounds hold even if the parent dies.

    Core dumps are disabled because the process holds a private document. The
    address-space backstop (:func:`address_space_limit_bytes`) applies on Linux
    only (macOS ignores ``RLIMIT_AS``), and Windows has no ``resource`` module;
    there the parent's limits are the only ones.
    """

    if sys.platform == "win32":
        return
    import resource

    def lower(kind: int, soft: int, hard: int) -> None:
        _current_soft, current_hard = resource.getrlimit(kind)
        if current_hard != resource.RLIM_INFINITY:
            soft, hard = min(soft, current_hard), min(hard, current_hard)
        try:
            resource.setrlimit(kind, (soft, hard))
        except (OSError, ValueError):
            # A backstop only: the parent still enforces its own limits.
            pass

    lower(resource.RLIMIT_CORE, 0, 0)
    cpu_seconds = math.ceil(timeout_seconds) + _CPU_LIMIT_MARGIN_SECONDS
    lower(resource.RLIMIT_CPU, cpu_seconds, cpu_seconds + 5)
    if sys.platform.startswith("linux"):
        address_space = address_space_limit_bytes(memory_limit_mb)
        lower(resource.RLIMIT_AS, address_space, address_space)


def block_unneeded_imports() -> None:
    """Make importing a library no parser uses fail, so an optional import of it is skipped.

    Only a parse child calls this: the server itself needs numpy.
    """

    for name in _UNNEEDED_MODULES:
        # A ``None`` entry makes ``import name`` raise ImportError.
        sys.modules.setdefault(name, cast(ModuleType, None))


def bundled_tiktoken_cache_dir() -> Path | None:
    """Return the tiktoken encodings directory shipped inside llama-index, if installed.

    The lookup does not import llama-index itself, only its namespace package.
    """

    try:
        spec = importlib.util.find_spec("llama_index.core")
    except (ImportError, ValueError):
        return None
    for location in (spec.submodule_search_locations or ()) if spec is not None else ():
        candidate = Path(location) / "_static" / "tiktoken_cache"
        if candidate.is_dir():
            return candidate
    return None


def configure_offline_tokenizer_cache() -> None:
    """Point tiktoken at the bundled encodings unless the operator chose a cache directory."""

    if os.environ.get("TIKTOKEN_CACHE_DIR"):
        return
    directory = bundled_tiktoken_cache_dir()
    if directory is not None:
        os.environ["TIKTOKEN_CACHE_DIR"] = str(directory)


@dataclass(frozen=True, slots=True)
class ParseRequest:
    """The header line of a parse request; the upload's bytes follow it."""

    filename: str
    extension: str
    memory_limit_mb: int
    timeout_seconds: float

    def encode(self, payload: bytes) -> bytes:
        """Return the bytes the parent writes to the child's standard input."""

        header = {
            "filename": self.filename,
            "extension": self.extension,
            "memory_limit_mb": self.memory_limit_mb,
            "timeout_seconds": self.timeout_seconds,
        }
        # ASCII JSON never contains a raw newline, so the header is exactly one line.
        return json.dumps(header, ensure_ascii=True).encode("ascii") + b"\n" + payload

    @classmethod
    def decode_header(cls, line: bytes) -> ParseRequest:
        """Read a header line; raise ``ValueError`` for anything malformed."""

        if len(line) > MAX_HEADER_BYTES or not line.endswith(b"\n"):
            raise ValueError("parse request header is missing or too long")
        data = _dict(json.loads(line), "header")
        memory_limit_mb = _int(data.get("memory_limit_mb"), "memory_limit_mb")
        timeout_seconds = data.get("timeout_seconds")
        if isinstance(timeout_seconds, bool) or not isinstance(timeout_seconds, int | float):
            raise ValueError("timeout_seconds must be a number")
        if memory_limit_mb <= 0 or not 0 < timeout_seconds < math.inf:
            raise ValueError("parse limits must be positive")
        return cls(
            filename=_str(data.get("filename"), "filename"),
            extension=_str(data.get("extension"), "extension"),
            memory_limit_mb=memory_limit_mb,
            timeout_seconds=float(timeout_seconds),
        )


def parse_upload(*, payload: bytes, filename: str, extension: str) -> ParsedUserFileDocument:
    """Read one upload with the parser its extension selects (see :mod:`animama.adapters.parsers.dispatch`)."""

    # Parser code loads only now, after the child has installed its guards.
    from animama.adapters.parsers.dispatch import parse_user_file

    return parse_user_file(payload=payload, filename=filename, extension=extension)


def answer_parse_request(request: ParseRequest, payload: bytes) -> dict[str, Any]:
    """Parse one payload and return the child's answer; content problems never raise."""

    try:
        document = parse_upload(payload=payload, filename=request.filename, extension=request.extension)
        return {"ok": True, "document": encode_parsed_document(document)}
    except UserFileParseRejectedError as exc:
        cause = exc.__cause__ if exc.__cause__ is not None else exc
        return _rejected(exc.reason, exc.error_type or type(cause).__name__)
    except MemoryError:
        return _rejected(memory_limit_reason(request.memory_limit_mb), "MemoryError")
    except Exception as exc:
        # A parser bug reads the same way on every attempt; report it without the content.
        return _unreadable(exc)


def run_parse_child(stdin: BinaryIO | None = None) -> int:
    """Run the ``parse-upload`` subcommand: answer one request on standard output.

    Returns the exit status: 0 once the answer was written, 1 if it could not be.
    """

    answer = _take_standard_output()
    source = stdin if stdin is not None else sys.stdin.buffer
    request: ParseRequest | None = None
    try:
        request = ParseRequest.decode_header(source.readline(MAX_HEADER_BYTES + 1))
        apply_resource_limits(memory_limit_mb=request.memory_limit_mb, timeout_seconds=request.timeout_seconds)
        install_network_guard()
        block_unneeded_imports()
        configure_offline_tokenizer_cache()
        data = _encode_answer(answer_parse_request(request, source.read()))
    except MemoryError:
        data = _encode_answer(
            _rejected(memory_limit_reason(request.memory_limit_mb), "MemoryError")
            if request
            else _unreadable(MemoryError())
        )
    except Exception as exc:
        data = _encode_answer(_unreadable(exc))
    try:
        with answer:
            answer.write(data + b"\n")
    except OSError:
        return 1
    return 0


def decode_parse_answer(output: bytes) -> ParsedUserFileDocument:
    """Return the document in a child's answer, or raise the rejection it reports.

    Raises ``ValueError`` when the output is not a well-formed answer.
    """

    answer = _dict(json.loads(output), "answer")
    if answer.get("ok") is True:
        return decode_parsed_document(answer.get("document"))
    reason = answer.get("reason")
    error_type = answer.get("error_type")
    if answer.get("ok") is False and isinstance(reason, str) and reason.strip():
        raise UserFileParseRejectedError(
            reason.strip()[:500], error_type=error_type[:100] if isinstance(error_type, str) else None
        )
    raise ValueError("parse answer is neither a document nor a rejection")


def encode_parsed_document(document: ParsedUserFileDocument) -> dict[str, Any]:
    """Return ``document`` as JSON-compatible data."""

    return {
        "text": document.text,
        "parser_name": document.parser_name,
        "metadata": document.metadata,
        "tables": document.tables,
        "chunks": (
            None
            if document.chunks is None
            else [
                {
                    "chunk_index": chunk.chunk_index,
                    "text": chunk.text,
                    "char_count": chunk.char_count,
                    "token_estimate": chunk.token_estimate,
                    "metadata": chunk.metadata,
                    "embedding_text": chunk.embedding_text,
                    "embedding": chunk.embedding,
                }
                for chunk in document.chunks
            ]
        ),
        "source_outline": [{"level": item.level, "title": item.title} for item in document.source_outline],
        "source_outline_truncated": document.source_outline_truncated,
    }


def decode_parsed_document(value: object) -> ParsedUserFileDocument:
    """Rebuild a document from :func:`encode_parsed_document` data; raise ``ValueError`` if malformed."""

    data = _dict(value, "document")
    tables = data.get("tables")
    chunks = data.get("chunks")
    return ParsedUserFileDocument(
        text=_str(data.get("text"), "text"),
        parser_name=_str(data.get("parser_name"), "parser_name"),
        metadata=_dict(data.get("metadata"), "metadata"),
        tables=None if tables is None else [_dict(table, "table") for table in _list(tables, "tables")],
        chunks=None if chunks is None else [_decode_chunk(chunk) for chunk in _list(chunks, "chunks")],
        source_outline=tuple(
            UserFileOutlineItem(level=_int(item.get("level"), "level"), title=_str(item.get("title"), "title"))
            for item in (_dict(entry, "outline item") for entry in _list(data.get("source_outline", []), "outline"))
        ),
        source_outline_truncated=_bool(data.get("source_outline_truncated", False), "source_outline_truncated"),
    )


def _decode_chunk(value: object) -> UserFileChunkDraft:
    data = _dict(value, "chunk")
    embedding_text = data.get("embedding_text")
    embedding = data.get("embedding")
    return UserFileChunkDraft(
        chunk_index=_int(data.get("chunk_index"), "chunk_index"),
        text=_str(data.get("text"), "chunk text"),
        char_count=_int(data.get("char_count"), "char_count"),
        token_estimate=_int(data.get("token_estimate"), "token_estimate"),
        metadata=_dict(data.get("metadata"), "chunk metadata"),
        embedding_text=None if embedding_text is None else _str(embedding_text, "embedding_text"),
        embedding=None
        if embedding is None
        else [_float(number, "embedding") for number in _list(embedding, "embedding")],
    )


def _take_standard_output() -> BinaryIO:
    """Keep the real standard output for the answer and send stray writes to standard error.

    A library that prints, from Python or from C, must not corrupt the one JSON answer.
    """

    if sys.stdout is not None:
        sys.stdout.flush()
    answer_descriptor = os.dup(1)
    os.dup2(2, 1)
    return os.fdopen(answer_descriptor, "wb")


def _encode_answer(answer: dict[str, Any]) -> bytes:
    try:
        return json.dumps(answer, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (TypeError, ValueError) as exc:
        # Parser metadata that JSON cannot carry is a parser bug, like any other.
        return json.dumps(_unreadable(exc)).encode("utf-8")


def _rejected(reason: str, error_type: str) -> dict[str, Any]:
    return {"ok": False, "reason": reason, "error_type": error_type}


def _unreadable(error: BaseException) -> dict[str, Any]:
    # Only the type name travels: an exception message may quote document content.
    return _rejected(UNREADABLE_REASON, type(error).__name__)


def _dict(value: object, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be an object")
    return value


def _list(value: object, name: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be a list")
    return value


def _str(value: object, name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a string")
    return value


def _int(value: object, name: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"{name} must be an integer")
    return value


def _float(value: object, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        raise ValueError(f"{name} must be a number")
    return float(value)


def _bool(value: object, name: str) -> bool:
    if not isinstance(value, bool):
        raise ValueError(f"{name} must be true or false")
    return value


__all__ = [
    "MAX_HEADER_BYTES",
    "PARSE_UPLOAD_COMMAND",
    "UNREADABLE_REASON",
    "NetworkAccessBlockedError",
    "ParseRequest",
    "address_space_limit_bytes",
    "answer_parse_request",
    "apply_resource_limits",
    "block_unneeded_imports",
    "bundled_tiktoken_cache_dir",
    "configure_offline_tokenizer_cache",
    "decode_parse_answer",
    "decode_parsed_document",
    "encode_parsed_document",
    "install_network_guard",
    "memory_limit_reason",
    "parse_upload",
    "run_parse_child",
    "time_limit_reason",
]
