"""Split a parsed upload into chunks that follow its headings (spec R4.1 to R4.4, R4.6).

Markdown headings divide a document into sections, each named by its heading
path, such as ``Report > Results > Costs``. A section that fits within the chunk
size is one chunk, and adjacent sections merge while they fit together; every
heading line stays in the text, and a merged chunk's path is the headings its
sections share. A chunk never continues from one section into a section that
does not fit with it whole. In a document of tables (a workbook, CSV or TSV),
each heading's table keeps chunks of its own: worksheets never share a chunk.

A larger section is cut into chunks one at a time. Each chunk takes as much as
fits and ends at the best boundary in the second half of that span: a blank
line, then a sentence end (``. ! ?`` before whitespace, or ``。！？``), a line
break, a space, and only then anywhere. Code skips sentence ends. A table ends a
chunk after a row, else after a cell, and every chunk that continues a table
starts with its header row, cut to its first columns when the whole header
would take more than half a chunk. Nothing here makes an object per word, line
or paragraph, so a pathological file costs time in proportion to its chunks.

A chunk's embedding text is its heading path, a blank line and its text, and
holds at most the chunk size in cl100k_base tokens, counted offline by
:mod:`animama.app.util.text_tokens`; its ``token_estimate`` is that count. The
stored text has no path and holds at most four characters per token of the
chunk size, the rate the uploaded-file read tool assumes, so every chunk fits
one read. A PDF chunk records the first and last page it spans. Only Markdown
formats (:data:`~animama.domain.user_file_processing.MARKDOWN_TEXT_FORMATS`)
have headings and tables. The same document always gives the same chunks.
"""

from __future__ import annotations

import bisect
import re
from collections.abc import Iterator
from dataclasses import dataclass, field
from typing import Any, Final

from animama.app.util.text_tokens import TokenCounter, cl100k_token_counter
from animama.domain.user_file_processing import (
    DEFAULT_USER_FILE_CHUNK_MAX_TOKENS,
    MARKDOWN_TEXT_FORMATS,
    MAX_USER_FILE_CHUNK_MAX_TOKENS,
    MIN_USER_FILE_CHUNK_MAX_TOKENS,
    MarkdownFenceTracker,
    ParsedUserFileDocument,
    UserFileChunkDraft,
    markdown_heading,
    user_file_document_format,
)

HEADING_PATH_SEPARATOR: Final = " > "
MAX_HEADING_PATH_TITLE_CHARS: Final = 200
"""A heading longer than this is clipped in heading paths and chunk metadata."""
MAX_CHUNK_CHARS_PER_TOKEN: Final = 4
"""A chunk's text holds at most this many characters per token of the chunk size.

The uploaded-file read tool estimates four ASCII characters, or one other
character, per token. With this cap and the largest chunk size every chunk fits
one read, whatever the script (spec R4.2).
"""
CHUNK_TYPE_PROSE: Final = "prose"
CHUNK_TYPE_TABLE: Final = "table"

_TEXT: Final = "text"
_TABLE: Final = "table"
_CODE: Final = "code"

# Characters per token assumed for a first cut; each chunk then measures its own.
_INITIAL_CHARS_PER_TOKEN: Final = 3.0
# A chunk filled to this share of its tokens is full enough; a fuller one is not looked for.
_FULL_ENOUGH: Final = 0.9
# Each cut aims at this share, between full enough and full, so a first count usually settles it.
_AIM: Final = 0.95
_FILL_ATTEMPTS: Final = 6

# A sentence end: ". ! ?" and any closing quotes or brackets before whitespace, or a
# full-width "。！？" and its closers. Each alternative starts only at the first mark of
# a run, so a long run of marks is scanned once.
_SENTENCE_END = re.compile(r"(?<![.!?])[.!?]++[\"'”’)\]]*+(?=\s)|(?<![。！？])[。！？]++[」』）”’\"')\]]*+")
_BLANK_LINE = re.compile(r"\n[^\S\n]*\n")
_NON_SPACE = re.compile(r"\S")
_CELL_SEPARATOR = re.compile(r"(?<!\\)\|")
_DELIMITER_CELL = re.compile(r":?-+:?")
_ELLIPSIS: Final = "…"


