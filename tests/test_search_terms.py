from __future__ import annotations

import re

import pytest

from animama.domain.search_terms import snippet_terms, substring_pattern, trim_edge_punctuation


@pytest.mark.parametrize(
    ("word", "trimmed"),
    [
        ("-抹茶", "抹茶"),
        ("「抹茶」", "抹茶"),
        ('"京都 抹茶"', "京都 抹茶"),
        ("“京都”。", "京都"),
        # Thai tone marks and Devanagari vowel signs are combining marks that end words.
        ("-แม่", "แม่"),
        ("किताबें", "किताबें"),
        ("-", ""),
    ],
)
def test_trim_edge_punctuation_keeps_combining_marks(word: str, trimmed: str) -> None:
    assert trim_edge_punctuation(word) == trimmed


@pytest.mark.parametrize(
    ("word", "pattern"),
    [
        ("京都", "%京都%"),
        ("-「서울」", "%서울%"),
        ("果汁100%の", "%果汁100\\%の%"),
        ("京_の", "%京\\_の%"),
        ("データ\\写真", "%データ\\\\写真%"),
        ("cat", None),
        ('"picture book"', None),
        ("。", None),
    ],
)
def test_substring_pattern_covers_only_non_ascii_words(word: str, pattern: str | None) -> None:
    assert substring_pattern(word) == pattern


def test_snippet_terms_keep_ascii_terms_and_whole_non_ascii_words() -> None:
    query = 'Picture-book "new job" a 茶 -「抹茶」 แม่ café'

    assert snippet_terms(query) == ["picture", "book", "new", "job", "茶", "抹茶", "แม่", "café"]
    ascii_query = "new job start-date x_y -pickle"
    assert snippet_terms(ascii_query) == [term.lower() for term in re.findall(r"[A-Za-z0-9_]{2,}", ascii_query)]
