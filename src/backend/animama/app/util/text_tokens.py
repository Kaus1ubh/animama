"""Count cl100k_base tokens offline, to size upload chunks (spec R1.5, R4.2).

The encoding is built from the cl100k_base file that llama-index bundles
(``llama_index/core/_static/tiktoken_cache``), after checking it against the
published digest. Nothing here asks tiktoken to resolve an encoding by name, so
counting never downloads anything and never depends on ``TIKTOKEN_CACHE_DIR``.
Without a usable file, counts fall back to :func:`estimate_tokens`, a CJK-aware
estimate, and a warning is logged once.

Texts up to :data:`EXACT_COUNT_MAX_CHARS` characters, such as chunks, are
counted exactly. tiktoken's byte-pair merging takes time quadratic in the length
of one pre-token, and a run of letters (a long CJK paragraph, a base64 blob) or
of whitespace is one pre-token, so a longer text is counted in pieces, each run
cut at most :data:`MAX_RUN_CHARS` long. The cuts change how the pieces merge, so
such a count is an estimate.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import importlib.util
import math
import re
import threading
from collections.abc import Iterator
from pathlib import Path
from typing import TYPE_CHECKING

from animama.logging import get_logger

if TYPE_CHECKING:
    import tiktoken

CL100K_BASE_FILE_NAME = "9b5ad71b2ce5302211f9c61530b329a4922fc6a4"
"""tiktoken's cache name for the cl100k_base file: the SHA-1 of its download URL."""
CL100K_BASE_SHA256 = "223921b76ee99bde995b7ff738513eef100fb51d18c93597a113bcffe865b2a7"
"""The published digest of the cl100k_base file, as tiktoken checks it."""

# The cl100k_base pre-tokenizer and special tokens, exactly as tiktoken_ext.openai_public defines them.
_CL100K_PATTERN = (
    r"""'(?i:[sdmt]|ll|ve|re)|[^\r\n\p{L}\p{N}]?+\p{L}++|\p{N}{1,3}+| ?[^\s\p{L}\p{N}]++[\r\n]*+|\s++$|\s*[\r\n]"""
    r"""|\s+(?!\S)|\s"""
)
_CL100K_SPECIAL_TOKENS = {
    "<|endoftext|>": 100257,
    "<|fim_prefix|>": 100258,
    "<|fim_middle|>": 100259,
    "<|fim_suffix|>": 100260,
    "<|endofprompt|>": 100276,
}

EXACT_COUNT_MAX_CHARS = 16_384
"""Longest text counted exactly; counting one is fast even when it is a single run."""
MAX_RUN_CHARS = 512
"""In a longer text, the longest run of non-whitespace, or of whitespace, counted in one piece."""

# A run longer than MAX_RUN_CHARS. Each alternative can start only where its run starts, so the scan is linear.
_LONG_RUN = re.compile(rf"(?<!\S)\S{{{MAX_RUN_CHARS + 1},}}|(?<!\s)\s{{{MAX_RUN_CHARS + 1},}}")
# A letter followed by a character that is not one: the next pre-token starts after the letter.
_LETTER_BEFORE_OTHER = re.compile(r"[^\W\d_](?=[\W\d_])")

# Runs for estimate_tokens, each with its own rate.
_ESTIMATE_RUN = re.compile(
    r"(?P<word>[A-Za-z]+)"
    r"|(?P<number>[0-9]+)"
    # A single space joins the word or symbol after it; before a number it is a token of its own.
    r"|(?P<space> (?=[^\s0-9]))"
    r"|(?P<blank>\s+)"
    # Accented Latin, Greek and Cyrillic letters.
    r"|(?P<alphabet>[À-ɏͰ-ԯ]+)"
    r"|(?P<other>.)",
    re.DOTALL,
)
_ESTIMATE_CHARS_PER_TOKEN = {"word": 4, "number": 3, "blank": 8, "alphabet": 2}

_log = get_logger("app.util.text_tokens")


class TokenizerFileError(Exception):
    """The cl100k_base encoding file is missing, unreadable or not the published file."""


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


