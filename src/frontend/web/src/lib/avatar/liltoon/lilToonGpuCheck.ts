import type * as THREE from "three";

import { createLogger } from "@/lib/logger";

import { isLilToonSurface } from "./lilToonSurface";

/**
 * Automatic for the per-Avatar Materials setting: lilToon at the highest frame
 * rate this machine's GPU sustains, and Simple only below 24 fps.
 *
 * The main Avatar canvas (`AvatarSceneHost` in `main` mode: chat and the
 * surfaces that reuse it; never Picture in Picture or previews) times frames
 * it draws with a lilToon Avatar on the GPU (`EXT_disjoint_timer_query_webgl2`)
 * and stores the median per viewer and GPU, under `localStorage` key
 * `animama.lilToonGpuCheck`. It measures once per session until a GPU has
 * `LILTOON_GPU_SAMPLES` measurements, then again once the newest is older than
 * `LILTOON_REMEASURE_AFTER_MS`; the newest few are kept and Automatic uses the
 * fastest, so one measurement taken while the machine was busy does not stick.
 *
 * Every load under Automatic reads them (`decideAutomaticMaterials`): lilToon,
 * capped at the highest of `LILTOON_FRAME_RATES` whose budget the frame fits,
 * or Simple when even 24 fps does not fit. The canvas showing the Avatar
 * renders at most at the cap (`canvasFrameCap.ts`). Materials and the cap are
 * chosen at load, so a new measurement applies from the next load. A GPU that
 * has not been measured yet, or a browser that cannot time the GPU, keeps
 * lilToon uncapped; Diagnostics says which (`AutomaticMaterialsDecision`).
 *
 * Removing the storage key, or raising `METHOD` below, measures every GPU
 * again from scratch.
 */

const logger = createLogger("LilToonGpuCheck");

/**
 * Frame rates Automatic renders a lilToon Avatar at, highest first: the
 * canvas's full rate, then the caps a slower GPU gets. Below the last, it
 * loads Simple.
 */
export const LILTOON_FRAME_RATES = [60, 45, 30, 24] as const;

/**
 * How much of a frame interval a lilToon frame may use: its measured GPU time
 * times this must fit the interval, so the Avatar's effects (up to 4 ms for a
 * Reaction's Particle and Scene Effects), the rest of the page and timing
 * jitter keep about a quarter of it. Budgets: 60 fps up to 12.8 ms, 45 up to
 * 17.1, 30 up to 25.6 and 24 up to 32.1. The reference Apple M5 measures
 * 5–7 ms idle (60 fps) and stored 14.4 ms once while the machine was busy
 * (45 fps), which later measurements replace. Owner decision.
 *
 * The time is compared as measured, not scaled by canvas size: on the M5 a
 * converted Avatar's lilToon frame took 5.3–6.0 ms from 1.0 to 5.9 million
 * drawing-buffer pixels (an 800 × 600 canvas at DPR 1.44 to 3.5; the default
 * app window's chat canvas is about 3.7 million at DPR 2), where an Included
 * Avatar's grew from 2.4 to 4.5 ms. The cost is mostly per frame, not per
 * pixel, so per-pixel scaling would understate a large canvas.
 */
export const LILTOON_FRAME_HEADROOM = 1.3;

/** The slowest lilToon frame, in GPU milliseconds, that fits `fps`. */
export function lilToonFrameBudgetMs(fps: number): number {
  return 1000 / fps / LILTOON_FRAME_HEADROOM;
}

/** Measurements kept per GPU; Automatic uses the fastest of them. */
export const LILTOON_GPU_SAMPLES = 3;

/** A GPU whose newest measurement is older than this is measured again. */
export const LILTOON_REMEASURE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Measurements, from different sessions, that must all be too slow for 24
 * fps before Automatic loads Simple. Until then it keeps lilToon at 24 fps,
 * because only lilToon frames can be measured again.
 */
export const LILTOON_SIMPLE_AFTER_SAMPLES = 2;

