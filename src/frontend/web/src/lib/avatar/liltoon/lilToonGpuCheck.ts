import type * as THREE from "three";

import { createLogger } from "@/lib/logger";

import { isLilToonSurface } from "./lilToonSurface";

/**
 * Automatic for the per-Avatar Materials setting: lilToon, unless this
 * machine's GPU is too slow for it.
 *
 * The main Avatar canvas (`AvatarSceneHost` in `main` mode: chat and the
 * surfaces that reuse it; never Picture in Picture or previews) times the
 * first frames it draws with a lilToon Avatar on the GPU
 * (`EXT_disjoint_timer_query_webgl2`) and keeps the median per viewer and
 * GPU, under `localStorage` key `animama.lilToonGpuCheck`. Every later load
 * under Automatic reads it: above `LILTOON_AUTOMATIC_MAX_FRAME_MS` it loads
 * the glTF fallback materials (Simple), otherwise lilToon. Materials are
 * built at load, so a new measurement applies from the next load. A GPU that
 * has not been measured yet, or a browser that cannot time the GPU, keeps
 * lilToon; Diagnostics says which (`AutomaticMaterialsDecision`).
 *
 * A GPU is measured once per viewer. Removing the storage key, or raising
 * `METHOD` below, measures every GPU again once the main canvas next mounts
 * (the check reads storage when it installs), on its next lilToon frames.
 */

const logger = createLogger("LilToonGpuCheck");

/**
 * The slowest lilToon frame Automatic keeps lilToon for, in milliseconds of
 * GPU time at the chat canvas: about half a 60 fps frame (16.7 ms), so the
 * Avatar, its effects (up to 4 ms for a Reaction's Particle and Scene
 * Effects) and the rest of the page still fit in one frame with headroom.
 * The reference Apple M5 measures 5–7 ms, so it keeps lilToon; a GPU about
 * half as fast moves to Simple. Owner decision; change it here (stored
 * measurements are compared on every load, so no re-measure).
 *
 * The measured time is compared as measured, not scaled by canvas size: on
 * the M5 a converted Avatar's lilToon frame took 5.3–6.0 ms from 1.0 to 5.9
 * million drawing-buffer pixels (an 800 × 600 canvas at DPR 1.44 to 3.5;
 * the default app window's chat canvas is about 3.7 million at DPR 2), where
 * an Included Avatar's grew from 2.4 to 4.5 ms. The cost is mostly per frame,
 * not per pixel, so per-pixel scaling would understate a large canvas.
 */
export const LILTOON_AUTOMATIC_MAX_FRAME_MS = 8;

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
  /** Disjoint events (GPU clock changes) before giving up for the session. */
  maxDisjoint: 10,
} as const;

/** Bump to measure every GPU again (a changed method or pre-pass). */
const METHOD = 1;
const STORAGE_KEY = "animama.lilToonGpuCheck";
/** GPUs one viewer keeps measurements for (an external display's eGPU, say). */
const MAX_GPUS = 8;

/** One GPU's stored result. */
export type LilToonGpuMeasurement =
  | {
      status: "measured";
      method: number;
      /** Median GPU time of a chat frame with a lilToon Avatar. */
      frameMs: number;
      frames: number;
      /** Drawing-buffer pixels of the measured canvas. */
      pixels: number;
      measuredAt: string;
    }
  | {
      /** The browser cannot time the GPU (no timer query extension). */
      status: "unsupported";
      method: number;
    };

/** What Automatic chose for one load, and why. */
export type AutomaticMaterialsDecision = {
  choice: "liltoon" | "simple";
  reason: "fast" | "slow" | "not_measured" | "unsupported";
  /** The measured median, when there is one. */
  frameMs: number | null;
  /** Drawing-buffer pixels of the measured canvas, when measured. */
  pixels: number | null;
  thresholdMs: number;
};

