import { describe, expect, it } from "vitest";

import { reminderHourOptions } from "@/lib/safety/reminderOptions";

describe("AI-notice reminder options", () => {
  it("offers only intervals at or below the operator's interval", () => {
    expect(reminderHourOptions(3)).toEqual([0.5, 1, 2, 3]);
    expect(reminderHourOptions(1.5)).toEqual([0.5, 1, 1.5]);
    expect(reminderHourOptions(6)).toEqual([0.5, 1, 2, 3, 6]);
    expect(reminderHourOptions(0.25)).toEqual([0.25]);
  });
});