/** How the chat canvas measures a lilToon frame. */
export const LILTOON_GPU_CHECK = {
  /** Frames drawn first, so shader compiles and uploads do not count. */
  warmupFrames: 60,
  /** Timed frames; the measurement is their median. */
  frames: 60,
  /**
   * Smallest drawing buffer that counts, in pixels: a chat canvas (800 × 600
   * at DPR 2 is 1.9 million), not a thumbnail-sized preview.
   */
  minPixels: 1_000_000,
  /** Disjoint events (GPU clock changes) before giving up until the next check. */
  maxDisjoint: 10,
  /** While nothing is measuring, how often the canvas checks whether a measurement is due. */
  recheckMs: 60 * 60 * 1000,
} as const;

/** Bump to measure every GPU again (a changed method or pre-pass). */
const METHOD = 2;
const STORAGE_KEY = "animama.lilToonGpuCheck";
/** GPUs one viewer keeps measurements for (an external display's eGPU, say). */
const MAX_GPUS = 8;

/** One timed run of lilToon frames. */
export type LilToonGpuSample = {
  /** Median GPU time of a chat frame with a lilToon Avatar. */
  frameMs: number;
  frames: number;
  /** Drawing-buffer pixels of the measured canvas. */
  pixels: number;
  measuredAt: string;
};

/** One GPU's stored result. */
export type LilToonGpuMeasurement =
  | {
      status: "measured";
      method: number;
      /** Oldest first; at most `LILTOON_GPU_SAMPLES`. */
      samples: LilToonGpuSample[];
    }
  | {
      /** The browser cannot time the GPU (no timer query extension). */
      status: "unsupported";
      method: number;
    };

/** What Automatic chose for one load, and why. */
export type AutomaticMaterialsDecision = {
  choice: "liltoon" | "simple";
  /**
   * `fast`: lilToon at 60 fps. `capped`: lilToon at a lower rate.
   * `remeasuring`: too slow for 24 fps, but lilToon at 24 fps until
   * `LILTOON_SIMPLE_AFTER_SAMPLES` recent measurements agree. `slow`: Simple.
   * `not_measured` and `unsupported`: lilToon, uncapped.
   */
  reason:
    | "fast"
    | "capped"
    | "remeasuring"
    | "slow"
    | "not_measured"
    | "unsupported";
  /**
   * The most frames per second a canvas showing this lilToon Avatar renders;
   * null when uncapped or Simple.
   */
  fpsCap: number | null;
  /**
   * The rate the measurement was judged against: the cap, or 24 when too
   * slow for it; null without a measurement.
   */
  budgetFps: number | null;
  /** The fastest stored measurement, when there is one. */
  frameMs: number | null;
  /** Drawing-buffer pixels of that measurement's canvas. */
  pixels: number | null;
  /** How many measurements the decision rests on. */
  samples: number;
};

const SLOWEST_FPS = LILTOON_FRAME_RATES[LILTOON_FRAME_RATES.length - 1];

/** The fastest of a GPU's stored measurements. */
function fastestSample(samples: readonly LilToonGpuSample[]): LilToonGpuSample {
  return samples.reduce((best, sample) =>
    sample.frameMs < best.frameMs ? sample : best,
  );
}

/** Whether a GPU's newest measurement is older than the re-measure interval. */
function isStale(samples: readonly LilToonGpuSample[], nowMs: number): boolean {
  const newest = Date.parse(samples[samples.length - 1]!.measuredAt);
  return !(nowMs - newest <= LILTOON_REMEASURE_AFTER_MS);
}

/** Decide Automatic from a GPU's stored measurement (none: not measured). */
export function decideAutomaticMaterials(
  measurement: LilToonGpuMeasurement | null,
  nowMs: number = Date.now(),
): AutomaticMaterialsDecision {
  if (!measurement || measurement.status === "unsupported")
    return {
      choice: "liltoon",
      reason: measurement ? "unsupported" : "not_measured",
      fpsCap: null,
      budgetFps: null,
      frameMs: null,
      pixels: null,
      samples: 0,
    };
  const best = fastestSample(measurement.samples);
  const facts = {
    frameMs: best.frameMs,
    pixels: best.pixels,
    samples: measurement.samples.length,
  };
  const fps = LILTOON_FRAME_RATES.find(
    (rate) => best.frameMs <= lilToonFrameBudgetMs(rate),
  );
  if (fps !== undefined)
    return {
      choice: "liltoon",
      reason: fps === LILTOON_FRAME_RATES[0] ? "fast" : "capped",
      fpsCap: fps,
      budgetFps: fps,
      ...facts,
    };
  const settled =
    measurement.samples.length >= LILTOON_SIMPLE_AFTER_SAMPLES &&
    !isStale(measurement.samples, nowMs);
  return settled
    ? {
        choice: "simple",
        reason: "slow",
        fpsCap: null,
        budgetFps: SLOWEST_FPS,
        ...facts,
      }
    : {
        choice: "liltoon",
        reason: "remeasuring",
        fpsCap: SLOWEST_FPS,
        budgetFps: SLOWEST_FPS,
        ...facts,
      };
}