/** Decide Automatic from a GPU's stored measurement (none: not measured). */
export function decideAutomaticMaterials(
  measurement: LilToonGpuMeasurement | null,
  thresholdMs: number = LILTOON_AUTOMATIC_MAX_FRAME_MS,
): AutomaticMaterialsDecision {
  if (!measurement)
    return {
      choice: "liltoon",
      reason: "not_measured",
      frameMs: null,
      pixels: null,
      thresholdMs,
    };
  if (measurement.status === "unsupported")
    return {
      choice: "liltoon",
      reason: "unsupported",
      frameMs: null,
      pixels: null,
      thresholdMs,
    };
  const slow = measurement.frameMs > thresholdMs;
  return {
    choice: slow ? "simple" : "liltoon",
    reason: slow ? "slow" : "fast",
    frameMs: measurement.frameMs,
    pixels: measurement.pixels,
    thresholdMs,
  };
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

function isMeasurement(value: unknown): value is LilToonGpuMeasurement {
  const entry = value as Partial<{
    status: unknown;
    method: unknown;
    frameMs: unknown;
    pixels: unknown;
  }> | null;
  if (!entry || entry.method !== METHOD) return false;
  if (entry.status === "unsupported") return true;
  return (
    entry.status === "measured" &&
    isCount(entry.frameMs) &&
    isCount(entry.pixels, LILTOON_GPU_CHECK.minPixels)
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

/** What Automatic chooses on the GPU the latest Avatar canvas draws on. */
export function automaticMaterialsDecision(): AutomaticMaterialsDecision {
  return decideAutomaticMaterials(
    currentGpu ? readLilToonGpuMeasurement(currentGpu) : null,
  );
}

/** Forget the noted GPU, for tests. */
export function resetAvatarCanvasGpuForTesting(gpu: string | null = null) {
  currentGpu = gpu;
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
 * and store the median for its GPU, once per GPU and viewer. Frames another
 * timer query already wraps (a benchmark) are left alone. Without the timer
 * extension it stores "unsupported" at once. Returns the release.
 */
export function installLilToonGpuCheck(
  renderer: THREE.WebGLRenderer,
  storage: Storage | null = viewerStorage(),
): () => void {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const gpu = gpuIdentityOf(gl);
  if (!gpu || readLilToonGpuMeasurement(gpu, storage)) return () => undefined;
  const timer = gl.getExtension(
    "EXT_disjoint_timer_query_webgl2",
  ) as TimerExtension | null;
  if (!timer) {
    writeLilToonGpuMeasurement(
      gpu,
      { status: "unsupported", method: METHOD },
      storage,
    );
    return () => undefined;
  }

  const samples: number[] = [];
  const pending: { query: WebGLQuery; pixels: number }[] = [];
  let pixelsMeasured = 0;
  let warm = 0;
  let disjoint = 0;
  let done = false;

  const drop = () => {
    for (const { query } of pending) gl.deleteQuery(query);
    pending.length = 0;
  };
  const collect = () => {
    while (pending.length) {
      const { query, pixels } = pending[0]!;
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
      // Checked once a result is available, as the extension recommends.
      // Reading the flag clears it; a disjoint event voids every query in
      // flight. Only frames this check timed can count one.
      if (gl.getParameter(timer.GPU_DISJOINT_EXT)) {
        disjoint += 1;
        drop();
        if (disjoint > LILTOON_GPU_CHECK.maxDisjoint) done = true;
        return;
      }
      pending.shift();
      samples.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      pixelsMeasured = pixels;
      gl.deleteQuery(query);
    }
    if (samples.length >= LILTOON_GPU_CHECK.frames) {
      done = true;
      const frameMs = median(samples);
      writeLilToonGpuMeasurement(
        gpu,
        {
          status: "measured",
          method: METHOD,
          frameMs,
          frames: samples.length,
          pixels: pixelsMeasured,
          measuredAt: new Date().toISOString(),
        },
        storage,
      );
      logger.info("Measure", "lilToon frame GPU time", {
        frameMs: Math.round(frameMs * 100) / 100,
        pixels: pixelsMeasured,
        thresholdMs: LILTOON_AUTOMATIC_MAX_FRAME_MS,
      });
    }
  };

  const render = renderer.render;
  const wrapped: THREE.WebGLRenderer["render"] = function (scene, camera) {
    if (done) return render.call(renderer, scene, camera);
    collect();
    const pixels = gl.drawingBufferWidth * gl.drawingBufferHeight;
    const timed =
      !done &&
      pixels >= LILTOON_GPU_CHECK.minPixels &&
      samples.length + pending.length < LILTOON_GPU_CHECK.frames &&
      gl.getQuery(timer.TIME_ELAPSED_EXT, gl.CURRENT_QUERY) === null &&
      drawsLilToon(scene);
    if (!timed || warm < LILTOON_GPU_CHECK.warmupFrames) {
      if (timed) warm += 1;
      return render.call(renderer, scene, camera);
    }
    const query = gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
    try {
      render.call(renderer, scene, camera);
    } finally {
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      pending.push({ query, pixels });
    }
  };
  renderer.render = wrapped;
  return () => {
    done = true;
    drop();
    if (renderer.render === wrapped) renderer.render = render;
  };
}
