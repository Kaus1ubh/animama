import "@fontsource-variable/dm-sans";
// First, so Tailwind's cascade layers keep their order (theme, base,
// components, utilities) before the Scene layers' own sheet adds to them.
import "./stage.css";

import * as THREE from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";

import { createWebI18n } from "@/i18n/web-i18n";
import { Avatar } from "@/lib/avatar";
import {
  chatCanvasFilter,
  type Rgb,
} from "@/lib/avatar/enhanced-rendering/backdropGlow";
import { isEnhancedRenderingEnabled } from "@/lib/avatar/enhanced-rendering/enhancedRendering";
import { cssColorToRgb } from "@/lib/avatar/enhanced-rendering/sampleBackdrop";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import {
  EMPTY_PREVIEW_MEDIA,
  PreviewMediaProvider,
  previewSceneEntry,
  type PreviewEffect,
  type PreviewMedia,
  type PreviewParticleEffect,
} from "@/lib/avatar/motion-authoring/preview/previewMedia";
import type { PreviewClip } from "@/lib/avatar/motion-authoring/preview/sources";

import { SceneBands, missingSceneMessage } from "../effect-render/sceneBands";
import { AmbientLayer, type AmbientWeights } from "./ambient";
import { CursorTrail } from "./trail";
import { addChatLights, applyChatColorPipeline } from "../effect-render/stage";
import {
  createStore,
  type CreatorState,
  type StageController,
  type StageState,
} from "./controller";
import { mountOverlay } from "./overlay";
import {
  CREATOR_PALETTES,
  CREATOR_PARTICLES,
  CREATOR_SCENE,
  PLAIN_BACKDROP,
  STAGE_STOPS,
  type StageCamera,
  type StageStop,
} from "./stops";

/**
 * Landing page stage (served by `scripts/landing-stage.mjs`). One production
 * `Avatar`, lit and tone-mapped like the chat canvas, fills the viewport over
 * a per-stop backdrop and the chat's Scene layers. Scrolling moves the camera
 * between the stops in `stops.ts`: each stop holds still for part of its
 * scroll segment, then the camera eases along the orbit to the next one. The
 * active stop plays its Gestures and Reactions (with their Avatar, Particle
 * and Scene Effects) or the creator demo's effects; the React overlay
 * (`overlay.tsx`) draws the captions and demos through `StageController`.
 *
 * `?hud` shows the live camera values; `?stop=<id>` opens at a stop;
 * `?classic` renders the Avatar without the app's enhanced shaders and
 * lighting (set before any module loads, in `index.html`); `?washes` brings
 * back the pastel gradient washes behind the light stops.
 */

type Program = {
  avatar: { id: string; url: string };
  sources: Record<
    string,
    {
      clip: PreviewClip | null;
      effect: PreviewEffect | null;
      media: PreviewMedia | null;
    }
  >;
  problems: string[];
};

type SceneEffect = Extract<PreviewEffect, { kind: "scene_effect" }>;
type Toggle = { enabled: boolean };
/** The parts of a background Scene definition the creator demo edits. */
type BackgroundDefinition = Record<string, unknown> & {
  gradient: Toggle & { stops: { color: string; position: number }[] };
  pattern: Toggle;
  screen: Toggle;
  scatters: Toggle[];
  flash?: Toggle;
};

/** Share of each scroll segment held at its stops before the camera moves. */
const HOLD = 0.22;
/** How quickly the camera catches up with the scroll position (per second). */
const CAMERA_FOLLOW = 5;
/** Viewports narrower than this aspect ratio use each stop's `tall` framing. */
const TALL_ASPECT = 0.8;
/** Pause before a stop's first clip and between its clips, in seconds. */
const CLIP_LEAD_SEC = 0.5;
const CLIP_GAP_SEC = 0.7;
/**
 * Reactions loop while she talks and looping Gestures never end, so both play
 * a whole number of times adding up to at least this long.
 */
