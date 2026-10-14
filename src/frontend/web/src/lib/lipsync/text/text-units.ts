/**
 * Turns spoken text into lip-sync units, by script:
 *
 * - kana → Japanese morae;
 * - Han → Japanese when the reply has kana (unknown-vowel units, since kanji
 *   readings are not known), otherwise Chinese pinyin;
 * - Hangul → Korean syllables;
 * - Latin → English, with numbers and symbols spelled out first; words with
 *   accented letters use plain letter rules;
 * - digits written beside Japanese, Chinese or Korean text → unknown units,
 *   since they are read in that language;
 * - punctuation → possible pauses;
 * - vocal tags → tag units, or a whisper that narrows the words after it.
 *
 * Every unit keeps its source range, so provider timing can be matched to it.
 */

import { spellOutEnglishSegments } from "./spell-out-english";
import {
  chineseUnits,
  hangulUnits,
  kanaUnits,
  latinUnits,
  unknownHanUnits,
} from "./converters";
import { englishWordUnits } from "./english-dictionary";
import { pausePriorSec, splitTags, TAG_PRIOR_SEC } from "./tags";
import type { LipSyncUnit } from "./units";

/** Pronounces one English word: emits its units with source ranges from `offset`. */
export type EnglishPronouncer = (
  word: string,
  offset: number,
  wordIndex: number,
  emit: (unit: LipSyncUnit) => void,
) => void;

export type TextUnitOptions = {
  /** How to read Han characters; see `detectHanLanguage`. */
  hanLanguage: "ja" | "zh";
  /**
   * English pronunciation. Defaults to the dictionary once
   * `loadEnglishDictionary` has run, with spelling rules for other words.
   */
  english?: EnglishPronouncer;
};

const KANA = /[ぁ-ゖァ-ヺー]/u;
const HAN = /[\p{Script=Han}々〆]/u;
const HANGUL = /\p{Script=Hangul}/u;
const STOP = /[.!?。！？…‼⁉]/u;
const EXCLAIM = /[!！‼⁉]/u;
const BREAK = /[,、，;；:：—–]/u;
/** Seconds a pause is expected to take, before the audio decides. */
const STOP_PRIOR_SEC = 0.3;
const BREAK_PRIOR_SEC = 0.15;
/** A digit read in Japanese, Chinese or Korean, such as 3 in 3時. */
const CJK_DIGIT_WEIGHT = 1.2;

type Script = "kana" | "han" | "hangul" | "other";

const scriptOf = (char: string): Script =>
  KANA.test(char)
    ? "kana"
    : HAN.test(char)
      ? "han"
      : HANGUL.test(char)
        ? "hangul"
        : "other";

/** The script at `index`, reading a surrogate pair as its whole character. */
function scriptAt(text: string, index: number): Script {
  const code = text.charCodeAt(index);
  if (code >= 0xdc00 && code <= 0xdfff && index > 0) {
    return scriptAt(text, index - 1);
  }
  return scriptOf(String.fromCodePoint(text.codePointAt(index)!));
}

/** Han reads as Japanese when the reply has any kana, otherwise as Chinese. */
export function detectHanLanguage(replyText: string): "ja" | "zh" {
  return /[ぁ-ゖァ-ヺ]/u.test(replyText) ? "ja" : "zh";
}

