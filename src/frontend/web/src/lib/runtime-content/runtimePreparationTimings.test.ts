import { afterEach, describe, expect, it } from "vitest";

import { createRuntimePreparationTimings } from "./runtimePreparationTimings";

const MILESTONES = [
  "animama:runtime-first-frame",
  "animama:runtime-idle-ready",
  "animama:runtime-settled",
];

function milestoneMounts(name: string): unknown[] {
  return performance
    .getEntriesByName(name, "mark")
    .map((entry) => (entry as PerformanceMark).detail?.mount);
}

describe("runtime preparation timings", () => {
  afterEach(() => performance.clearMarks());

  it("records each milestone once under a shared name, with its mount in the detail", () => {
    const timings = createRuntimePreparationTimings();
    timings.mark("first-posed-frame");
    for (const name of ["first-frame", "idle-ready", "settled"] as const) {
      timings.milestone(name);
      timings.milestone(name);
    }
    const [perMount] = performance
      .getEntriesByType("mark")
      .filter((entry) => entry.name.endsWith(":first-posed-frame"));
    const mount = Number(perMount!.name.match(/runtime-(\d+):/)![1]);
    for (const name of MILESTONES)
      expect(milestoneMounts(name)).toEqual([mount]);
    timings.dispose();
    expect(performance.getEntriesByType("mark")).toEqual([]);
  });

  it("keeps only the newest mount's milestone, which an older mount's disposal leaves", () => {
    const older = createRuntimePreparationTimings();
    const newer = createRuntimePreparationTimings();
    older.milestone("settled");
    newer.milestone("settled");
    const [entry] = performance.getEntriesByName("animama:runtime-settled");
    const mount = (entry as PerformanceMark).detail.mount;
    older.dispose();
    expect(milestoneMounts("animama:runtime-settled")).toEqual([mount]);
    newer.dispose();
    expect(milestoneMounts("animama:runtime-settled")).toEqual([]);
  });
});