const MIN_CLIP_SEC = 3;
/** The creator demo replays its Particle Effect this often, for this long. */
const PARTICLE_REPEAT_MS = 3200;
const PARTICLE_SEC = 3;
/** Largest upper-body turn toward a camera behind her, in degrees. */
const MAX_LOOK_BACK_DEG = 120;
/** How the turn is shared along the spine, neck and head. */
const LOOK_BACK_BONES: [VRMHumanBoneName, number][] = [
  ["spine", 0.12],
  ["chest", 0.14],
  ["upperChest", 0.14],
  ["neck", 0.26],
  ["head", 0.34],
];
/** Dusk lighting: the chat lights tinted lavender and slightly dimmed. */
const DUSK_TINT = new THREE.Color(0xd9c9ff);
const DUSK_DIM = 0.12;
const DEG = Math.PI / 180;
const UP = new THREE.Vector3(0, 1, 0);
const CAMERA_KEYS = [
  "yaw",
  "distance",
  "aim",
  "rise",
  "fov",
  "shift",
  "lift",
] as const satisfies readonly (keyof StageCamera)[];

const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const ui = {
  canvas: document.getElementById("canvas") as HTMLCanvasElement,
  backdrop: document.getElementById("backdrop") as HTMLDivElement,
  ambient: document.getElementById("ambient") as HTMLCanvasElement,
  bands: document.getElementById("bands") as HTMLDivElement,
  overlay: document.getElementById("overlay") as HTMLDivElement,
  hud: document.getElementById("hud") as HTMLPreElement,
};

const renderer = new THREE.WebGLRenderer({
  canvas: ui.canvas,
  antialias: true,
  alpha: true,
  stencil: false,
});
applyChatColorPipeline(renderer);
renderer.setClearColor(0x000000, 0);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
const scene = new THREE.Scene();
addChatLights(scene);
/** The chat lights with their daylight colour and intensity, for dusk blending. */
const lights = scene.children
  .filter((child): child is THREE.Light => child instanceof THREE.Light)
  .map((light) => ({
    light,
    color: light.color.clone(),
    intensity: light.intensity,
  }));
/** Whether to apply the chat canvas's soft grade and backdrop glow. */
const enhanced = isEnhancedRenderingEnabled();
const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 30);
const media = new PreviewMediaProvider();
const bands = new SceneBands(ui.bands);
const ambient = new AmbientLayer(ui.ambient);
new CursorTrail(document.getElementById("trail") as HTMLCanvasElement);
const clock = new THREE.Clock();
const store = createStore<StageState>({
  ready: false,
  active: -1,
  playing: null,
  problems: [],
});

let program: Program | null = null;
let avatar: Avatar | null = null;
/** Rest height of the head bone; the unit of every camera length. */
let headHeight = 1;
/** Session seconds, the clock Scene animations are seeked to. */
let time = 0;
/** The camera as shown, easing toward the scroll position's framing. */
let shown: StageCamera | null = null;
/** Smoothed look-back weight (0–1). */
let lookBack = 0;
/** Current turn toward the camera, in radians, applied in `vrm.update`. */
let turn = 0;
/** Smoothed dusk lighting weight (0–1). */
let dusk = 0;
/** Whether a clip is playing (a finished clip stays marked in the store). */
let clipBusy = false;
/** Smoothed cursor look-at strength (0–1), and the value last applied. */
let cursorFollow = 0;
let shownCursorFollow = -1;
/** Smoothed weight of each ambient mood (0–1). */
const ambientWeights: AmbientWeights = { sparkles: 0, stars: 0 };
/** Increases whenever playback changes hands; stale callbacks stop. */
let playToken = 0;
let clipTimer: number | undefined;
let particleTimer: number | undefined;
let particleCount = 0;
/** The next clip each cycling stop plays, so a return visit moves on. */
const cursors = STAGE_STOPS.map(() => 0);
/** The creator demo's selections, applied while its stop is active. */
let creator: CreatorState | null = null;
/** When the creator's Scene started, so its animations keep running. */
let creatorSceneStart = 0;
const backdrops: HTMLDivElement[] = [];