@dataclass(frozen=True, slots=True)
class _Block:
    """A run of paragraphs and lists, a table, or a fenced code block: a trimmed span of the text."""

    kind: str
    start: int
    end: int
    # Tables: where the header and delimiter rows end, and the table's position among the document's tables.
    header_end: int = 0
    table_index: int = -1


@dataclass(slots=True)
class _Section:
    """A run of heading lines, named by the path of the last one, and the blocks up to the next heading."""

    path: tuple[str, ...]
    start: int
    # Where the heading lines end; ``start`` itself for the text before the first heading.
    lead_end: int
    blocks: list[_Block] = field(default_factory=list)

    @property
    def end(self) -> int:
        return self.blocks[-1].end if self.blocks else self.lead_end


@dataclass(slots=True)
class _Open:
    """The chunk being filled: an optional repeated table header, then ``text[start:end]``."""

    start: int = -1
    end: int = -1
    prefix: str = ""
    # The count of its final embedding text, when known.
    tokens: int = -1
    # Whether it holds more than heading lines, and what: prose, or rows of which tables.
    content: bool = False
    prose: bool = False
    tables: set[int] = field(default_factory=set)
    first_row: int = 0
    last_row: int = 0


class _PageMap:
    """The PDF pages a span of the text covers, from the parser's per-page character ranges."""

    def __init__(self, numbers: list[int], starts: list[int], ends: list[int]) -> None:
        self._numbers = numbers
        self._starts = starts
        self._ends = ends

    @classmethod
    def from_metadata(cls, value: object, text_length: int) -> _PageMap | None:
        """Read ``[{"page", "start", "end"}, ...]`` in text order; anything malformed gives no page map."""

        if not isinstance(value, list) or not value:
            return None
        numbers: list[int] = []
        starts: list[int] = []
        ends: list[int] = []
        for entry in value:
            if not isinstance(entry, dict):
                return None
            page, start, end = entry.get("page"), entry.get("start"), entry.get("end")
            if not (_is_int(page) and _is_int(start) and _is_int(end)):
                return None
            assert isinstance(page, int) and isinstance(start, int) and isinstance(end, int)
            if page < 1 or not 0 <= start <= end <= text_length or (ends and start < ends[-1]):
                return None
            numbers.append(page)
            starts.append(start)
            ends.append(end)
        return cls(numbers, starts, ends)

    def span_pages(self, start: int, end: int) -> list[int] | None:
        """``[first, last]`` page holding text of ``[start, end)``, or ``None`` if none does."""

        first = bisect.bisect_right(self._ends, start)
        last = bisect.bisect_left(self._starts, end) - 1
        if first > last:
            return None
        return [self._numbers[first], self._numbers[last]]


def chunk_parsed_user_file_document(
    document: ParsedUserFileDocument,
    *,
    max_tokens: int = DEFAULT_USER_FILE_CHUNK_MAX_TOKENS,
    counter: TokenCounter | None = None,
) -> list[UserFileChunkDraft]:
    """Split a parsed document into chunks of at most ``max_tokens`` tokens, heading path included.

    ``max_tokens`` must lie between :data:`MIN_USER_FILE_CHUNK_MAX_TOKENS` and
    :data:`MAX_USER_FILE_CHUNK_MAX_TOKENS`. ``counter`` defaults to the shared
    cl100k_base counter. Chunking a large document takes a while; async callers
    run this in a worker thread.
    """

    if not MIN_USER_FILE_CHUNK_MAX_TOKENS <= max_tokens <= MAX_USER_FILE_CHUNK_MAX_TOKENS:
        raise ValueError(
            f"max_tokens must lie between {MIN_USER_FILE_CHUNK_MAX_TOKENS} and {MAX_USER_FILE_CHUNK_MAX_TOKENS}"
        )
    text = document.text
    page_map: _PageMap | None = None
    if "\r" in text:
        # Page ranges index the parser's text, and a PDF's text never holds a carriage return.
        text = text.replace("\r\n", "\n").replace("\r", "\n")
    else:
        page_map = _PageMap.from_metadata(document.metadata.get("pdf_pages"), len(text))
    # A workbook's sheets stay apart, even an empty one beside the next.
    separate = document.metadata.get("table_only") is True
    chunker = _Chunker(
        text,
        counter=counter or cl100k_token_counter(),
        max_tokens=max_tokens,
        merge_sections=not separate,
        page_map=page_map,
    )
    markdown = user_file_document_format(document) in MARKDOWN_TEXT_FORMATS
    for section in _sections(text, markdown=markdown, fold_headings=not separate):
        chunker.add(section)
    chunker.finish()
    return chunker.drafts


