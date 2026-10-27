// The app's full stylesheet, so DOM Scene layers cost what they cost in chat.
import "@/index.css";
import * as THREE from "three";

import { Avatar } from "@/lib/avatar";
import type { AvatarMaterialMode } from "@/lib/avatar/avatarSettings";
import type { LilToonMaterialState } from "@/lib/avatar/liltoon/lilToon";
import {
  PreviewMediaProvider,
  type PreviewMedia,
} from "@/lib/avatar/motion-authoring/preview/previewMedia";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import { applyAvatarVFXEffectById } from "@/lib/avatar/vfx/runtime";
import { EMPTY_RUNTIME_MEDIA_PROVIDER } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";
import { buildSceneCameraPreset } from "@/ui/main/canvas/sceneCameraPresets";
import { nextSceneFrame } from "@/ui/main/canvas/sceneFramePacing";

import { ReviewStage } from "../effect-render/reviewStage";
import { missingSceneMessage } from "../effect-render/sceneBands";
import {
  createStage,
  effectEntry,
  type EffectSource,
} from "../effect-render/stage";
import {
  applyFeatureChanges,
  materialsByBinding,
  planBreakdown,
  type BreakdownKind,
  type Structure,
} from "./breakdown";

/** A clip as the Avatar plays it. */
type AnimaPoseClip = Parameters<Avatar["playAnimaPoseClip"]>[0];

/**
 * Avatar Effect frame-cost benchmark (driven by `scripts/effect-bench.mjs`).
 *
 * One production `Avatar` per request, rendered like the chat canvas (DPR 2
 * unless the request asks for another, antialiasing, the chat's tone mapping
 * and lights, sRGB, Portrait framing) while a looping Gesture plays through
 * `Avatar.update`. Each animation frame times `avatar.update` plus
 * `renderer.render` on the CPU and, where `EXT_disjoint_timer_query_webgl2`
 * exists, the render's GPU time. The baseline runs with no effects; the heavy
 * run adds the requested effects and two attachments drawn here in code (a
 * pulsing chest heart and a scrolling silhouette pattern). The two alternate
 * over several rounds.
 *
 * A breakdown request times the plain Avatar against scenarios that each
 * change one thing (`breakdown.ts`): a material hidden or alone, a lilToon
 * feature off, a layer hidden, or materials drawn with their fallbacks.
 */

type StageRequest = {
  avatar: { id: string; url: string };
  clip: unknown;
  width: number;
  height: number;
  pixelRatio: number;
  /** The Avatar's material setting; Automatic when absent. */
  materialMode?: AvatarMaterialMode;
  /** Warm-up frames before each measured pass. */
  warmupFrames: number;
  /** Measured frames per scenario, split across the rounds. */
  frames: number;
  /** Alternating passes per scenario. */
  rounds: number;
  /**
   * Render at most this many frames per second, paced like the app's scenes
   * (`nextSceneFrame`), for the cost of a frame-rate cap; every animation
   * frame when absent.
   */
  fps?: number | null;
  /** Feature scenarios (`breakdown.ts` ids) applied to every measurement. */
  apply?: string[];
};

type BenchRequest = StageRequest & {
  /** Face effects resolved by Node (Included or Local sources). */
  effects: EffectSource[];
};

type BreakdownRequest = StageRequest & { breakdown: BreakdownKind[] };

type Stats = { mean: number; p95: number; samples: number };

type ScenarioResult = {
  cpu: Stats;
  gpu: Stats | null;
  /** Measured frames whose GPU time a disjoint event voided. */
  disjointFrames: number;
  drawCalls: number;
  triangles: number;
  /** Rendered frames per second over the measured frames. */
  frameRate: number;
  /**
   * Mean GPU time of each measured pass, in order, to show drift between
   * rounds (another job on the GPU, say); empty without a GPU timer.
   */
  passes: number[];
};

/** The WebGL renderer and drawing buffer a result was measured on. */
type RendererFacts = {
  renderer: string;
  vendor: string;
  gpuTimer: boolean;
  pixelRatio: number;
  drawingBuffer: { width: number; height: number };
  /** Feature scenarios applied to every measurement. */
  applied: string[];
};

