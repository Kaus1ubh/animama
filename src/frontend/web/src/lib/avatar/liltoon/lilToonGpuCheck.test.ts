import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  LILTOON_AUTOMATIC_MAX_FRAME_MS,
  LILTOON_GPU_CHECK,
  automaticMaterialsDecision,
  decideAutomaticMaterials,
  installLilToonGpuCheck,
  readLilToonGpuMeasurement,
  rememberAvatarCanvasGpu,
  resetAvatarCanvasGpuForTesting,
  writeLilToonGpuMeasurement,
  type LilToonGpuMeasurement,
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

const measured = (frameMs: number): LilToonGpuMeasurement => ({
  status: "measured",
  method: 1,
  frameMs,
  frames: 60,
  pixels: 1_920_000,
  measuredAt: "2026-10-27T00:00:00.000Z",
});

const TIMER = { TIME_ELAPSED_EXT: 0x88bf, GPU_DISJOINT_EXT: 0x8fbb };
const DEBUG = {
  UNMASKED_VENDOR_WEBGL: 0x9245,
  UNMASKED_RENDERER_WEBGL: 0x9246,
};

/**
 * A WebGL2 context stand-in whose timer queries finish at once with
 * `frameNs` of GPU time.
 */
function fakeGl({
  timer = true,
  frameNs = 9_000_000,
  disjoint = false,
  width = 1600,
  height = 1200,
  gpu = "Apple M5",
} = {}) {
  let active: object | null = null;
  const gl = {
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
        ? disjoint
        : pname === DEBUG.UNMASKED_VENDOR_WEBGL
          ? "Apple"
          : pname === DEBUG.UNMASKED_RENDERER_WEBGL
            ? gpu
            : null,
    createQuery: () => ({}),
    deleteQuery: vi.fn(),
    beginQuery: (_target: number, query: object) => {
      active = query;
    },
    endQuery: () => {
      active = null;
    },
    getQuery: () => active,
    getQueryParameter: (_query: object, pname: number) =>
      pname === gl.QUERY_RESULT_AVAILABLE ? true : frameNs,
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
});

describe("decideAutomaticMaterials", () => {
  it("chooses Simple above the threshold and lilToon otherwise", () => {
    expect(decideAutomaticMaterials(measured(9.6))).toEqual({
      choice: "simple",
      reason: "slow",
      frameMs: 9.6,
      pixels: 1_920_000,
      thresholdMs: LILTOON_AUTOMATIC_MAX_FRAME_MS,
    });
    expect(decideAutomaticMaterials(measured(5.2))).toMatchObject({
      choice: "liltoon",
      reason: "fast",
    });
    expect(decideAutomaticMaterials(measured(5.2), 4)).toMatchObject({
      choice: "simple",
      thresholdMs: 4,
    });
  });

  it("keeps lilToon when nothing was measured or the GPU cannot be timed", () => {
    expect(decideAutomaticMaterials(null)).toMatchObject({
      choice: "liltoon",
      reason: "not_measured",
      frameMs: null,
    });
    expect(
      decideAutomaticMaterials({ status: "unsupported", method: 1 }),
    ).toMatchObject({ choice: "liltoon", reason: "unsupported" });
  });
});

describe("stored measurements", () => {
  it("keep one result per GPU and ignore other methods and bad data", () => {
    const storage = memoryStorage();
    writeLilToonGpuMeasurement("gpu-a", measured(9), storage);
    writeLilToonGpuMeasurement("gpu-b", measured(4), storage);
    expect(readLilToonGpuMeasurement("gpu-a", storage)).toEqual(measured(9));
    expect(readLilToonGpuMeasurement("gpu-b", storage)).toEqual(measured(4));
    expect(readLilToonGpuMeasurement("gpu-c", storage)).toBeNull();

    writeLilToonGpuMeasurement("gpu-a", { ...measured(9), method: 0 }, storage);
    expect(readLilToonGpuMeasurement("gpu-a", storage)).toBeNull();
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
    writeLilToonGpuMeasurement("Apple | Slow GPU", measured(12), storage);
    rememberAvatarCanvasGpu(fakeRenderer(slowGpu).renderer);
    expect(automaticMaterialsDecision()).toMatchObject({
      choice: "simple",
      reason: "slow",
      frameMs: 12,
    });

    // A different GPU has its own (here missing) measurement.
    rememberAvatarCanvasGpu(fakeRenderer(fakeGl({ gpu: "Other" })).renderer);
    expect(automaticMaterialsDecision().reason).toBe("not_measured");
  });
});

describe("installLilToonGpuCheck", () => {
  it("times lilToon frames after the warm-up and stores the median", () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    const storage = memoryStorage();
    const gl = fakeGl({ frameNs: 9_600_000 });
    const { renderer, render } = fakeRenderer(gl);
    const release = installLilToonGpuCheck(renderer, storage);

    renderFrames(renderer, lilToonScene(), ALL_FRAMES);

    expect(render).toHaveBeenCalledTimes(ALL_FRAMES);
    expect(
      readLilToonGpuMeasurement("Apple | Apple M5", storage),
    ).toMatchObject({
      status: "measured",
      frameMs: 9.6,
      frames: LILTOON_GPU_CHECK.frames,
      pixels: 1600 * 1200,
    });
    release();
    expect(renderer.render).toBe(render);
  });

  it("reuses a stored measurement instead of timing again", () => {
    const storage = memoryStorage();
    writeLilToonGpuMeasurement("Apple | Apple M5", measured(5), storage);
    const { renderer, render } = fakeRenderer(fakeGl());
    installLilToonGpuCheck(renderer, storage);
    expect(renderer.render).toBe(render);
    expect(readLilToonGpuMeasurement("Apple | Apple M5", storage)).toEqual(
      measured(5),
    );
  });

  it("stores unsupported where the browser cannot time the GPU", () => {
    const storage = memoryStorage();
    const { renderer, render } = fakeRenderer(fakeGl({ timer: false }));
    installLilToonGpuCheck(renderer, storage);
    expect(renderer.render).toBe(render);
    expect(readLilToonGpuMeasurement("Apple | Apple M5", storage)).toEqual({
      status: "unsupported",
      method: 1,
    });
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

  it("gives up for the session when the GPU keeps reporting disjoint timings", () => {
    const storage = memoryStorage();
    const { renderer } = fakeRenderer(fakeGl({ disjoint: true }));
    installLilToonGpuCheck(renderer, storage);
    renderFrames(renderer, lilToonScene(), ALL_FRAMES * 2);
    expect(readLilToonGpuMeasurement("Apple | Apple M5", storage)).toBeNull();
  });
});
