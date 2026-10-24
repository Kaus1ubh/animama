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

  it.each([
    [812, 375, "phone"],
    [1024, 499, "phone"],
    [1024, 500, "tablet"],
    [1440, 400, "desktop"],
  ] as const)(
    "maps a %ix%ipx viewport to the %s layout",
    (width, height, expected) => {
      expect(resolveAnimaRosterLayout(width, height)).toBe(expected);
    },
  );
});
