/**
 * Per-script converters from words to lip-sync units. Kana, Hangul and pinyin
 * spell their sounds, so small tables are enough. Each converter receives one
 * word with its source offset and returns units in order.
 *
 * Kanji have no reading here: each becomes an unknown-vowel unit, timed by the
 * audio. Chinese readings come from `pinyin-pro`, loaded on first use with
 * `loadChineseReadings`; until then Chinese characters are unknown units too.
 */

import type { LipSyncVowel } from "@/lib/lipsync/track";
import type { LipSyncUnit } from "./units";

type Emit = (unit: LipSyncUnit) => void;

/** Relative lengths, in syllables. */
const CLOSURE_ONSET = 0.25;
const CLOSURE_CODA = 0.35;
const NASAL_CODA = 0.25;
/** An average kanji is about one and a half morae. */
const KANJI_WEIGHT = 1.6;

// ---------------------------------------------------------------- Japanese kana

const KANA_VOWEL: Record<string, LipSyncVowel> = {};
for (const [vowel, chars] of [
  ["A", "アカガサザタダナハバパマヤラワァャヮヵ"],
  ["I", "イキギシジチヂニヒビピミリィヰ"],
  ["U", "ウクグスズツヅヌフブプムユルゥュヴ"],
  ["E", "エケゲセゼテデネヘベペメレェヱヶ"],
  ["O", "オコゴソゾトドノホボポモヨロヲォョ"],
] as const) {
  for (const char of chars) KANA_VOWEL[char] = vowel;
}
const SMALL_GLIDES = new Set("ャュョァィゥェォヮ");
const BILABIAL_KANA = new Set("バビブベボパピプペポマミムメモ");

const toKatakana = (char: string) =>
  /[ぁ-ゖ]/.test(char) ? String.fromCharCode(char.charCodeAt(0) + 0x60) : char;

/** Kana to morae: ー lengthens, ッ closes, ン is nasal, small kana glide. */
export function kanaUnits(
  text: string,
  offset: number,
  word: number,
  emit: Emit,
): void {
  let previous = null as LipSyncUnit | null;
  for (let i = 0; i < text.length; i += 1) {
    const char = toKatakana(text[i]!);
    const at = { start: offset + i, end: offset + i + 1, word };
    if (char === "ー" && previous?.kind === "syllable") {
      previous.weight += 1;
      previous.end = at.end;
    } else if (char === "ッ") {
      previous = { kind: "closure", weight: 1, ...at };
      emit(previous);
    } else if (char === "ン") {
      previous = { kind: "nasal", weight: 1, ...at };
      emit(previous);
    } else if (SMALL_GLIDES.has(char) && previous?.kind === "syllable") {
      previous.vowel = KANA_VOWEL[char];
      previous.end = at.end;
    } else if (KANA_VOWEL[char]) {
      if (BILABIAL_KANA.has(char))
        emit({ kind: "closure", weight: CLOSURE_ONSET, ...at, end: at.start });
      previous = {
        kind: "syllable",
        vowel: KANA_VOWEL[char],
        weight: 1,
        ...at,
      };
      emit(previous);
    }
  }
}

/** Kanji (or any Han character without a reading): one unknown-vowel unit each. */
export function unknownHanUnits(
  text: string,
  offset: number,
  word: number,
  emit: Emit,
): void {
  for (let i = 0; i < text.length; i += 1) {
    // A character outside the Basic Multilingual Plane is one unit, not two.
    const width = text.codePointAt(i)! > 0xffff ? 2 : 1;
    emit({
      kind: "unknown",
      weight: KANJI_WEIGHT,
      start: offset + i,
      end: offset + i + width,
      word,
    });
    i += width - 1;
  }
}

// ---------------------------------------------------------------- Korean Hangul

// prettier-ignore
/** Vowel shape of each medial jamo, in Unicode order: ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ */
const KO_MEDIAL: LipSyncVowel[] = ["A", "E", "A", "E", "O", "E", "O", "E", "O", "A", "E", "E", "O", "U", "O", "E", "I", "U", "I", "I", "I"];
const KO_BILABIAL_INITIAL = new Set([6, 7, 8, 17]); // ㅁ ㅂ ㅃ ㅍ
const KO_BILABIAL_FINAL = new Set([16, 17, 26]); // ㅁ ㅂ ㅍ
const KO_NASAL_FINAL = new Set([4, 21]); // ㄴ ㅇ