# --- Sections ---------------------------------------------------------------------------------------


def _sections(text: str, *, markdown: bool, fold_headings: bool) -> Iterator[_Section]:
    """The text's sections in order. Only Markdown text has headings, tables and fenced code."""

    if markdown:
        yield from _MarkdownReader(text, fold_headings=fold_headings).sections()
        return
    span = _trimmed(text, 0, len(text))
    if span is not None:
        yield _Section((), span[0], span[0], [_Block(_TEXT, *span)])


class _MarkdownReader:
    """Read Markdown line by line into sections, keeping only the current section and paragraph.

    Consecutive paragraphs and lists form one text block; a paragraph whose first
    two lines are a header row and a delimiter row is a table. With
    ``fold_headings``, consecutive headings open one section named by the last of
    them, so a heading always stays with the text after it.
    """

    def __init__(self, text: str, *, fold_headings: bool) -> None:
        self._text = text
        self._fold = fold_headings
        self._fences = MarkdownFenceTracker()
        self._headings: list[tuple[int, str]] = []
        self._section: _Section | None = None
        self._done: list[_Section] = []
        self._tables = 0
        # The text block, paragraph and code block being read, as spans of the text.
        self._run = (-1, -1)
        self._code = (-1, -1)
        self._paragraph = (-1, -1)
        self._paragraph_lines = 0
        self._first_line = (-1, -1)
        self._second_line = (-1, -1)

    def sections(self) -> Iterator[_Section]:
        text = self._text
        position = 0
        while position <= len(text):
            line_end = text.find("\n", position)
            if line_end < 0:
                line_end = len(text)
            self._line(position, line_end)
            if self._done:
                yield from self._done
                self._done.clear()
            position = line_end + 1
        self._end_paragraph()
        self._end_run()
        self._end_code()
        if self._section is not None:
            yield self._section

    def _line(self, line_start: int, line_end: int) -> None:
        text = self._text
        first = _NON_SPACE.search(text, line_start, line_end)
        start = first.start() if first is not None else line_end
        end = line_end
        while end > start and text[end - 1].isspace():
            end -= 1
        # Only a line starting with a backtick or tilde can open or close a fence.
        if first is not None and text[start] in "`~":
            code = self._fences.is_code(text[line_start:line_end])
        else:
            code = self._fences.inside
        if code:
            self._end_paragraph()
            self._end_run()
            if first is not None:
                self._code = (self._code[0] if self._code[0] >= 0 else start, end)
            return
        self._end_code()
        if first is None:
            self._end_paragraph()
            return
        # Only a line starting with "#" after up to three spaces can be a heading.
        if text[start] == "#" and start - line_start <= 3:
            heading = markdown_heading(text[line_start:line_end])
            if heading is not None:
                self._end_paragraph()
                self._end_run()
                self._heading(start, end, *heading)
                return
        if self._paragraph[0] < 0:
            self._paragraph = (start, end)
            self._paragraph_lines = 1
            self._first_line = (start, end)
        else:
            self._paragraph = (self._paragraph[0], end)
            self._paragraph_lines += 1
            if self._paragraph_lines == 2:
                self._second_line = (start, end)

    def _heading(self, start: int, end: int, level: int, title: str) -> None:
        while self._headings and self._headings[-1][0] >= level:
            self._headings.pop()
        self._headings.append((level, _path_title(title)))
        path = tuple(name for _level, name in self._headings)
        section = self._section
        if section is not None and not section.blocks and self._fold:
            section.lead_end, section.path = end, path
            return
        if section is not None:
            self._done.append(section)
        self._section = _Section(path, start, end)

    def _end_paragraph(self) -> None:
        start, end = self._paragraph
        if start < 0:
            return
        if self._paragraph_lines >= 2 and _starts_table(self._text, self._first_line, self._second_line):
            self._end_run()
            self._add(_Block(_TABLE, start, end, self._second_line[1], self._tables))
            self._tables += 1
        else:
            self._run = (self._run[0] if self._run[0] >= 0 else start, end)
        self._paragraph = (-1, -1)

    def _end_run(self) -> None:
        if self._run[0] >= 0:
            self._add(_Block(_TEXT, *self._run))
            self._run = (-1, -1)

    def _end_code(self) -> None:
        if self._code[0] >= 0:
            self._add(_Block(_CODE, *self._code))
            self._code = (-1, -1)

    def _add(self, block: _Block) -> None:
        if self._section is None:
            self._section = _Section((), block.start, block.start)
        self._section.blocks.append(block)


