import { describe, expect, it } from "vitest";

import { resolveAnimaRosterLayout } from "@/lib/animas/anima-roster-layout";

describe("resolveAnimaRosterLayout", () => {
  it.each([
    [0, "phone"],
    [767, "phone"],
    [768, "tablet"],
    [1279, "tablet"],
    [1280, "desktop"],
    [1920, "desktop"],
  ] as const)("maps %ipx to the %s layout", (width, expected) => {
    expect(resolveAnimaRosterLayout(width)).toBe(expected);
  });
});
