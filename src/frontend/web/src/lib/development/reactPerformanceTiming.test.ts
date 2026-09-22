import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installReactPerformanceTimingCleanup } from "./reactPerformanceTiming";

const testPrefix = "animama-react-timing-test:";
const measuredNames = new Set<string>();

/** Use the real User Timing buffer and fake only browser observer delivery. */
class TestObserver {
  static supportedEntryTypes = ["measure"];
  static instances: TestObserver[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  readonly callback: PerformanceObserverCallback;

  constructor(callback: PerformanceObserverCallback) {
    this.callback = callback;
    TestObserver.instances.push(this);
  }

  deliver(entries = performance.getEntriesByType("measure")) {
    this.callback(
      {
        getEntries: () => entries,
      } as PerformanceObserverEntryList,
      this as unknown as PerformanceObserver,
    );
  }
}

function measure(name: string, detail: unknown) {
  const fullName = `${testPrefix}${name}`;
  measuredNames.add(fullName);
  return performance.measure(fullName, { start: 0, end: 1, detail });
}

let stop: (() => void) | undefined;

beforeEach(() => {
  TestObserver.instances = [];
  vi.stubGlobal("PerformanceObserver", TestObserver);
  vi.stubGlobal("window", { location: { search: "" } });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  for (const name of measuredNames) {
    performance.clearMeasures(name);
    performance.clearMarks(name);
  }
  measuredNames.clear();
  vi.unstubAllGlobals();
});

describe("development React performance timing cleanup", () => {
  it("releases component and scheduler measures after every delivery", () => {
    stop = installReactPerformanceTimingCleanup();

    for (let round = 0; round < 3; round++) {
      for (let index = 0; index < 1_000; index++) {
        measure("component", {
          devtools: {
            track: "Components ⚛",
            properties: [["Changed Props", ""]],
          },
        });
        measure("scheduler", {
          devtools: { track: "Blocking", trackGroup: "Scheduler ⚛" },
        });
      }
      for (const observer of TestObserver.instances) observer.deliver();
      expect(
        performance.getEntriesByName(`${testPrefix}component`),
      ).toHaveLength(0);
      expect(
        performance.getEntriesByName(`${testPrefix}scheduler`),
      ).toHaveLength(0);
    }
  });

  it("preserves app timings, unknown metadata and marks, including name collisions", () => {
    // This older app measure is not in the next observer delivery.
    const appMeasure = measure("shared", { source: "application" });
    const unknownMeasure = measure("unknown", {
      devtools: { track: "Components" },
    });
    const plainMeasure = measure("plain", null);
    stop = installReactPerformanceTimingCleanup();
    const component = measure("component", {
      devtools: { track: "Components ⚛" },
    });
    const shared = measure("shared", { devtools: { track: "Components ⚛" } });
    performance.mark(component.name);
    const clearMeasures = vi.spyOn(performance, "clearMeasures");

    TestObserver.instances[0].deliver([component, shared]);

    expect(performance.getEntriesByType("measure")).toEqual([
      appMeasure,
      unknownMeasure,
      plainMeasure,
      shared,
    ]);
    expect(performance.getEntriesByName(component.name, "mark")).toHaveLength(
      1,
    );
    expect(clearMeasures).toHaveBeenCalledExactlyOnceWith(component.name);
  });

  it("installs once, disconnects idempotently and can restart after cleanup", () => {
    stop = installReactPerformanceTimingCleanup();
    expect(installReactPerformanceTimingCleanup()).toBe(stop);
    expect(TestObserver.instances).toHaveLength(1);
    expect(TestObserver.instances[0].observe).toHaveBeenCalledWith({
      type: "measure",
      buffered: true,
    });
    stop();
    stop();
    expect(TestObserver.instances[0].disconnect).toHaveBeenCalledTimes(1);

    const component = measure("component", {
      devtools: { track: "Components ⚛" },
    });
    TestObserver.instances[0].deliver();
    expect(performance.getEntriesByName(component.name)).toHaveLength(1);

    stop = installReactPerformanceTimingCleanup();
    expect(TestObserver.instances).toHaveLength(2);
    TestObserver.instances[1].deliver();
    expect(performance.getEntriesByName(component.name)).toHaveLength(0);
  });

  it.each([
    undefined,
    class {
      static supportedEntryTypes = ["resource"];
    },
  ])("does nothing when measure observation is unavailable", (observer) => {
    vi.stubGlobal("PerformanceObserver", observer);
    const component = measure("component", {
      devtools: { track: "Components ⚛" },
    });

    stop = installReactPerformanceTimingCleanup();
    stop();

    expect(TestObserver.instances).toHaveLength(0);
    expect(performance.getEntriesByName(component.name)).toHaveLength(1);
  });

  it("preserves intentional profiling when opted in on page load", () => {
    vi.stubGlobal("window", {
      location: { search: "?other=1&reactProfile=1" },
    });
    const component = measure("component", {
      devtools: { track: "Components ⚛" },
    });

    stop = installReactPerformanceTimingCleanup();

    expect(TestObserver.instances).toHaveLength(0);
    expect(performance.getEntriesByName(component.name)).toHaveLength(1);
  });
});
