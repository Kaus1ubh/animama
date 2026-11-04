import { isNonNullObject } from "@/lib/records";

let activeCleanup: (() => void) | undefined;

/** Match the metadata emitted by the installed React 19.2 development renderers. */
function isReactMeasure(entry: PerformanceEntry): boolean {
  if (entry.entryType !== "measure") return false;
  const detail: unknown = (entry as PerformanceMeasure).detail;
  if (!isNonNullObject(detail) || !isNonNullObject(detail.devtools))
    return false;
  return (
    detail.devtools.track === "Components ⚛" ||
    detail.devtools.trackGroup === "Scheduler ⚛"
  );
}

/**
 * Release React's development timings after observer delivery. The browser
 * still records the measurements; intentional profiling can retain them with
 * ?reactProfile=1 on page load. No entry or name is retained between callbacks.
 */
export function installReactPerformanceTimingCleanup(): () => void {
  if (activeCleanup) return activeCleanup;
  if (
    !__ANIMAMA_DEV_BUILD__ ||
    typeof window === "undefined" ||
    typeof PerformanceObserver === "undefined" ||
    !PerformanceObserver.supportedEntryTypes?.includes("measure")
  ) {
    return () => {};
  }

  // Preserve the tab's explicit profiling choice across HMR and route changes.
  const retainMeasures: boolean =
    import.meta.hot?.data.retainReactMeasures ??
    new URLSearchParams(window.location.search).get("reactProfile") === "1";
  if (import.meta.hot)
    import.meta.hot.data.retainReactMeasures = retainMeasures;
  if (retainMeasures) return () => {};

  let stopped = false;
  const observer = new PerformanceObserver((list) => {
    if (stopped) return;
    const names = new Set<string>();
    for (const entry of list.getEntries()) {
      if (isReactMeasure(entry)) names.add(entry.name);
    }
    for (const name of names) {
      // User Timing can clear only by name, not entry identity. Preserve mixed
      // names so a React component cannot erase an application's own measure.
      if (performance.getEntriesByName(name, "measure").every(isReactMeasure)) {
        performance.clearMeasures(name);
      }
    }
  });
  observer.observe({ type: "measure", buffered: true });

  activeCleanup = () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    activeCleanup = undefined;
  };
  return activeCleanup;
}

if (__ANIMAMA_DEV_BUILD__) installReactPerformanceTimingCleanup();

if (import.meta.hot) {
  import.meta.hot.accept();
  import.meta.hot.dispose(() => activeCleanup?.());
}
