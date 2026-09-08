"""Deterministic overview extraction for processed user uploads."""

from __future__ import annotations

import json
import math
import re
import unicodedata
from collections import Counter
from collections.abc import Mapping, Sequence
from xml.etree import ElementTree

from animama.domain.user_file_processing import (
    ParsedUserFileDocument,
    UserFileChunkDraft,
    UserFileOutlineItem,
    UserFileOverview,
    UserFileOverviewMethod,
)

USER_FILE_OVERVIEW_VERSION = 1
MAX_OVERVIEW_OUTLINE_ITEMS = 200
MAX_OVERVIEW_TITLE_CHARS = 200
MAX_OVERVIEW_OUTLINE_CHARS = 16_000
MAX_OVERVIEW_DESCRIPTION_CHARS = 400
MAX_OVERVIEW_HEADING_LEVEL = 6
MAX_SUMMARY_SAMPLE_CHARS = 12_000
SUMMARY_SEGMENT_CHARS = MAX_SUMMARY_SAMPLE_CHARS // 3

_METHODS = frozenset({"structured", "extractive", "table", "json", "xml", "fallback_excerpt"})
_ATX_HEADING_RE = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$")
_FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
_MARKDOWN_LINK_RE = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_SENTENCE_RE = re.compile(r"[^.!?\n]+[.!?]+(?:[\"')\]]*)")
_WORD_RE = re.compile(r"[^\W_]+(?:['’-][^\W_]+)*", re.UNICODE)
_LIST_LINE_RE = re.compile(r"^\s*(?:[-+*]|\d+[.)])\s+")
_STOPWORDS = frozenset(
    {
        "a",
        "an",
        "and",
        "are",
        "as",
        "at",
        "be",
        "been",
        "but",
        "by",
        "for",
        "from",
        "has",
        "have",
        "he",
        "her",
        "his",
        "i",
        "if",
        "in",
        "into",
        "is",
        "it",
        "its",
        "not",
        "of",
        "on",
        "or",
        "our",
        "she",
        "that",
        "the",
        "their",
        "them",
        "they",
        "this",
        "to",
        "was",
        "we",
        "were",
        "will",
        "with",
        "you",
        "your",
    }
)


def build_user_file_overview(
    *,
    filename: str,
    document: ParsedUserFileDocument,
    chunks: Sequence[UserFileChunkDraft],
) -> UserFileOverview:
    """Build one deterministic, bounded overview from normalized parser output."""

    format_name = _document_format(document)
    outline: tuple[UserFileOutlineItem, ...]
    outline_truncated = bool(document.source_outline_truncated)

    if format_name == "json":
        raw_outline, description = _json_structure(document.text)
        outline, bounded = _bound_outline(raw_outline)
        return _overview(description, outline, "json", outline_truncated or bounded)

    if format_name == "xml":
        raw_outline, description = _xml_structure(document.text)
        outline, bounded = _bound_outline(raw_outline)
        return _overview(description, outline, "xml", outline_truncated or bounded)

    if document.source_outline:
        outline, bounded = _bound_outline(document.source_outline)
        outline_truncated = outline_truncated or bounded
    elif _supports_markdown_outline(document):
        outline, bounded = _bound_outline(_extract_markdown_outline(document.text))
        outline_truncated = outline_truncated or bounded
    else:
        outline = ()

    if outline:
        description = _structured_description(outline, document.text)
        return _overview(description, outline, "structured", outline_truncated)

    table_outline, table_description = _table_structure(document)
    if table_outline:
        outline, bounded = _bound_outline(table_outline)
        return _overview(table_description, outline, "table", outline_truncated or bounded)

    source_text = _overview_source_text(document, chunks)
    normalized_text = _normalize_block(source_text)
    if normalized_text and len(normalized_text) <= MAX_OVERVIEW_DESCRIPTION_CHARS:
        return _overview(normalized_text, (), "extractive", outline_truncated)

    description = _extractive_description(source_text, sentence_count=2)
    if description:
        return _overview(description, (), "extractive", outline_truncated)

    return fallback_user_file_overview(filename=filename, document=document, chunks=chunks)


def fallback_user_file_overview(
    *,
    filename: str,
    document: ParsedUserFileDocument,
    chunks: Sequence[UserFileChunkDraft],
) -> UserFileOverview:
    """Return a no-fail excerpt or filename overview after extraction errors."""

    try:
        source = _normalize_block(_overview_source_text(document, chunks))
        description = _clip_text(source, MAX_OVERVIEW_DESCRIPTION_CHARS)
    except Exception:
        description = ""
    if not description:
        safe_name = _normalize_inline(filename) or "uploaded file"
        description = _clip_text(f"Uploaded document {safe_name}.", MAX_OVERVIEW_DESCRIPTION_CHARS)
    return _overview(description, (), "fallback_excerpt", False)


