import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Translations copy the verified crisis lines; they must never drift from English.
const safetyDocs = new URL("../../../../../../docs/safety/", import.meta.url);

function facts(text: string) {
  return {
    urls: [...text.matchAll(/https?:\/\/[^\s)>\]]+/g)].map(([url]) => url),
    numbers: [...text.matchAll(/\d[\d\s-]{1,}\d|\b\d+\b/g)].map(([value]) =>
      value.replace(/\s+/g, " "),
    ),
  };
}

describe("crisis protocol translations", () => {
  const english = readFileSync(
    new URL("crisis-protocol.md", safetyDocs),
    "utf8",
  );
  const translations = readdirSync(safetyDocs).filter((name) =>
    /^crisis-protocol\.[\w-]+\.md$/.test(name),
  );

  it("exist for every beta locale", () => {
    expect(translations.sort()).toEqual([
      "crisis-protocol.ja.md",
      "crisis-protocol.ko.md",
      "crisis-protocol.zh-Hans.md",
      "crisis-protocol.zh-Hant.md",
    ]);
  });

  it.each(translations)(
    "%s keeps every link, number and date of the English protocol",
    (name) => {
      const translated = readFileSync(new URL(name, safetyDocs), "utf8");
      const source = facts(english);
      const copy = facts(translated);
      expect(copy.urls).toEqual(source.urls);
      for (const number of source.numbers)
        expect(copy.numbers).toContain(number);
    },
  );
});