def _starts_table(text: str, header: tuple[int, int], delimiter: tuple[int, int]) -> bool:
    """Whether a paragraph's first two lines are a Markdown table's header row and delimiter row."""

    if text.find("|", header[0], header[1]) < 0:
        return False
    row = text[delimiter[0] : delimiter[1]]
    if "|" not in row or "-" not in row:
        return False
    return all(_DELIMITER_CELL.fullmatch(cell.strip()) for cell in row.strip("|").split("|"))


def _path_title(title: str) -> str:
    """A heading as a heading-path entry: on one line and at most :data:`MAX_HEADING_PATH_TITLE_CHARS` long."""

    return " ".join(title[: 4 * MAX_HEADING_PATH_TITLE_CHARS].split())[:MAX_HEADING_PATH_TITLE_CHARS].rstrip()


def _common_path(first: tuple[str, ...], second: tuple[str, ...]) -> tuple[str, ...]:
    shared = 0
    for left, right in zip(first, second, strict=False):
        if left != right:
            break
        shared += 1
    return first[:shared]


def _trimmed(text: str, start: int, end: int) -> tuple[int, int] | None:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return (start, end) if start < end else None


def _is_int(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


# --- Chunks -----------------------------------------------------------------------------------------


class _Chunker:
    """Turn sections into chunk drafts: small sections whole and merged, large ones cut chunk by chunk."""

    def __init__(
        self,
        text: str,
        *,
        counter: TokenCounter,
        max_tokens: int,
        merge_sections: bool,
        page_map: _PageMap | None,
    ) -> None:
        self._text = text
        self._counter = counter
        self._max_tokens = max_tokens
        self._max_chars = MAX_CHUNK_CHARS_PER_TOKEN * max_tokens
        self._merge = merge_sections
        self._page_map = page_map
        self._labels: dict[tuple[str, ...], tuple[str | None, int]] = {}
        self._counts: dict[str, int] = {}
        self._headers: dict[int, str] = {}
        self._row_cursor = (-1, 0, 0)
        self._chars_per_token = _INITIAL_CHARS_PER_TOKEN
        self._group: list[_Section] = []
        self._group_path: tuple[str, ...] = ()
        self._group_tokens = 0
        self.drafts: list[UserFileChunkDraft] = []

    def add(self, section: _Section) -> None:
        """Take the next section: merge it with the sections before it, or cut it into chunks."""

        text = self._text
        chars = section.end - section.start
        tokens = self._counter.count(text[section.start : section.end]) if chars <= self._max_chars else -1
        if tokens < 0 or tokens + self._label(section.path)[1] > self._max_tokens:
            self.finish()
            self._split(section)
            return
        group = self._group
        if group and self._merge:
            common = _common_path(self._group_path, section.path)
            gap = text[group[-1].end : section.start]
            merged = self._group_tokens + self._repeated_count(gap) + tokens
            if section.end - group[0].start <= self._max_chars and merged + self._label(common)[1] <= self._max_tokens:
                group.append(section)
                self._group_path, self._group_tokens = common, merged
                return
        self.finish()
        self._group, self._group_path, self._group_tokens = [section], section.path, tokens

    def finish(self) -> None:
        """Emit the sections waiting to merge, as many per chunk as fit by the count of the final text."""

        group = self._group
        while group:
            for size in range(len(group), 0, -1):
                path = group[0].path
                for section in group[1:size]:
                    path = _common_path(path, section.path)
                start, end = group[0].start, group[size - 1].end
                tokens = self._embedding_tokens(path, "", start, end)
                if tokens <= self._max_tokens:
                    chunk = _Open(start, end, tokens=tokens, content=True)
                    for section in group[:size]:
                        for block in section.blocks:
                            self._record(chunk, block, block.start, block.end)
                    self._emit(chunk, path)
                    group = group[size:]
                    break
                if size == 1:
                    # Rare: the section fit by the sum of its parts, not counted whole.
                    self._split(group[0])
                    group = group[1:]
                    break
        self._group = []

    def _split(self, section: _Section) -> None:
        """Cut a section too large for one chunk, keeping its heading lines with the text after them."""

        chunk = _Open()
        blocks = list(section.blocks)
        if section.lead_end > section.start:
            lead = self._text[section.start : section.lead_end]
            if len(lead) * 2 > self._max_chars or self._counter.count(lead) * 2 > self._max_tokens or not blocks:
                # Heading lines too long to lead a chunk are cut like text.
                blocks.insert(0, _Block(_TEXT, section.start, section.lead_end))
            else:
                chunk.start, chunk.end = section.start, section.lead_end
        for block in blocks:
            self._place(chunk, block, section.path)
        self._close(chunk, section.path)

    def _place(self, chunk: _Open, block: _Block, path: tuple[str, ...]) -> None:
        """Add a block to the open chunk, closing and opening chunks as it fills them."""

        split_header = False
        if block.kind == _TABLE:
            if chunk.content and not self._fits(chunk.start, chunk.prefix, block.end, path):
                # A table that does not fit whole beside earlier text starts a chunk of its own.
                self._close(chunk, path)
            # A header too large for one chunk gets chunks of its own, so every chunk of rows
            # starts with the repeated header.
            first = chunk.start if chunk.start >= 0 else block.start
            split_header = not self._fits(first, chunk.prefix, block.header_end, path)
        position = block.start
        while position < block.end:
            if chunk.start < 0:
                chunk.start = position
                if block.kind == _TABLE and position > block.header_end:
                    chunk.prefix = self._repeated_header(block, path)
            stop = block.header_end if split_header and position < block.header_end else block.end
            end, after, tokens = self._fill(chunk, position, block, path, stop)
            if end <= position:
                self._close(chunk, path)
                continue
            self._record(chunk, block, position, end)
            chunk.end, chunk.tokens, chunk.content = end, tokens, True
            if end >= block.end:
                return
            self._close(chunk, path)
            if end >= stop:
                # The header is done; the rows start a chunk of their own.
                row = _NON_SPACE.search(self._text, stop, block.end)
                after = row.start() if row is not None else block.end
            position = after

    def _fits(self, start: int, prefix: str, end: int, path: tuple[str, ...]) -> bool:
        """Whether a chunk of ``prefix`` and ``text[start:end]`` stays within both limits."""

        if end - start + (len(prefix) + 1 if prefix else 0) > self._max_chars:
            return False
        return self._embedding_tokens(path, prefix, start, end) <= self._max_tokens

    def _close(self, chunk: _Open, path: tuple[str, ...]) -> None:
        if chunk.start >= 0:
            self._emit(chunk, path)
        chunk.start, chunk.end, chunk.prefix, chunk.tokens = -1, -1, "", -1
        chunk.content, chunk.prose, chunk.first_row, chunk.last_row = False, False, 0, 0
        chunk.tables.clear()

    def _emit(self, chunk: _Open, path: tuple[str, ...]) -> None:
        """Append the draft of a chunk, with its compact metadata and the count of its embedding text."""

        body = self._text[chunk.start : chunk.end]
        text = f"{chunk.prefix}\n{body}" if chunk.prefix else body
        label = self._label(path)[0]
        embedding = f"{label}\n\n{text}" if label else None
        tokens = chunk.tokens if chunk.tokens >= 0 else self._counter.count(embedding or text)
        metadata: dict[str, Any] = {"chunk_type": CHUNK_TYPE_PROSE}
        if chunk.tables and not chunk.prose:
            metadata["chunk_type"] = CHUNK_TYPE_TABLE
            if len(chunk.tables) == 1:
                metadata["table_index"] = next(iter(chunk.tables))
                if chunk.first_row:
                    metadata["row_start"], metadata["row_end"] = chunk.first_row, chunk.last_row
        if path:
            metadata["headings"] = list(path)
        pages = self._page_map.span_pages(chunk.start, chunk.end) if self._page_map is not None else None
        if pages is not None:
            metadata["pages"] = pages
        self.drafts.append(
            UserFileChunkDraft(
                chunk_index=len(self.drafts),
                text=text,
                char_count=len(text),
                token_estimate=tokens,
                metadata=metadata,
                embedding_text=embedding,
            )
        )

    def _record(self, chunk: _Open, block: _Block, start: int, end: int) -> None:
        """Note what part of a block the chunk now holds, for its metadata."""

        if block.kind != _TABLE:
            chunk.prose = True
            return
        chunk.tables.add(block.table_index)
        first_data = block.header_end + 1
        if end <= first_data:
            return
        first = self._row(block, max(start, first_data))
        last = self._row(block, end - 1)
        chunk.first_row = first if not chunk.first_row else min(chunk.first_row, first)
        chunk.last_row = max(chunk.last_row, last)

    def _row(self, table: _Block, position: int) -> int:
        """The data row of a table that holds ``position``, counting forward from the last one asked about."""

        start, at, row = self._row_cursor
        if start != table.start or position < at:
            at, row = table.header_end + 1, 1
        row += self._text.count("\n", at, position)
        self._row_cursor = (table.start, position, row)
        return row

    # --- Filling a chunk --------------------------------------------------------------------------

    def _fill(
        self, chunk: _Open, position: int, block: _Block, path: tuple[str, ...], stop: int
    ) -> tuple[int, int, int]:
        """Where the open chunk ends in ``block`` between ``position`` and ``stop``: ``(end, next start, tokens)``.

        ``tokens`` counts the chunk's final embedding text. An ``end`` at
        ``position`` means none of the block fits beside the content the chunk
        already holds. The chunk takes as much as fits, by tokens and by
        characters, and ends at the best boundary in the second half of that
        span; each try cuts at a guess from the characters per token measured so
        far, then corrects the guess from the count.
        """

        text = self._text
        start = chunk.start
        head = self._head(path, chunk.prefix)
        head_tokens = self._repeated_count(head)
        room = self._max_chars - (len(chunk.prefix) + 1 if chunk.prefix else 0)
        ceiling = min(stop, start + room)
        may_close = chunk.content and position > start
        if ceiling <= position:
            # Only a chunk that holds content can be this full: it closes before the block.
            return position, position, 0
        if ceiling == stop:
            tokens = self._counter.count(head + text[start:ceiling])
            if tokens <= self._max_tokens:
                return ceiling, ceiling, tokens
        budget = self._max_tokens - head_tokens
        guess = min(ceiling, max(position + 1, start + int(_AIM * budget * self._chars_per_token)))
        best: tuple[int, int, int] | None = None
        tried: set[int] = set()
        for _attempt in range(_FILL_ATTEMPTS):
            end, after = self._boundary(start, position, guess, block, may_close=may_close)
            if end <= position or end in tried:
                break
            tried.add(end)
            tokens = self._counter.count(head + text[start:end])
            body_tokens = max(1, tokens - head_tokens)
            if tokens <= self._max_tokens:
                if best is None or end > best[0]:
                    best = (end, after, tokens)
                if tokens >= _FULL_ENOUGH * self._max_tokens or guess >= ceiling:
                    break
                grown = start + int((end - start) * (_AIM * self._max_tokens - head_tokens) / body_tokens)
                guess = min(ceiling, max(guess + 1, grown))
            else:
                shrunk = start + int((end - start) * (_AIM * self._max_tokens - head_tokens) / body_tokens)
                guess = max(position + 1, min(end - 1, shrunk))
        if best is None:
            if may_close:
                return position, position, 0
            return self._hard_cut(head, start, ceiling)
        end, _after, tokens = best
        if tokens > head_tokens:
            self._chars_per_token = (end - start) / (tokens - head_tokens)
        return best

    def _hard_cut(self, head: str, start: int, ceiling: int) -> tuple[int, int, int]:
        """The longest span from ``start``, cut anywhere, that fits; always at least one character."""

        good, bad = start + 1, ceiling + 1
        if self._counter.count(head + self._text[start:good]) <= self._max_tokens:
            while bad - good > 1:
                middle = (good + bad) // 2
                if self._counter.count(head + self._text[start:middle]) <= self._max_tokens:
                    good = middle
                else:
                    bad = middle
        return good, good, self._counter.count(head + self._text[start:good])

    def _boundary(self, start: int, position: int, guess: int, block: _Block, *, may_close: bool) -> tuple[int, int]:
        """The best place at or before ``guess`` to end a chunk, and where the next chunk starts.

        Boundaries in the second half of the chunk win, in this order: a blank line
        or the block's own start, a sentence end (not in code), a line break or
        row end, a cell end in a table, a space. Failing those, the chunk ends at
        the block's start when it may, else at the guess itself.
        """

        low = max(position, start + (guess - start) // 2)
        kind = block.kind
        finders = []
        if kind != _TABLE:
            finders.append(self._blank_line)
        if kind == _TEXT:
            finders.append(self._sentence_end)
        finders.append(self._line_break)
        if kind == _TABLE:
            finders.append(self._cell_end)
        finders.append(self._space)
        for index, finder in enumerate(finders):
            cut = finder(low, guess, position)
            if cut is not None:
                return cut
            if index == 0 and may_close and position >= low and kind != _TABLE:
                return position, position
        if may_close:
            return position, position
        return guess, guess

    def _blank_line(self, low: int, high: int, position: int) -> tuple[int, int] | None:
        last = None
        for match in _BLANK_LINE.finditer(self._text, low, high + 1):
            last = match
        return self._cut_before(last.start(), position) if last is not None else None

    def _sentence_end(self, low: int, high: int, position: int) -> tuple[int, int] | None:
        last = None
        for match in _SENTENCE_END.finditer(self._text, low, min(len(self._text), high + 1)):
            if match.end() <= high:
                last = match
        return self._cut_before(last.end(), position) if last is not None else None

    def _line_break(self, low: int, high: int, position: int) -> tuple[int, int] | None:
        found = self._text.rfind("\n", low, high)
        return self._cut_before(found, position) if found >= 0 else None

    def _space(self, low: int, high: int, position: int) -> tuple[int, int] | None:
        text = self._text
        for index in range(high - 1, low - 1, -1):
            if text[index].isspace():
                return self._cut_before(index, position)
        return None

    def _cell_end(self, low: int, high: int, position: int) -> tuple[int, int] | None:
        """After the last cell separator: the next chunk starts with that separator, as a row does."""

        last = None
        for match in _CELL_SEPARATOR.finditer(self._text, low, high - 1):
            last = match
        if last is None or last.start() <= position:
            return None
        return last.start() + 1, last.start()

    def _cut_before(self, cut: int, position: int) -> tuple[int, int] | None:
        """End a chunk at ``cut`` without trailing whitespace; the next one starts at the next character."""

        text = self._text
        end = cut
        while end > position and text[end - 1].isspace():
            end -= 1
        if end <= position:
            return None
        after = _NON_SPACE.search(text, cut)
        return end, after.start() if after is not None else len(text)

    # --- Headers, labels and counts ---------------------------------------------------------------

    def _repeated_header(self, table: _Block, path: tuple[str, ...]) -> str:
        """The header and delimiter rows that start every chunk continuing ``table``.

        A header that would take more than half a chunk is cut to its first
        columns, with an ``…`` column for the rest, to take at most a quarter.
        """

        cached = self._headers.get(table.start)
        if cached is not None:
            return cached
        text = self._text
        header = text[table.start : table.header_end]
        head_tokens = self._label(path)[1]
        if len(header) * 2 <= self._max_chars and (self._counter.count(header) + head_tokens) * 2 <= self._max_tokens:
            self._headers[table.start] = header
            return header
        first_line_end = text.find("\n", table.start, table.header_end)
        separators = [match.start() for match in _CELL_SEPARATOR.finditer(text, table.start, first_line_end)]

        def cut(columns: int) -> str:
            row = f"{text[table.start : separators[columns] + 1]} {_ELLIPSIS} |"
            return f"{row}\n|{' --- |' * (columns + 1)}"

        good = 0
        bad = len(separators)
        while bad - good > 1:
            middle = (good + bad) // 2
            candidate = cut(middle)
            if len(candidate) * 4 <= self._max_chars and self._counter.count(candidate) * 4 <= self._max_tokens:
                good = middle
            else:
                bad = middle
        result = cut(good) if good else ""
        self._headers[table.start] = result
        return result

    def _embedding_tokens(self, path: tuple[str, ...], prefix: str, start: int, end: int) -> int:
        return self._counter.count(self._head(path, prefix) + self._text[start:end])

    def _head(self, path: tuple[str, ...], prefix: str) -> str:
        """What precedes a chunk's own text in its embedding text: its label, and any repeated table header."""

        label = self._label(path)[0]
        return (f"{label}\n\n" if label else "") + (f"{prefix}\n" if prefix else "")

    def _repeated_count(self, text: str) -> int:
        """Count a string that recurs, a chunk's head or the gap between sections, once."""

        tokens = self._counts.get(text)
        if tokens is None:
            tokens = self._counter.count(text)
            # Gaps are whitespace and heads one per path and table, so the cache stays small.
            if len(text) <= self._max_chars:
                self._counts[text] = tokens
        return tokens

    def _label(self, path: tuple[str, ...]) -> tuple[str | None, int]:
        """The heading-path label of the embedding text, and the tokens of the label and its blank line.

        A label longer than a quarter of the chunk size drops its outer headings
        for an ellipsis, and the deepest heading alone is cut to fit.
        """

        cached = self._labels.get(path)
        if cached is not None:
            return cached
        if not path:
            result: tuple[str | None, int] = (None, 0)
        else:
            label = self._fitted_label(path, max(1, self._max_tokens // 4))
            result = (label, self._counter.count(f"{label}\n\n"))
        self._labels[path] = result
        return result

    def _fitted_label(self, path: tuple[str, ...], limit: int) -> str:
        for skipped in range(len(path)):
            label = HEADING_PATH_SEPARATOR.join(path[skipped:])
            if skipped:
                label = f"{_ELLIPSIS}{HEADING_PATH_SEPARATOR}{label}"
            if self._counter.count(label) <= limit:
                return label
        # Even the deepest heading behind an ellipsis is too long: keep as much of it as fits.
        title = path[-1]
        good, bad = 0, len(title) + 1
        while bad - good > 1:
            middle = (good + bad) // 2
            if self._counter.count(title[:middle]) <= limit:
                good = middle
            else:
                bad = middle
        return title[:good].rstrip() or title[:1]


__all__ = [
    "CHUNK_TYPE_PROSE",
    "CHUNK_TYPE_TABLE",
    "HEADING_PATH_SEPARATOR",
    "MAX_CHUNK_CHARS_PER_TOKEN",
    "MAX_HEADING_PATH_TITLE_CHARS",
    "chunk_parsed_user_file_document",
]