def serialize_user_file_overview(overview: UserFileOverview) -> dict[str, object]:
    """Serialize an overview to JSON-compatible primitives."""

    return {
        "version": overview.version,
        "description": overview.description,
        "outline": [{"level": item.level, "title": item.title} for item in overview.outline],
        "method": overview.method,
        "outline_truncated": overview.outline_truncated,
    }


def deserialize_user_file_overview(value: object) -> UserFileOverview | None:
    """Validate stored overview JSON without trusting arbitrary metadata."""

    if not isinstance(value, Mapping) or set(value) != {
        "version",
        "description",
        "outline",
        "method",
        "outline_truncated",
    }:
        return None
    version = value.get("version")
    description = value.get("description")
    raw_outline = value.get("outline")
    method = value.get("method")
    outline_truncated = value.get("outline_truncated")
    if version != USER_FILE_OVERVIEW_VERSION or isinstance(version, bool):
        return None
    if not isinstance(description, str) or not description or len(description) > MAX_OVERVIEW_DESCRIPTION_CHARS:
        return None
    if _normalize_block(description) != description:
        return None
    if not isinstance(method, str) or method not in _METHODS:
        return None
    if not isinstance(outline_truncated, bool) or not isinstance(raw_outline, list):
        return None
    if len(raw_outline) > MAX_OVERVIEW_OUTLINE_ITEMS:
        return None

    outline: list[UserFileOutlineItem] = []
    title_chars = 0
    for raw_item in raw_outline:
        if not isinstance(raw_item, Mapping) or set(raw_item) != {"level", "title"}:
            return None
        level = raw_item.get("level")
        title = raw_item.get("title")
        if isinstance(level, bool) or not isinstance(level, int) or not 1 <= level <= MAX_OVERVIEW_HEADING_LEVEL:
            return None
        if not isinstance(title, str) or not title or len(title) > MAX_OVERVIEW_TITLE_CHARS:
            return None
        if _normalize_inline(title) != title:
            return None
        title_chars += len(title)
        if title_chars > MAX_OVERVIEW_OUTLINE_CHARS:
            return None
        outline.append(UserFileOutlineItem(level=level, title=title))

    return UserFileOverview(
        version=USER_FILE_OVERVIEW_VERSION,
        description=description,
        outline=tuple(outline),
        method=method,  # type: ignore[arg-type]
        outline_truncated=outline_truncated,
    )


def _overview(
    description: str,
    outline: tuple[UserFileOutlineItem, ...],
    method: UserFileOverviewMethod,
    outline_truncated: bool,
) -> UserFileOverview:
    safe_description = _clip_text(_normalize_block(description), MAX_OVERVIEW_DESCRIPTION_CHARS)
    if not safe_description:
        safe_description = "Uploaded document."
    return UserFileOverview(
        version=USER_FILE_OVERVIEW_VERSION,
        description=safe_description,
        outline=outline,
        method=method,
        outline_truncated=outline_truncated,
    )


def _document_format(document: ParsedUserFileDocument) -> str:
    value = document.metadata.get("format")
    if isinstance(value, str) and value.strip():
        return value.strip().lower().lstrip(".")
    extension = document.metadata.get("extension")
    if isinstance(extension, str) and extension.strip():
        return extension.strip().lower().lstrip(".")
    return document.parser_name.removeprefix("stdlib-").lower()


def _supports_markdown_outline(document: ParsedUserFileDocument) -> bool:
    return document.parser_name == "docling" or _document_format(document) in {"md", "markdown", "html", "htm"}


def _extract_markdown_outline(text: str) -> tuple[UserFileOutlineItem, ...]:
    items: list[UserFileOutlineItem] = []
    fence_marker: str | None = None
    for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        fence = _FENCE_RE.match(line)
        if fence is not None:
            marker = fence.group(1)[0]
            if fence_marker is None:
                fence_marker = marker
            elif fence_marker == marker:
                fence_marker = None
            continue
        if fence_marker is not None:
            continue
        match = _ATX_HEADING_RE.match(line)
        if match is not None:
            items.append(UserFileOutlineItem(level=len(match.group(1)), title=match.group(2)))
    return tuple(items)


def _bound_outline(
    items: Sequence[UserFileOutlineItem],
) -> tuple[tuple[UserFileOutlineItem, ...], bool]:
    bounded: list[UserFileOutlineItem] = []
    total_chars = 0
    truncated = False
    previous: tuple[int, str] | None = None
    for item in items:
        level = min(MAX_OVERVIEW_HEADING_LEVEL, max(1, int(item.level)))
        normalized_title = _normalize_heading(item.title)
        if not normalized_title:
            continue
        clipped_title = _clip_text(normalized_title, MAX_OVERVIEW_TITLE_CHARS)
        if clipped_title != normalized_title:
            truncated = True
        identity = (level, clipped_title)
        if identity == previous:
            continue
        if len(bounded) >= MAX_OVERVIEW_OUTLINE_ITEMS or total_chars + len(clipped_title) > MAX_OVERVIEW_OUTLINE_CHARS:
            truncated = True
            break
        bounded.append(UserFileOutlineItem(level=level, title=clipped_title))
        total_chars += len(clipped_title)
        previous = identity
    return tuple(bounded), truncated


