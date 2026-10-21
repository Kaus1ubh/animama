/**
 * Characters of scripts written without spaces between words: Chinese
 * characters, Japanese kana (with the shared prolonged sound mark ー) and CJK
 * or fullwidth punctuation. Korean Hangul is written with spaces, so it is not
 * among them.
 */
const UNSPACED =
  "\\p{Script_Extensions=Han}\\p{Script_Extensions=Hiragana}\\p{Script_Extensions=Katakana}\\u3000-\\u303f\\uff00-\\uffef";
const ENDS_UNSPACED = new RegExp(`[${UNSPACED}]$`, "u");
const STARTS_UNSPACED = new RegExp(`^[${UNSPACED}]`, "u");

/**
 * Join two pieces of recognized speech: with one space between words, but
 * none where either side is Chinese or Japanese text or already has whitespace.
 */
export function joinSpeechText(base: string, next: string): string {
  if (!base) return next;
  if (!next) return base;
  const spaced =
    /\s$/u.test(base) ||
    /^\s/u.test(next) ||
    ENDS_UNSPACED.test(base) ||
    STARTS_UNSPACED.test(next);
  return `${base}${spaced ? "" : " "}${next}`;
}