// ── Camera rig ─────────────────────────────────────────────────────────────

const isTall = () => window.innerWidth / window.innerHeight < TALL_ASPECT;

function stopCamera(stop: StageStop): StageCamera {
  return isTall() ? { ...stop.camera, ...stop.tall } : stop.camera;
}

/** Ease in and out with zero velocity and acceleration at both ends. */
const smootherstep = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * Where scrolling has reached: the segment's first stop, the eased blend
 * toward the next one, and the stop the page treats as active.
 */
function scrollPosition() {
  const last = STAGE_STOPS.length - 1;
  const raw = THREE.MathUtils.clamp(
    window.scrollY / Math.max(1, window.innerHeight),
    0,
    last,
  );
  const from = Math.min(Math.floor(raw), last - 1);
  const local = raw - from;
  const blend = smootherstep(
    THREE.MathUtils.clamp((local - HOLD) / (1 - 2 * HOLD), 0, 1),
  );
  return { from, blend, active: local < 0.5 ? from : from + 1 };
}

function blendCameras(a: StageCamera, b: StageCamera, t: number): StageCamera {
  const out = { ...a };
  for (const key of CAMERA_KEYS)
    out[key] = THREE.MathUtils.lerp(a[key], b[key], t);
  return out;
}

/** Ease `shown` toward `target`, framerate independently. */
function follow(target: StageCamera, delta: number) {
  if (!shown || reducedMotion) {
    shown = { ...target };
    return;
  }
  const k = 1 - Math.exp(-CAMERA_FOLLOW * delta);
  for (const key of CAMERA_KEYS) shown[key] += (target[key] - shown[key]) * k;
}

const aimPoint = new THREE.Vector3();

/**
 * Put the camera on its orbit around the Avatar's vertical axis (yaw 0 is in
 * front of her; she faces +Z and her left is +X), aim it and shift the lens.
 */
function placeCamera(view: StageCamera, width: number, height: number) {
  aimPoint.set(0, view.aim * headHeight, 0);
  const distance = view.distance * headHeight;
  camera.position.set(
    Math.sin(view.yaw * DEG) * distance,
    aimPoint.y + view.rise * headHeight,
    Math.cos(view.yaw * DEG) * distance,
  );
  camera.lookAt(aimPoint);
  camera.fov = view.fov;
  camera.aspect = width / height;
  // A negative x offset moves the subject right; a positive y offset, up.
  camera.setViewOffset(
    width,
    height,
    -view.shift * width,
    view.lift * height,
    width,
    height,
  );
  camera.updateProjectionMatrix();
}

// ── Look back ──────────────────────────────────────────────────────────────

/**
 * Turn her upper body and head toward the camera when it is behind her. The
 * turn is added to the normalized bones just before three-vrm copies them to
 * the model (so spring bones follow it) and removed afterwards, leaving the
 * pose the Avatar's own layers write untouched.
 */
function installLookBack(target: Avatar) {
  const vrm = target.vrm!;
  const bones = LOOK_BACK_BONES.map(([name, share]) => ({
    node: vrm.humanoid.getNormalizedBoneNode(name),
    share,
  })).filter(
    (bone): bone is { node: THREE.Object3D; share: number } => !!bone.node,
  );
  const total = bones.reduce((sum, { share }) => sum + share, 0);
  const saved = bones.map(() => new THREE.Quaternion());
  const parentWorld = new THREE.Quaternion();
  const worldTurn = new THREE.Quaternion();
  const localTurn = new THREE.Quaternion();
  const update = vrm.update.bind(vrm);
  vrm.update = (delta: number) => {
    if (Math.abs(turn) < 1e-4) return update(delta);
    bones.forEach(({ node, share }, index) => {
      saved[index].copy(node.quaternion);
      node.parent!.getWorldQuaternion(parentWorld);
      worldTurn.setFromAxisAngle(UP, (turn * share) / total);
      // Rotate about the world vertical through the bone's own pivot.
      localTurn
        .copy(parentWorld)
        .invert()
        .multiply(worldTurn)
        .multiply(parentWorld);
      node.quaternion.premultiply(localTurn);
    });
    update(delta);
    bones.forEach(({ node }, index) => node.quaternion.copy(saved[index]));
  };
}