def _normalize_heading(value: object) -> str:
    text = _normalize_inline(value)
    text = _MARKDOWN_LINK_RE.sub(r"\1", text)
    text = re.sub(r"\s+#+\s*$", "", text)
    return _normalize_inline(text)


def _structured_description(outline: Sequence[UserFileOutlineItem], text: str) -> str:
    title = outline[0].title
    sentence = _first_prose_sentence(text) or _extractive_description(text, sentence_count=1)
    if not sentence:
        return title
    if sentence.casefold().startswith(title.casefold()):
        return sentence
    separator = " " if title.endswith((".", "!", "?", ":")) else ". "
    return f"{title}{separator}{sentence}"


def _first_prose_sentence(text: str) -> str:
    for _sample_offset, sample in _representative_samples(text):
        prose = _prose_for_sentences(sample)
        for match in _SENTENCE_RE.finditer(prose):
            sentence = _normalize_inline(match.group(0))
            if 30 <= len(sentence) <= 320 and _WORD_RE.search(sentence):
                return _clip_text(sentence, MAX_OVERVIEW_DESCRIPTION_CHARS)
    return ""


def _json_structure(text: str) -> tuple[tuple[UserFileOutlineItem, ...], str]:
    parsed = json.loads(text)
    if isinstance(parsed, dict):
        keys = [str(key) for key in parsed]
        outline = tuple(UserFileOutlineItem(level=1, title=key) for key in keys)
        key_text = ", ".join(keys[:8]) or "no keys"
        return outline, f"JSON object with {len(keys)} top-level keys: {key_text}."
    if isinstance(parsed, list):
        outline: list[UserFileOutlineItem] = [UserFileOutlineItem(level=1, title=f"Array ({len(parsed)} items)")]
        first = parsed[0] if parsed else None
        if isinstance(first, dict):
            outline.extend(UserFileOutlineItem(level=2, title=str(key)) for key in first)
            return tuple(outline), f"JSON array with {len(parsed)} items whose first object has {len(first)} keys."
        item_type = type(first).__name__ if first is not None else "empty"
        return tuple(outline), f"JSON array with {len(parsed)} items; first item type is {item_type}."
    return (), f"JSON scalar value of type {type(parsed).__name__}."


def _xml_structure(text: str) -> tuple[tuple[UserFileOutlineItem, ...], str]:
    root = ElementTree.fromstring(text)
    root_name = _xml_local_name(root.tag)
    child_names = tuple(dict.fromkeys(_xml_local_name(child.tag) for child in root))
    outline = [UserFileOutlineItem(level=1, title=root_name)]
    outline.extend(UserFileOutlineItem(level=2, title=name) for name in child_names)
    children = ", ".join(child_names[:8]) or "no child elements"
    return tuple(outline), f"XML document with root {root_name} and first-level elements: {children}."


def _xml_local_name(value: object) -> str:
    text = str(value)
    return text.rsplit("}", 1)[-1] if "}" in text else text


def _table_structure(
    document: ParsedUserFileDocument,
) -> tuple[tuple[UserFileOutlineItem, ...], str]:
    tables = document.tables or []
    if tables:
        outline: list[UserFileOutlineItem] = []
        first_columns: list[str] = []
        total_rows = 0
        for index, table in enumerate(tables, start=1):
            outline.append(UserFileOutlineItem(level=1, title=f"Table {index}"))
            rows = table.get("rows") if isinstance(table, Mapping) else None
            if isinstance(rows, list) and rows:
                columns = [_normalize_inline(value) for value in rows[0]]
                columns = [value for value in columns if value]
                data_rows = max(0, len(rows) - 1)
                if index == 1:
                    first_columns = columns
                total_rows += data_rows
                if columns:
                    outline.append(UserFileOutlineItem(level=2, title=f"Columns: {', '.join(columns)}"))
                outline.append(UserFileOutlineItem(level=2, title=f"Rows: {data_rows}"))
        column_text = ", ".join(first_columns[:8]) or "unspecified columns"
        description = f"Tabular document with {len(tables)} table(s), {total_rows} data rows, and {column_text}."
        return tuple(outline), description

    docling = document.metadata.get("docling")
    table_count = docling.get("tables_count") if isinstance(docling, Mapping) else None
    if isinstance(table_count, int) and not isinstance(table_count, bool) and table_count > 0:
        outline = tuple(UserFileOutlineItem(level=1, title=f"Table {index}") for index in range(1, table_count + 1))
        return outline, f"Structured document containing {table_count} table(s)."
    return (), ""