type BenchResult = RendererFacts & {
  avatar: string;
  materialMode: AvatarMaterialMode;
  none: ScenarioResult;
  heavy: ScenarioResult;
  activeEffectIds: string[];
  warnings: string[];
};

type BreakdownResult = RendererFacts & {
  avatar: string;
  materialMode: AvatarMaterialMode;
  /** Whether the file's lilToon materials render (`Avatar.lilToonMaterials`). */
  lilToonMaterials: LilToonMaterialState;
  structure: Structure;
  /** Canvas pixels the Avatar covers in the probe frame. */
  avatarPixels: number;
  baseline: ScenarioResult;
  scenarios: (ScenarioResult & {
    id: string;
    group: string;
    label: string;
    /**
     * Share (0–1) of the Avatar's pixels that look different in one probe
     * frame of the same pose: how visible the change is.
     */
    changedPixels: number;
  })[];
  notes: string[];
};

/** A channel difference above this (of 255) counts as a changed pixel. */
const PIXEL_THRESHOLD = 8;

/**
 * Compare two captures of the same pose: the Avatar's pixels (drawn in
 * either) and the share of them that changed.
 */
function comparePixels(
  reference: Uint8Array,
  candidate: Uint8Array,
): { avatarPixels: number; changed: number } {
  let avatarPixels = 0;
  let changed = 0;
  for (let index = 0; index < reference.length; index += 4) {
    if (reference[index + 3] === 0 && candidate[index + 3] === 0) continue;
    avatarPixels++;
    for (let channel = 0; channel < 4; channel++) {
      if (
        Math.abs(reference[index + channel]! - candidate[index + channel]!) >
        PIXEL_THRESHOLD
      ) {
        changed++;
        break;
      }
    }
  }
  return { avatarPixels, changed: avatarPixels ? changed / avatarPixels : 0 };
}

const FRAME_SEC = 1 / 60;

type TimerExtension = { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number };

function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const p95 =
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)]!;
  return { mean, p95, samples: values.length };
}

const nextFrame = () =>
  new Promise<number>((resolve) => requestAnimationFrame(resolve));

/** Test art drawn in code, as a PNG data URL. */
function drawArt(
  width: number,
  height: number,
  draw: (context: CanvasRenderingContext2D) => void,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  draw(canvas.getContext("2d")!);
  return canvas.toDataURL("image/png");
}

/** The body and silhouette effects of the heavy combination. */
function builtInAttachments(): EffectSource[] {
  const heart = drawArt(128, 128, (context) => {
    context.fillStyle = "#ff2d6f";
    context.beginPath();
    context.moveTo(64, 112);
    context.bezierCurveTo(20, 80, 4, 52, 18, 30);
    context.bezierCurveTo(32, 8, 58, 14, 64, 36);
    context.bezierCurveTo(70, 14, 96, 8, 110, 30);
    context.bezierCurveTo(124, 52, 108, 80, 64, 112);
    context.fill();
  });
  const stripes = drawArt(64, 64, (context) => {
    context.fillStyle = "rgba(27, 42, 138, 0.55)";
    context.fillRect(0, 0, 64, 64);
    context.fillStyle = "rgba(143, 211, 255, 0.85)";
    for (let x = -64; x < 64; x += 32) {
      context.beginPath();
      context.moveTo(x, 64);
      context.lineTo(x + 64, 0);
      context.lineTo(x + 80, 0);
      context.lineTo(x + 16, 64);
      context.fill();
    }
  });
  const source = (
    contentId: string,
    imageUrl: string,
    definition: Record<string, unknown>,
  ): EffectSource => ({
    stem: contentId,
    contentId,
    name: contentId,
    description: contentId,
    imageUrl,
    otherImageUrl: null,
    definition: {
      schema: "animama/avatar-effect/2",
      art: { image: "art.png" },
      ...definition,
    },
  });
  return [
    source("bench_body_heart", heart, {
      region: "body",
      attachment: {
        kind: "body",
        bone: "chest",
        offset: { z: 0.16 },
        size: 0.12,
      },
      motion: { pulse: { scaleMin: 0.85, scaleMax: 1.15 } },
    }),
    source("bench_silhouette_stripes", stripes, {
      region: "silhouette",
      attachment: {
        kind: "silhouette",
        patternScale: 0.35,
        scroll: { x: 0.25, y: 0 },
      },
      appearance: { opacity: 0.7 },
    }),
  ];
}

