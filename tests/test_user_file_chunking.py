"""Uploads are chunked at their headings, within the configured token limit (spec R4.1 to R4.4, R4.6).

Documents come from the real parsers where the format matters (CSV, XLSX and
PDF); Markdown documents are written inline. Token counts use cl100k_base from
the encoding file llama-index bundles, so nothing here touches the network.
"""

from __future__ import annotations

import logging
import random
import socket
import time
import tracemalloc
from pathlib import Path
from typing import Any

import pytest
import tiktoken
import tiktoken.load

from animama.adapters.parsers.dispatch import parse_user_file
from animama.app.chat.memory_tools import MAX_UPLOADED_FILE_READ_RESPONSE_TOKENS
from animama.app.model_clients.context_budget import estimate_text_tokens
from animama.app.services.user_file_chunking import MAX_CHUNK_CHARS_PER_TOKEN, chunk_parsed_user_file_document
from animama.app.util.text_tokens import (
    CL100K_BASE_FILE_NAME,
    EXACT_COUNT_MAX_CHARS,
    TokenCounter,
    bundled_tiktoken_cache_dir,
    cl100k_token_counter,
    estimate_tokens,
    load_cl100k_base,
)
from animama.domain.user_file_processing import (
    DEFAULT_USER_FILE_CHUNK_MAX_TOKENS,
    MAX_USER_FILE_CHUNK_MAX_TOKENS,
    MIN_USER_FILE_CHUNK_MAX_TOKENS,
    ParsedUserFileDocument,
    UserFileChunkDraft,
)
from animama.server.config import Settings
from tests.user_file_fixtures import IMAGE_PAGE, pdf_bytes, text_page, xlsx_bytes

COMPACT_METADATA_KEYS = {"chunk_type", "headings", "pages", "table_index", "row_start", "row_end"}
WORDS = (
    "river stone garden light paper window market bridge silver morning harbor engine winter "
    "forest letter column signal planet orange basket ladder kettle mirror pocket shadow"
).split()


@pytest.fixture(scope="module")
def encoding() -> tiktoken.Encoding:
    return load_cl100k_base()


def _tokens(encoding: tiktoken.Encoding, text: str) -> int:
    return len(encoding.encode_ordinary(text))


def _prose(words: int, *, seed: int = 0, end: str = ".") -> str:
    """A sentence of ``words`` common words: about one token each."""

    return " ".join(WORDS[(seed * 7 + index) % len(WORDS)] for index in range(words)).capitalize() + end


def _document(text: str, *, format_name: str = "md", **metadata: Any) -> ParsedUserFileDocument:
    return ParsedUserFileDocument(text=text, parser_name="test", metadata={"format": format_name, **metadata})


def _chunk(document: ParsedUserFileDocument, *, max_tokens: int = DEFAULT_USER_FILE_CHUNK_MAX_TOKENS) -> list[Any]:
    return chunk_parsed_user_file_document(document, max_tokens=max_tokens)


def _assert_within_limit(chunks: list[UserFileChunkDraft], encoding: tiktoken.Encoding, max_tokens: int) -> None:
    for chunk in chunks:
        # The token estimate counts the embedding text, the chunk's text behind its heading path.
        assert chunk.token_estimate == _tokens(encoding, chunk.embedding_text or chunk.text) <= max_tokens
        # Four characters per token at most, as the uploaded-file read tool estimates.
        assert chunk.char_count == len(chunk.text) <= MAX_CHUNK_CHARS_PER_TOKEN * max_tokens, chunk.text[:200]
    assert [chunk.chunk_index for chunk in chunks] == list(range(len(chunks)))


# --- Sections and heading paths -------------------------------------------------------------------


