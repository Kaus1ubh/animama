import { useEffect, useMemo, useState } from "react";

type TimedSample = {
  atMs: number;
  value: number;
};

type NumericSummary = {
  count: number;
  avg: number | null;
  p95: number | null;
  max: number | null;
};

export type MainThreadHealthMetrics = {
  updatedAtMs: number | null;
  fps1s: number | null;
  fps5s: number | null;
  frameMs: NumericSummary;
  eventLoopLagMs: NumericSummary;
  longTaskObserverSupported: boolean;
  longTaskCount10s: number;
  longTaskBlockedMs10s: number;
  longTaskCountTotal: number;
  longTaskBlockedMsTotal: number;
};

export type RuntimeCapabilities = {
  hardwareConcurrency: number | null;
  deviceMemoryGiB: number | null;
  crossOriginIsolated: boolean;
  sharedArrayBuffer: boolean;
  atomics: boolean;
  webWorkers: boolean;
  audioWorklet: boolean;
  webAssembly: boolean;
  wasmThreadsPrereqs: boolean;
  jsHeapMemoryApi: boolean;
  userAgentSpecificMemoryApi: boolean;
};

export type MemoryMetrics = {
  updatedAtMs: number | null;
  jsHeapSupported: boolean;
  jsHeapUsedBytes: number | null;
  jsHeapTotalBytes: number | null;
  jsHeapLimitBytes: number | null;
  jsHeapDelta10sBytes: number | null;
  uaMemorySupported: boolean;
  uaMemoryBytes: number | null;
  uaMemoryBreakdownCount: number | null;
  uaMemoryUpdatedAtMs: number | null;
  uaMemoryError: string | null;
};

type PerformanceMemoryLike = {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
};

type UserAgentSpecificMemoryResultLike = {
  bytes: number;
  breakdown?: unknown[];
};

type PerformanceWithExperimentalMemory = Performance & {
  memory?: PerformanceMemoryLike;
  measureUserAgentSpecificMemory?: () => Promise<UserAgentSpecificMemoryResultLike>;
};

const EMPTY_SUMMARY: NumericSummary = {
  count: 0,
  avg: null,
  p95: null,
  max: null,
};

const INITIAL_MAIN_THREAD: MainThreadHealthMetrics = {
  updatedAtMs: null,
  fps1s: null,
  fps5s: null,
  frameMs: EMPTY_SUMMARY,
  eventLoopLagMs: EMPTY_SUMMARY,
  longTaskObserverSupported: false,
  longTaskCount10s: 0,
  longTaskBlockedMs10s: 0,
  longTaskCountTotal: 0,
  longTaskBlockedMsTotal: 0,
};

const INITIAL_RUNTIME_CAPABILITIES: RuntimeCapabilities = {
  hardwareConcurrency: null,
  deviceMemoryGiB: null,
  crossOriginIsolated: false,
  sharedArrayBuffer: false,
  atomics: false,
  webWorkers: false,
  audioWorklet: false,
  webAssembly: false,
  wasmThreadsPrereqs: false,
  jsHeapMemoryApi: false,
  userAgentSpecificMemoryApi: false,
};

const INITIAL_MEMORY: MemoryMetrics = {
  updatedAtMs: null,
  jsHeapSupported: false,
  jsHeapUsedBytes: null,
  jsHeapTotalBytes: null,
  jsHeapLimitBytes: null,
  jsHeapDelta10sBytes: null,
  uaMemorySupported: false,
  uaMemoryBytes: null,
  uaMemoryBreakdownCount: null,
  uaMemoryUpdatedAtMs: null,
  uaMemoryError: null,
};

function pushSample(
  list: TimedSample[],
  sample: TimedSample,
  retentionMs: number,
): void {
  list.push(sample);
  const cutoff = sample.atMs - retentionMs;
  while (list.length > 0 && list[0].atMs < cutoff) {
    list.shift();
  }
}

function summarizeSamples(samples: TimedSample[]): NumericSummary {
  if (samples.length === 0) return EMPTY_SUMMARY;
  let sum = 0;
  let max = Number.NEGATIVE_INFINITY;
  const values = new Array<number>(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const value = samples[i].value;
    values[i] = value;
    sum += value;
    if (value > max) max = value;
  }
  values.sort((a, b) => a - b);
  const p95Index = Math.min(
    values.length - 1,
    Math.floor(values.length * 0.95),
  );
  return {
    count: samples.length,
    avg: sum / samples.length,
    p95: values[p95Index] ?? null,
    max: Number.isFinite(max) ? max : null,
  };
}

function summarizeWindow(
  samples: TimedSample[],
  nowMs: number,
  windowMs: number,
): NumericSummary {
  const cutoff = nowMs - windowMs;
  const windowSamples = samples.filter((sample) => sample.atMs >= cutoff);
  return summarizeSamples(windowSamples);
}

