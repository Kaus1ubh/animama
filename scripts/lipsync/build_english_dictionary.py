"""Build the browser English pronunciation data for lip-sync from CMUdict and SCOWL.

Lip-sync needs, per English word, its syllables' vowel shapes and stress and
where the lips close; not full phonemes. This keeps the CMUdict pronunciations of
words in SCOWL's common lists (size 35, plus capitalised words up to size 50 and
CMUdict's apostrophe forms of those words: contractions and possessives), encodes
each pronunciation compactly, and writes a generated TypeScript module that
lip-sync loads on first use (`loadEnglishDictionary`).

Code letters per word, in order:
- a e i o u: a syllable's vowel shape (A, E, I, O, U); upper case for primary stress;
- w: a weak, unstressed E-like vowel (AH0, ER0); y: a weak I (IH0);
- ":" after a vowel: a long vowel or diphthong;
- m: lips closed (M, B, P); n: a nasal (N, NG).

Lines are front-coded: a digit gives how many leading letters repeat the
previous word's, followed by the rest of the word, a space and its code.

Sources (pinned; their notices travel with the generated file):
- CMUdict, cmusphinx/cmudict at 74790861f652b15e4ac49015a90074ad62a27690,
  cmudict.dict SHA-256 81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22, BSD-2-Clause.
- SCOWL 2020.12.07 (scowl-2020.12.07.tar.gz SHA-256
  5587667caa20c4891390c2d42dbb4d5c4c3f41bee77af1457ece3ba23fb859cc), Kevin Atkinson's permissive licence.

Usage:
  python3 scripts/lipsync/build_english_dictionary.py <cmudict.dict> <scowl-2020.12.07 directory>
  uv run python scripts/lipsync/build_english_dictionary.py --gruut-reference <scowl-2020.12.07 directory>

The second form records how gruut reads a fixed list (SCOWL's most common words
plus the English test lines' words) as `tests/lipsync/english-gruut-reference.json`,
so the browser source can be checked against it after gruut is removed. It needs
the backend's gruut.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUTPUT = REPO / "src/frontend/web/src/lib/lipsync/text/english-dictionary.data.ts"
REFERENCE = REPO / "src/frontend/web/tests/lipsync/english-gruut-reference.json"
TESTSET = REPO / "src/frontend/web/tests/lipsync/testset.json"
REFERENCE_LEVEL = 10
CMUDICT_SHA256 = "81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22"
SCOWL_VERSION = "2020.12.07"
WORD_LEVEL = 35
UPPER_LEVEL = 50

VOWELS = {
    "AA": "a",
    "AE": "a",
    "AH": "a",
    "AO": "o",
    "AW": "a",
    "AY": "a",
    "EH": "e",
    "ER": "e",
    "EY": "e",
    "IH": "i",
    "IY": "i",
    "OW": "o",
    "OY": "o",
    "UH": "u",
    "UW": "u",
}
LONG = {"AA", "AO", "AW", "AY", "ER", "EY", "IY", "OW", "OY", "UW"}
WEAK = {"AH": "w", "ER": "w", "IH": "y"}


def encode(phones: list[str]) -> str:
    out = []
    for phone in phones:
        base, stress = re.sub(r"\d", "", phone), re.sub(r"\D", "", phone)
        if base in VOWELS:
            if stress == "0" and base in WEAK:
                out.append(WEAK[base])
                continue
            vowel = VOWELS[base]
            out.append((vowel.upper() if stress == "1" else vowel) + (":" if base in LONG else ""))
        elif base in ("M", "B", "P"):
            out.append("m")
        elif base in ("N", "NG"):
            out.append("n")
    return "".join(out)


def read_cmudict(path: Path) -> dict[str, list[str]]:
    data = path.read_bytes()
    if hashlib.sha256(data).hexdigest() != CMUDICT_SHA256:
        raise SystemExit(f"{path}: unexpected SHA-256; update the pin after reviewing the new version")
    entries: dict[str, list[str]] = {}
    for line in data.decode("latin-1").splitlines():
        line = line.split("#")[0].strip()
        if not line:
            continue
        word, *phones = line.split()
        if "(" not in word:  # first pronunciation only
            entries[word] = phones
    return entries


def scowl_lists(scowl: Path) -> Path:
    """The `final/` word lists of the pinned SCOWL release."""
    version = (scowl / "VERSION").read_text().strip() if (scowl / "VERSION").exists() else None
    if version != SCOWL_VERSION:
        raise SystemExit(f"{scowl}: expected SCOWL {SCOWL_VERSION}, found {version}")
    return scowl / "final"


def read_scowl(final: Path) -> set[str]:
    words: set[str] = set()
    for path in final.iterdir():
        match = re.fullmatch(r"(english|american)-(words|upper|contractions)\.(\d+)", path.name)
        if not match:
            continue
        limit = UPPER_LEVEL if match.group(2) == "upper" else WORD_LEVEL
        if int(match.group(3)) <= limit:
            words.update(word.lower() for word in path.read_text(encoding="latin-1").split())
    return words


def gruut_vowels(word: str) -> str:
    """gruut's vowel sequence for a word, in the dictionary's letters (w and y for weak)."""
    import gruut

    out = []
    for sentence in gruut.sentences(word, lang="en_US"):
        for token in sentence:
            for phoneme in token.phonemes or []:
                stressed = "ˈ" in phoneme or "ˌ" in phoneme
                bare = phoneme.replace("ˈ", "").replace("ˌ", "").replace("ː", "")
                if not stressed and bare in ("ə", "ɚ"):
                    out.append("w")
                    continue
                if not stressed and bare == "ɪ":
                    out.append("y")
                    continue
                for pattern, vowel in IPA_VOWELS:
                    if re.match(pattern, bare):
                        out.append(vowel)
                        break
    return "".join(out)


IPA_VOWELS = [
    (r"^(aɪ|aʊ|ɑ|a|æ|ʌ|ɐ)", "a"),
    (r"^(eɪ|ɛ|e|ɝ|ɚ|ə)", "e"),
    (r"^(ɪ|i)", "i"),
    (r"^(ɔɪ|oʊ|ɔ|o|ɒ)", "o"),
    (r"^(ʊ|u)", "u"),
]


def record_gruut_reference(final: Path) -> None:
    from importlib.metadata import version

    words: set[str] = set()
    for path in final.iterdir():
        match = re.fullmatch(r"(english|american)-words\.(\d+)", path.name)
        if match and int(match.group(2)) <= REFERENCE_LEVEL:
            listed = path.read_text(encoding="latin-1").split()
            words.update(w.lower() for w in listed if re.fullmatch(r"[A-Za-z']+", w))
    for line in json.loads(TESTSET.read_text())["lines"]:
        if line["lang"] == "en":
            text = re.sub(r"<[^>]+>|\[[^\]]+\]", " ", line["text"])
            words.update(w.lower() for w in re.findall(r"[A-Za-z']+", text))
    reference = {word: gruut_vowels(word) for word in sorted(words)}
    REFERENCE.write_text(
        json.dumps(
            {
                "description": (
                    f"gruut {version('gruut')} (en_US) vowel shapes for SCOWL's most common words and the "
                    "English test lines' words, as a, e, i, o, u, with w for a weak unstressed E-like vowel "
                    "and y for a weak I. Made by scripts/lipsync/build_english_dictionary.py --gruut-reference."
                ),
                "words": reference,
            },
            indent=2,
            ensure_ascii=False,
        )
        + "\n"
    )
    print(f"{len(reference)} words recorded")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--gruut-reference", action="store_true", help="record gruut's readings instead")
    parser.add_argument("paths", nargs="+", metavar="PATH", help="cmudict.dict and the SCOWL directory")
    args = parser.parse_args()
    if args.gruut_reference:
        if len(args.paths) != 1:
            parser.error("--gruut-reference takes the SCOWL directory only")
        record_gruut_reference(scowl_lists(Path(args.paths[0])))
        return
    if len(args.paths) != 2:
        parser.error("expected cmudict.dict and the SCOWL directory")
    cmudict = read_cmudict(Path(args.paths[0]))
    common = read_scowl(scowl_lists(Path(args.paths[1])))
    chosen = {word for word in common if re.fullmatch(r"[a-z']+", word) and word in cmudict}
    # Apostrophe forms of chosen words: contractions ("you've", "i'd") and possessives,
    # which SCOWL lists only at larger sizes.
    chosen |= {word for word in cmudict if "'" in word and word.split("'")[0] in chosen and len(word) <= 10}
    lines = []
    previous = ""
    for word in sorted(chosen):
        shared = 0
        while shared < min(len(word), len(previous), 9) and word[shared] == previous[shared]:
            shared += 1
        lines.append(f"{shared}{word[shared:]} {encode(cmudict[word])}")
        previous = word
    body = "\n".join(lines)
    OUTPUT.write_text(
        "// Generated by scripts/lipsync/build_english_dictionary.py; do not edit.\n"
        "// Pronunciations from CMUdict (BSD-2-Clause, Carnegie Mellon University) for\n"
        "// words in SCOWL (Kevin Atkinson). Notices: licenses/third-party/code-and-models.md.\n"
        "// prettier-ignore\n"
        f"export const ENGLISH_DICTIONARY_WORDS = {len(lines)};\n"
        "// prettier-ignore\n"
        f"export const ENGLISH_DICTIONARY = {json.dumps(body)};\n"
    )
    print(f"{len(lines)} words, {len(body.encode()) // 1024} KB")


if __name__ == "__main__":
    main()