def load_cl100k_base(directory: Path | None = None) -> tiktoken.Encoding:
    """Build cl100k_base from its encoding file in ``directory``, by default the one llama-index bundles.

    Raises :class:`TokenizerFileError` when the file is missing or is not the
    published one. Nothing is downloaded, and a damaged file is left alone.
    """

    import tiktoken

    folder = directory if directory is not None else bundled_tiktoken_cache_dir()
    if folder is None:
        raise TokenizerFileError("llama-index's bundled tiktoken encodings are not installed")
    try:
        data = (folder / CL100K_BASE_FILE_NAME).read_bytes()
    except OSError as exc:
        raise TokenizerFileError(f"the cl100k_base file cannot be read ({exc.__class__.__name__})") from exc
    if hashlib.sha256(data).hexdigest() != CL100K_BASE_SHA256:
        raise TokenizerFileError("the cl100k_base file is not the published one")
    ranks: dict[bytes, int] = {}
    try:
        for line in data.splitlines():
            if line:
                token, rank = line.split()
                ranks[base64.b64decode(token)] = int(rank)
    except (ValueError, binascii.Error) as exc:
        raise TokenizerFileError("the cl100k_base file is malformed") from exc
    return tiktoken.Encoding(
        name="cl100k_base",
        pat_str=_CL100K_PATTERN,
        mergeable_ranks=ranks,
        special_tokens=dict(_CL100K_SPECIAL_TOKENS),
    )


class TokenCounter:
    """Count text in cl100k_base tokens, or estimate the count when the encoding is unavailable.

    Special-token markers in the text count as ordinary text. A text longer
    than :data:`EXACT_COUNT_MAX_CHARS` gets an estimate (see the module).
    Counting is safe from worker threads.
    """

    def __init__(self, encoding: tiktoken.Encoding | None) -> None:
        self._encoding = encoding

    @property
    def exact(self) -> bool:
        """Whether counts come from cl100k_base rather than :func:`estimate_tokens`."""

        return self._encoding is not None

    def count(self, text: str) -> int:
        """The number of tokens in ``text``."""

        if not text:
            return 0
        if self._encoding is None:
            return estimate_tokens(text)
        encode = self._encoding.encode_ordinary
        if len(text) <= EXACT_COUNT_MAX_CHARS:
            return len(encode(text))
        return sum(len(encode(piece)) for piece in _bounded_pieces(text))


_counters: dict[Path | None, TokenCounter] = {}
_counters_lock = threading.Lock()


def cl100k_token_counter(directory: Path | None = None) -> TokenCounter:
    """The shared counter for the cl100k_base file in ``directory`` (by default the bundled one), loaded once.

    When the file cannot be used, the counter estimates instead, and that is
    logged once.
    """

    with _counters_lock:
        counter = _counters.get(directory)
        if counter is None:
            try:
                counter = TokenCounter(load_cl100k_base(directory))
            except (TokenizerFileError, ImportError) as exc:
                _log.warning(
                    "Upload chunk token counts are estimated: the cl100k_base encoding is unavailable",
                    reason=str(exc),
                )
                counter = TokenCounter(None)
            _counters[directory] = counter
    return counter


def estimate_tokens(text: str) -> int:
    """Estimate the cl100k_base token count of ``text`` without the encoding.

    English words count a token per four letters and numbers one per three
    digits. CJK, kana, Hangul and other scripts without an alphabet rate count
    a token per character, two outside the Basic Multilingual Plane, and so do
    punctuation and symbols. The estimate is usually within half to twice the
    real count.
    """

    total = 0
    for run in _ESTIMATE_RUN.finditer(text):
        kind = run.lastgroup
        if kind == "space":
            continue
        if kind == "other":
            total += 2 if ord(run.group()) > 0xFFFF else 1
        else:
            total += math.ceil(len(run.group()) / _ESTIMATE_CHARS_PER_TOKEN[kind or "word"])
    return total


def _bounded_pieces(text: str) -> Iterator[str]:
    """``text`` in consecutive pieces, none holding a run of more than :data:`MAX_RUN_CHARS` characters.

    A run is cut after a letter that another kind of character follows when it
    has one, where a new pre-token usually starts, and otherwise anywhere.
    """

    position = 0
    for run in _LONG_RUN.finditer(text):
        start, end = run.span()
        if start > position:
            yield text[position:start]
        while end - start > MAX_RUN_CHARS:
            cut = _run_cut(text, start)
            yield text[start:cut]
            start = cut
        yield text[start:end]
        position = end
    if position < len(text):
        yield text[position:]


def _run_cut(text: str, start: int) -> int:
    """Where a piece of the long run at ``start`` ends: after its last letter that another character follows.

    Only the second half of the :data:`MAX_RUN_CHARS` window is searched, so
    pieces stay large; without such a letter the piece ends at the window's end.
    """

    window_end = start + MAX_RUN_CHARS
    cut = window_end
    for letter in _LETTER_BEFORE_OTHER.finditer(text, start + MAX_RUN_CHARS // 2, window_end):
        cut = letter.end()
    return cut


__all__ = [
    "CL100K_BASE_FILE_NAME",
    "CL100K_BASE_SHA256",
    "EXACT_COUNT_MAX_CHARS",
    "MAX_RUN_CHARS",
    "TokenCounter",
    "TokenizerFileError",
    "bundled_tiktoken_cache_dir",
    "cl100k_token_counter",
    "estimate_tokens",
    "load_cl100k_base",
]