type Samples = {
  cpu: number[];
  gpu: number[];
  /** Milliseconds between consecutive measured frames. */
  interval: number[];
  /** Mean GPU time of each pass. */
  passes: number[];
  disjoint: number;
};

const newSamples = (): Samples => ({
  cpu: [],
  gpu: [],
  interval: [],
  passes: [],
  disjoint: 0,
});

/** A chat-like stage with the request's Avatar loaded and framed. */
type BenchStage = {
  renderer: THREE.WebGLRenderer;
  avatar: Avatar;
  facts: RendererFacts;
  /**
   * Time `frames` frames after the request's warm-up frames into `samples`,
   * then collect the remaining GPU queries. Returns `renderer.info` of the
   * last measured frame.
   */
  measure: (
    frames: number,
    samples: Samples,
  ) => Promise<{ drawCalls: number; triangles: number }>;
  /**
   * Render the current pose once, without advancing time, and return the
   * canvas pixels (RGBA, as drawn).
   */
  capture: () => Uint8Array;
  result: (
    samples: Samples,
    counts: { drawCalls: number; triangles: number },
  ) => ScenarioResult;
};

/** The mean frame rate of measured intervals. */
function frameRateOf(intervals: number[]): number {
  return intervals.length ? 1000 / stats(intervals).mean : 0;
}

/**
 * Run `body` on a chat-like stage with `request.avatar` loaded, framed in
 * Portrait and playing `request.clip`; the stage and Avatar are disposed
 * afterwards.
 */
