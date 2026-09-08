let nextMount = 1;

export type RuntimeTimingStage =
  | "manifest-ready"
  | "essential-bytes-ready"
  | "first-posed-frame"
  | "optional-settled";

/** Four bounded, identity-free User Timing marks per mounted runtime for Performance traces. */
export function createRuntimePreparationTimings() {
  const prefix = `animama:runtime-${nextMount++}`;
  const marks = new Set<string>();
  return {
    mark(stage: RuntimeTimingStage) {
      const name = `${prefix}:${stage}`;
      if (marks.has(name)) return;
      marks.add(name);
      performance.mark(name);
    },
    dispose() {
      for (const name of marks) performance.clearMarks(name);
      marks.clear();
    },
  };
}
