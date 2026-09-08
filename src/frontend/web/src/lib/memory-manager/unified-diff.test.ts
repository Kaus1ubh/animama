import { describe, expect, it } from "vitest";

import { parseUnifiedDiff } from "./unified-diff";

describe("parseUnifiedDiff", () => {
  it("classifies unified diff control and content lines", () => {
    const lines = parseUnifiedDiff(
      [
        "--- a/profile.md",
        "+++ b/profile.md",
        "@@ -1,3 +1,3 @@",
        " # Profile",
        "-Old note",
        "+New note",
        "\\ No newline at end of file",
      ].join("\n"),
    );

    expect(lines.map((line) => line.kind)).toEqual([
      "file",
      "file",
      "hunk",
      "context",
      "remove",
      "add",
      "meta",
    ]);
    expect(lines[4]?.content).toBe("-Old note");
    expect(lines[5]?.content).toBe("+New note");
  });

  it("returns an empty list for blank diffs", () => {
    expect(parseUnifiedDiff(" \n ")).toEqual([]);
    expect(parseUnifiedDiff(null)).toEqual([]);
  });
});