/** Hangul syllables by arithmetic: the vowel from the medial, closures from ㅁ ㅂ ㅍ. */
export function hangulUnits(
  text: string,
  offset: number,
  word: number,
  emit: Emit,
): void {
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0xac00 || code > 0xd7a3) continue;
    const index = code - 0xac00;
    const initial = Math.floor(index / 588);
    const medial = Math.floor((index % 588) / 28);
    const final = index % 28;
    const at = { start: offset + i, end: offset + i + 1, word };
    if (KO_BILABIAL_INITIAL.has(initial))
      emit({ kind: "closure", weight: CLOSURE_ONSET, ...at, end: at.start });
    emit({
      kind: "syllable",
      vowel: KO_MEDIAL[medial],
      weight: final ? 1.1 : 1,
      ...at,
    });
    if (KO_BILABIAL_FINAL.has(final))
      emit({ kind: "closure", weight: CLOSURE_CODA, ...at, start: at.end });
    else if (KO_NASAL_FINAL.has(final))
      emit({ kind: "nasal", weight: NASAL_CODA, ...at, start: at.end });
  }
}

// ---------------------------------------------------------------- Mandarin

type PinyinFunction = (
  text: string,
  options: { toneType: "none"; type: "array" },
) => string[];
let pinyinFunction: PinyinFunction | null = null;

/** Load the pinyin table (about 145 KB gzip) the first time Chinese is planned. */
export async function loadChineseReadings(): Promise<void> {
  if (pinyinFunction) return;
  const module = await import("pinyin-pro");
  pinyinFunction = module.pinyin as PinyinFunction;
}

export const chineseReadingsLoaded = () => pinyinFunction !== null;

function pinyinShape(syllable: string): {
  vowel: LipSyncVowel;
  bilabial: boolean;
  nasal: boolean;
} {
  const bilabial = /^[bpm]/.test(syllable);
  const final = syllable.replace(/^(zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])/, "");
  const nasal = /n$|ng$/.test(final);
  const palatal = /^[jqxy]/.test(syllable);
  let vowel: LipSyncVowel = "A";
  if (/^(ian|üan|van|uan)$/.test(final) && palatal) vowel = "E";
  else if (/^(i?a|ua|ai|uai|ao|iao|ang|iang|uang|uan|an)$/.test(final))
    vowel = "A";
  else if (/^(o|uo|ou|iu|iou)$/.test(final)) vowel = "O";
  else if (/^(ong|iong)$/.test(final)) vowel = "U";
  else if (/^(e|ie|üe|ve|ue|ei|ui|uei|en|un|uen|eng|er)$/.test(final)) {
    vowel = palatal && /^(ue|un)$/.test(final) ? "U" : "E";
  } else if (/^(i|in|ing)$/.test(final)) vowel = "I";
  else if (/^(u|ü|v)$/.test(final)) vowel = "U";
  return { vowel, bilabial, nasal };
}

/** Chinese characters through their pinyin finals; unknown units until the table loads. */
export function chineseUnits(
  text: string,
  offset: number,
  word: number,
  emit: Emit,
): void {
  if (!pinyinFunction) {
    unknownHanUnits(text, offset, word, (unit) => emit({ ...unit, weight: 1 }));
    return;
  }
  const syllables = pinyinFunction(text, { toneType: "none", type: "array" });
  for (let i = 0; i < text.length; i += 1) {
    const syllable = syllables[i] ?? "";
    const at = { start: offset + i, end: offset + i + 1, word };
    if (!/^[a-zü]+$/.test(syllable)) {
      emit({ kind: "unknown", weight: 1, ...at });
      continue;
    }
    const { vowel, bilabial, nasal } = pinyinShape(syllable);
    if (bilabial)
      emit({ kind: "closure", weight: CLOSURE_ONSET, ...at, end: at.start });
    emit({ kind: "syllable", vowel, weight: 1, ...at });
    if (nasal) emit({ kind: "nasal", weight: 0.2, ...at, start: at.end });
  }
}