def test_chunks_split_at_headings_and_carry_their_heading_paths(encoding: tiktoken.Encoding) -> None:
    sections = [
        "# Report",
        _prose(40, seed=1),
        "## Results",
        _prose(40, seed=2),
        "### Costs",
        _prose(40, seed=3),
        "## Appendix",
        _prose(40, seed=4),
    ]

    chunks = _chunk(_document("\n\n".join(sections)), max_tokens=100)

    assert [chunk.text for chunk in chunks] == [
        "\n\n".join(sections[index : index + 2]) for index in range(0, len(sections), 2)
    ]
    assert [chunk.metadata["headings"] for chunk in chunks] == [
        ["Report"],
        ["Report", "Results"],
        ["Report", "Results", "Costs"],
        ["Report", "Appendix"],
    ]
    assert chunks[2].embedding_text == f"Report > Results > Costs\n\n{chunks[2].text}"
    _assert_within_limit(chunks, encoding, 100)


def test_small_adjacent_sections_merge_and_keep_their_heading_lines() -> None:
    text = (
        "# Guide\n\nShort intro.\n\n## Install\n\nRun the installer.\n\n"
        "### Linux\n\nUse the package.\n\n## Use\n\nOpen it."
    )

    chunks = _chunk(_document(text))

    assert [chunk.text for chunk in chunks] == [text]
    # Merged sections keep the headings they share; their own headings stay in the text.
    assert chunks[0].metadata["headings"] == ["Guide"]
    assert chunks[0].embedding_text == f"Guide\n\n{text}"


def test_small_top_level_sections_merge_with_only_the_headings_they_share() -> None:
    text = "Preface line.\n\n# Budget\n\nRent and food.\n\n# Notes\n\nRemember the deposit."

    (chunk,) = _chunk(_document(text))

    assert chunk.text == text
    # The sections share no heading, so the chunk has no heading path.
    assert "headings" not in chunk.metadata and chunk.embedding_text is None


def test_worksheets_never_share_a_chunk() -> None:
    def build(workbook: Any) -> None:
        workbook.active.title = "Budget"
        workbook.active.append(["Item", "Cost"])
        workbook.active.append(["Rent", 1200])
        workbook.create_sheet("Blank")
        notes = workbook.create_sheet("Notes")
        notes.append(["Remember the deposit"])

    document = parse_user_file(payload=xlsx_bytes(build), filename="budget.xlsx", extension=".xlsx")

    chunks = _chunk(document)

    assert [chunk.text for chunk in chunks] == [
        "# Budget\n\n| Item | Cost |\n| --- | --- |\n| Rent | 1200 |",
        "# Blank",
        "# Notes\n\n| Remember the deposit |\n| --- |",
    ]
    assert [chunk.metadata["headings"] for chunk in chunks] == [["Budget"], ["Blank"], ["Notes"]]
    assert [chunk.metadata["chunk_type"] for chunk in chunks] == ["table", "prose", "table"]
    assert chunks[0].metadata | {"table_index": 0, "row_start": 1, "row_end": 1} == chunks[0].metadata


def test_consecutive_headings_stay_with_the_text_that_follows_them(encoding: tiktoken.Encoding) -> None:
    body = [_prose(35, seed=index) for index in range(6)]
    text = "# Manual\n\n## Chapter 1\n\n### Setup\n\n" + "\n\n".join(body)

    chunks = _chunk(_document(text), max_tokens=100)

    assert chunks[0].text.startswith("# Manual\n\n## Chapter 1\n\n### Setup\n\n" + body[0])
    assert all(chunk.metadata["headings"] == ["Manual", "Chapter 1", "Setup"] for chunk in chunks)
    _assert_within_limit(chunks, encoding, 100)


def test_hash_lines_are_headings_only_in_markdown_formats() -> None:
    text = "# not a heading in plain text\n\nSome text."

    for format_name, headings in (("txt", None), ("md", ["not a heading in plain text"])):
        (chunk,) = _chunk(_document(text, format_name=format_name))
        assert chunk.text == text
        assert chunk.metadata.get("headings") == headings


def test_headings_inside_code_fences_do_not_start_sections() -> None:
    text = "# Script\n\n```sh\n# install\nmake sync\n```\n\nDone."

    (chunk,) = _chunk(_document(text))

    assert chunk.text == text
    assert chunk.metadata["headings"] == ["Script"]


