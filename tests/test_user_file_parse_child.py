"""Uploads are parsed in a separate child process under time and memory limits (spec R1.5, R3.1)."""

from __future__ import annotations

import asyncio
import json
import socket
import subprocess
import sys
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import psutil
import pytest

from animama.adapters.parsers import parse_child
from animama.adapters.parsers.dispatch import parse_user_file
from animama.adapters.parsers.isolated_user_file_parser import (
    IsolatedUserFileParser,
    UserFileParseChildError,
    child_environment,
    default_parse_command,
)
from animama.adapters.parsers.parse_child import (
    UNREADABLE_REASON,
    ParseRequest,
    answer_parse_request,
    decode_parsed_document,
    encode_parsed_document,
)
from animama.adapters.parsers.text_user_file_parser import parse_text_user_file
from animama.app.ports.user_file_parser_port import UserFileParseRejectedError
from animama.app.services.user_file_processing_service import is_retryable_processing_failure
from animama.domain.user_file_processing import ParsedUserFileDocument, UserFileChunkDraft, UserFileOutlineItem
from tests.user_file_fixtures import (
    flate_bomb_pdf,
    pdf_bytes,
    pptx_bytes,
    simple_docx,
    text_page,
    xlsx_bytes,
    zip_bytes,
)


def _python(code: str) -> list[str]:
    """A stand-in child that ignores the parse protocol and runs ``code``."""

    return [sys.executable, "-c", code]


def _children_running(marker: str) -> list[psutil.Process]:
    """This process's live children whose command line contains ``marker``."""

    found = []
    for child in psutil.Process().children(recursive=True):
        try:
            if child.status() != psutil.STATUS_ZOMBIE and marker in " ".join(child.cmdline()):
                found.append(child)
        except psutil.Error:
            continue
    return found


@pytest.mark.parametrize(
    ("extension", "payload"),
    [
        (".txt", b"Alpha notes\n\nBeta paragraph with caf\xc3\xa9."),
        (".json", b'{"b": 2, "a": [1, "x"]}'),
        (".tsv", b"name\tvalue\nalpha\t1\nbeta\t2\n"),
        (".xml", b"<root><item>Value</item></root>"),
    ],
)
async def test_child_reads_standard_library_formats_as_the_server_did(extension: str, payload: bytes) -> None:
    filename = f"notes{extension}"

    parsed = await IsolatedUserFileParser().parse(payload=payload, filename=filename, extension=extension)

    assert parsed == parse_text_user_file(payload=payload, filename=filename, extension=extension)


def _slides(presentation: Any) -> None:
    slide = presentation.slides.add_slide(presentation.slide_layouts[1])
    slide.shapes.title.text = "Agenda"
    slide.placeholders[1].text_frame.text = "Introductions"


def _sheet(workbook: Any) -> None:
    workbook.active.title = "Totals"
    workbook.active.append(["Region", "Sales"])
    workbook.active.append(["North", 12])


OFFICE_AND_PDF_UPLOADS: dict[str, Callable[[], bytes]] = {
    ".docx": lambda: simple_docx("The child read this Word document.", heading="Summary"),
    ".pdf": lambda: pdf_bytes(text_page(b"The child read this PDF."), text_page(b"Second page.")),
    ".pptx": lambda: pptx_bytes(_slides),
    ".xlsx": lambda: xlsx_bytes(_sheet),
}


@pytest.mark.parametrize("extension", sorted(OFFICE_AND_PDF_UPLOADS))
async def test_child_reads_office_documents_and_pdfs_end_to_end(extension: str) -> None:
    """The real child, under the default limits (on Linux, a 1 GiB address space), reads each binary format."""

    payload = OFFICE_AND_PDF_UPLOADS[extension]()
    filename = f"upload{extension}"

    parsed = await IsolatedUserFileParser().parse(payload=payload, filename=filename, extension=extension)

    assert parsed == parse_user_file(payload=payload, filename=filename, extension=extension)
    assert parsed.text


