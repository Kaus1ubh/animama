import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LILTOON_GPU_CHECK,
  LILTOON_GPU_SAMPLES,
  LILTOON_REMEASURE_AFTER_MS,
  automaticDecisionSinceLoad,
  automaticMaterialsDecision,
  decideAutomaticMaterials,
  installLilToonGpuCheck,
  lilToonFrameBudgetMs,
  lilToonGpuCheckDue,
  readLilToonGpuMeasurement,
  recordLilToonGpuSample,
  rememberAvatarCanvasGpu,
  resetAvatarCanvasGpuForTesting,
  writeLilToonGpuMeasurement,
  type LilToonGpuMeasurement,
  type LilToonGpuSample,
} from "./lilToonGpuCheck";

/** A per-viewer storage stand-in. */
function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

/** Storage that refuses every call, as a blocked private window's can. */
function refusingStorage(): Storage {
  const refuse = () => {
    throw new DOMException("blocked", "SecurityError");
  };
  return {
    length: 0,
    clear: refuse,
    getItem: refuse,
    key: refuse,
    removeItem: refuse,
    setItem: refuse,
  };
}

const NOW = Date.parse("2026-10-27T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

/** One measurement, taken `daysAgo` before `NOW`. */
const sample = (frameMs: number, daysAgo = 0): LilToonGpuSample => ({
  frameMs,
  frames: 60,
  pixels: 1_920_000,
  measuredAt: new Date(NOW - daysAgo * DAY_MS).toISOString(),
});

/** A GPU's stored measurements, oldest first, all taken today. */
const measured = (
  ...frameMs: number[]
): Extract<LilToonGpuMeasurement, { status: "measured" }> => ({
  status: "measured",
  method: 2,
  samples: frameMs.map((value) => sample(value)),
});

const TIMER = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
const DEBUG = {
  UNMASKED_VENDOR_WEBGL: 0x9245,
  UNMASKED_RENDERER_WEBGL: 0x9246,
};

/** A callback that always returns `value`. */
const constant =
  <T>(value: T) =>
  (): T =>
    value;

/**
 * A WebGL2 context stand-in whose timer queries finish at once. `frameNs`
 * gives each timed frame's GPU time (by the order queries began), and
 * `disjoint` whether each read of the disjoint flag reports an event.
 */
function fakeGl({
  timer = true,
  frameNs = constant(9_000_000),
  disjoint = constant(false),
  width = 1600,
  height = 1200,
  gpu = "Apple M5",
}: {
  timer?: boolean;
  frameNs?: (frame: number) => number;
  disjoint?: (read: number) => boolean;
  width?: number;
  height?: number;
  gpu?: string;
} = {}) {
  let active: object | null = null;
  let begun = 0;
  let disjointReads = 0;
  const times = new Map<object, number>();
  const gl = {
    disjointReads: () => disjointReads,
    drawingBufferWidth: width,
    drawingBufferHeight: height,
    VENDOR: 0x1f00,
    RENDERER: 0x1f01,
    QUERY_RESULT: 0x8866,
    QUERY_RESULT_AVAILABLE: 0x8867,
    CURRENT_QUERY: 0x8865,
    getExtension: (name: string) =>
      name === "EXT_disjoint_timer_query_webgl2"
        ? timer
          ? TIMER
          : null
        : name === "WEBGL_debug_renderer_info"
          ? DEBUG
          : null,
    getParameter: (pname: number) =>
      pname === TIMER.GPU_DISJOINT_EXT
        ? disjoint(disjointReads++)
        : pname === DEBUG.UNMASKED_VENDOR_WEBGL
          ? "Apple"
          : pname === DEBUG.UNMASKED_RENDERER_WEBGL
            ? gpu
            : null,
    createQuery: () => ({}),
    deleteQuery: vi.fn(),
    beginQuery: (_target: number, query: object) => {
      active = query;
      times.set(query, frameNs(begun++));
    },
    endQuery: () => {
      active = null;
    },
    getQuery: () => active,
    getQueryParameter: (query: object, pname: number) =>
      pname === gl.QUERY_RESULT_AVAILABLE ? true : times.get(query),
  };
  return gl;
}

function fakeRenderer(gl: ReturnType<typeof fakeGl>) {
  const render = vi.fn();
  const renderer = {
    getContext: () => gl,
    render,
  } as unknown as THREE.WebGLRenderer;
  return { renderer, render };
}

/** A scene holding one lilToon surface, as three-liltoon builds it. */
function lilToonScene(): THREE.Scene {
  const material = Object.assign(new THREE.MeshBasicMaterial(), {
    isLilToonMaterial: true,
    pass: "forward",
  });
  const scene = new THREE.Scene();
  scene.add(new THREE.Mesh(new THREE.BufferGeometry(), material));
  return scene;
}

function renderFrames(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  frames: number,
) {
  for (let frame = 0; frame < frames; frame += 1)
    renderer.render(scene, new THREE.PerspectiveCamera());
}

const ALL_FRAMES =
  LILTOON_GPU_CHECK.warmupFrames + LILTOON_GPU_CHECK.frames + 2;

afterEach(() => {
  resetAvatarCanvasGpuForTesting();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("decideAutomaticMaterials", () => {
  it("keeps lilToon at the highest frame rate whose budget the frame fits", () => {
    // Budgets with 1.3× headroom: 12.8, 17.1, 25.6 and 32.1 ms.
    expect(lilToonFrameBudgetMs(60)).toBeCloseTo(12.82, 2);
    expect(lilToonFrameBudgetMs(24)).toBeCloseTo(32.05, 2);
    const cases: [number, number, string][] = [
      [5.5, 60, "fast"],
      [12.8, 60, "fast"],
      [12.9, 45, "capped"],
      [14.4, 45, "capped"],
      [17.0, 45, "capped"],
      [17.1, 30, "capped"],
      [25.6, 30, "capped"],
      [25.7, 24, "capped"],
      [32.0, 24, "capped"],
    ];
    for (const [frameMs, fpsCap, reason] of cases)
      expect(decideAutomaticMaterials(measured(frameMs), NOW)).toMatchObject({
        choice: "liltoon",
        reason,
        fpsCap,
        budgetFps: fpsCap,
        frameMs,
        samples: 1,
      });
  });

  it("loads Simple only after two recent measurements too slow for 24 fps", () => {
    // One measurement: lilToon at 24 fps, so the canvas can measure again.
    expect(decideAutomaticMaterials(measured(32.1), NOW)).toMatchObject({
      choice: "liltoon",
      reason: "remeasuring",
      fpsCap: 24,
      budgetFps: 24,
    });
    expect(decideAutomaticMaterials(measured(40, 33), NOW)).toEqual({
      choice: "simple",
      reason: "slow",
      fpsCap: null,
      budgetFps: 24,
      frameMs: 33,
      pixels: 1_920_000,
      samples: 2,
    });
    // Measurements over a week old are confirmed again first.
    const stale: LilToonGpuMeasurement = {
      status: "measured",
      method: 2,
      samples: [sample(40, 9), sample(36, 8)],
    };
    expect(decideAutomaticMaterials(stale, NOW)).toMatchObject({
      choice: "liltoon",
      reason: "remeasuring",
      fpsCap: 24,
    });
  });

  it("uses the fastest stored measurement, so a later faster one recovers", () => {
    // One taken while the machine was busy, then an idle one.
    expect(decideAutomaticMaterials(measured(14.4, 6), NOW)).toMatchObject({
      choice: "liltoon",
      reason: "fast",
      fpsCap: 60,
      frameMs: 6,
      samples: 2,
    });
    expect(decideAutomaticMaterials(measured(40, 20), NOW)).toMatchObject({
      choice: "liltoon",
      fpsCap: 30,
    });
  });

  it("keeps lilToon uncapped when nothing was measured or the GPU cannot be timed", () => {
    expect(decideAutomaticMaterials(null)).toEqual({
      choice: "liltoon",
      reason: "not_measured",
      fpsCap: null,
      budgetFps: null,
      frameMs: null,
      pixels: null,
      samples: 0,
    });
    expect(
      decideAutomaticMaterials({ status: "unsupported", method: 2 }),
    ).toMatchObject({ choice: "liltoon", reason: "unsupported", fpsCap: null });
  });
});

describe("lilToonGpuCheckDue", () => {
  it("measures each session until three measurements, then weekly", () => {
    expect(lilToonGpuCheckDue(null, false, NOW)).toBe(true);
    expect(lilToonGpuCheckDue(measured(9), false, NOW)).toBe(true);
    expect(lilToonGpuCheckDue(measured(9), true, NOW)).toBe(false);
    const full = measured(9, 8, 7);
    expect(full.samples).toHaveLength(LILTOON_GPU_SAMPLES);
    expect(lilToonGpuCheckDue(full, false, NOW)).toBe(false);
    expect(
      lilToonGpuCheckDue(full, true, NOW + LILTOON_REMEASURE_AFTER_MS + 1),
    ).toBe(true);
  });

  it("checks a browser that could not time the GPU again each session", () => {
    const unsupported = { status: "unsupported", method: 2 } as const;
    expect(lilToonGpuCheckDue(unsupported, false, NOW)).toBe(true);
    expect(lilToonGpuCheckDue(unsupported, true, NOW)).toBe(false);
  });
});

describe("stored measurements", () => {
  it("ignore a measurement of a canvas smaller than a chat canvas", () => {
    const storage = memoryStorage();
    writeLilToonGpuMeasurement(
      "gpu-a",
      {
        ...measured(9),
        samples: [{ ...sample(9), pixels: LILTOON_GPU_CHECK.minPixels - 1 }],
      },
      storage,
    );
    expect(readLilToonGpuMeasurement("gpu-a", storage)).toBeNull();
  });

  it("keep the newest three measurements per GPU", () => {
    const storage = memoryStorage();
    for (const frameMs of [14.4, 6, 7, 8])
      recordLilToonGpuSample("gpu-a", sample(frameMs), storage);
    recordLilToonGpuSample("gpu-b", sample(4), storage);
    expect(readLilToonGpuMeasurement("gpu-a", storage)).toEqual(
      measured(6, 7, 8),
    );
    expect(readLilToonGpuMeasurement("gpu-b", storage)).toEqual(measured(4));
    expect(readLilToonGpuMeasurement("gpu-c", storage)).toBeNull();
  });

  it("ignore other methods and bad data", () => {
    const storage = memoryStorage();
    writeLilToonGpuMeasurement("gpu-a", { ...measured(9), method: 1 }, storage);
    expect(readLilToonGpuMeasurement("gpu-a", storage)).toBeNull();
    writeLilToonGpuMeasurement(
      "gpu-a",
      { ...measured(9), samples: [{ ...sample(9), measuredAt: "never" }] },
      storage,
    );
    expect(readLilToonGpuMeasurement("gpu-a", storage)).toBeNull();
    writeLilToonGpuMeasurement(
      "gpu-a",
      { ...measured(), samples: [] },
      storage,
    );
    expect(readLilToonGpuMeasurement("gpu-a", storage)).toBeNull();
    // The previous method's single result: measured again.
    storage.setItem(
      "animama.lilToonGpuCheck",
      JSON.stringify({
        "gpu-b": { ...sample(9), status: "measured", method: 1 },
      }),
    );
    expect(readLilToonGpuMeasurement("gpu-b", storage)).toBeNull();
    storage.setItem("animama.lilToonGpuCheck", "not json");
    expect(readLilToonGpuMeasurement("gpu-b", storage)).toBeNull();
  });

  it("treat refusing or missing storage as not measured", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      writeLilToonGpuMeasurement("gpu-a", measured(9), refusingStorage()),
    ).not.toThrow();
    expect(readLilToonGpuMeasurement("gpu-a", refusingStorage())).toBeNull();
    expect(readLilToonGpuMeasurement("gpu-a", null)).toBeNull();
  });
});

describe("automaticMaterialsDecision", () => {
  it("reads the measurement of the GPU the latest Avatar canvas uses", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    expect(automaticMaterialsDecision().reason).toBe("not_measured");

    const slowGpu = fakeGl({ gpu: "Slow GPU" });
    writeLilToonGpuMeasurement("Apple | Slow GPU", measured(20), storage);
    rememberAvatarCanvasGpu(fakeRenderer(slowGpu).renderer);
    expect(automaticMaterialsDecision()).toMatchObject({
      choice: "liltoon",
      reason: "capped",
      fpsCap: 30,
      frameMs: 20,
    });

    // A different GPU has its own (here missing) measurement.
    rememberAvatarCanvasGpu(fakeRenderer(fakeGl({ gpu: "Other" })).renderer);
    expect(automaticMaterialsDecision().reason).toBe("not_measured");
  });

  it("reports a change since a load only when the materials or cap change", () => {
    const storage = memoryStorage();
    vi.stubGlobal("localStorage", storage);
    resetAvatarCanvasGpuForTesting("gpu-a");
    const atLoad = automaticMaterialsDecision();
    expect(automaticDecisionSinceLoad(atLoad)).toBeNull();
    // A browser found unable to time the GPU: still lilToon, uncapped.
    writeLilToonGpuMeasurement(
      "gpu-a",
      { status: "unsupported", method: 2 },
      storage,
    );
    expect(automaticDecisionSinceLoad(atLoad)).toBeNull();
    writeLilToonGpuMeasurement("gpu-a", measured(14.4), storage);
    expect(automaticDecisionSinceLoad(atLoad)).toMatchObject({ fpsCap: 45 });
    expect(automaticDecisionSinceLoad(null)).toBeNull();
  });
});