# --- Size limit and splitting ---------------------------------------------------------------------


def test_large_sections_split_between_paragraphs(encoding: tiktoken.Encoding) -> None:
    paragraphs = [_prose(30, seed=index) for index in range(8)]
    text = "## Notes\n\n" + "\n\n".join(paragraphs)

    chunks = _chunk(_document(text), max_tokens=80)

    assert len(chunks) > 1
    for paragraph in paragraphs:
        # Every paragraph lies whole in exactly one chunk.
        assert sum(paragraph in chunk.text for chunk in chunks) == 1
    assert "\n\n".join(chunk.text for chunk in chunks) == text
    _assert_within_limit(chunks, encoding, 80)


def test_long_paragraphs_split_between_sentences(encoding: tiktoken.Encoding) -> None:
    sentences = [_prose(12, seed=index, end=("." if index % 3 else "?")) for index in range(20)]
    paragraph = " ".join(sentences)

    chunks = _chunk(_document(paragraph, format_name="txt"), max_tokens=64)

    assert len(chunks) > 1
    assert " ".join(chunk.text for chunk in chunks) == paragraph
    assert all(chunk.text.endswith((".", "?")) for chunk in chunks)
    _assert_within_limit(chunks, encoding, 64)


def test_cjk_text_splits_after_full_width_sentence_ends(encoding: tiktoken.Encoding) -> None:
    sentences = [
        "東京都の人口は約千四百万人です。",
        "本当にそうですか？",
        "はい、その通りです！",
        "明日は雨が降るでしょう。",
    ]
    paragraph = "".join(sentences * 12)

    chunks = _chunk(_document(paragraph, format_name="txt"), max_tokens=64)

    assert len(chunks) > 1
    assert "".join(chunk.text for chunk in chunks) == paragraph
    assert all(chunk.text.endswith(("。", "？", "！")) for chunk in chunks)
    _assert_within_limit(chunks, encoding, 64)


def test_a_sentence_without_ends_splits_between_words(encoding: tiktoken.Encoding) -> None:
    run_on = " ".join(WORDS[index % len(WORDS)] for index in range(400))

    chunks = _chunk(_document(run_on, format_name="txt"), max_tokens=64)

    assert len(chunks) > 1
    assert " ".join(chunk.text for chunk in chunks) == run_on
    _assert_within_limit(chunks, encoding, 64)


@pytest.mark.parametrize("word", ["x" * 9000, "漢字" * 2500, "Z29vZCBkYXk=" * 800])
def test_a_single_oversized_word_splits_by_tokens(word: str, encoding: tiktoken.Encoding) -> None:
    chunks = _chunk(_document(word, format_name="txt"), max_tokens=64)

    assert len(chunks) > 1
    assert "".join(chunk.text for chunk in chunks) == word
    _assert_within_limit(chunks, encoding, 64)


def test_heading_paths_count_toward_the_limit_and_long_ones_are_shortened(encoding: tiktoken.Encoding) -> None:
    long_title = " ".join(WORDS)
    text = f"# {long_title}\n\n## Results\n\n" + "\n\n".join(_prose(30, seed=index) for index in range(6))
    assert _tokens(encoding, f"{long_title} > Results") > 25

    chunks = _chunk(_document(text), max_tokens=100)

    assert len(chunks) > 1
    for chunk in chunks:
        label, _blank, body = (chunk.embedding_text or "").partition("\n\n")
        assert body == chunk.text
        # The label keeps the deepest heading and stays within a quarter of the limit.
        assert label.endswith("Results") and _tokens(encoding, label) <= 25
        # Metadata keeps the whole path.
        assert chunk.metadata["headings"] == [long_title, "Results"]
    _assert_within_limit(chunks, encoding, 100)


