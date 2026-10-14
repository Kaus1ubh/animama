import type { PostProcessorModule } from "i18next";

/**
 * Development-only pseudo-locale. It renders English catalogs with accented,
 * lengthened and bracketed text so untranslated strings (which stay plain) and
 * layouts that cannot absorb longer translations are easy to spot. It is never
 * offered in a language picker.
 */
export const PSEUDO_LOCALE = "en-XA";

/** Marks that open and close every pseudo-localized string. */
export const PSEUDO_OPEN = "⟦";
export const PSEUDO_CLOSE = "⟧";

const ACCENTED: Readonly<Record<string, string>> = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "é",
  f: "ƒ",
  g: "ĝ",
  h: "ĥ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ĺ",
  m: "ɱ",
  n: "ñ",
  o: "ó",
  p: "þ",
  q: "ǫ",
  r: "ŕ",
  s: "š",
  t: "ţ",
  u: "ú",
  v: "ṽ",
  w: "ŵ",
  x: "ẋ",
  y: "ý",
  z: "ž",
  A: "Á",
  B: "Ɓ",
  C: "Ç",
  D: "Ð",
  E: "É",
  F: "Ƒ",
  G: "Ĝ",
  H: "Ĥ",
  I: "Í",
  J: "Ĵ",
  K: "Ķ",
  L: "Ĺ",
  M: "Ṁ",
  N: "Ñ",
  O: "Ó",
  P: "Þ",
  Q: "Ǫ",
  R: "Ŕ",
  S: "Š",
  T: "Ţ",
  U: "Ú",
  V: "Ṽ",
  W: "Ŵ",
  X: "Ẋ",
  Y: "Ý",
  Z: "Ž",
};

/** Share of the original length added as padding, approximating longer languages. */
const EXPANSION = 0.35;

/** Accent and lengthen text, leaving markup tags such as `<1>` or `<strong>` intact. */
export function pseudoLocalize(text: string): string {
  if (!text) return text;
  let letters = 0;
  const accented = text
    .split(/(<[^>]*>)/)
    .map((part) => {
      if (part.startsWith("<") && part.endsWith(">")) return part;
      return part.replace(/[A-Za-z]/g, (letter) => {
        letters += 1;
        return ACCENTED[letter] ?? letter;
      });
    })
    .join("");
  const padding = "·".repeat(Math.ceil(letters * EXPANSION));
  return `${PSEUDO_OPEN}${accented}${padding ? ` ${padding}` : ""}${PSEUDO_CLOSE}`;
}

/** i18next post-processor that pseudo-localizes only while the pseudo-locale is active. */
export const pseudoPostProcessor: PostProcessorModule = {
  type: "postProcessor",
  name: "pseudo",
  process(
    value,
    _key,
    _options,
    translator: { language?: string } | undefined,
  ) {
    return translator?.language === PSEUDO_LOCALE
      ? pseudoLocalize(value)
      : value;
  },
};
