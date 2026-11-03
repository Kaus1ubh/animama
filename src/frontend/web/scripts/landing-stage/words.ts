/*
 * Captions as words for their entrances: titles bounce in letter by letter
 * and lines fade up line by line, wrapping only between words. Most UI
 * Locales put spaces between words; Japanese and Chinese do not, so their
 * text is split with `Intl.Segmenter` and its words join without a space.
 */

/** A caption's word, and whether a space separates it from the one before. */
export type CaptionWord = { text: string; space: boolean };

/** Whether `locale` writes its words without spaces between them. */
export function unspaced(locale: string): boolean {
  return /^(ja|zh)\b/i.test(locale);
}

/** Opening brackets and quotes, which stay with the word after them. */
const OPENING = /^[\p{Ps}\p{Pi}]+$/u;

/**
 * A Japanese particle or verb ending (`の`, `に`, `おう`), which the
 * segmenter splits from the word before it; kept with that word, a line
 * breaks between phrases (`出会おう`, not `出会|おう`).
 */
const ENDING = /^\p{Script=Hiragana}{1,2}$/u;

/**
 * `text` as words. In spaced locales a word runs between spaces, keeping
 * its punctuation. In unspaced ones it is a segment from `Intl.Segmenter`
 * (one character where the browser lacks it), with punctuation kept beside
 * its word so no line starts with a comma or ends with an opening bracket,
 * and Japanese endings beside theirs (`ENDING`).
 * A space before the first word counts, so text split into runs keeps the
 * spaces between them.
 */
export function captionWords(text: string, locale: string): CaptionWord[] {
  const words: CaptionWord[] = [];
  if (!unspaced(locale)) {
    let space = false;
    for (const token of text.split(/(\s+)/)) {
      if (!token) continue;
      if (/^\s+$/.test(token)) space = true;
      else {
        words.push({ text: token, space });
        space = false;
      }
    }
    return words;
  }
  const segments =
    typeof Intl.Segmenter === "function"
      ? [
          ...new Intl.Segmenter(locale, { granularity: "word" }).segment(text),
        ].map(({ segment, isWordLike }) => ({
          segment,
          word: isWordLike ?? false,
        }))
      : [...text].map((segment) => ({
          segment,
          word: /[\p{L}\p{N}]/u.test(segment),
        }));
  let space = false;
  let opening = "";
  for (const { segment, word } of segments) {
    if (/^\s+$/.test(segment)) {
      space = true;
      continue;
    }
    const last = words.at(-1);
    const joins =
      !word ||
      (locale.startsWith("ja") &&
        ENDING.test(segment) &&
        !/\p{P}$/u.test(last?.text ?? ""));
    if (!word && OPENING.test(segment)) opening += segment;
    else if (joins && last && !space && !opening) last.text += segment;
    else {
      words.push({ text: opening + segment, space });
      opening = "";
    }
    space = false;
  }
  if (opening) words.push({ text: opening, space });
  return words;
}
