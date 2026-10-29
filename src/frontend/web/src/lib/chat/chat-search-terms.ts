/**
 * Query words that chat-search snippets highlight, following the backend's
 * matching rules (`animama.domain.search_terms`).
 *
 * Plain ASCII words give their runs of two or more letters, digits or
 * underscores. A word containing a non-ASCII letter or digit, such as `京都`,
 * matches whole as a substring, so it is highlighted whole once punctuation,
 * symbols and spaces are trimmed from its ends. Combining marks such as Thai
 * tone marks stay, because they end words.
 */

const EDGE_CHARACTER = /^[\p{P}\p{S}\p{Z}]$/u;
const NON_ASCII_LETTER_OR_DIGIT = /(?!\p{ASCII})[\p{L}\p{N}]/u;
const ASCII_TERM = /[A-Za-z0-9_]{2,}/g;
const MAX_TERMS = 8;

/**
 * Strip punctuation, symbols and spaces from both ends of a word, one code
 * point at a time; a trailing-run regex would be quadratic on long runs.
 */
function trimEdgePunctuation(word: string): string {
  const characters = Array.from(word);
  let start = 0;
  let end = characters.length;
  while (start < end && EDGE_CHARACTER.test(characters[start] ?? "")) {
    start += 1;
  }
  while (end > start && EDGE_CHARACTER.test(characters[end - 1] ?? "")) {
    end -= 1;
  }
  return characters.slice(start, end).join("");
}

/** Return the lowercased, distinct query words to highlight, longest first. */
export function chatSearchHighlightTerms(query: string): string[] {
  const terms = query.split(/\s+/).flatMap((word) => {
    const trimmed = trimEdgePunctuation(word);
    return NON_ASCII_LETTER_OR_DIGIT.test(trimmed)
      ? [trimmed]
      : (word.match(ASCII_TERM) ?? []);
  });
  return [...new Set(terms.map((term) => term.toLowerCase()))]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_TERMS);
}