// ---------------------------------------------------------------- Latin spelling

/**
 * Letter rules for Latin-script words other than English, such as Spanish or
 * Portuguese: each vowel letter is a syllable nucleus, and m, b, p and v close
 * the lips. Close for languages that write vowels as they sound.
 */
export function latinUnits(
  text: string,
  offset: number,
  word: number,
  emit: Emit,
): void {
  const lower = text.toLowerCase().normalize("NFD");
  let previous = null as LipSyncUnit | null;
  // NFD can add combining marks; map positions back to the source by counting letters.
  let sourceIndex = -1;
  for (let i = 0; i < lower.length; i += 1) {
    const char = lower[i]!;
    if (/\p{M}/u.test(char)) continue;
    sourceIndex += 1;
    const at = {
      start: offset + sourceIndex,
      end: offset + sourceIndex + 1,
      word,
    };
    const next = lower[i + 1] ?? "";
    const prior = lower[i - 1] ?? "";
    if ("aeiou".includes(char)) {
      // "u" is silent in que, qui, gue and gui.
      if (char === "u" && /[qg]/.test(prior) && /[ei]/.test(next)) continue;
      const glide: boolean =
        previous?.kind === "syllable" && "aeiou".includes(prior);
      previous = {
        kind: "syllable",
        vowel: char.toUpperCase() as LipSyncVowel,
        weight: glide ? 0.6 : 1,
        ...at,
      };
      emit(previous);
    } else if (char === "y" && !/\p{L}/u.test(next)) {
      previous = { kind: "syllable", vowel: "I", weight: 0.8, ...at };
      emit(previous);
    } else if (/[mbpv]/.test(char)) {
      previous = { kind: "closure", weight: 0.3, ...at };
      emit(previous);
    } else if (/\p{L}/u.test(char) && previous && previous.kind !== "pause") {
      previous.weight += 0.15;
    }
  }
}

// ---------------------------------------------------------------- English

/** Vowel shapes of English spelling patterns, longest first. */
const ENGLISH_VOWEL_GROUPS: Array<[RegExp, LipSyncVowel]> = [
  [/^(ee|ea|ie|ey|ei)/, "I"],
  [/^(oo|ew|ue|ui)/, "U"],
  [/^(oa|ow|ou|oi|oy|au|aw|o)/, "O"],
  [/^(ai|ay|e)/, "E"],
  [/^(a|u)/, "A"],
  [/^(i|y)/, "I"],
];

/**
 * English by spelling: each vowel group is a syllable with a likely shape, a
 * silent final "e" is dropped, and m, b and p close the lips. A stand-in until a
 * pronunciation source replaces it.
 */
export function englishLetterUnits(
  text: string,
  offset: number,
  word: number,
  emit: Emit,
): void {
  const lower = text.toLowerCase();
  // A final "e" after a consonant is silent when the word has another vowel ("make", not "the").
  const silentE =
    /[^aeiouy]e$/.test(lower) && /[aeiouy]/.test(lower.slice(0, -2));
  const end = silentE ? lower.length - 1 : lower.length;
  let i = 0;
  while (i < end) {
    const char = lower[i]!;
    const at = { start: offset + i, word };
    const isVowel = /[aeiou]/.test(char) || (char === "y" && i > 0);
    if (isVowel) {
      let length = 1;
      while (i + length < end && /[aeiouy]/.test(lower[i + length]!))
        length += 1;
      const group = lower.slice(i, i + length);
      const vowel =
        ENGLISH_VOWEL_GROUPS.find(([pattern]) => pattern.test(group))?.[1] ??
        "E";
      emit({
        kind: "syllable",
        vowel,
        weight: length > 1 ? 1.3 : 1,
        ...at,
        end: offset + i + length,
      });
      i += length;
      continue;
    }
    if (/[mbp]/.test(char))
      emit({
        kind: "closure",
        weight: CLOSURE_CODA,
        ...at,
        end: offset + i + 1,
      });
    else if (char === "n" && !/[aeiouy]/.test(lower[i + 1] ?? "")) {
      emit({ kind: "nasal", weight: NASAL_CODA, ...at, end: offset + i + 1 });
    }
    i += 1;
  }
}