/**
 * Whether the chat canvas should measure a GPU now: never measured, fewer
 * than `LILTOON_GPU_SAMPLES` measurements and none yet this session, or the
 * newest older than `LILTOON_REMEASURE_AFTER_MS`. A browser that could not
 * time the GPU is checked again each session.
 */
export function lilToonGpuCheckDue(
  measurement: LilToonGpuMeasurement | null,
  measuredThisSession: boolean,
  nowMs: number = Date.now(),
): boolean {
  if (measurement?.status !== "measured") return !measuredThisSession;
  return (
    isStale(measurement.samples, nowMs) ||
    (!measuredThisSession && measurement.samples.length < LILTOON_GPU_SAMPLES)
  );
}

type StoredMeasurements = Record<string, LilToonGpuMeasurement>;

/** The viewer's storage, or null where it is blocked (private windows). */
function viewerStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readAll(storage: Storage | null): StoredMeasurements {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as StoredMeasurements)
      : {};
  } catch {
    return {};
  }
}

const isCount = (value: unknown, min = 0): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= min;

function isSample(value: unknown): value is LilToonGpuSample {
  const sample = value as Partial<
    Record<keyof LilToonGpuSample, unknown>
  > | null;
  return (
    !!sample &&
    isCount(sample.frameMs) &&
    isCount(sample.frames, 1) &&
    isCount(sample.pixels, LILTOON_GPU_CHECK.minPixels) &&
    typeof sample.measuredAt === "string" &&
    Number.isFinite(Date.parse(sample.measuredAt))
  );
}

function isMeasurement(value: unknown): value is LilToonGpuMeasurement {
  const entry = value as Partial<{
    status: unknown;
    method: unknown;
    samples: unknown;
  }> | null;
  if (!entry || entry.method !== METHOD) return false;
  if (entry.status === "unsupported") return true;
  return (
    entry.status === "measured" &&
    Array.isArray(entry.samples) &&
    entry.samples.length > 0 &&
    entry.samples.length <= LILTOON_GPU_SAMPLES &&
    entry.samples.every(isSample)
  );
}

/** A GPU's stored measurement by this method, or null. */
export function readLilToonGpuMeasurement(
  gpu: string,
  storage: Storage | null = viewerStorage(),
): LilToonGpuMeasurement | null {
  const entry = readAll(storage)[gpu];
  return isMeasurement(entry) ? entry : null;
}