@pytest.mark.parametrize("max_tokens", [MIN_USER_FILE_CHUNK_MAX_TOKENS, 200, DEFAULT_USER_FILE_CHUNK_MAX_TOKENS])
def test_mixed_documents_stay_within_the_limit(max_tokens: int, encoding: tiktoken.Encoding) -> None:
    rows = "\n".join(f"| item {index} | {index * 37 % 1000} | note {index} |" for index in range(120))
    text = "\n\n".join(
        [
            "# Mixed",
            _prose(150, seed=1),
            "## Lists",
            "\n".join(f"- {_prose(9, seed=index, end='')}" for index in range(60)),
            "## Table",
            "| Item | Cost | Note |\n| --- | --- | --- |\n" + rows,
            "## Code",
            "```python\n" + "\n".join(f"value_{index} = compute({index}, factor=2)" for index in range(80)) + "\n```",
            "## 日本語",
            "これは長い日本語の文章です、句読点を含みます。" * 40,
        ]
    )

    chunks = _chunk(_document(text), max_tokens=max_tokens)

    _assert_within_limit(chunks, encoding, max_tokens)
    for line in text.split("\n"):
        # Nothing is lost: every line survives in some chunk (split lines in pieces).
        assert any(line.strip()[:20] in chunk.text for chunk in chunks)


# --- Embedding text ---------------------------------------------------------------------------------


def test_embedding_text_starts_with_the_heading_path_while_the_stored_text_does_not() -> None:
    text = "# Report\n\n## Results\n\nRevenue grew."

    (chunk,) = _chunk(_document(text))

    assert chunk.text == text
    assert chunk.embedding_text == "Report > Results\n\n# Report\n\n## Results\n\nRevenue grew."

    (plain,) = _chunk(_document("No headings here.", format_name="txt"))
    assert plain.text == "No headings here." and plain.embedding_text is None


# --- Tables ---------------------------------------------------------------------------------------


def test_csv_tables_repeat_their_header_row_in_every_chunk(encoding: tiktoken.Encoding) -> None:
    rows = ["name,value,notes"] + [f"row {index},{index},note | {index}" for index in range(1, 201)]
    document = parse_user_file(payload="\n".join(rows).encode(), filename="data.csv", extension=".csv")

    chunks = _chunk(document, max_tokens=100)

    header = "| name | value | notes |\n| --- | --- | --- |"
    assert len(chunks) > 1
    assert all(chunk.text.startswith(header + "\n") for chunk in chunks)
    assert all(chunk.metadata["chunk_type"] == "table" and chunk.metadata["table_index"] == 0 for chunk in chunks)
    ranges = [(chunk.metadata["row_start"], chunk.metadata["row_end"]) for chunk in chunks]
    assert ranges[0][0] == 1 and ranges[-1][1] == 200
    assert all(previous[1] + 1 == current[0] for previous, current in zip(ranges, ranges[1:], strict=False))
    body = [line for chunk in chunks for line in chunk.text.split("\n")[2:]]
    assert body == document.text.split("\n")[2:]
    _assert_within_limit(chunks, encoding, 100)


def test_xlsx_chunks_stay_within_one_sheet_named_by_their_heading_path(encoding: tiktoken.Encoding) -> None:
    def build(workbook: Any) -> None:
        budget = workbook.active
        budget.title = "Budget"
        budget.append(["Item", "Cost", "When"])
        for index in range(300):
            budget.append([f"Item {index}", index * 3, f"2026-01-{index % 28 + 1:02d}"])
        notes = workbook.create_sheet("Notes")
        notes.append(["Note"])
        notes.append(["Remember the deposit"])

    document = parse_user_file(payload=xlsx_bytes(build), filename="budget.xlsx", extension=".xlsx")

    chunks = _chunk(document, max_tokens=150)

    budget_chunks = [chunk for chunk in chunks if chunk.metadata["headings"] == ["Budget"]]
    assert [chunk.metadata["headings"] for chunk in chunks] == [["Budget"]] * len(budget_chunks) + [["Notes"]]
    assert len(budget_chunks) > 1
    assert budget_chunks[0].text.startswith("# Budget\n\n| Item | Cost | When |\n| --- | --- | --- |\n")
    assert all(chunk.text.startswith("| Item | Cost | When |\n| --- | --- | --- |\n") for chunk in budget_chunks[1:])
    assert all("Remember" not in chunk.text for chunk in budget_chunks)
    assert chunks[-1].text == "# Notes\n\n| Note |\n| --- |\n| Remember the deposit |"
    assert chunks[-1].embedding_text == f"Notes\n\n{chunks[-1].text}"
    assert all(chunk.metadata["chunk_type"] == "table" for chunk in chunks)
    _assert_within_limit(chunks, encoding, 150)


