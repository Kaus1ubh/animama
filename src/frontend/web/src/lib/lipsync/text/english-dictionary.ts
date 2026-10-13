/**
 * English pronunciation for lip-sync: each word's syllables, vowel shapes,
 * stress and lip closures from a compact CMUdict subset (see
 * `scripts/lipsync/build_english_dictionary.py`), loaded on first use. Words it
 * lacks fall back to letter names for short capitalised abbreviations ("PM",
 * "TV") and to spelling rules otherwise; until it loads, every word uses
 * spelling rules.
 */

import type { LipSyncVowel } from "@/lib/lipsync/track";
import {
  CLOSURE_CODA,
  CLOSURE_ONSET,
  englishLetterUnits,
  NASAL_CODA,
} from "./converters";
import type { LipSyncUnit } from "./units";

type Emit = (unit: LipSyncUnit) => void;

let dictionary: Map<string, string> | null = null;
let loading: Promise<void> | null = null;

/**
 * Load the dictionary (about 150 KB gzip) once; later calls wait for the same
 * load. A failed load is retried on the next call.
 */
export function loadEnglishDictionary(): Promise<void> {
  loading ??= import("./english-dictionary.data").then(
    (module) => {
      dictionary = decodeEnglishDictionary(module.ENGLISH_DICTIONARY);
    },
    (error: unknown) => {
      loading = null;
      throw error;
    },
  );
  return loading;
}

export const englishDictionaryLoaded = () => dictionary !== null;

/** Decode front-coded lines: shared-prefix digit, rest of the word, space, code. */
export function decodeEnglishDictionary(data: string): Map<string, string> {
  const map = new Map<string, string>();
  let previous = "";
  for (const line of data.split("\n")) {
    const space = line.indexOf(" ");
    if (space < 1) continue;
    const word = previous.slice(0, Number(line[0])) + line.slice(1, space);
    map.set(word, line.slice(space + 1));
    previous = word;
  }
  return map;
}

/** Codes for letter names, as said when spelling an abbreviation. */
const LETTER_NAMES: Record<string, string> = {
  a: "E:",
  b: "mI:",
  c: "I:",
  d: "I:",
  e: "I:",
  f: "E",
  g: "I:",
  h: "E:",
  i: "A:",
  j: "E:",
  k: "E:",
  l: "E",
  m: "Em",
  n: "En",
  o: "O:",
  p: "mI:",
  q: "U:",
  r: "A:",
  s: "E",
  t: "I:",
  u: "U:",
  v: "I:",
  w: "Amwu:",
  x: "E",
  y: "A:",
  z: "I:",
};

const VOWEL_OF: Record<string, LipSyncVowel> = {
  a: "A",
  e: "E",
  i: "I",
  o: "O",
  u: "U",
};

/** A code letter that starts a vowel, so a closure before it is an onset. */
const VOWEL_CODE = /[aeiouwy]/i;
/** Stems ending in a hissing sound, where "'s" adds a syllable: "box's", "page's". */
const SIBILANT_END = /(s|z|x|ch|sh|ce|ge|se|ze)$/;

/** Emit the units a code describes, all spanning the word's source range. */
function codeUnits(
  code: string,
  start: number,
  end: number,
  word: number,
  emit: Emit,
): void {
  const at = { start, end, word };
  for (let i = 0; i < code.length; i += 1) {
    const char = code[i]!;
    if (char === "m") {
      const onset = VOWEL_CODE.test(code[i + 1] ?? "");
      emit({
        kind: "closure",
        weight: onset ? CLOSURE_ONSET : CLOSURE_CODA,
        ...at,
      });
    } else if (char === "n") {
      emit({ kind: "nasal", weight: NASAL_CODA, ...at });
    } else if (char === "w" || char === "y") {
      // A weak, unstressed vowel, as in "about" or "rabbit": a short, small mouth.
      emit({
        kind: "syllable",
        vowel: char === "y" ? "I" : "E",
        weight: 0.6,
        weak: true,
        ...at,
      });
    } else {
      const lower = char.toLowerCase();
      const vowel = VOWEL_OF[lower];
      if (!vowel) continue;
      const long = code[i + 1] === ":";
      emit({
        kind: "syllable",
        vowel,
        weight: long ? 1.3 : 1,
        ...at,
        ...(char !== lower ? { stressed: true } : {}),
      });
      if (long) i += 1;
    }
  }
}

/** The dictionary's code for a word, reading a possessive or a quoted word through its stem. */
function lookUp(key: string): string | undefined {
  if (!dictionary) return undefined;
  const found = dictionary.get(key);
  if (found !== undefined) return found;
  // A closing quote or a dropped letter: "hello'", "students'".
  if (key.endsWith("'")) return dictionary.get(key.slice(0, -1));
  if (!key.endsWith("'s")) return undefined;
  const stem = key.slice(0, -2);
  const code = dictionary.get(stem);
  if (code === undefined) return undefined;
  return SIBILANT_END.test(stem) ? `${code}y` : code;
}

/**
 * Pronounce one English word: the dictionary when it has the word (or its stem
 * before "'s"), letter names for a short capitalised abbreviation it lacks,
 * spelling rules otherwise.
 */
export function englishWordUnits(
  text: string,
  offset: number,
  word: number,
  emit: Emit,
): void {
  const key = text.toLowerCase().replace(/’/g, "'");
  const end = offset + text.length;
  const found = lookUp(key);
  if (found !== undefined) {
    codeUnits(found, offset, end, word, emit);
    return;
  }
  // "PM", "TV": spoken letter by letter. Single letters are dictionary words.
  if (dictionary && /^[A-Z]{2,4}$/.test(text)) {
    for (let i = 0; i < text.length; i += 1) {
      codeUnits(LETTER_NAMES[key[i]!]!, offset + i, offset + i + 1, word, emit);
    }
    return;
  }
  englishLetterUnits(text, offset, word, emit);
}