function fpsFromFrameSummary(summary: NumericSummary): number | null {
  if (typeof summary.avg !== "number" || summary.avg <= 0) return null;
  return 1000 / summary.avg;
}

function supportsLongTaskObserver(): boolean {
  if (typeof PerformanceObserver === "undefined") return false;
  const supported = PerformanceObserver.supportedEntryTypes;
  return Array.isArray(supported) && supported.includes("longtask");
}

function readRuntimeCapabilities(): RuntimeCapabilities {
  if (typeof window === "undefined") {
    return INITIAL_RUNTIME_CAPABILITIES;
  }

  const nav = navigator as Navigator & { deviceMemory?: number };
  const perf = performance as PerformanceWithExperimentalMemory;
  const sharedArrayBuffer = typeof SharedArrayBuffer !== "undefined";
  const atomics = typeof Atomics !== "undefined";
  const crossOriginIsolated = window.crossOriginIsolated === true;

  return {
    hardwareConcurrency:
      typeof nav.hardwareConcurrency === "number" && nav.hardwareConcurrency > 0
        ? nav.hardwareConcurrency
        : null,
    deviceMemoryGiB:
      typeof nav.deviceMemory === "number" && Number.isFinite(nav.deviceMemory)
        ? nav.deviceMemory
        : null,
    crossOriginIsolated,
    sharedArrayBuffer,
    atomics,
    webWorkers: typeof Worker !== "undefined",
    audioWorklet:
      typeof AudioWorkletNode !== "undefined" ||
      typeof (window as Window & { AudioWorklet?: unknown }).AudioWorklet !==
        "undefined",
    webAssembly: typeof WebAssembly !== "undefined",
    wasmThreadsPrereqs:
      typeof WebAssembly !== "undefined" &&
      sharedArrayBuffer &&
      atomics &&
      crossOriginIsolated,
    jsHeapMemoryApi: typeof perf.memory !== "undefined",
    userAgentSpecificMemoryApi:
      typeof perf.measureUserAgentSpecificMemory === "function",
  };
}

export function useDebugMainThreadHealthMetrics(
  enabled: boolean,
): MainThreadHealthMetrics {
  const [metrics, setMetrics] =
    useState<MainThreadHealthMetrics>(INITIAL_MAIN_THREAD);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const frameSamples: TimedSample[] = [];
    const lagSamples: TimedSample[] = [];
    const longTaskSamples: TimedSample[] = [];
    let longTaskCountTotal = 0;
    let longTaskBlockedMsTotal = 0;
    let rafId: number | null = null;
    let publishTimerId: number | null = null;
    let lagTimerId: number | null = null;
    let observer: PerformanceObserver | null = null;
    let lastFrameAtMs: number | null = null;

    const longTaskObserverSupported = supportsLongTaskObserver();

    const onAnimationFrame = (nowMs: number) => {
      if (typeof lastFrameAtMs === "number") {
        const frameMs = nowMs - lastFrameAtMs;
        if (Number.isFinite(frameMs) && frameMs > 0 && frameMs < 1000) {
          pushSample(frameSamples, { atMs: nowMs, value: frameMs }, 5_000);
        }
      }
      lastFrameAtMs = nowMs;
      rafId = window.requestAnimationFrame(onAnimationFrame);
    };

    rafId = window.requestAnimationFrame(onAnimationFrame);

    const lagIntervalMs = 100;
    let expectedLagTickMs = performance.now() + lagIntervalMs;
    lagTimerId = window.setInterval(() => {
      const nowMs = performance.now();
      const lagMs = Math.max(0, nowMs - expectedLagTickMs);
      expectedLagTickMs = nowMs + lagIntervalMs;
      pushSample(lagSamples, { atMs: nowMs, value: lagMs }, 5_000);
    }, lagIntervalMs);

    if (longTaskObserverSupported) {
      observer = new PerformanceObserver((list) => {
        const nowMs = performance.now();
        for (const entry of list.getEntries()) {
          const duration = Number(entry.duration);
          if (!Number.isFinite(duration) || duration <= 0) continue;
          pushSample(longTaskSamples, { atMs: nowMs, value: duration }, 10_000);
          longTaskCountTotal += 1;
          longTaskBlockedMsTotal += duration;
        }
      });
      try {
        observer.observe({ entryTypes: ["longtask"] });
      } catch {
        observer.disconnect();
        observer = null;
      }
    }

    const publish = () => {
      const nowMs = performance.now();
      const frame1s = summarizeWindow(frameSamples, nowMs, 1_000);
      const frame5s = summarizeWindow(frameSamples, nowMs, 5_000);
      const lag5s = summarizeWindow(lagSamples, nowMs, 5_000);

      const longTaskCutoffMs = nowMs - 10_000;
      while (
        longTaskSamples.length > 0 &&
        longTaskSamples[0].atMs < longTaskCutoffMs
      ) {
        longTaskSamples.shift();
      }

      let longTaskBlockedMs10s = 0;
      for (const sample of longTaskSamples) {
        longTaskBlockedMs10s += sample.value;
      }

      setMetrics({
        updatedAtMs: Date.now(),
        fps1s: fpsFromFrameSummary(frame1s),
        fps5s: fpsFromFrameSummary(frame5s),
        frameMs: frame5s,
        eventLoopLagMs: lag5s,
        longTaskObserverSupported,
        longTaskCount10s: longTaskSamples.length,
        longTaskBlockedMs10s,
        longTaskCountTotal,
        longTaskBlockedMsTotal,
      });
    };

    publish();
    publishTimerId = window.setInterval(publish, 500);

    return () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      if (lagTimerId !== null) {
        window.clearInterval(lagTimerId);
      }
      if (publishTimerId !== null) {
        window.clearInterval(publishTimerId);
      }
      observer?.disconnect();
    };
  }, [enabled]);

  return enabled ? metrics : INITIAL_MAIN_THREAD;
}