def test_table_chunks_of_any_cells_stay_within_the_limit(encoding: tiktoken.Encoding) -> None:
    rng = random.Random(5)
    cells = ["12", "3.5", "-7", "Café", "日本語", "😀", "a \\| b", "it's", "…", "", "$9.99", "한국어", "**bold**"]
    rows = [f"| {' | '.join(rng.choice(cells) for _ in range(4))} |" for _ in range(300)]
    text = "## Data\n\n| A | B | C | D |\n| --- | --- | --- | --- |\n" + "\n".join(rows) + "\n\nAfter the table."

    chunks = _chunk(_document(text), max_tokens=80)

    assert sum(chunk.metadata["chunk_type"] == "table" for chunk in chunks) > 5
    _assert_within_limit(chunks, encoding, 80)


def _wide_csv(columns: int, rows: int) -> ParsedUserFileDocument:
    rng = random.Random(3)
    lines = [",".join(f"sensor_{column}" for column in range(columns))]
    lines += [",".join(str(rng.randint(0, 999)) for _ in range(columns)) for _ in range(rows)]
    return parse_user_file(payload="\n".join(lines).encode(), filename="wide.csv", extension=".csv")


def test_wide_tables_keep_a_header_cut_to_its_first_columns(encoding: tiktoken.Encoding) -> None:
    """A header too long to repeat whole is cut to its first columns; rows too long for a chunk split between cells."""

    document = _wide_csv(columns=400, rows=40)
    header_line_end = document.text.index("\n")
    data_start = document.text.index("\n", header_line_end + 1) + 1

    chunks = _chunk(document)

    assert {chunk.metadata["chunk_type"] for chunk in chunks} == {"table"}
    assert {chunk.metadata["table_index"] for chunk in chunks} == {0}
    continuing = [chunk for chunk in chunks if "row_start" in chunk.metadata]
    assert continuing and all(chunk.text.startswith("| sensor_0 | sensor_1 | ") for chunk in continuing)
    repeated = continuing[-1].text.split("\n")[0]
    assert repeated.endswith(" | … |") and len(repeated) < len(document.text[:header_line_end])
    assert continuing[0].metadata["row_start"] == 1 and continuing[-1].metadata["row_end"] == 40
    # Every cell of every row is in some chunk, after the repeated header.
    bodies = "\n".join(chunk.text.split("\n", 2)[-1] for chunk in continuing)
    for row in document.text[data_start:].split("\n")[:3]:
        assert all(cell in bodies for cell in row.split(" | ")[1:-1])
    _assert_within_limit(chunks, encoding, DEFAULT_USER_FILE_CHUNK_MAX_TOKENS)


SINGLE_CHARACTER_WORDS = " ".join("abcdefghij"[index % 10] for index in range(500_000))
UNPUNCTUATED_CJK = "".join("漢字仮名交文章日本語中文"[index % 12] for index in range(300_000))


