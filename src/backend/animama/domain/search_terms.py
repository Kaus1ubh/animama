"""Query-word rules shared by the keyword searches over memory files, chat history and uploads.

PostgreSQL's ``english`` text-search parser splits words only at spaces and
punctuation. Japanese, Chinese and Thai text therefore becomes one token per
unspaced run, and Korean words keep their attached particles, so a word inside
such text never matches as a lexeme. Each search keeps its full-text matching
for ASCII words and also matches a word containing a non-ASCII letter or digit
as a case-insensitive substring (``ILIKE``) of the searched text.
"""

from __future__ import annotations

import re
import unicodedata

# One web-search clause: a quoted phrase or a whitespace-separated word, either optionally negated with "-".
WEB_SEARCH_CLAUSE_PATTERN = re.compile(r'-?"[^"]*"?|\S+')
_ASCII_SNIPPET_TERM_PATTERN = re.compile(r"[A-Za-z0-9_]{2,}")


def trim_edge_punctuation(word: str) -> str:
    """Strip punctuation, symbols and spaces from both ends, such as the exclusion "-", quotes and 「」.

    Combining marks stay, because Thai tone marks and Devanagari vowel signs end many words.
    """

    start, end = 0, len(word)
    while start < end and unicodedata.category(word[start])[0] in "PSZ":
        start += 1
    while end > start and unicodedata.category(word[end - 1])[0] in "PSZ":
        end -= 1
    return word[start:end]


def _has_non_ascii_letter_or_digit(word: str) -> bool:
    return any(not char.isascii() and char.isalnum() for char in word)


def substring_pattern(word: str) -> str | None:
    """Return an ``ILIKE`` pattern finding a non-ASCII word anywhere in a text, or None for other words.

    The word loses the punctuation at its ends, and ``%``, ``_`` and ``\\`` match
    only themselves under PostgreSQL's default backslash escape. ASCII-only words
    and punctuation return None and keep full-text matching, so ``cat`` never
    matches ``category``.
    """

    term = trim_edge_punctuation(word)
    if not _has_non_ascii_letter_or_digit(term):
        return None
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


def snippet_terms(query: str) -> list[str]:
    """Return the lowercased query words a snippet centres on.

    ASCII words give their runs of two or more letters, digits or underscores;
    a non-ASCII word counts whole, as its substring match does, so one-character
    words such as 茶 (tea) and words ending in combining marks still centre it.
    """

    terms: list[str] = []
    for word in query.split():
        term = trim_edge_punctuation(word)
        if _has_non_ascii_letter_or_digit(term):
            terms.append(term.lower())
        else:
            terms.extend(match.lower() for match in _ASCII_SNIPPET_TERM_PATTERN.findall(word))
    return terms
