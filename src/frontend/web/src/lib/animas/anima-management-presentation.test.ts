import { describe, expect, it } from "vitest";

import {
  resolveAnimaIdentityContent,
  summarizeIdentityMarkdown,
} from "./anima-management-presentation";

describe("Anima management presentation", () => {
  it("prefers readable Personality prose over earlier identity sections", () => {
    const identity = [
      "# Annie",
      "",
      "## Appearance",
      "Annie has red hair.",
      "",
      "## Personality",
      "- Friendly, curious, and conversational.",
      "- Loves helping with vague ideas.",
      "",
      "## Boundaries",
      "Be kind.",
    ].join("\n");

    expect(summarizeIdentityMarkdown(identity)).toBe(
      "Friendly, curious, and conversational. Loves helping with vague ideas.",
    );
  });

  it("strips inline Markdown and truncates a long fallback at a word", () => {
    expect(
      summarizeIdentityMarkdown(
        "# Identity\nA **warm** companion with [good instincts](https://example.com) and patient conversation.",
        50,
      ),
    ).toBe("A warm companion with good instincts and…");
  });

  it("returns an empty summary when there is no readable prose", () => {
    expect(summarizeIdentityMarkdown("## Personality\n\n")).toBe("");
    expect(summarizeIdentityMarkdown(null)).toBe("");
  });

  it("uses scoped identity memory before the Avatar seed fallback", () => {
    expect(resolveAnimaIdentityContent("  # Current identity  ", "Seed")).toBe(
      "# Current identity",
    );
    expect(resolveAnimaIdentityContent(null, "  # Seed identity  ")).toBe(
      "# Seed identity",
    );
    expect(resolveAnimaIdentityContent("   ", "Seed identity")).toBe(
      "Seed identity",
    );
    expect(resolveAnimaIdentityContent(null, null)).toBe("");
  });
});
