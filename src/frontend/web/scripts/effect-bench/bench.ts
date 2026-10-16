// The app's full stylesheet, so DOM Scene layers cost what they cost in chat.
import "@/index.css";
import { Avatar } from "@/lib/avatar";
import {
  PreviewMediaProvider,
  type PreviewMedia,
} from "@/lib/avatar/motion-authoring/preview/previewMedia";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import { applyAvatarVFXEffectById } from "@/lib/avatar/vfx/runtime";
import { EMPTY_RUNTIME_MEDIA_PROVIDER } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";
import { buildSceneCameraPreset } from "@/ui/main/canvas/sceneCameraPresets";

import { ReviewStage } from "../effect-render/reviewStage";
import { missingSceneMessage } from "../effect-render/sceneBands";
import {
  createStage,
  effectEntry,
  type EffectSource,
} from "../effect-render/stage";

/** A clip as the Avatar plays it. */
type AnimaPoseClip = Parameters<Avatar["playAnimaPoseClip"]>[0];

/**
 * Avatar Effect frame-cost benchmark (driven by `scripts/effect-bench.mjs`).
 *
 * One production `Avatar` per request, rendered like the chat canvas (DPR 2,
 * antialiasing, the chat's tone mapping and lights, sRGB, Portrait framing)
 * while a looping Gesture plays through `Avatar.update`. Each animation frame
 * times `avatar.update` plus `renderer.render` on the CPU and, where
 * `EXT_disjoint_timer_query_webgl2` exists, the render's GPU time. The
 * baseline runs with no effects; the heavy run adds the requested effects
 * and two attachments drawn here in code (a pulsing chest heart and a
 * scrolling silhouette pattern). The two alternate over several rounds.
 */

type BenchRequest = {
  avatar: { id: string; url: string };
  clip: unknown;
  /** Face effects resolved by Node (Included or Local sources). */
  effects: EffectSource[];
  width: number;
  height: number;
  pixelRatio: number;
  /** Warm-up frames before each measured pass. */
  warmupFrames: number;
  /** Measured frames per scenario, split across the rounds. */
  frames: number;
  /** Alternating none/heavy passes per scenario. */
  rounds: number;
};

type Stats = { mean: number; p95: number; samples: number };

type ScenarioResult = {
  cpu: Stats;
  gpu: Stats | null;
  /** Measured frames whose GPU time a disjoint event voided. */
  disjointFrames: number;
  drawCalls: number;
  triangles: number;
};

type BenchResult = {
  avatar: string;
  renderer: string;
  vendor: string;
  gpuTimer: boolean;
  drawingBuffer: { width: number; height: number };
  none: ScenarioResult;
  heavy: ScenarioResult;
  activeEffectIds: string[];
  warnings: string[];
};

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

async function runBench(request: BenchRequest): Promise<BenchResult> {
  const { renderer, scene, camera } = createStage(
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

  type Samples = { cpu: number[]; gpu: number[]; disjoint: number };
  let drawCalls = 0;
  let triangles = 0;

  /**
   * Time `frames` frames after `warmupFrames` into `samples`, then collect the
   * remaining GPU queries.
   */
  const measure = async (frames: number, samples: Samples): Promise<void> => {
    const pending: WebGLQuery[] = [];
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
    for (let index = 0; index < request.warmupFrames + frames; index++) {
      await nextFrame();
      const measured = index >= request.warmupFrames;
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

  const result = (samples: Samples, calls: number, tris: number) => ({
    cpu: stats(samples.cpu),
    gpu: timer && samples.gpu.length ? stats(samples.gpu) : null,
    disjointFrames: samples.disjoint,
    drawCalls: calls,
    triangles: tris,
  });

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

  try {
    await avatar.load({ filePath: request.avatar.url });
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

    // Alternate the scenarios (none, heavy, none, heavy, …) so clock and
    // thermal drift do not favour either one.
    const noneSamples: Samples = { cpu: [], gpu: [], disjoint: 0 };
    const heavySamples: Samples = { cpu: [], gpu: [], disjoint: 0 };
    const framesPerPass = Math.ceil(request.frames / request.rounds);
    let noneCalls = [0, 0];
    let heavyCalls = [0, 0];
    let snapshot = avatar.vfxController?.getSnapshot();
    for (let round = 0; round < request.rounds; round++) {
      avatar.vfxController?.clearAllEffects();
      await measure(framesPerPass, noneSamples);
      noneCalls = [drawCalls, triangles];
      await applyHeavy();
      snapshot = avatar.vfxController?.getSnapshot();
      await measure(framesPerPass, heavySamples);
      heavyCalls = [drawCalls, triangles];
    }
    const none = result(noneSamples, noneCalls[0]!, noneCalls[1]!);
    const heavy = result(heavySamples, heavyCalls[0]!, heavyCalls[1]!);
    return {
      avatar: request.avatar.id,
      renderer: debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
        : String(gl.getParameter(gl.RENDERER)),
      vendor: debugInfo
        ? String(gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL))
        : String(gl.getParameter(gl.VENDOR)),
      gpuTimer: Boolean(timer),
      drawingBuffer: {
        width: gl.drawingBufferWidth,
        height: gl.drawingBufferHeight,
      },
      none,
      heavy,
      activeEffectIds: [
        ...(snapshot?.activeEffects ?? []),
        ...(snapshot?.attachmentEffects ?? []),
      ].map((effect) => effect.effectId),
      warnings: snapshot?.warnings ?? [],
    };
  } finally {
    if (avatar.scene) scene.remove(avatar.scene);
    avatar.dispose();
    renderer.dispose();
    renderer.domElement.remove();
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
  const { renderer, scene, camera } = createStage(
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
    renderer.dispose();
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
    runReactionBench: typeof runReactionBench;
    effectBenchRendererInfo: typeof rendererInfo;
    effectRendererReady: boolean;
  }
}

window.runEffectBench = runBench;
window.runReactionBench = runReactionBench;
window.effectBenchRendererInfo = rendererInfo;
window.effectRendererReady = true;