describe("installLilToonGpuCheck", () => {
  it("times lilToon frames after the warm-up and stores the median", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const storage = memoryStorage();
    const gl = fakeGl({ frameNs: () => 9_600_000 });
    const { renderer, render } = fakeRenderer(gl);
    const release = installLilToonGpuCheck(renderer, storage);

    renderFrames(renderer, lilToonScene(), ALL_FRAMES);

    expect(render).toHaveBeenCalledTimes(ALL_FRAMES);
    expect(
      readLilToonGpuMeasurement("Apple | Apple M5", storage),
    ).toMatchObject({
      status: "measured",
      samples: [
        {
          frameMs: 9.6,
          frames: LILTOON_GPU_CHECK.frames,
          pixels: 1600 * 1200,
        },
      ],
    });
    release();
    expect(renderer.render).toBe(render);
  });

  it("measures once per session until it has three measurements", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const storage = memoryStorage();
    const frameTimes = () =>
      (
        readLilToonGpuMeasurement("Apple | Apple M5", storage) as {
          samples: LilToonGpuSample[];
        }
      ).samples.map((entry) => entry.frameMs);
    writeLilToonGpuMeasurement("Apple | Apple M5", measured(14.4), storage);

    const first = fakeRenderer(fakeGl({ frameNs: constant(6_000_000) }));
    installLilToonGpuCheck(first.renderer, storage);
    renderFrames(first.renderer, lilToonScene(), ALL_FRAMES * 2);
    expect(frameTimes()).toEqual([14.4, 6]);

    // A remounted chat canvas in the same session measures nothing.
    const again = fakeRenderer(fakeGl({ frameNs: constant(7_000_000) }));
    installLilToonGpuCheck(again.renderer, storage);
    renderFrames(again.renderer, lilToonScene(), ALL_FRAMES);
    expect(frameTimes()).toEqual([14.4, 6]);

    // The next session measures once more; with three it stops.
    resetAvatarCanvasGpuForTesting();
    const next = fakeRenderer(fakeGl({ frameNs: constant(7_000_000) }));
    installLilToonGpuCheck(next.renderer, storage);
    renderFrames(next.renderer, lilToonScene(), ALL_FRAMES);
    expect(frameTimes()).toEqual([14.4, 6, 7]);
    resetAvatarCanvasGpuForTesting();
    const settled = fakeRenderer(fakeGl({ frameNs: constant(5_000_000) }));
    installLilToonGpuCheck(settled.renderer, storage);
    renderFrames(settled.renderer, lilToonScene(), ALL_FRAMES);
    expect(frameTimes()).toEqual([14.4, 6, 7]);
  });

  it("measures again once the newest measurement is a week old", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const storage = memoryStorage();
    writeLilToonGpuMeasurement("Apple | Apple M5", measured(9, 9, 9), storage);
    const { renderer } = fakeRenderer(fakeGl({ frameNs: constant(5e6) }));
    installLilToonGpuCheck(renderer, storage);
    renderFrames(renderer, lilToonScene(), ALL_FRAMES);
    expect(readLilToonGpuMeasurement("Apple | Apple M5", storage)).toEqual(
      measured(9, 9, 9),
    );

    // The canvas stays mounted; it looks again at its next hourly check.
    vi.setSystemTime(
      NOW + LILTOON_REMEASURE_AFTER_MS + LILTOON_GPU_CHECK.recheckMs,
    );
    renderFrames(renderer, lilToonScene(), ALL_FRAMES);
    const stored = readLilToonGpuMeasurement("Apple | Apple M5", storage);
    expect(
      stored?.status === "measured" &&
        stored.samples.map((entry) => entry.frameMs),
    ).toEqual([9, 9, 5]);
  });

  it("stores unsupported where the browser cannot time the GPU", () => {
    const storage = memoryStorage();
    const { renderer, render } = fakeRenderer(fakeGl({ timer: false }));
    installLilToonGpuCheck(renderer, storage);
    expect(renderer.render).toBe(render);
    expect(readLilToonGpuMeasurement("Apple | Apple M5", storage)).toEqual({
      status: "unsupported",
      method: 2,
    });
  });

  it("keeps stored measurements in a session that cannot time the GPU", () => {
    const storage = memoryStorage();
    writeLilToonGpuMeasurement("Apple | Apple M5", measured(20), storage);
    installLilToonGpuCheck(
      fakeRenderer(fakeGl({ timer: false })).renderer,
      storage,
    );
    expect(readLilToonGpuMeasurement("Apple | Apple M5", storage)).toEqual(
      measured(20),
    );
  });

  it("times nothing without lilToon, on small canvases or inside another timer", () => {
    const storage = memoryStorage();
    const plain = fakeRenderer(fakeGl()).renderer;
    installLilToonGpuCheck(plain, storage);
    renderFrames(plain, new THREE.Scene(), ALL_FRAMES);

    const small = fakeRenderer(fakeGl({ width: 400, height: 300 })).renderer;
    installLilToonGpuCheck(small, storage);
    renderFrames(small, lilToonScene(), ALL_FRAMES);

    const gl = fakeGl();
    const benchmarked = fakeRenderer(gl).renderer;
    installLilToonGpuCheck(benchmarked, storage);
    gl.beginQuery(TIMER.TIME_ELAPSED_EXT, {});
    renderFrames(benchmarked, lilToonScene(), ALL_FRAMES);

    expect(readLilToonGpuMeasurement("Apple | Apple M5", storage)).toBeNull();
  });

  it("gives up until its next check when the GPU keeps reporting disjoint timings", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    const storage = memoryStorage();
    const gl = fakeGl({ disjoint: () => true });
    const { renderer } = fakeRenderer(gl);
    installLilToonGpuCheck(renderer, storage);
    renderFrames(renderer, lilToonScene(), ALL_FRAMES * 2);
    expect(readLilToonGpuMeasurement("Apple | Apple M5", storage)).toBeNull();
    // It stops reading the flag once it has given up.
    expect(gl.disjointReads()).toBe(LILTOON_GPU_CHECK.maxDisjoint + 1);
    vi.setSystemTime(NOW + LILTOON_GPU_CHECK.recheckMs);
    renderFrames(renderer, lilToonScene(), ALL_FRAMES * 2);
    expect(gl.disjointReads()).toBe(2 * (LILTOON_GPU_CHECK.maxDisjoint + 1));
  });

  it("keeps timing after a few disjoint events and stores the median", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const storage = memoryStorage();
    // Two slow outliers in every ten frames: the mean would be 12.4 ms.
    const gl = fakeGl({
      frameNs: (frame) => (frame % 10 < 2 ? 30_000_000 : 8_000_000),
      disjoint: (read) => read < 3,
    });
    const { renderer } = fakeRenderer(gl);
    installLilToonGpuCheck(renderer, storage);
    renderFrames(renderer, lilToonScene(), ALL_FRAMES + 10);
    expect(
      readLilToonGpuMeasurement("Apple | Apple M5", storage),
    ).toMatchObject({ status: "measured", samples: [{ frameMs: 8 }] });
  });

  it("reads the disjoint flag only for frames it timed", () => {
    const gl = fakeGl();
    const { renderer } = fakeRenderer(gl);
    installLilToonGpuCheck(renderer, memoryStorage());
    // Warm-up frames and frames without lilToon start no timer query.
    renderFrames(renderer, new THREE.Scene(), 20);
    renderFrames(renderer, lilToonScene(), LILTOON_GPU_CHECK.warmupFrames);
    expect(gl.disjointReads()).toBe(0);
  });
});
