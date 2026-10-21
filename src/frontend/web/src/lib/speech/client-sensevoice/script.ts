/**
 * Simplified → Traditional conversion for `zh-Hant`, with OpenCC's Taiwan
 * standard (`cn2t` tables, about 450 KB compressed), loaded on first use so
 * other languages never fetch them. Taiwan forms (說, 群, 著) are also the ones
 * the FLEURS Cantonese references use.
 */
let converter: Promise<(text: string) => string> | null = null;

export async function toTraditional(text: string): Promise<string> {
  if (!text) return text;
  converter ??= import("opencc-js/cn2t").then(({ Converter }) =>
    Converter({ from: "cn", to: "tw" }),
  );
  return (await converter)(text);
}