@pytest.mark.parametrize(
    ("case", "document"),
    [
        ("single-character words", _document(SINGLE_CHARACTER_WORDS, format_name="txt")),
        ("unpunctuated CJK", _document(UNPUNCTUATED_CJK, format_name="txt")),
        ("wide CSV", None),
    ],
)
def test_pathological_text_chunks_in_memory_and_time_bounded_by_its_size(
    case: str, document: ParsedUserFileDocument | None
) -> None:
    """No object is made per word, line or cell: memory stays a few times the text (spec R1.6)."""

    document = document or _wide_csv(columns=1000, rows=120)
    size = len(document.text.encode())
    cl100k_token_counter()
    tracemalloc.start()
    started = time.monotonic()
    try:
        chunks = _chunk(document)
        elapsed = time.monotonic() - started
        _current, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()

    assert chunks
    assert peak < 6 * size + 4 * 2**20, f"{case}: peak {peak / 2**20:.1f} MiB for {size / 2**20:.1f} MiB of text"
    assert elapsed < 30, case


def test_parsers_record_table_summaries_instead_of_their_cells() -> None:
    def build(workbook: Any) -> None:
        sheet = workbook.active
        sheet.title = "Data"
        for index in range(50):
            sheet.append([f"r{index}", index])

    document = parse_user_file(payload=xlsx_bytes(build), filename="data.xlsx", extension=".xlsx")

    assert document.tables == [
        {
            "table_index": 0,
            "header": ["r0", "0"],
            "data_row_count": 49,
            "source": "xlsx",
            "sheet": "Data",
            "first_row": 1,
            "first_column": 1,
        }
    ]


# --- PDF pages ------------------------------------------------------------------------------------


def _pdf_document(*pages: bytes) -> ParsedUserFileDocument:
    return parse_user_file(payload=pdf_bytes(*pages), filename="paper.pdf", extension=".pdf")


def test_pdf_chunks_record_the_pages_they_span(encoding: tiktoken.Encoding) -> None:
    page_text = [_prose(13, seed=index) for index in range(6)]
    pages = [text_page(text.encode()) for text in page_text]
    # Page 4 is a scan without selectable text.
    document = _pdf_document(*pages[:3], IMAGE_PAGE, *pages[3:])
    numbers = {text: number for number, text in zip((1, 2, 3, 5, 6, 7), page_text, strict=True)}

    chunks = _chunk(document, max_tokens=64)

    assert len(chunks) > 1
    for chunk in chunks:
        spanned = [number for text, number in numbers.items() if text in chunk.text]
        assert chunk.metadata["pages"] == [min(spanned), max(spanned)]
    assert any(chunk.metadata["pages"] == [3, 5] for chunk in chunks)
    _assert_within_limit(chunks, encoding, 64)


def test_a_long_pdf_page_splits_into_chunks_of_that_page() -> None:
    long_page = [_prose(12, seed=index).encode() for index in range(30)]
    document = _pdf_document(text_page(b"Cover page."), text_page(*long_page), text_page(b"Back page."))

    chunks = _chunk(document, max_tokens=64)

    assert chunks[0].metadata["pages"][0] == 1 and chunks[-1].metadata["pages"][1] == 3
    inner = [chunk for chunk in chunks if "Cover" not in chunk.text and "Back" not in chunk.text]
    assert inner and all(chunk.metadata["pages"] == [2, 2] for chunk in inner)


def test_chunk_metadata_stays_compact() -> None:
    document = _pdf_document(*(text_page(_prose(40, seed=index).encode()) for index in range(40)))
    assert len(document.metadata["pdf_pages"]) == 40

    chunks = _chunk(document, max_tokens=200)

    for chunk in chunks:
        assert set(chunk.metadata) <= COMPACT_METADATA_KEYS
        assert set(chunk.metadata) == {"chunk_type", "pages"}


# --- Repeatability --------------------------------------------------------------------------------


def test_the_same_file_always_gives_the_same_chunks() -> None:
    def build(workbook: Any) -> None:
        sheet = workbook.active
        sheet.title = "Sheet"
        for index in range(200):
            sheet.append([f"name {index}", index, _prose(6, seed=index)])

    payloads = {
        ".xlsx": xlsx_bytes(build),
        ".pdf": pdf_bytes(*(text_page(_prose(30, seed=index).encode()) for index in range(10))),
        ".md": ("# Title\n\n" + "\n\n".join(f"## Part {i}\n\n{_prose(50, seed=i)}" for i in range(20))).encode(),
    }

    for extension, payload in payloads.items():
        first, second = (
            _chunk(parse_user_file(payload=payload, filename=f"file{extension}", extension=extension), max_tokens=100)
            for _ in range(2)
        )
        assert first == second and len(first) > 1


