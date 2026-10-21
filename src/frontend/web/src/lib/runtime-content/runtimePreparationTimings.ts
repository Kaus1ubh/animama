let nextMount = 1;

export type RuntimeTimingStage =
  | "manifest-ready"
  | "essential-bytes-ready"
  | "first-posed-frame"
  | "optional-settled";

/** Milestones of one mount, recorded under names every mount shares. */
export type RuntimeMilestone = "first-frame" | "idle-ready" | "settled";

/**
 * Bounded, identity-free User Timing marks for Performance traces: four
 * per-mount marks (`animama:runtime-N:<stage>`) and three milestones
 * (`animama:runtime-<milestone>`) whose detail names the mount. Only the newest
 * mount's entry is kept under a milestone name.
 */
export function createRuntimePreparationTimings() {
  const mount = nextMount++;
  const prefix = `animama:runtime-${mount}`;
  const marks = new Set<string>();
  const milestones = new Set<string>();
  return {
    mark(stage: RuntimeTimingStage) {
      const name = `${prefix}:${stage}`;
      if (marks.has(name)) return;
      marks.add(name);
      performance.mark(name);
    },
    milestone(milestone: RuntimeMilestone) {
      const name = `animama:runtime-${milestone}`;
      if (milestones.has(name)) return;
      milestones.add(name);
      performance.clearMarks(name);
      performance.mark(name, { detail: { mount } });
    },
    dispose() {
      for (const name of marks) performance.clearMarks(name);
      marks.clear();
      for (const name of milestones) {
        // A newer mount's entry replaced this one: leave it.
        const own = performance
          .getEntriesByName(name, "mark")
          .every((entry) => (entry as PerformanceMark).detail?.mount === mount);
        if (own) performance.clearMarks(name);
      }
      milestones.clear();
    },
  };
}