/** The turn (radians) that faces her toward the camera, within reach. */
function lookBackTurn(weight: number): number {
  const toward = Math.atan2(camera.position.x, camera.position.z);
  const limit = MAX_LOOK_BACK_DEG * DEG;
  return THREE.MathUtils.clamp(toward, -limit, limit) * weight;
}

// ── Clips ──────────────────────────────────────────────────────────────────

/**
 * The clip and playback for a demo: clips that would never finish on their
 * own play a whole number of times adding up to at least `MIN_CLIP_SEC`.
 * Reactions loop while she talks (a `playback` lifetime), which finite
 * playback does not accept, so the demo drops that lifetime.
 */
function demoPlayback(source: PreviewClip) {
  const { playback, ...clip } = source.clip as typeof source.clip & {
    playback?: unknown;
  };
  if (!source.loop && playback === undefined)
    return { clip: source.clip, finitePlayback: undefined };
  return {
    clip: clip as typeof source.clip,
    finitePlayback: {
      timeScale: 1,
      repetitions: Math.max(
        1,
        Math.ceil(MIN_CLIP_SEC / Math.max(source.duration, 0.1)),
      ),
    },
  };
}

function stopPlayback() {
  playToken += 1;
  clipBusy = false;
  window.clearTimeout(clipTimer);
  window.clearInterval(particleTimer);
  store.set({ playing: null });
}

/** Play clip `index` of stop `stopIndex`, then continue a cycling stop. */
function playClip(stopIndex: number, index: number) {
  stopPlayback();
  const stop = STAGE_STOPS[stopIndex];
  const item = stop.clips[index];
  const source = item ? program?.sources[item.spec] : undefined;
  if (!avatar || !source?.clip) return;
  const token = playToken;
  cursors[stopIndex] = (index + 1) % stop.clips.length;
  media.setMedia(source.media ?? EMPTY_PREVIEW_MEDIA);
  const { clip, finitePlayback } = demoPlayback(source.clip);
  avatar.playAnimaPoseClip(clip, {
    preserveProceduralOffsets: true,
    finitePlayback,
    onFinished: () => {
      // The finished clip stays marked until the next one starts.
      if (token !== playToken) return;
      clipBusy = false;
      if (stop.clipMode === "cycle")
        clipTimer = window.setTimeout(
          () => playClip(stopIndex, cursors[stopIndex]),
          CLIP_GAP_SEC * 1000,
        );
    },
  });
  clipBusy = true;
  store.set({ playing: { stop: stopIndex, clip: index } });
}

// ── Creator demo ───────────────────────────────────────────────────────────

const isCreatorStop = (index: number) =>
  STAGE_STOPS[index]?.panel === "creator";

/** The creator Scene with the demo's layers and palette applied. */
function creatorSceneEntry(base: SceneEffect, state: CreatorState) {
  const definition = structuredClone(base.definition) as BackgroundDefinition;
  const palette =
    CREATOR_PALETTES.find(({ id }) => id === state.palette) ??
    CREATOR_PALETTES[0];
  definition.gradient.enabled = state.layers.gradient;
  definition.gradient.stops = palette.stops.map((color, position) => ({
    color,
    position,
  }));
  definition.pattern.enabled = state.layers.pattern;
  definition.screen.enabled = state.layers.rays;
  definition.scatters[0].enabled = state.layers.stars;
  definition.scatters[1].enabled = state.layers.confetti;
  if (definition.flash) definition.flash.enabled = false;
  return previewSceneEntry({ ...base, definition });
}