# --- Offline token counting -----------------------------------------------------------------------


@pytest.fixture
def no_network(monkeypatch: pytest.MonkeyPatch) -> None:
    """Fail every connection and name lookup, and tiktoken's own download path."""

    def refuse(*_args: object, **_kwargs: object) -> None:
        raise AssertionError("token counting must not use the network")

    monkeypatch.setattr(socket.socket, "connect", refuse)
    monkeypatch.setattr(socket.socket, "connect_ex", refuse)
    monkeypatch.setattr(socket, "create_connection", refuse)
    monkeypatch.setattr(socket, "getaddrinfo", refuse)
    monkeypatch.setattr(tiktoken.load, "read_file", refuse)
    monkeypatch.setattr(tiktoken.load, "read_file_cached", refuse)


@pytest.mark.usefixtures("no_network")
def test_cl100k_base_loads_from_the_bundled_file_without_the_network() -> None:
    directory = bundled_tiktoken_cache_dir()
    assert directory is not None and (directory / CL100K_BASE_FILE_NAME).is_file()

    counter = TokenCounter(load_cl100k_base())

    assert counter.exact
    assert counter.count("hello world") == 2
    assert counter.count("日本語の文章です。") == 8
    (chunk,) = chunk_parsed_user_file_document(_document("# Title\n\nBody text."), max_tokens=64, counter=counter)
    assert chunk.embedding_text == "Title\n\n# Title\n\nBody text."
    assert chunk.token_estimate == counter.count(chunk.embedding_text)


def test_the_bundled_encoding_matches_tiktoken_cl100k_base(monkeypatch: pytest.MonkeyPatch) -> None:
    from tiktoken_ext import openai_public  # type: ignore[import-untyped]

    encoding = load_cl100k_base()
    # tiktoken's own constructor, given the same ranks instead of downloading them.
    monkeypatch.setattr(openai_public, "load_tiktoken_bpe", lambda *_args, **_kwargs: encoding._mergeable_ranks)
    official = openai_public.cl100k_base()

    assert encoding.name == official["name"]
    assert encoding._pat_str == official["pat_str"]
    assert encoding._special_tokens == official["special_tokens"]


