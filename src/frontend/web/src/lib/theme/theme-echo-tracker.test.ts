import { describe, expect, it } from "vitest";

import { createThemeEchoTracker } from "./theme-echo-tracker";

describe("createThemeEchoTracker", () => {
  it("consumes each submitted value once", () => {
    const tracker = createThemeEchoTracker();
    tracker.submit("dark");
    expect(tracker.consumeEcho("dark")).toBe(true);
    // A later stored "dark" is an external change and must be applied.
    expect(tracker.consumeEcho("dark")).toBe(false);
  });

  it("does not treat stored values this client never sent as echoes", () => {
    const tracker = createThemeEchoTracker();
    tracker.submit("dark");
    expect(tracker.consumeEcho("light")).toBe(false);
  });

  it("counts repeated submissions of the same value", () => {
    const tracker = createThemeEchoTracker();
    tracker.submit("light");
    tracker.submit("light");
    expect(tracker.consumeEcho("light")).toBe(true);
    expect(tracker.consumeEcho("light")).toBe(true);
    expect(tracker.consumeEcho("light")).toBe(false);
  });

  it("drops failed submissions so their value can be applied later", () => {
    const tracker = createThemeEchoTracker();
    tracker.submit("dark");
    tracker.fail("dark");
    expect(tracker.consumeEcho("dark")).toBe(false);
  });
});
