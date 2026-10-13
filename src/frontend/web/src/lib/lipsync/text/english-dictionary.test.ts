import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  decodeEnglishDictionary,
  englishDictionaryLoaded,
  englishWordUnits,
  loadEnglishDictionary,
} from "./english-dictionary";
import {
  ENGLISH_DICTIONARY,
  ENGLISH_DICTIONARY_WORDS,
} from "./english-dictionary.data";
import type { LipSyncUnit } from "./units";

const reference = JSON.parse(
  readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../tests/lipsync/english-gruut-reference.json",
    ),
    "utf8",
  ),
) as { words: Record<string, string> };

function units(word: string): LipSyncUnit[] {
  const out: LipSyncUnit[] = [];
  englishWordUnits(word, 0, 0, (unit) => out.push(unit));
  return out;
}

/**
 * Vowel shapes in the reference's letters: a e i o u, with w for a weak E-like
 * vowel and y for a weak I.
 */
function vowels(word: string): string {
  return units(word)
    .filter((unit) => unit.kind === "syllable")
    .map((unit) =>
      unit.weak ? (unit.vowel === "I" ? "y" : "w") : unit.vowel!.toLowerCase(),
    )
    .join("");
}

/** The shapes a viewer sees: a weak vowel shows its own vowel, small. */
const shown = (code: string) => code.replace(/w/g, "e").replace(/y/g, "i");
/** Weak vowels as one class, as gruut and CMUdict reduce them differently. */
const relaxed = (code: string) => code.replace(/y/g, "w");

beforeAll(async () => {
  await loadEnglishDictionary();
});

describe("English dictionary", () => {
  it("decodes every front-coded word", () => {
    expect(englishDictionaryLoaded()).toBe(true);
    const map = decodeEnglishDictionary(ENGLISH_DICTIONARY);
    expect(map.size).toBe(ENGLISH_DICTIONARY_WORDS);
    expect(map.get("hello")).toBeDefined();
    expect(map.get("you've")).toBeDefined();
  });

  it("gives stress, weak vowels and lip closures", () => {
    // problem: P R AA1 B L AH0 M → closure, stressed A, closure, weak, closure.
    const problem = units("problem");
    expect(problem.map((unit) => unit.kind)).toEqual([
      "closure",
      "syllable",
      "closure",
      "syllable",
      "closure",
    ]);
    expect(problem[1]).toMatchObject({ vowel: "A", stressed: true });
    expect(problem[3]).toMatchObject({ weak: true });
    // Every unit spans the word.
    expect(problem.every((unit) => unit.start === 0 && unit.end === 7)).toBe(
      true,
    );
  });

  it("reads a possessive or a quoted word through its stem", () => {
    // "planet's" is not a dictionary entry; "box's" adds a weak syllable.
    expect(vowels("planet's")).toBe(vowels("planet"));
    expect(vowels("box's")).toBe(`${vowels("box")}y`);
    expect(vowels("hello'")).toBe(vowels("hello"));
  });

  it("spells short capitalised abbreviations letter by letter", () => {
    // P M: "pee em"; "PM" is not a dictionary word.
    expect(vowels("PM")).toBe("ie");
    expect(units("PM").map((unit) => unit.end)).toEqual([1, 1, 2, 2]);
    // A capitalised dictionary word reads as a word.
    expect(vowels("HELP")).toBe(vowels("help"));
  });

  it("falls back to spelling rules for unknown words", () => {
    expect(vowels("zorbulax").length).toBeGreaterThan(0);
  });

  it("agrees with gruut's vowels on common words", () => {
    const words = Object.entries(reference.words);
    expect(words.length).toBeGreaterThan(4000);
    const share = (same: (ours: string, gruut: string) => boolean) =>
      words.filter(([word, gruut]) => same(vowels(word), gruut)).length /
      words.length;
    // Weak vowels as one class: at least 90% (the R11 measure).
    expect(
      share((ours, gruut) => relaxed(ours) === relaxed(gruut)),
    ).toBeGreaterThanOrEqual(0.9);
    // The shapes shown, each weak vowel as its own vowel: at least 85%.
    expect(
      share((ours, gruut) => shown(ours) === shown(gruut)),
    ).toBeGreaterThanOrEqual(0.85);
  });
});
