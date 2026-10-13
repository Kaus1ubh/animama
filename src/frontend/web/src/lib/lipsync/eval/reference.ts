/**
 * Converts forced-alignment output (romanised words with per-letter spans)
 * into an evaluation reference: word spans, and vowel spans as A, E, I, O, U.
 *
 * Romanised Korean writes ㅓ as "eo" and ㅡ as "eu"; they count as one O or I
 * vowel. Other languages map each vowel letter on its own.
 */

import type { EvalLanguage, EvalReference } from "./clip";

export type AlignedWord = {
  word: string;
  start: number;
  end: number;
  /** Letters as [letter, start, end, score]. */
  chars: Array<[string, number, number, number]>;
};

const VOWEL_INDEX: Record<string, number> = { a: 0, e: 1, i: 2, o: 3, u: 4 };

export function referenceFromAlignment(
  words: AlignedWord[],
  lang: EvalLanguage,
): EvalReference {
  const vowels: EvalReference["vowels"] = [];
  for (const word of words) {
    const { chars } = word;
    for (let k = 0; k < chars.length; k += 1) {
      const [letter, start, end] = chars[k]!;
      let vowel = VOWEL_INDEX[letter];
      if (vowel === undefined) continue;
      const next = chars[k + 1];
      let vowelEnd = end;
      if (lang === "ko") {
        if (letter === "e" && (next?.[0] === "o" || next?.[0] === "u")) {
          // One vowel spans both letters of "eo" or "eu".
          vowel = next[0] === "o" ? 3 : 2;
          vowelEnd = next[2];
        } else if (
          (letter === "o" || letter === "u") &&
          chars[k - 1]?.[0] === "e"
        ) {
          // The second letter of "eo" or "eu" is part of the vowel already counted.
          continue;
        }
      }
      vowels.push([vowel, start, vowelEnd]);
    }
  }
  return { words: words.map((word) => [word.start, word.end]), vowels };
}