export function useDebugMemoryMetrics(enabled: boolean): MemoryMetrics {
  const [metrics, setMetrics] = useState<MemoryMetrics>(INITIAL_MEMORY);

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    const perf = performance as PerformanceWithExperimentalMemory;
    const heapSamples: TimedSample[] = [];
    let heapTimerId: number | null = null;
    let uaTimerId: number | null = null;
    let uaPollInFlight = false;
    let disposed = false;

    const pollHeap = () => {
      const nowMs = performance.now();
      const heap = perf.memory;
      if (heap) {
        pushSample(
          heapSamples,
          { atMs: nowMs, value: heap.usedJSHeapSize },
          10_000,
        );
      }

      const oldestHeapSample = heapSamples[0] ?? null;
      const newestHeapSample =
        heapSamples.length > 0 ? heapSamples[heapSamples.length - 1] : null;
      const jsHeapDelta10sBytes =
        oldestHeapSample && newestHeapSample
          ? newestHeapSample.value - oldestHeapSample.value
          : null;

      setMetrics((prev) => ({
        ...prev,
        updatedAtMs: Date.now(),
        jsHeapSupported: typeof heap !== "undefined",
        jsHeapUsedBytes: heap?.usedJSHeapSize ?? null,
        jsHeapTotalBytes: heap?.totalJSHeapSize ?? null,
        jsHeapLimitBytes: heap?.jsHeapSizeLimit ?? null,
        jsHeapDelta10sBytes,
        uaMemorySupported:
          typeof perf.measureUserAgentSpecificMemory === "function",
      }));
    };

    const pollUserAgentMemory = async () => {
      if (typeof perf.measureUserAgentSpecificMemory !== "function") return;
      if (uaPollInFlight) return;
      uaPollInFlight = true;
      try {
        const result = await perf.measureUserAgentSpecificMemory();
        if (disposed) return;
        setMetrics((prev) => ({
          ...prev,
          uaMemorySupported: true,
          uaMemoryBytes:
            typeof result?.bytes === "number" && Number.isFinite(result.bytes)
              ? result.bytes
              : null,
          uaMemoryBreakdownCount: Array.isArray(result?.breakdown)
            ? result.breakdown.length
            : null,
          uaMemoryUpdatedAtMs: Date.now(),
          uaMemoryError: null,
        }));
      } catch (error) {
        if (disposed) return;
        const message =
          error instanceof Error ? error.message : String(error ?? "unknown");
        setMetrics((prev) => ({
          ...prev,
          uaMemorySupported: true,
          uaMemoryError: message,
          uaMemoryUpdatedAtMs: Date.now(),
        }));
      } finally {
        uaPollInFlight = false;
      }
    };

    pollHeap();
    void pollUserAgentMemory();

    heapTimerId = window.setInterval(pollHeap, 1_000);
    uaTimerId = window.setInterval(() => {
      void pollUserAgentMemory();
    }, 15_000);

    return () => {
      disposed = true;
      if (heapTimerId !== null) {
        window.clearInterval(heapTimerId);
      }
      if (uaTimerId !== null) {
        window.clearInterval(uaTimerId);
      }
    };
  }, [enabled]);

  return enabled ? metrics : INITIAL_MEMORY;
}

export function useDebugRuntimeCapabilities(
  enabled: boolean,
): RuntimeCapabilities {
  return useMemo(
    () => (enabled ? readRuntimeCapabilities() : INITIAL_RUNTIME_CAPABILITIES),
    [enabled],
  );
}

export function useDebugSystemMetrics(enabled: boolean): {
  mainThreadHealth: MainThreadHealthMetrics;
  runtimeCapabilities: RuntimeCapabilities;
  memory: MemoryMetrics;
} {
  const mainThreadHealth = useDebugMainThreadHealthMetrics(enabled);
  const memory = useDebugMemoryMetrics(enabled);
  const runtimeCapabilities = useDebugRuntimeCapabilities(enabled);

  return {
    mainThreadHealth,
    runtimeCapabilities,
    memory,
  };
}
