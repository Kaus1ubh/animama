import { describe, expect, it } from "vitest";

import { resolveSonnerTheme } from "./sonner";

describe("resolveSonnerTheme", () => {
  it.each([
    ["light", "light"],
    ["dark", "dark"],
    ["system", "system"],
    ["custom", "light"],
  ] as const)("maps %s to %s", (theme, expected) => {
    expect(resolveSonnerTheme(theme)).toBe(expected);
  });
});