/** Show the creator demo's Scene and replay its Particle Effect. */
function applyCreator() {
  window.clearInterval(particleTimer);
  if (!creator || !avatar || !program) return;
  const base = program.sources[CREATOR_SCENE]?.effect;
  if (base?.kind === "scene_effect") {
    if (Object.values(creator.layers).some(Boolean))
      bands.showScene(
        creatorSceneEntry(base, creator),
        creatorSceneStart,
        "creator",
      );
    else bands.clearScenes();
  }
  const particle = CREATOR_PARTICLES.find(({ id }) => id === creator?.particle);
  const effect = particle ? program.sources[particle.spec]?.effect : null;
  if (effect?.kind !== "particle_effect") return;
  const fire = () =>
    void avatar?.particleVFXController?.playEffect({
      effectId: effect.alias,
      appliedId: `creator-particle-${(particleCount += 1)}`,
      lifetime: { kind: "duration", durationSec: PARTICLE_SEC },
    });
  fire();
  particleTimer = window.setInterval(fire, PARTICLE_REPEAT_MS);
}

/** Every creator Particle Effect, so the demo can play any of them. */
function creatorMedia(): PreviewMedia {
  const particleEffects = CREATOR_PARTICLES.map(
    ({ spec }) => program?.sources[spec]?.effect,
  ).filter(
    (effect): effect is PreviewParticleEffect & PreviewEffect =>
      effect?.kind === "particle_effect",
  );
  return { ...EMPTY_PREVIEW_MEDIA, particleEffects };
}

// ── Stops ──────────────────────────────────────────────────────────────────

function enterStop(index: number) {
  stopPlayback();
  const stop = STAGE_STOPS[index];
  document.body.dataset.ink = stop.ink;
  store.set({ active: index });
  if (!avatar) return;
  avatar.stopClip({ transition: { mode: "fadeOut", durationSec: 0.35 } });
  bands.clearScenes();
  if (isCreatorStop(index)) {
    media.setMedia(creatorMedia());
    creatorSceneStart = time;
    applyCreator();
    return;
  }
  if (stop.clips.length === 0) return;
  const token = playToken;
  clipTimer = window.setTimeout(() => {
    if (token === playToken) playClip(index, cursors[index]);
  }, CLIP_LEAD_SEC * 1000);
}

function scrollToStop(index: number) {
  window.scrollTo({
    top: index * window.innerHeight,
    behavior: reducedMotion ? "auto" : "smooth",
  });
}

// ── Cursor look-at ─────────────────────────────────────────────────────────

/** A tracking window long enough never to pause during a visit. */
const FOLLOW_FOREVER_SEC = 1e6;

/**
 * Ease the Avatar's cursor look-at toward the active stop's `followCursor`,
 * held off while a `once` clip (the hero's wave) is still playing.
 */
function showFollow(stop: StageStop, ease: number) {
  const target =
    stop.followCursor && !(stop.clipMode === "once" && clipBusy) ? 1 : 0;
  cursorFollow += (target - cursorFollow) * ease;
  // Snap the tail of a fade-out so the layer fully releases her.
  if (target === 0 && cursorFollow < 0.01) cursorFollow = 0;
  const intensity = Math.round(cursorFollow * 100) / 100;
  if (intensity === shownCursorFollow) return;
  shownCursorFollow = intensity;
  avatar?.setProceduralAnimationLayerParams("cursorLookAt", { intensity });
}

// ── Backdrop glow ──────────────────────────────────────────────────────────

/**
 * A stop's backdrop: plain cream behind the light stops unless `?washes`
 * asks for their pastel gradients; the night sky always keeps its own.
 */
function stopBackdrop(stop: StageStop) {
  return stop.dusk || params.has("washes") ? stop.backdrop : PLAIN_BACKDROP;
}

/** A backdrop's top-level layers (commas inside functions do not split). */
function backdropLayers(css: string): string[] {
  const layers = [""];
  let depth = 0;
  for (const char of css) {
    if (char === "(") depth += 1;
    else if (char === ")") depth -= 1;
    if (char === "," && depth === 0) layers.push("");
    else layers[layers.length - 1] += char;
  }
  return layers.map((layer) => layer.trim());
}

