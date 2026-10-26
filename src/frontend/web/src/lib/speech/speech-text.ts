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
const UNSPACED_GAP = new RegExp(
  `(?<=[${UNSPACED}])\\s+|\\s+(?=[${UNSPACED}])`,
  "gu",
);

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

/**
 * Remove whitespace beside Chinese or Japanese text inside one piece of
 * recognized speech, as `joinSpeechText` does between pieces. Recognizers
 * that mark word starts (SentencePiece `▁`) would otherwise space out
 * Japanese and Chinese words; Korean and Latin spacing is kept.
 */
export function closeUnspacedGaps(text: string): string {
  return text.replace(UNSPACED_GAP, "");
}