export function textToUnits(
  text: string,
  options: TextUnitOptions,
): LipSyncUnit[] {
  const units: LipSyncUnit[] = [];
  const english = options.english ?? englishWordUnits;
  let word = -1;
  let whisper = false;
  // Whether the next CJK character continues the current word.
  let inCjkWord = false;

  const emit = (unit: LipSyncUnit) => {
    if (whisper && unit.kind !== "pause" && unit.kind !== "tag")
      unit.whisper = true;
    units.push(unit);
  };
  const pause = (char: string, at: number) => {
    const kind = STOP.test(char) ? "stop" : BREAK.test(char) ? "break" : null;
    if (!kind) return;
    inCjkWord = false;
    const last = units[units.length - 1];
    // A run of punctuation, such as "..." or "?!", is one pause.
    const exclaim = EXCLAIM.test(char);
    if (last?.kind === "pause" && last.end === at) {
      last.end = at + 1;
      if (kind === "stop") {
        last.pause = "stop";
        last.weight = STOP_PRIOR_SEC;
      }
      if (exclaim) last.exclaim = true;
      return;
    }
    units.push({
      kind: "pause",
      pause: kind,
      weight: kind === "stop" ? STOP_PRIOR_SEC : BREAK_PRIOR_SEC,
      start: at,
      end: at + 1,
      ...(exclaim ? { exclaim } : {}),
    });
  };

  /** Latin text: spell out numbers and symbols, then pronounce each word. */
  const latinRun = (start: number, end: number) => {
    for (const segment of spellOutEnglishSegments(text.slice(start, end))) {
      const segmentStart = start + segment.start;
      const segmentEnd = start + segment.end;
      const spoken = segment.text;
      // Spelled words all map to the source range they replace.
      const place = segment.spelled
        ? (unit: LipSyncUnit) =>
            emit({ ...unit, start: segmentStart, end: segmentEnd })
        : emit;
      for (const token of spoken.matchAll(
        /[\p{L}\p{N}][\p{L}\p{N}'’]*|[^\s\p{L}\p{N}]/gu,
      )) {
        const value = token[0];
        const offset = segment.spelled
          ? segmentStart
          : segmentStart + token.index;
        if (!/[\p{L}\p{N}]/u.test(value[0]!)) {
          if (!segment.spelled) pause(value, offset);
          continue;
        }
        word += 1;
        inCjkWord = false;
        if (/^[A-Za-z'’]+$/.test(value)) english(value, offset, word, place);
        else latinUnits(value, offset, word, place);
      }
    }
  };

  const cjkRun = (script: Script, start: number, end: number) => {
    if (!inCjkWord) word += 1;
    inCjkWord = true;
    const run = text.slice(start, end);
    if (script === "kana") kanaUnits(run, start, word, emit);
    else if (script === "hangul") hangulUnits(run, start, word, emit);
    else if (options.hanLanguage === "ja")
      unknownHanUnits(run, start, word, emit);
    else chineseUnits(run, start, word, emit);
  };

  const otherRun = (
    start: number,
    end: number,
    beforeCjk: boolean,
    afterCjk: boolean,
  ) => {
    const run = text.slice(start, end);
    // Digits written right against CJK text, such as 3時 or 3시, are read in
    // that language.
    // Spaced digits between CJK text count too, as do full-width digits.
    const touchesCjk =
      (beforeCjk && afterCjk) ||
      (beforeCjk && /^[\d０-９]/.test(run)) ||
      (afterCjk && /[\d０-９]$/.test(run));
    const isDigits = /^\s*[\d０-９,.]+\s*$/.test(run) && /[\d０-９]/.test(run);
    if (isDigits && touchesCjk) {
      if (/^\s/.test(run)) inCjkWord = false;
      if (!inCjkWord) word += 1;
      inCjkWord = true;
      for (let i = 0; i < run.length; i += 1) {
        if (/[\d０-９]/.test(run[i]!)) {
          emit({
            kind: "unknown",
            weight: CJK_DIGIT_WEIGHT,
            start: start + i,
            end: start + i + 1,
            word,
          });
        }
      }
      if (/\s$/.test(run)) inCjkWord = false;
      return;
    }
    if (/[\p{L}\p{N}$€£¥#&@+=%°~]/u.test(run)) {
      latinRun(start, end);
      return;
    }
    for (let i = 0; i < run.length; i += 1) {
      const char = run[i]!;
      if (/\s/.test(char)) inCjkWord = false;
      else pause(char, start + i);
    }
  };

  for (const piece of splitTags(text)) {
    if (piece.type === "tag") {
      const { kind, kinds, label, start, end } = piece.tag;
      inCjkWord = false;
      // A delivery direction carries forward until another replaces it; a
      // whisper inside a combined tag such as [laughs, whispering] counts too.
      if (kinds.includes("whisper")) whisper = true;
      else if (kinds.includes("delivery")) whisper = false;
      if (kind === "whisper" || kind === "delivery") continue;
      units.push({
        kind: "tag",
        weight: kind === "pause" ? pausePriorSec(label) : TAG_PRIOR_SEC[kind]!,
        start,
        end,
        tag: { kind, label },
      });
      continue;
    }
    // Split the text piece into runs of one script.
    let runStart = piece.start;
    let runScript = scriptAt(text, runStart);
    let previousScript: Script | null = null;
    for (let i = piece.start + 1; i <= piece.end; i += 1) {
      const script = i < piece.end ? scriptAt(text, i) : null;
      if (script === runScript) continue;
      if (runScript === "other")
        otherRun(runStart, i, previousScript !== null, script !== null);
      else cjkRun(runScript, runStart, i);
      previousScript = runScript;
      runStart = i;
      if (script) runScript = script;
    }
  }
  return units;
}