@pytest.mark.usefixtures("no_network")
@pytest.mark.parametrize("damage", ["missing", "altered"])
def test_an_unusable_encoding_file_falls_back_to_an_estimate_and_logs_once(
    damage: str, tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    if damage == "altered":
        (tmp_path / CL100K_BASE_FILE_NAME).write_bytes(b"aGVsbG8= 0\n")
    caplog.set_level(logging.WARNING)

    counter = cl100k_token_counter(tmp_path)
    again = cl100k_token_counter(tmp_path)

    assert again is counter and not counter.exact
    assert counter.count("hello world") == estimate_tokens("hello world") > 0
    # CJK characters count about one token each, not a quarter.
    assert counter.count("日本語の文章です" * 25) >= 200
    warnings = [record for record in caplog.records if "token" in record.getMessage().lower()]
    assert len(warnings) == 1
    # The damaged file is left alone; nothing tried to replace it.
    assert sorted(entry.name for entry in tmp_path.iterdir()) == (
        [] if damage == "missing" else [CL100K_BASE_FILE_NAME]
    )

    chunks = chunk_parsed_user_file_document(
        _document("\n\n".join(_prose(40, seed=index) for index in range(10)), format_name="txt"),
        max_tokens=64,
        counter=counter,
    )
    assert len(chunks) > 1 and all(counter.count(chunk.text) <= 64 for chunk in chunks)


def test_estimates_are_close_to_cl100k_for_text_tables_and_cjk(encoding: tiktoken.Encoding) -> None:
    samples = [
        _prose(200),
        "| Item | Cost |\n| --- | --- |\n" + "\n".join(f"| row {index} | {index * 37} |" for index in range(60)),
        "日本語の文章です。これはテストです！" * 30,
        "这是一个测试文件，用于检查分块是否正确。" * 30,
        "안녕하세요. 이것은 테스트 문서입니다." * 30,
    ]
    for sample in samples:
        assert 0.6 <= estimate_tokens(sample) / _tokens(encoding, sample) <= 2.0, sample[:40]


def test_long_unbroken_runs_are_counted_and_chunked_in_bounded_time() -> None:
    """tiktoken takes quadratic time over one long run; counting cuts long runs first (spec R1.6)."""

    started = time.monotonic()
    counter = cl100k_token_counter()
    assert counter.count("a" * 2_000_000) > 0
    assert counter.count(" " * 1_000_000 + "x") > 0
    chunks = _chunk(_document("漢" * 300_000, format_name="txt"), max_tokens=DEFAULT_USER_FILE_CHUNK_MAX_TOKENS)

    assert "".join(chunk.text for chunk in chunks) == "漢" * 300_000
    assert time.monotonic() - started < 20


def test_texts_up_to_the_exact_bound_count_exactly(encoding: tiktoken.Encoding) -> None:
    paragraph = "東京都の人口は約千四百万人で、日本で最も多い。" * 60
    run = "x" * (EXACT_COUNT_MAX_CHARS - 1)

    for text in (paragraph, run):
        assert cl100k_token_counter().count(text) == _tokens(encoding, text)


# --- Settings -------------------------------------------------------------------------------------


def test_chunk_size_setting_must_be_usable(tmp_path: Path) -> None:
    roots = {"animama_content_root": tmp_path / "content", "animama_data_root": tmp_path / "data"}

    assert Settings(**roots).anima_user_file_chunk_max_tokens == DEFAULT_USER_FILE_CHUNK_MAX_TOKENS
    assert not hasattr(Settings(**roots), "anima_user_file_chunk_tokenizer_model")
    for size in (MIN_USER_FILE_CHUNK_MAX_TOKENS - 1, MAX_USER_FILE_CHUNK_MAX_TOKENS + 1):
        with pytest.raises(ValueError, match="ANIMAMA_USER_FILE_CHUNK_MAX_TOKENS"):
            Settings(**roots, anima_user_file_chunk_max_tokens=size)


@pytest.mark.parametrize(
    "max_tokens", [0, 1, 2, MIN_USER_FILE_CHUNK_MAX_TOKENS - 1, MAX_USER_FILE_CHUNK_MAX_TOKENS + 1]
)
def test_the_chunker_refuses_a_chunk_size_outside_its_range(max_tokens: int) -> None:
    """A tiny size could never fit a token beside a heading path; the chunker must refuse it, not loop."""

    with pytest.raises(ValueError, match="max_tokens"):
        chunk_parsed_user_file_document(_document("# Title\n\nBody text."), max_tokens=max_tokens)


@pytest.mark.parametrize("unit", ["— ", "что ", "…", "漢"])
def test_the_largest_chunks_fit_one_read_in_any_script(unit: str) -> None:
    """The read tool counts a non-ASCII character as a token; the largest chunks must still fit one read."""

    chunks = chunk_parsed_user_file_document(
        _document("# Notes\n\n" + unit * 40_000), max_tokens=MAX_USER_FILE_CHUNK_MAX_TOKENS
    )

    assert MAX_CHUNK_CHARS_PER_TOKEN * MAX_USER_FILE_CHUNK_MAX_TOKENS < MAX_UPLOADED_FILE_READ_RESPONSE_TOKENS
    assert max(estimate_text_tokens(chunk.text) for chunk in chunks) <= MAX_UPLOADED_FILE_READ_RESPONSE_TOKENS