async function withBenchStage<T>(
  request: StageRequest,
  body: (stage: BenchStage) => Promise<T>,
): Promise<T> {
  const { renderer, scene, camera, disposeRenderer } = createStage(
    request.width,
    request.height,
    {
      pixelRatio: request.pixelRatio,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    },
  );
  document.body.appendChild(renderer.domElement);
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const timer = gl.getExtension(
    "EXT_disjoint_timer_query_webgl2",
  ) as TimerExtension | null;
  const avatar = new Avatar(camera, renderer.domElement, {
    motionCatalog: BUILT_IN_AVATAR_MOTION_CATALOG,
    mediaCatalog: EMPTY_RUNTIME_MEDIA_PROVIDER,
  });

  const measure: BenchStage["measure"] = async (frames, samples) => {
    const pending: WebGLQuery[] = [];
    let counts = { drawCalls: 0, triangles: 0 };
    const collect = () => {
      // Reading the flag also clears it. A disjoint event (for example a GPU
      // clock change) voids every query in flight, not just the next one.
      if (gl.getParameter(timer!.GPU_DISJOINT_EXT)) {
        samples.disjoint += pending.length;
        for (const query of pending) gl.deleteQuery(query);
        pending.length = 0;
        return;
      }
      while (pending.length) {
        const query = pending[0]!;
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
        pending.shift();
        samples.gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
    };
    if (timer) gl.getParameter(timer.GPU_DISJOINT_EXT);
    const firstGpuSample = samples.gpu.length;
    let scheduled = Number.NEGATIVE_INFINITY;
    let previous: number | null = null;
    for (let index = 0; index < request.warmupFrames + frames; index++) {
      let now = await nextFrame();
      if (request.fps) {
        // Skip display frames until the app's pacing would render one.
        let next = nextSceneFrame(now, scheduled, request.fps);
        while (next === null) {
          now = await nextFrame();
          next = nextSceneFrame(now, scheduled, request.fps);
        }
        scheduled = next;
      }
      const measured = index >= request.warmupFrames;
      if (measured && previous !== null) samples.interval.push(now - previous);
      previous = now;
      const query = measured && timer ? gl.createQuery() : null;
      const start = performance.now();
      avatar.update(request.fps ? 1 / request.fps : FRAME_SEC);
      if (query) gl.beginQuery(timer!.TIME_ELAPSED_EXT, query);
      renderer.render(scene, camera);
      if (query) gl.endQuery(timer!.TIME_ELAPSED_EXT);
      const end = performance.now();
      if (measured) {
        samples.cpu.push(end - start);
        if (query) pending.push(query);
        counts = {
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
        };
      }
      if (timer) collect();
    }
    for (let wait = 0; timer && pending.length && wait < 120; wait++) {
      await nextFrame();
      collect();
    }
    const pass = samples.gpu.slice(firstGpuSample);
    if (pass.length) samples.passes.push(stats(pass).mean);
    return counts;
  };

  const capture = () => {
    avatar.update(0);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(
      gl.drawingBufferWidth * gl.drawingBufferHeight * 4,
    );
    // Without preserveDrawingBuffer the frame is readable until this task ends.
    gl.readPixels(
      0,
      0,
      gl.drawingBufferWidth,
      gl.drawingBufferHeight,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixels,
    );
    return pixels;
  };

  const result: BenchStage["result"] = (samples, counts) => ({
    cpu: stats(samples.cpu),
    gpu: timer && samples.gpu.length ? stats(samples.gpu) : null,
    disjointFrames: samples.disjoint,
    ...counts,
    frameRate: frameRateOf(samples.interval),
    passes: samples.passes,
  });

  let undoChanges: () => void = () => undefined;
  try {
    await avatar.load({
      filePath: request.avatar.url,
      materialMode: request.materialMode,
    });
    avatar.setAutomaticAnimationPlaybackEnabled(false);
    avatar.prepareFirstFrame();
    scene.add(avatar.scene!);
    const { position, orbitTarget, fov } = buildSceneCameraPreset("portrait", {
      avatar,
    }).settings;
    camera.fov = fov;
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(orbitTarget.x, orbitTarget.y, orbitTarget.z);
    camera.updateProjectionMatrix();
    if (request.clip) avatar.playAnimaPoseClip(request.clip as AnimaPoseClip);
    const changes = applyFeatureChanges(avatar, renderer, request.apply ?? []);
    undoChanges = changes.undo;
    if (changes.unknown.length)
      throw new Error(
        `--apply: ${request.avatar.id} has no feature scenario ${changes.unknown.join(", ")}`,
      );
    const facts: RendererFacts = {
      renderer: debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER)),
      vendor: debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
        : String(gl.getParameter(gl.VENDOR)),
      gpuTimer: Boolean(timer),
      pixelRatio: request.pixelRatio,
      drawingBuffer: {
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
      },
      applied: request.apply ?? [],
    };
    return await body({ renderer, avatar, facts, measure, capture, result });
  } finally {
    undoChanges();
    if (avatar.scene) scene.remove(avatar.scene);
    avatar.dispose();
    disposeRenderer();
    renderer.domElement.remove();
  }
}

async function runBench(request: BenchRequest): Promise<BenchResult> {
  return withBenchStage(request, async ({ avatar, facts, measure, result }) => {
    const applyHeavy = async () => {
      for (const effect of [...request.effects, ...builtInAttachments()]) {
        const entry = effectEntry(effect);
        await applyAvatarVFXEffectById({
          avatar,
          effectId: entry.id,
          effectEntry: entry,
        });
      }
    };

    // Alternate the scenarios (none, heavy, none, heavy, …) so clock and
    // thermal drift do not favour either one.
    const noneSamples = newSamples();
    const heavySamples = newSamples();
    const framesPerPass = Math.ceil(request.frames / request.rounds);
    let noneCounts = { drawCalls: 0, triangles: 0 };
    let heavyCounts = { drawCalls: 0, triangles: 0 };
    let snapshot = avatar.vfxController?.getSnapshot();
    for (let round = 0; round < request.rounds; round++) {
      avatar.vfxController?.clearAllEffects();
      noneCounts = await measure(framesPerPass, noneSamples);
      await applyHeavy();
      snapshot = avatar.vfxController?.getSnapshot();
      heavyCounts = await measure(framesPerPass, heavySamples);
    }
    return {
      avatar: request.avatar.id,
      ...facts,
      materialMode: request.materialMode ?? "automatic",
      none: result(noneSamples, noneCounts),
      heavy: result(heavySamples, heavyCounts),
      activeEffectIds: [
        ...(snapshot?.activeEffects ?? []),
        ...(snapshot?.attachmentEffects ?? []),
      ].map((effect) => effect.effectId),
      warnings: snapshot?.warnings ?? [],
    };
  });
}