/**
 * A stop backdrop's overall colour, for the glow: the average of the colours
 * in its base (last) layer. The washes and stars above it are small or
 * fade out, so they are left out.
 */
function backdropColor(css: string): Rgb | null {
  if (css === PLAIN_BACKDROP)
    return cssColorToRgb(
      getComputedStyle(document.documentElement).getPropertyValue(
        "--background",
      ),
    );
  const base = backdropLayers(css).at(-1) ?? "";
  const colors = (base.match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)/gi) ?? [])
    .map(cssColorToRgb)
    .filter((color): color is Rgb => color !== null);
  if (colors.length === 0) return null;
  return [0, 1, 2].map(
    (channel) =>
      colors.reduce((sum, color) => sum + color[channel], 0) / colors.length,
  ) as unknown as Rgb;
}

let stopColors = STAGE_STOPS.map((stop) => backdropColor(stopBackdrop(stop)));
let shownFilter = "";
// The theme toggle switches `.dark` on <html>; the plain backdrop follows it.
new MutationObserver(() => {
  stopColors = STAGE_STOPS.map((stop) => backdropColor(stopBackdrop(stop)));
  shownFilter = "";
}).observe(document.documentElement, { attributeFilter: ["class"] });

/**
 * The chat canvas's grade and glow, as `Scene.tsx` applies it, with the glow
 * following the backdrop colour blended between the two stops in view.
 */
function showGlow(from: number, blend: number) {
  const a = stopColors[from];
  const b = stopColors[from + 1] ?? a;
  const color =
    a && b
      ? (a.map((value, channel) =>
          Math.round(THREE.MathUtils.lerp(value, b[channel], blend)),
        ) as unknown as Rgb)
      : (a ?? b);
  const filter = chatCanvasFilter(color);
  if (filter !== shownFilter) ui.canvas.style.filter = shownFilter = filter;
}

// ── Frame loop ─────────────────────────────────────────────────────────────

function frame() {
  const delta = Math.min(clock.getDelta(), 0.1);
  time += delta;
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);

  const { from, blend, active } = scrollPosition();
  const a = STAGE_STOPS[from];
  const b = STAGE_STOPS[from + 1];
  follow(blendCameras(stopCamera(a), stopCamera(b), blend), delta);
  backdrops.forEach((layer, index) => {
    layer.style.opacity = String(
      index === from ? 1 - blend : index === from + 1 ? blend : 0,
    );
  });
  if (active !== store.get().active) enterStop(active);

  placeCamera(shown!, width, height);
  const ease = 1 - Math.exp(-4 * delta);
  lookBack +=
    (THREE.MathUtils.lerp(a.lookBack ?? 0, b.lookBack ?? 0, blend) - lookBack) *
    ease;
  turn = lookBackTurn(lookBack);
  dusk +=
    (THREE.MathUtils.lerp(a.dusk ? 1 : 0, b.dusk ? 1 : 0, blend) - dusk) * ease;
  for (const mood of ["sparkles", "stars"] as const) {
    const target = THREE.MathUtils.lerp(
      a.ambient === mood ? 1 : 0,
      b.ambient === mood ? 1 : 0,
      blend,
    );
    ambientWeights[mood] += (target - ambientWeights[mood]) * ease;
  }
  showFollow(STAGE_STOPS[active], ease);
  ambient.setSize(width, height);
  ambient.frame(delta, ambientWeights, from + blend);
  for (const { light, color, intensity } of lights) {
    light.color.copy(color).lerp(DUSK_TINT, dusk);
    light.intensity = intensity * (1 - DUSK_DIM * dusk);
  }
  avatar?.update(delta);
  renderer.render(scene, camera);

  bands.setSize(width, height);
  bands.expire(time);
  bands.seekAnimations(time);
  if (enhanced) showGlow(from, blend);
  if (!ui.hud.hidden) showHud();
  requestAnimationFrame(frame);
}

