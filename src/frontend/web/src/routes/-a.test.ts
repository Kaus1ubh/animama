import { describe, expect, it } from "vitest";

import { legacyApplicationHref } from "./a";

describe("legacy /a redirect", () => {
  it.each([
    ["/a", "/"],
    ["/a/", "/"],
    ["/a/library?section=fx#top", "/library?section=fx#top"],
    ["/a/annie/c/chat-1", "/annie/c/chat-1"],
    // Router matching is case-insensitive; a mismatch here would loop.
    ["/A/library", "/library"],
  ])("redirects %s to %s", (legacy, current) => {
    expect(legacyApplicationHref(legacy)).toBe(current);
  });

  it.each(["/a//evil.example/x", "/a/\\evil.example"])(
    "keeps %s on the current origin",
    (legacy) => {
      const href = legacyApplicationHref(legacy);
      expect(href.startsWith("/")).toBe(true);
      expect(href.startsWith("//")).toBe(false);
      expect(new URL(href, "http://app.invalid").origin).toBe(
        "http://app.invalid",
      );
    },
  );
});