def _overview_source_text(
    document: ParsedUserFileDocument,
    chunks: Sequence[UserFileChunkDraft],
) -> str:
    if document.text.strip():
        return document.text
    return "\n\n".join(chunk.text for chunk in chunks if chunk.text.strip())


def _extractive_description(text: str, *, sentence_count: int) -> str:
    candidates: list[tuple[int, str, tuple[str, ...]]] = []
    for sample_offset, sample in _representative_samples(text):
        prose = _prose_for_sentences(sample)
        for match in _SENTENCE_RE.finditer(prose):
            sentence = _normalize_inline(match.group(0))
            if not 30 <= len(sentence) <= 320:
                continue
            words = tuple(
                word.casefold()
                for word in _WORD_RE.findall(sentence)
                if len(word) > 1 and word.casefold() not in _STOPWORDS
            )
            if words:
                candidates.append((sample_offset + match.start(), sentence, words))
    if not candidates:
        return ""

    frequencies = Counter(word for _, _, words in candidates for word in words)
    ranked = sorted(
        candidates,
        key=lambda item: (
            -(sum(frequencies[word] for word in item[2]) / math.sqrt(len(item[2]))),
            item[0],
            item[1],
        ),
    )
    selected: list[tuple[int, str]] = []
    seen: set[str] = set()
    for position, sentence, _words in ranked:
        identity = sentence.casefold()
        if identity in seen:
            continue
        selected.append((position, sentence))
        seen.add(identity)
        if len(selected) >= sentence_count:
            break
    selected.sort(key=lambda item: item[0])
    return _clip_text(" ".join(sentence for _, sentence in selected), MAX_OVERVIEW_DESCRIPTION_CHARS)


def _representative_samples(text: str) -> tuple[tuple[int, str], ...]:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    if len(normalized) <= MAX_SUMMARY_SAMPLE_CHARS:
        return ((0, normalized),)
    middle_start = max(0, len(normalized) // 2 - SUMMARY_SEGMENT_CHARS // 2)
    end_start = max(0, len(normalized) - SUMMARY_SEGMENT_CHARS)
    return (
        (0, normalized[:SUMMARY_SEGMENT_CHARS]),
        (middle_start, normalized[middle_start : middle_start + SUMMARY_SEGMENT_CHARS]),
        (end_start, normalized[end_start:]),
    )


def _prose_for_sentences(text: str) -> str:
    paragraphs: list[str] = []
    current: list[str] = []
    fence_marker: str | None = None

    def flush_paragraph() -> None:
        if current:
            paragraphs.append(" ".join(current))
            current.clear()

    for line in text.split("\n"):
        fence = _FENCE_RE.match(line)
        if fence is not None:
            flush_paragraph()
            marker = fence.group(1)[0]
            if fence_marker is None:
                fence_marker = marker
            elif fence_marker == marker:
                fence_marker = None
            continue
        stripped = line.strip()
        if fence_marker is not None or not stripped:
            flush_paragraph()
            continue
        if (
            _ATX_HEADING_RE.match(line)
            or _LIST_LINE_RE.match(line)
            or stripped.startswith("<!--")
            or (stripped.startswith("|") and stripped.endswith("|"))
        ):
            flush_paragraph()
            continue
        current.append(stripped)
    flush_paragraph()
    return "\n".join(paragraphs)


def _normalize_inline(value: object) -> str:
    text = _strip_control_characters(str(value))
    return " ".join(text.split())


def _normalize_block(value: object) -> str:
    return _normalize_inline(value)


def _strip_control_characters(text: str) -> str:
    return "".join(character for character in text if not unicodedata.category(character).startswith("C"))


def _clip_text(text: str, limit: int) -> str:
    if len(text) <= limit:
        return text
    clipped = text[: max(0, limit - 3)].rstrip()
    if " " in clipped:
        clipped = clipped.rsplit(" ", 1)[0].rstrip()
    return f"{clipped}..." if clipped else text[:limit]


__all__ = [
    "MAX_OVERVIEW_DESCRIPTION_CHARS",
    "MAX_OVERVIEW_HEADING_LEVEL",
    "MAX_OVERVIEW_OUTLINE_CHARS",
    "MAX_OVERVIEW_OUTLINE_ITEMS",
    "MAX_OVERVIEW_TITLE_CHARS",
    "USER_FILE_OVERVIEW_VERSION",
    "build_user_file_overview",
    "deserialize_user_file_overview",
    "fallback_user_file_overview",
    "serialize_user_file_overview",
]