function showHud() {
  const view = shown!;
  const { active, problems } = store.get();
  ui.hud.textContent = [
    `stop   ${STAGE_STOPS[active]?.id ?? "-"} (${isTall() ? "tall" : "wide"})`,
    ...CAMERA_KEYS.map((key) => `${key.padEnd(8)} ${view[key].toFixed(3)}`),
    `turn   ${(turn / DEG).toFixed(1)}°`,
    `clip   ${avatar?.getClipSnapshot().clipId ?? "-"}`,
    `scenes ${bands.sceneLabels().join(", ") || "-"}`,
    ...problems.map((problem) => `! ${problem}`),
  ].join("\n");
}

// ── Start ──────────────────────────────────────────────────────────────────

const controller: StageController = {
  getState: store.get,
  subscribe: store.subscribe,
  scrollToStop,
  playClip,
  setCreator(state) {
    creator = state;
    // The overlay calls this from an effect, and `SceneBands` renders with
    // `flushSync`, which React refuses inside its own commit.
    queueMicrotask(() => {
      if (isCreatorStop(store.get().active)) applyCreator();
    });
  },
};

declare global {
  interface Window {
    landingStage: {
      ready: boolean;
      error: string | null;
      stop: () => string | null;
      problems: string[];
    };
  }
}
window.landingStage = {
  ready: false,
  error: null,
  stop: () => STAGE_STOPS[store.get().active]?.id ?? null,
  problems: [],
};

async function start() {
  for (const stop of STAGE_STOPS) {
    const layer = document.createElement("div");
    layer.className = "backdrop-layer";
    layer.style.background = stopBackdrop(stop);
    ui.backdrop.append(layer);
    backdrops.push(layer);
  }
  ui.hud.hidden = !params.has("hud");
  // The app's components read their labels from its English catalogs.
  mountOverlay(ui.overlay, controller, await createWebI18n("en"));
  const opening = STAGE_STOPS.findIndex(({ id }) => id === params.get("stop"));
  if (opening > 0) window.scrollTo({ top: opening * window.innerHeight });
  // Captions and camera follow the scroll while the Avatar loads.
  requestAnimationFrame(frame);

  const response = await fetch("/__stage/program");
  if (!response.ok)
    throw new Error(`Program request failed (${response.status}).`);
  program = (await response.json()) as Program;
  window.landingStage.problems = program.problems;
  store.set({ problems: program.problems });

  avatar = new Avatar(camera, ui.canvas, {
    motionCatalog: BUILT_IN_AVATAR_MOTION_CATALOG,
    mediaCatalog: media,
  });
  await avatar.load({ filePath: program.avatar.url });
  if (!avatar.scene || !avatar.vrm)
    throw new Error(`Cannot load ${program.avatar.id}.`);
  scene.add(avatar.scene);
  avatar.update(0);
  headHeight = avatar.vrm.humanoid
    .getRawBoneNode("head")!
    .getWorldPosition(new THREE.Vector3()).y;
  installLookBack(avatar);
  // Track the cursor continuously while a stop allows it, rather than in the
  // chat's occasional glances; `followCursor` fades the strength in and out.
  avatar.setProceduralAnimationLayerParams("cursorLookAt", {
    durationMinSec: FOLLOW_FOREVER_SEC,
    durationMaxSec: FOLLOW_FOREVER_SEC,
    pauseMinSec: 0,
    pauseMaxSec: 0,
    intensity: 0,
  });
  bands.setAvatar(avatar);
  avatar.setPoseClipExternalEventSink(
    bands.clipSceneSink(
      (kind, alias) => media.resolveSceneVFX(kind, alias),
      () => time,
      (alias, kind) => {
        throw new Error(missingSceneMessage(alias, kind));
      },
    ),
  );
  // Enter the current stop again now that the Avatar can play it.
  store.set({ ready: true });
  enterStop(Math.max(0, store.get().active));
  document.body.classList.add("is-ready");
  window.landingStage.ready = true;
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  window.landingStage.error = message;
  ui.hud.hidden = false;
  ui.hud.textContent = `Error: ${message}`;
});