/**
 * Break the plain Avatar's frame cost down: the baseline and each scenario of
 * `request.breakdown` take turns, in reversed order on odd rounds, so clock
 * and thermal drift do not favour the ones measured first. Each pass warms up
 * first, which also covers compiling a changed lilToon shader.
 */
async function runBreakdown(
  request: BreakdownRequest,
): Promise<BreakdownResult> {
  // The `mixed` scenarios borrow the fallback materials of a Simple load.
  const fallback = request.breakdown.includes("mixed")
    ? new Avatar(new THREE.PerspectiveCamera(), null, {
        motionCatalog: BUILT_IN_AVATAR_MOTION_CATALOG,
        mediaCatalog: EMPTY_RUNTIME_MEDIA_PROVIDER,
      })
    : null;
  try {
    if (fallback)
      await fallback.load({
        filePath: request.avatar.url,
        materialMode: "simple",
      });
    return await withBenchStage(
      request,
      async ({ renderer, avatar, facts, measure, capture, result }) => {
        const { structure, scenarios, notes } = planBreakdown(
          avatar,
          renderer,
          request.breakdown,
          fallback ? materialsByBinding(fallback) : new Map(),
        );
        // One probe frame per scenario, all of the same pose, before timing.
        const reference = capture();
        const avatarPixels = comparePixels(reference, reference).avatarPixels;
        const changedPixels = scenarios.map((scenario) => {
          const undo = scenario.apply();
          try {
            return comparePixels(reference, capture()).changed;
          } finally {
            undo();
          }
        });
        const baseline = {
          id: "baseline",
          apply: () => () => undefined,
        };
        const runs = [baseline, ...scenarios].map((scenario) => ({
          scenario,
          samples: newSamples(),
          counts: { drawCalls: 0, triangles: 0 },
        }));
        const framesPerPass = Math.ceil(request.frames / request.rounds);
        for (let round = 0; round < request.rounds; round++) {
          const order = round % 2 ? [...runs].reverse() : runs;
          for (const run of order) {
            const undo = run.scenario.apply();
            try {
              run.counts = await measure(framesPerPass, run.samples);
            } finally {
              undo();
            }
          }
        }
        const [plain, ...rest] = runs;
        return {
          avatar: request.avatar.id,
          ...facts,
          materialMode: request.materialMode ?? "automatic",
          lilToonMaterials: avatar.lilToonMaterials,
          structure,
          avatarPixels,
          baseline: result(plain!.samples, plain!.counts),
          scenarios: rest.map((run, index) => ({
            id: scenarios[index]!.id,
            group: scenarios[index]!.group,
            label: scenarios[index]!.label,
            ...result(run.samples, run.counts),
            changedPixels: changedPixels[index]!,
          })),
          notes,
        };
      },
    );
  } finally {
    fallback?.dispose();
  }
}

type ReactionBenchRequest = {
  avatar: { id: string; url: string };
  clip: unknown;
  /** The effects the Reaction's events play, by dependency alias. */
  clipMedia: Omit<PreviewMedia, "notices">;
  width: number;
  height: number;
  pixelRatio: number;
  warmupFrames: number;
  frames: number;
  rounds: number;
  /** Frames between replays, so the Reaction's effects keep playing. */
  replayFrames: number;
};

type ReactionScenario = ScenarioResult & {
  /** Whole-frame interval between animation frames (uncapped frame rate). */
  interval: Stats;
};