/** Store a GPU's measurement; storage that refuses is not an error. */
export function writeLilToonGpuMeasurement(
  gpu: string,
  measurement: LilToonGpuMeasurement,
  storage: Storage | null = viewerStorage(),
): void {
  try {
    const all = readAll(storage);
    delete all[gpu];
    const kept = Object.entries(all).slice(-(MAX_GPUS - 1));
    storage?.setItem(
      STORAGE_KEY,
      JSON.stringify(Object.fromEntries([...kept, [gpu, measurement]])),
    );
  } catch (error) {
    logger.warn("Store", "Could not keep the lilToon GPU measurement", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * Add one measurement to a GPU's stored ones, keeping the newest
 * `LILTOON_GPU_SAMPLES`; returns what is stored now.
 */
export function recordLilToonGpuSample(
  gpu: string,
  sample: LilToonGpuSample,
  storage: Storage | null = viewerStorage(),
): LilToonGpuMeasurement {
  const previous = readLilToonGpuMeasurement(gpu, storage);
  const measurement: LilToonGpuMeasurement = {
    status: "measured",
    method: METHOD,
    samples: [
      ...(previous?.status === "measured" ? previous.samples : []),
      sample,
    ].slice(-LILTOON_GPU_SAMPLES),
  };
  writeLilToonGpuMeasurement(gpu, measurement, storage);
  return measurement;
}

/** The GPU a WebGL context draws on, as the browser names it. */
export function gpuIdentityOf(gl: WebGLRenderingContext): string | null {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const vendor = String(
      gl.getParameter(info ? info.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
    );
    const renderer = String(
      gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    );
    return `${vendor} | ${renderer}`;
  } catch {
    return null;
  }
}

let currentGpu: string | null = null;
/** The GPU a short-lived context names, once per session (undefined: not yet). */
let probedGpu: string | null | undefined;
/** GPUs the chat canvas measured (or found it cannot time) this session. */
const measuredThisSession = new Set<string>();

/**
 * The GPU a fresh WebGL context draws on, for a load before any Avatar canvas
 * has noted one (an off-screen Diagnostics load, the Library before a
 * preview): one context, released at once and named once per session, so
 * every surface looks up the same stored measurement.
 */
function probeGpu(): string | null {
  if (probedGpu !== undefined) return probedGpu;
  probedGpu = null;
  try {
    const canvas = document.createElement("canvas");
    // As React Three Fiber asks for its canvases, so a machine with two GPUs
    // names the one the Avatar canvases draw on.
    const attributes = { powerPreference: "high-performance" } as const;
    const gl = (canvas.getContext("webgl2", attributes) ??
      canvas.getContext("webgl", attributes)) as WebGLRenderingContext | null;
    if (gl) {
      probedGpu = gpuIdentityOf(gl);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  } catch {
    // No DOM or no WebGL: the GPU stays unnamed and Automatic keeps lilToon.
  }
  return probedGpu;
}

/**
 * Note the GPU an Avatar canvas draws on, so Automatic can look up its
 * measurement before the next load. Canvases call it on mount.
 */
export function rememberAvatarCanvasGpu(renderer: THREE.WebGLRenderer): void {
  try {
    currentGpu = gpuIdentityOf(renderer.getContext()) ?? currentGpu;
  } catch {
    // A renderer without a context (a test stand-in) names no GPU.
  }
}

/**
 * What Automatic chooses now: the stored measurement of the GPU the latest
 * Avatar canvas draws on, or of the probed GPU before any canvas noted one.
 * Every Avatar load under Automatic asks this, on every surface.
 */
export function automaticMaterialsDecision(): AutomaticMaterialsDecision {
  const gpu = currentGpu ?? probeGpu();
  return decideAutomaticMaterials(gpu ? readLilToonGpuMeasurement(gpu) : null);
}

/**
 * Automatic's decision now, when a measurement stored since an Avatar loaded
 * changes the materials or frame cap it loaded with (`atLoad`); null when
 * they are unchanged or not under Automatic. Both are chosen at load, so the
 * next load uses it.
 */
export function automaticDecisionSinceLoad(
  atLoad: AutomaticMaterialsDecision | null,
): AutomaticMaterialsDecision | null {
  if (!atLoad) return null;
  const now = automaticMaterialsDecision();
  return now.choice === atLoad.choice && now.fpsCap === atLoad.fpsCap
    ? null
    : now;
}

/**
 * Forget the noted GPU and this session's measurements, for tests; `probed`
 * stands in for the GPU a fresh context would name (undefined: probe again).
 */
export function resetAvatarCanvasGpuForTesting(
  gpu: string | null = null,
  probed?: string | null,
) {
  currentGpu = gpu;
  probedGpu = probed;
  measuredThisSession.clear();
}

type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

/** Whether `scene` draws a visible lilToon surface. */
function drawsLilToon(scene: THREE.Object3D): boolean {
  let found = false;
  scene.traverseVisible((object) => {
    if (found) return;
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material]) {
      if (isLilToonSurface(material)) found = true;
    }
  });
  return found;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Time `renderer`'s frames that draw a lilToon Avatar on a chat-sized canvas
 * and store the median for its GPU whenever a measurement is due
 * (`lilToonGpuCheckDue`; checked at install and then hourly while the canvas
 * lives). Frames another timer query already wraps (a benchmark) are left
 * alone. Without the timer extension it stores "unsupported" at once.
 * Returns the release.
 */
export function installLilToonGpuCheck(
  renderer: THREE.WebGLRenderer,
  storage: Storage | null = viewerStorage(),
): () => void {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const gpu = gpuIdentityOf(gl);
  if (!gpu) return () => undefined;
  const timer = gl.getExtension(
    "EXT_disjoint_timer_query_webgl2",
  ) as TimerExtension | null;
  if (!timer) {
    // Measurements another session took stay; only an unmeasured GPU is
    // marked unsupported.
    if (
      !measuredThisSession.has(gpu) &&
      readLilToonGpuMeasurement(gpu, storage)?.status !== "measured"
    ) {
      measuredThisSession.add(gpu);
      writeLilToonGpuMeasurement(
        gpu,
        { status: "unsupported", method: METHOD },
        storage,
      );
    }
    return () => undefined;
  }

  /** The measurement in progress, or null between measurements. */
  type Round = {
    samples: number[];
    pending: { query: WebGLQuery; pixels: number }[];
    pixelsMeasured: number;
    warm: number;
    disjoint: number;
  };
  let round: Round | null = null;
  let nextCheckMs = Number.NEGATIVE_INFINITY;

  /** Start a round when one is due; otherwise look again after `recheckMs`. */
  const startIfDue = () => {
    const now = Date.now();
    if (now < nextCheckMs) return;
    nextCheckMs = now + LILTOON_GPU_CHECK.recheckMs;
    if (
      lilToonGpuCheckDue(
        readLilToonGpuMeasurement(gpu, storage),
        measuredThisSession.has(gpu),
        now,
      )
    )
      round = {
        samples: [],
        pending: [],
        pixelsMeasured: 0,
        warm: 0,
        disjoint: 0,
      };
  };
  const drop = (active: Round) => {
    for (const { query } of active.pending) gl.deleteQuery(query);
    active.pending.length = 0;
  };
  const finish = (active: Round) => {
    round = null;
    nextCheckMs = Date.now() + LILTOON_GPU_CHECK.recheckMs;
    measuredThisSession.add(gpu);
    const frameMs = median(active.samples);
    const stored = recordLilToonGpuSample(
      gpu,
      {
        frameMs,
        frames: active.samples.length,
        pixels: active.pixelsMeasured,
        measuredAt: new Date().toISOString(),
      },
      storage,
    );
    const decision = decideAutomaticMaterials(stored);
    logger.info("Measure", "lilToon frame GPU time", {
      frameMs: Math.round(frameMs * 100) / 100,
      pixels: active.pixelsMeasured,
      samples: decision.samples,
      choice: decision.choice,
      fpsCap: decision.fpsCap,
    });
  };
  const collect = (active: Round) => {
    while (active.pending.length) {
      const { query, pixels } = active.pending[0]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
      // Checked once a result is available, as the extension recommends.
      // Reading the flag clears it; a disjoint event voids every query in
      // flight. Only frames this check timed can count one.
      if (gl.getParameter(timer.GPU_DISJOINT_EXT)) {
        active.disjoint += 1;
        drop(active);
        // Give up until the next check.
        if (active.disjoint > LILTOON_GPU_CHECK.maxDisjoint) {
          round = null;
          nextCheckMs = Date.now() + LILTOON_GPU_CHECK.recheckMs;
        }
        return;
      }
      active.pending.shift();
      active.samples.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      active.pixelsMeasured = pixels;
      gl.deleteQuery(query);
    }
    if (active.samples.length >= LILTOON_GPU_CHECK.frames) finish(active);
  };

  const render = renderer.render;
  const wrapped: THREE.WebGLRenderer["render"] = function (scene, camera) {
    if (!round) startIfDue();
    const active = round;
    if (!active) return render.call(renderer, scene, camera);
    collect(active);
    const pixels = gl.drawingBufferWidth * gl.drawingBufferHeight;
    const timed =
      round === active &&
      pixels >= LILTOON_GPU_CHECK.minPixels &&
      active.samples.length + active.pending.length <
        LILTOON_GPU_CHECK.frames &&
      gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) === null &&
      drawsLilToon(scene);
    if (!timed || active.warm < LILTOON_GPU_CHECK.warmupFrames) {
      if (timed) active.warm += 1;
      return render.call(renderer, scene, camera);
    }
    const query = gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    try {
      render.call(renderer, scene, camera);
    } finally {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      active.pending.push({ query, pixels });
    }
  };
  renderer.render = wrapped;
  return () => {
    if (round) drop(round);
    round = null;
    nextCheckMs = Number.POSITIVE_INFINITY;
    if (renderer.render === wrapped) renderer.render = render;
  };
}
