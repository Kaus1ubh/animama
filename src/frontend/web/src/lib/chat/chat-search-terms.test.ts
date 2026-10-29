import { describe, expect, it } from "vitest";

import { chatSearchHighlightTerms } from "./chat-search-terms";

describe("chatSearchHighlightTerms", () => {
  it("keeps ASCII runs of two or more characters, distinct and longest first", () => {
    expect(chatSearchHighlightTerms("React hooks-guide a React")).toEqual([
      "react",
      "hooks",
      "guide",
    ]);
  });

  it("highlights non-ASCII words whole, without edge punctuation", () => {
    expect(chatSearchHighlightTerms("「京都」 茶 서울")).toEqual([
      "京都",
      "서울",
      "茶",
    ]);
    expect(chatSearchHighlightTerms("Café -“抹茶”。")).toEqual([
      "café",
      "抹茶",
    ]);
  });

  it("keeps combining marks that end a word", () => {
    expect(chatSearchHighlightTerms("แม่")).toEqual(["แม่"]);
  });

  it("returns nothing for punctuation alone", () => {
    expect(chatSearchHighlightTerms(" 。 - ")).toEqual([]);
  });
});