type ReactionBenchResult = {
  avatar: string;
  renderer: string;
  gpuTimer: boolean;
  drawingBuffer: { width: number; height: number };
  plain: ReactionScenario;
  effects: ReactionScenario;
  activeEffectIds: string[];
  warnings: string[];
};

const EFFECT_EVENT_KINDS = new Set(["avatar_vfx", "particle_vfx", "scene_vfx"]);

/**
 * Frame cost of one Reaction's Avatar, Particle and Scene Effects. The chat
 * canvas sits between the Scene bands, as in chat, at DPR 2. The Reaction
 * replays every `replayFrames` frames with its effect events (effects) and
 * without them (plain), alternating over `rounds`. Each frame records the CPU
 * time of `avatar.update` plus render, the render's GPU time, and the
 * interval since the previous animation frame. With the frame rate uncapped,
 * that interval includes the browser's style, layout and compositing of the
 * DOM Scene layers, which neither of the other two measures.
 */
async function runReactionBench(
  request: ReactionBenchRequest,
): Promise<ReactionBenchResult> {
  const stage = new ReviewStage(request.width, request.height);
  const { renderer, scene, camera, disposeRenderer } = createStage(
    request.width,
    request.height,
    {
      pixelRatio: request.pixelRatio,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    },
  );
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const timer = gl.getExtension(
    "EXT_disjoint_timer_query_webgl2",
  ) as TimerExtension | null;
  const media = new PreviewMediaProvider({
    ...request.clipMedia,
    notices: [],
  });
  const avatar = new Avatar(camera, renderer.domElement, {
    motionCatalog: BUILT_IN_AVATAR_MOTION_CATALOG,
    mediaCatalog: media,
  });
  const problems = new Set<string>();
  // Scene animations run live here, so the start time is not used.
  avatar.setPoseClipExternalEventSink(
    stage.bands.clipSceneSink(
      (kind, alias) => media.resolveSceneVFX(kind, alias),
      () => 0,
      (alias, kind) => problems.add(missingSceneMessage(alias, kind)),
    ),
  );
  const full = request.clip as AnimaPoseClip;
  const plain = {
    ...full,
    events: (full.events ?? []).filter(
      (event) => !EFFECT_EVENT_KINDS.has(event.kind),
    ),
  } as AnimaPoseClip;

  type Samples = {
    cpu: number[];
    gpu: number[];
    interval: number[];
    disjoint: number;
  };
  const samplesOf = (): Samples => ({
    cpu: [],
    gpu: [],
    interval: [],
    disjoint: 0,
  });
  let drawCalls = 0;
  let triangles = 0;
  let activeEffectIds: string[] = [];

  const replay = (clip: AnimaPoseClip) => {
    avatar.stopClip({ transition: { mode: "fadeOut", durationSec: 0 } });
    avatar.vfxController?.clearAllEffects();
    stage.bands.clearScenes();
    avatar.playAnimaPoseClip(clip, { preserveProceduralOffsets: true });
  };

  const measure = async (
    clip: AnimaPoseClip,
    frames: number,
    samples: Samples,
  ) => {
    const pending: WebGLQuery[] = [];
    const collect = () => {
      if (gl.getParameter(timer!.GPU_DISJOINT_EXT)) {
        samples.disjoint += pending.length;
        for (const query of pending) gl.deleteQuery(query);
        pending.length = 0;
        return;
      }
      while (pending.length) {
        const query = pending[0]!;
        if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) return;
        pending.shift();
        samples.gpu.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
        gl.deleteQuery(query);
      }
    };
    if (timer) gl.getParameter(timer.GPU_DISJOINT_EXT);
    let previous = await nextFrame();
    for (let index = 0; index < request.warmupFrames + frames; index++) {
      if (index % request.replayFrames === 0) replay(clip);
      const now = await nextFrame();
      const measured = index >= request.warmupFrames;
      if (measured) samples.interval.push(now - previous);
      previous = now;
      const query = measured && timer ? gl.createQuery() : null;
      const start = performance.now();
      avatar.update(FRAME_SEC);
      if (query) gl.beginQuery(timer!.TIME_ELAPSED_EXT, query);
      renderer.render(scene, camera);
      if (query) gl.endQuery(timer!.TIME_ELAPSED_EXT);
      const end = performance.now();
      if (measured) {
        samples.cpu.push(end - start);
        if (query) pending.push(query);
        drawCalls = renderer.info.render.calls;
        triangles = renderer.info.render.triangles;
      }
      if (timer) collect();
    }
    for (let wait = 0; timer && pending.length && wait < 120; wait++) {
      await nextFrame();
      collect();
    }
  };

  const result = (samples: Samples): ReactionScenario => ({
    cpu: stats(samples.cpu),
    gpu: timer && samples.gpu.length ? stats(samples.gpu) : null,
    interval: stats(samples.interval),
    disjointFrames: samples.disjoint,
    drawCalls,
    triangles,
    frameRate: frameRateOf(samples.interval),
    passes: [],
  });

  try {
    await avatar.load({ filePath: request.avatar.url });
    avatar.setAutomaticAnimationPlaybackEnabled(false);
    avatar.prepareFirstFrame();
    stage.attachCanvas(renderer.domElement, avatar);
    scene.add(avatar.scene!);
    const { position, orbitTarget, fov } = buildSceneCameraPreset("portrait", {
      avatar,
    }).settings;
    camera.fov = fov;
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(orbitTarget.x, orbitTarget.y, orbitTarget.z);
    camera.updateProjectionMatrix();

    const plainSamples = samplesOf();
    const effectSamples = samplesOf();
    const framesPerPass = Math.ceil(request.frames / request.rounds);
    let plainResult: ReactionScenario | null = null;
    let effectsResult: ReactionScenario | null = null;
    for (let round = 0; round < request.rounds; round++) {
      await measure(plain, framesPerPass, plainSamples);
      plainResult = result(plainSamples);
      await measure(full, framesPerPass, effectSamples);
      effectsResult = result(effectSamples);
      const snapshot = avatar.vfxController?.getSnapshot();
      activeEffectIds = [
        ...[
          ...(snapshot?.activeEffects ?? []),
          ...(snapshot?.attachmentEffects ?? []),
        ].map((effect) => effect.effectId),
        ...(avatar.particleVFXController
          ?.getSnapshot()
          .activeInstances.map((instance) => instance.effectId) ?? []),
        ...stage.bands.sceneIds(),
      ];
    }
    return {
      avatar: request.avatar.id,
      renderer: debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER)),
      gpuTimer: Boolean(timer),
      drawingBuffer: {
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
      },
      plain: plainResult!,
      effects: effectsResult!,
      activeEffectIds,
      warnings: [
        ...(avatar.vfxController?.getSnapshot().warnings ?? []),
        ...(avatar.particleVFXController?.getSnapshot().warnings ?? []),
        ...media.getProblems(),
        ...problems,
      ],
    };
  } finally {
    avatar.setPoseClipExternalEventSink(null);
    if (avatar.scene) scene.remove(avatar.scene);
    avatar.dispose();
    disposeRenderer();
    stage.dispose();
  }
}

/** The WebGL renderer string, to confirm the GPU before timing. */
function rendererInfo(): { renderer: string; vendor: string } {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext("webgl2");
  if (!gl) return { renderer: "unavailable", vendor: "unavailable" };
  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  return {
    renderer: String(
      gl.getParameter(
        debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER,
      ),
    ),
    vendor: String(
      gl.getParameter(debugInfo ? debugInfo.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
    ),
  };
}

declare global {
  interface Window {
    runEffectBench: typeof runBench;
    runEffectBenchBreakdown: typeof runBreakdown;
    runReactionBench: typeof runReactionBench;
    effectBenchRendererInfo: typeof rendererInfo;
    effectRendererReady: boolean;
  }
}

window.runEffectBench = runBench;
window.runEffectBenchBreakdown = runBreakdown;
window.runReactionBench = runReactionBench;
window.effectBenchRendererInfo = rendererInfo;
window.effectRendererReady = true;