async def test_child_refuses_a_zip_bomb_without_unpacking_it() -> None:
    bomb = zip_bytes({"[Content_Types].xml": b"<Types/>", "word/document.xml": bytes(64 * 1024 * 1024)})

    with pytest.raises(UserFileParseRejectedError) as rejected:
        await IsolatedUserFileParser(memory_limit_mb=256).parse(payload=bomb, filename="bomb.docx", extension=".docx")

    assert rejected.value.reason == "The document contains a part that expands more than 100 times when unpacked."


async def test_pdf_decompression_bomb_fails_at_the_memory_limit() -> None:
    """A content stream that inflates to 512 MiB stops at the limit, with the reason naming it (spec R3.4).

    On Linux the child's address-space backstop sits above the limit, so the
    parent's resident-memory check stops the child first, as on other platforms.
    """

    payload = flate_bomb_pdf(512)
    assert len(payload) < 2 * 1024 * 1024

    with pytest.raises(UserFileParseRejectedError) as rejected:
        await IsolatedUserFileParser(memory_limit_mb=256).parse(payload=payload, filename="bomb.pdf", extension=".pdf")

    assert rejected.value.reason == "Reading the file needed more than 256 MB of memory."
    assert rejected.value.error_type == "MemoryError"


def test_child_reports_a_missing_documents_extra_with_its_failure_name(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = simple_docx("Unread.")
    monkeypatch.setitem(sys.modules, "docx", None)
    request = ParseRequest(filename="a.docx", extension=".docx", memory_limit_mb=1024, timeout_seconds=60)

    assert answer_parse_request(request, payload) == {
        "ok": False,
        "reason": "This installation cannot read .docx files: the documents extra is not installed.",
        "error_type": "DocumentsExtraMissing",
    }


async def test_child_rejects_malformed_content_with_the_existing_reason() -> None:
    with pytest.raises(UserFileParseRejectedError) as rejected:
        await IsolatedUserFileParser().parse(payload=b"{not json", filename="data.json", extension=".json")

    assert rejected.value.reason.startswith("Invalid JSON document: ")
    assert rejected.value.error_type == "JSONDecodeError"


# Every parser library, and what each format may load. A format loads only its own library.
PARSER_LIBRARIES = ("docx", "pptx", "openpyxl", "pypdfium2", "pypdfium2_raw", "lxml", "defusedxml", "PIL", "et_xmlfile")
LIBRARIES_BY_EXTENSION = {
    ".json": set(),
    ".html": set(),
    ".xml": {"defusedxml"},
    ".docx": {"docx", "lxml"},
    ".pptx": {"pptx", "lxml", "PIL"},
    ".xlsx": {"openpyxl", "lxml", "defusedxml", "PIL"},
    ".pdf": {"pypdfium2", "pypdfium2_raw"},
}
SAMPLE_UPLOADS: dict[str, Callable[[], bytes]] = {
    ".json": lambda: b'{"a": 1}',
    ".html": lambda: b"<h1>Title</h1><p>Body</p>",
    ".xml": lambda: b"<root><item>Value</item></root>",
    **OFFICE_AND_PDF_UPLOADS,
}


@pytest.mark.parametrize("extension", sorted(LIBRARIES_BY_EXTENSION))
def test_child_loads_only_the_parser_code_its_format_needs(extension: str, tmp_path: Path) -> None:
    """The ORM, the server, provider SDKs, numpy and other formats' libraries would cost each child time and memory.

    The probe prepares itself as the child does, so openpyxl's optional numpy
    import is refused as well.
    """

    upload = tmp_path / f"upload{extension}"
    upload.write_bytes(SAMPLE_UPLOADS[extension]())
    probe = (
        "import sys\n"
        "import animama.runtime.cli\n"
        "from animama.adapters.parsers.parse_child import ParseRequest, answer_parse_request, block_unneeded_imports\n"
        "block_unneeded_imports()\n"
        f"request = ParseRequest(filename='upload{extension}', extension='{extension}', memory_limit_mb=1024,"
        " timeout_seconds=60)\n"
        f"answer = answer_parse_request(request, open({str(upload)!r}, 'rb').read())\n"
        "assert answer['ok'] is True, answer\n"
        "heavy = ('numpy', 'sqlalchemy', 'openai', 'anthropic', 'pydantic', 'fastapi', 'httpx')\n"
        "local = ('animama.app.services', 'animama.orm', 'animama.server', 'animama.local')\n"
        f"libraries = {PARSER_LIBRARIES!r}\n"
        "loaded = {name.split('.')[0] for name, module in sys.modules.items() if module is not None}\n"
        "print(sorted(m for m in loaded if m in heavy or m in libraries))\n"
        "print(sorted(m for m in sys.modules if m.startswith(local)))\n"
    )
    result = subprocess.run(
        [sys.executable, "-P", "-c", probe], capture_output=True, text=True, timeout=120, check=False
    )

    assert result.returncode == 0, result.stderr
    libraries, local_modules = result.stdout.strip().splitlines()
    assert libraries == str(sorted(LIBRARIES_BY_EXTENSION[extension]))
    assert local_modules == "[]"


def test_parse_upload_command_answers_with_one_json_document() -> None:
    """The ``parse-upload`` subcommand reads a header line and the payload, and writes only its answer."""

    header = {"filename": "notes.txt", "extension": ".txt", "memory_limit_mb": 1024, "timeout_seconds": 120}
    result = subprocess.run(
        default_parse_command(),
        input=json.dumps(header).encode() + b"\n" + b"Hello from the child",
        capture_output=True,
        env=child_environment(),
        timeout=120,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    response = json.loads(result.stdout)
    assert response["ok"] is True
    assert response["document"]["text"] == "Hello from the child"
    assert response["document"]["parser_name"] == "stdlib-text"


async def test_slow_child_is_stopped_at_the_time_limit_without_blocking_the_server() -> None:
    marker = "time.sleep(600) # slow-child"
    parser = IsolatedUserFileParser(timeout_seconds=0.5, command=_python(f"import time; {marker}"))
    ticks = 0

    async def tick() -> None:
        nonlocal ticks
        while True:
            await asyncio.sleep(0.02)
            ticks += 1

    ticker = asyncio.create_task(tick())
    started = time.monotonic()
    try:
        with pytest.raises(UserFileParseRejectedError) as rejected:
            # More than a pipe buffer: writing it must not block the event loop either.
            await parser.parse(payload=b"x" * (2 * 1024 * 1024), filename="slow.txt", extension=".txt")
    finally:
        ticker.cancel()

    assert rejected.value.reason == "Reading the file took longer than 0.5 seconds."
    assert rejected.value.error_type == "TimeoutError"
    assert time.monotonic() - started < 10
    # Other work kept running while the child was read and timed out.
    assert ticks >= 10
    assert _children_running(marker) == []


async def test_child_that_exceeds_the_memory_limit_is_stopped() -> None:
    hog = (
        "import time\n"
        "held = []\n"
        "for _ in range(64):\n"
        "    held.append(b'x' * (16 * 1024 * 1024))\n"
        "    time.sleep(0.02)\n"
        "time.sleep(600)  # memory-hog\n"
    )
    parser = IsolatedUserFileParser(memory_limit_mb=64, timeout_seconds=60, command=_python(hog))

    with pytest.raises(UserFileParseRejectedError) as rejected:
        await parser.parse(payload=b"data", filename="large.txt", extension=".txt")

    assert rejected.value.reason == "Reading the file needed more than 64 MB of memory."
    assert rejected.value.error_type == "MemoryError"
    assert _children_running("memory-hog") == []


@pytest.mark.parametrize(
    ("code", "error_type"),
    [
        ("import os; os._exit(3)", "ParseChildExited"),
        ("import os, signal; os.kill(os.getpid(), signal.SIGKILL)", "ParseChildExited"),
        ("print('not json')", "InvalidParseAnswer"),
        ('import sys; sys.stdout.write(\'{"ok": true, "document": {"text": 1}}\')', "InvalidParseAnswer"),
        ("import sys; sys.stdout.write('{\"ok\": false}')", "InvalidParseAnswer"),
    ],
)
async def test_child_that_ends_without_a_usable_answer_is_retried(code: str, error_type: str) -> None:
    """A crash, a signal or a broken command says nothing about the file, so the job retries."""

    with pytest.raises(UserFileParseChildError) as failed:
        await IsolatedUserFileParser(command=_python(code)).parse(payload=b"x", filename="a.txt", extension=".txt")

    assert failed.value.reason == UNREADABLE_REASON == "The file could not be read."
    assert failed.value.error_type == error_type
    assert is_retryable_processing_failure(failed.value) is True


def test_child_reports_running_out_of_memory_as_the_memory_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    def exhausted(**_kwargs: object) -> ParsedUserFileDocument:
        raise MemoryError

    monkeypatch.setattr(parse_child, "parse_upload", exhausted)
    request = ParseRequest(filename="big.txt", extension=".txt", memory_limit_mb=256, timeout_seconds=120)

    assert answer_parse_request(request, b"payload") == {
        "ok": False,
        "reason": "Reading the file needed more than 256 MB of memory.",
        "error_type": "MemoryError",
    }


def test_network_guard_refuses_connections_and_name_lookups() -> None:
    with socket.create_server(("127.0.0.1", 0)) as server:
        server.settimeout(0.5)
        port = server.getsockname()[1]
        probe = (
            "import socket\n"
            "from animama.adapters.parsers.parse_child import NetworkAccessBlockedError, install_network_guard\n"
            "install_network_guard()\n"
            "attempts = [\n"
            f"    lambda: socket.create_connection(('127.0.0.1', {port}), timeout=2),\n"
            f"    lambda: socket.socket().connect(('127.0.0.1', {port})),\n"
            f"    lambda: socket.socket().connect_ex(('127.0.0.1', {port})),\n"
            "    lambda: socket.getaddrinfo('localhost', 443),\n"
            "    lambda: socket.socket(type=socket.SOCK_DGRAM).sendto(b'x', ('127.0.0.1', 9)),\n"
            "]\n"
            "for attempt in attempts:\n"
            "    try:\n"
            "        attempt()\n"
            "    except NetworkAccessBlockedError:\n"
            "        continue\n"
            "    raise SystemExit('network access was not refused')\n"
            "print('refused')\n"
        )
        result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, timeout=60, check=False)

        assert result.returncode == 0, result.stderr
        assert result.stdout.strip() == "refused"
        with pytest.raises(TimeoutError):
            server.accept()


def test_address_space_backstop_sits_above_the_memory_limit() -> None:
    # Twice the limit plus 512 MB: room for the interpreter and one sampling interval of growth.
    assert parse_child.address_space_limit_bytes(1024) == (2 * 1024 + 512) * 1024 * 1024
    assert parse_child.address_space_limit_bytes(128) == (2 * 128 + 512) * 1024 * 1024


@pytest.mark.skipif(not sys.platform.startswith("linux"), reason="only Linux enforces RLIMIT_AS")
def test_linux_child_cannot_grow_past_its_address_space_backstop() -> None:
    probe = (
        "from animama.adapters.parsers.parse_child import address_space_limit_bytes, apply_resource_limits\n"
        "apply_resource_limits(memory_limit_mb=256, timeout_seconds=60)\n"
        "try:\n"
        "    held = b'x' * address_space_limit_bytes(256)\n"
        "except MemoryError:\n"
        "    print('limited')\n"
    )
    result = subprocess.run([sys.executable, "-c", probe], capture_output=True, text=True, timeout=60, check=False)

    assert result.stdout.strip() == "limited", result.stderr


def test_parsed_documents_survive_the_child_protocol() -> None:
    document = ParsedUserFileDocument(
        text="# Report\n\nBody text",
        parser_name="test",
        metadata={"parser": "test", "pages": [1, 2], "nested": {"flag": True, "ratio": 0.5}},
        tables=[{"table_index": 0, "rows": [["name", "value"], ["alpha", "1"]], "source": "tsv"}],
        chunks=[
            UserFileChunkDraft(
                chunk_index=0,
                text="Body text",
                char_count=9,
                token_estimate=3,
                metadata={"pages": [1]},
                embedding_text="Report\nBody text",
                embedding=[0.25, -1.5],
            ),
            UserFileChunkDraft(chunk_index=1, text="More", char_count=4, token_estimate=1, metadata={}),
        ],
        source_outline=(UserFileOutlineItem(level=1, title="Report"), UserFileOutlineItem(level=2, title="Costs")),
        source_outline_truncated=True,
    )
    plain = ParsedUserFileDocument(text="plain", parser_name="stdlib-text", metadata={})

    for original in (document, plain):
        assert decode_parsed_document(json.loads(json.dumps(encode_parsed_document(original)))) == original


@pytest.mark.parametrize(
    "value",
    [
        None,
        [],
        {"parser_name": "p", "metadata": {}},
        {"text": 1, "parser_name": "p", "metadata": {}},
        {"text": "t", "parser_name": "p", "metadata": []},
        {"text": "t", "parser_name": "p", "metadata": {}, "tables": {}},
        {"text": "t", "parser_name": "p", "metadata": {}, "chunks": [{"chunk_index": "0"}]},
        {"text": "t", "parser_name": "p", "metadata": {}, "source_outline": [{"level": "1", "title": "x"}]},
        {"text": "t", "parser_name": "p", "metadata": {}, "source_outline_truncated": "yes"},
    ],
)
def test_malformed_child_documents_are_refused(value: object) -> None:
    with pytest.raises(ValueError):
        decode_parsed_document(value)


def test_parse_command_runs_the_frozen_runtime_or_the_package_module(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delattr(sys, "frozen", raising=False)
    # -P keeps the server's working directory off the child's import path.
    assert default_parse_command() == [sys.executable, "-P", "-m", "animama.runtime.cli", "parse-upload"]

    monkeypatch.setattr(sys, "frozen", True, raising=False)
    assert default_parse_command() == [sys.executable, "parse-upload"]


def test_child_environment_is_an_allowlist_without_secrets() -> None:
    inherited = {
        "PATH": "/usr/bin",
        "HOME": "/home/owner",
        "TMPDIR": "/tmp/owner",
        "LANG": "en_US.UTF-8",
        "LC_ALL": "C.UTF-8",
        "PYTHONUNBUFFERED": "1",
        "PYTHONPATH": "/app/src",
        "_PYI_APPLICATION_HOME_DIR": "/Applications/Animama.app/Contents/Resources/runtime",
        "SystemRoot": "C:\\Windows",
    }
    secrets = {
        "OPENAI_API_KEY": "sk-secret",
        "ANTHROPIC_API_KEY": "secret",
        "ANIMAMA_DATABASE_URL": "postgresql+asyncpg://animama:password@127.0.0.1/animama",
        "ANIMAMA_DESKTOP_CONTROL_TOKEN": "token",
        "ANIMAMA_CONNECTION_C1_API_KEY": "secret",
        "PGPASSWORD": "password",
        "PGHOST": "127.0.0.1",
        "PGUSER": "animama",
        "AWS_SECRET_ACCESS_KEY": "secret",
        "GITHUB_TOKEN": "secret",
        "PYTHON_KEYRING_PASSWORD": "secret",
    }

    assert child_environment({**inherited, **secrets}) == inherited
