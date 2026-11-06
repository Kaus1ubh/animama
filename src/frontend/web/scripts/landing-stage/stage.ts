import * as THREE from "three";
import type { VRMHumanBoneName } from "@pixiv/three-vrm";

import { Avatar } from "@/lib/avatar";
import {
  chatCanvasFilter,
  type Rgb,
} from "@/lib/avatar/enhanced-rendering/backdropGlow";
import {
  isEnhancedRenderingEnabled,
  useEnhancedRenderingStore,
} from "@/lib/avatar/enhanced-rendering/enhancedRendering";
import { cssColorToRgb } from "@/lib/avatar/enhanced-rendering/sampleBackdrop";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import {
  EMPTY_PREVIEW_MEDIA,
  PreviewMediaProvider,
  type PreviewMedia,
} from "@/lib/avatar/motion-authoring/preview/previewMedia";
import type { PreviewClip } from "@/lib/avatar/motion-authoring/preview/sources";

import { SceneBands, missingSceneMessage } from "../effect-render/sceneBands";
import { AmbientLayer, type AmbientWeights } from "./ambient";
import { Intro, WALK_VARIANTS, type WalkVariantId } from "./intro";
import {
  createBackdrops,
  devParam,
  openingStop,
  params,
  reducedMotion,
  scrollPosition,
  scrollToStop,
  stopBackdrop,
} from "./page";
import { PROGRAM, type StageProgram } from "./program";
import { ResolutionGovernor } from "./quality";
import { mountStills } from "./stills";
import { CursorTrail } from "./trail";
import { addChatLights, applyChatColorPipeline } from "../effect-render/stage";
import {
  createStore,
  type StageController,
  type StageState,
} from "./controller";
import { PAGE_NAMESPACES, createLandingI18n, initialLocale } from "./i18n";
import { mountOverlay } from "./overlay";
import {
  PLAIN_BACKDROP,
  PUZZLE_CLIP_FILE,
  PUZZLE_EFFECT_SOURCES,
  STAGE_AVATARS,
  STAGE_STOPS,
  TALL_ASPECT,
  type StageCamera,
  type StageStop,
  stopClips,
} from "./stops";

/**
 * Landing page stage (served by `scripts/landing-stage.mjs`). One production
 * `Avatar`, lit and tone-mapped like the chat canvas, fills the viewport over
 * a per-stop backdrop and the chat's Scene layers. Scrolling moves the camera
 * between the stops in `stops.ts`: each stop holds still for part of its
 * scroll segment, then the camera eases along the orbit to the next one. The
 * active stop plays its Gestures and Reactions (with their Avatar, Particle
 * and Scene Effects); the React overlay (`overlay.tsx`) draws the captions
 * and demos through `StageController`.
 *
 * `?stop=<id>` opens at a stop and `?nointro` skips the entrance. In
 * development only (a production build drops them): `?hud` shows the live
 * camera values; the walk-on is procedural, and `?walk=<id>` tries a clip
 * cycle from `WALK_VARIANTS` instead, when `--walk-clips` supplies them;
 * `?nopuzzle` skips the head scratch and double take; `?classic` renders the
 * Avatar without the app's enhanced shaders and lighting; `?washes` brings
 * back the pastel gradient washes behind the light stops; `?wave=small` plays
 * the small shy wave instead of Wave hello.
 */

/** How quickly the camera catches up with the scroll position (per second). */
const CAMERA_FOLLOW = 5;
/** Least space between the hero's text and the top of her head, in pixels. */
const HERO_TEXT_GAP_PX = 14;
/** Pause before a stop's first clip, in seconds; the next clip follows at once. */
const CLIP_LEAD_SEC = 0.3;
/**
 * Reactions loop while she talks and looping Gestures never end, so both play
 * a whole number of times adding up to at least this long.
 */
const MIN_CLIP_SEC = 3;
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

if (devParam("classic") !== null)
  useEnhancedRenderingStore.getState().setEnabled(false);
/**
 * Whether she walks on stage first: only when the page opens at the hero,
 * motion is allowed and `?nointro` is absent.
 */
const playIntro = openingStop <= 0 && !reducedMotion && !params.has("nointro");
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
  // At 2x the pixel grid already smooths edges, and multisampling a
  // full-screen Retina buffer is the page's largest GPU allocation.
  antialias: window.devicePixelRatio < 2,
  alpha: true,
  stencil: false,
});
applyChatColorPipeline(renderer);
renderer.setClearColor(0x000000, 0);
const resolution = new ResolutionGovernor(window.devicePixelRatio);
renderer.setPixelRatio(resolution.ratio);
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
  intro: playIntro ? "walking" : "done",
  revealed: !playIntro,
  avatar: STAGE_AVATARS[0].id,
  avatarLoading: null,
  fallback: false,
});

const program = PROGRAM;
let avatar: Avatar | null = null;
/** The hero entrance while it plays; null once she is on her mark. */
let intro: Intro | null = null;
/** Rest height of the head bone on stage; the unit of camera aim heights. */
let headHeight = 1;
/**
 * The first Avatar's rest head height: the unit of camera distances and
 * rises for every Avatar, so each shows at the same size on screen.
 */
let frameUnit = 1;
/** Rest height of the top of her head, hair included. */
let crownHeight = 1;
/** Where the hero's text ends (px from the top); 0 until the overlay reports. */
let heroTextBottom = 0;
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
/**
 * When her smile began to grow (session seconds): from the double take,
 * happy rises from 0 to 1 over `HAPPY_RAMP_SEC`, through the turn and into
 * the wave, and holds until the wave ends.
 */
let happyFrom: number | null = null;
const HAPPY_RAMP_SEC = 1.2;
/**
 * With the head scratch, her smile waits for the double take's surprise to
 * start fading: the clip holds `surprised` from its take (1.91 s) until she
 * settles (2.6 s), and the turn begins at 1.85 s.
 */
const HAPPY_AFTER_TAKE_SEC = 0.7;
/** Whether the entrance played the head scratch and double take. */
let puzzled = false;
/** When her wave began (session seconds), and how far into it the reveal starts. */
let waveFrom: number | null = null;
const REVEAL_DELAY_SEC = 0.2;
/**
 * Whether the camera has pushed in from the entrance's wider framing to the
 * hero stop. It follows her wave, even when a click or key press has already
 * revealed the text (`revealOnInteraction`).
 */
let pushedIn = !playIntro;
/**
 * When her smile began to fade (session seconds): once the wave ends, with
 * the camera already pushed in, happy eases back to 0 over `HAPPY_FADE_SEC`
 * and hands her face back to the Avatar.
 */
let happyFadeFrom: number | null = null;
const HAPPY_FADE_SEC = 1;
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
/** The next clip each cycling stop plays, so a return visit moves on. */
const cursors = STAGE_STOPS.map(() => 0);
/** The hero's wave: Wave hello, or the small shy wave with `?wave=small`. */
const HERO_WAVE = devParam("wave") === "small" ? 1 : 0;
cursors[0] = HERO_WAVE;
const showBackdrops = createBackdrops(ui.backdrop);
/** Stills of her in place of the canvas, once she has failed to load. */
let showStills: ((from: number, blend: number) => void) | null = null;

// ── Camera rig ─────────────────────────────────────────────────────────────

const isTall = () => window.innerWidth / window.innerHeight < TALL_ASPECT;

function stopCamera(stop: StageStop): StageCamera {
  const view = isTall() ? { ...stop.camera, ...stop.tall } : stop.camera;
  return stop.id === "hero" ? clearHeroText(view) : view;
}

const fitCamera = new THREE.PerspectiveCamera();
const crown = new THREE.Vector3();

/**
 * The hero framing, lowered just enough for the top of her head to clear the
 * hero's text. The text keeps its size while the Avatar scales with the
 * screen height, so on shorter screens (and for Avatars with taller hair)
 * the stop's own framing would tuck her head under its last line.
 */
function clearHeroText(view: StageCamera): StageCamera {
  if (heroTextBottom <= 0) return view;
  const width = window.innerWidth;
  const height = window.innerHeight;
  placeCamera(view, width, height, fitCamera);
  fitCamera.updateMatrixWorld();
  crown.set(intro?.cameraX ?? 0, crownHeight, 0).project(fitCamera);
  const top = ((1 - crown.y) / 2) * height;
  const overlap = heroTextBottom + HERO_TEXT_GAP_PX - top;
  // The lift is a pixel shift of the frame, so this lowers her exactly.
  return overlap > 0 ? { ...view, lift: view.lift - overlap / height } : view;
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
function placeCamera(
  view: StageCamera,
  width: number,
  height: number,
  target: THREE.PerspectiveCamera = camera,
) {
  // The camera follows her sideways while she walks on.
  const pan = intro?.cameraX ?? 0;
  aimPoint.set(pan, view.aim * headHeight, 0);
  const distance = view.distance * frameUnit;
  target.position.set(
    pan + Math.sin(view.yaw * DEG) * distance,
    aimPoint.y + view.rise * frameUnit,
    Math.cos(view.yaw * DEG) * distance,
  );
  target.lookAt(aimPoint);
  target.fov = view.fov;
  target.aspect = width / height;
  // A negative x offset moves the subject right; a positive y offset, up.
  target.setViewOffset(
    width,
    height,
    -view.shift * width,
    view.lift * height,
    width,
    height,
  );
  target.updateProjectionMatrix();
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
  store.set({ playing: null });
}

/** Play clip `index` of stop `stopIndex`, then continue a cycling stop. */
function playClip(stopIndex: number, index: number) {
  stopPlayback();
  const stop = STAGE_STOPS[stopIndex];
  const clips = stopClips(stop, store.get().avatar);
  const item = clips[index];
  const source = item ? program.sources[item.spec] : undefined;
  if (!avatar || !source?.clip) {
    // Without her (she failed to load), a chosen reaction still shows.
    if (item && store.get().fallback)
      store.set({ playing: { stop: stopIndex, clip: index } });
    return;
  }
  const token = playToken;
  // A cycling stop moves on; a `once` stop replays the same clip next visit.
  if (stop.clipMode === "cycle")
    cursors[stopIndex] = (index + 1) % clips.length;
  media.setMedia(source.media ?? EMPTY_PREVIEW_MEDIA);
  const { clip, finitePlayback } = demoPlayback(source.clip);
  // During the entrance her face follows the stage's growing smile, not the
  // wave's own expressions.
  avatar.playAnimaPoseClip(
    happyFrom === null ? clip : { ...clip, expressions: {} },
    {
      preserveProceduralOffsets: true,
      finitePlayback,
      onFinished: () => {
        // The finished clip stays marked until the next one starts.
        if (token !== playToken) return;
        clipBusy = false;
        if (stopIndex === 0 && store.get().intro === "waving") {
          finishIntro();
          if (happyFrom !== null) happyFadeFrom = time;
        }
        if (stop.clipMode === "cycle")
          // Just after the Avatar update that reported the end, not inside it.
          clipTimer = window.setTimeout(() =>
            playClip(stopIndex, cursors[stopIndex]),
          );
      },
    },
  );
  clipBusy = true;
  store.set({ playing: { stop: stopIndex, clip: index } });
}

// ── Stops ──────────────────────────────────────────────────────────────────

function enterStop(index: number) {
  // Leaving the hero mid-entrance puts her straight on her mark, and hands
  // her face back to the stops' clips.
  if (index !== 0) {
    finishIntro();
    if (happyFrom !== null) avatar?.clearExpressionOverride("happy");
    happyFrom = null;
    happyFadeFrom = null;
  }
  stopPlayback();
  // A stop's effects load and compile as it starts; that says nothing about
  // the machine.
  resolution.settle(time);
  const stop = STAGE_STOPS[index];
  document.body.dataset.ink = stop.ink;
  store.set({ active: index });
  if (!avatar) return;
  avatar.stopClip({ transition: { mode: "fadeOut", durationSec: 0.35 } });
  bands.clearScenes();
  // The entrance plays the hero's wave itself once she has turned.
  if (
    stopClips(stop, store.get().avatar).length === 0 ||
    (index === 0 && intro)
  )
    return;
  const token = playToken;
  clipTimer = window.setTimeout(() => {
    if (token === playToken) playClip(index, cursors[index]);
  }, CLIP_LEAD_SEC * 1000);
}

// ── Intro ──────────────────────────────────────────────────────────────────

/** The scratch walk's clip, when the walk-clips folder has one. */
let puzzleClip: PreviewClip["clip"] | null = null;

/** The hero entrance with the requested walk. */
async function createIntro(target: Avatar) {
  const puzzlePath = program.walk[PUZZLE_CLIP_FILE];
  if (puzzlePath && devParam("nopuzzle") === null) {
    // Optional: without it she walks on without the head scratch.
    try {
      const response = await fetch(puzzlePath);
      if (response.ok) puzzleClip = await response.json();
    } catch (error) {
      console.warn("Landing stage: no head scratch,", error);
    }
  }
  const requested = devParam("walk") ?? "";
  const variant: WalkVariantId =
    requested in WALK_VARIANTS ? (requested as WalkVariantId) : "overte";
  // The screen's left edge at her depth, for the intro framing.
  const view = { ...stopCamera(STAGE_STOPS[0]), ...STAGE_STOPS[0].introCamera };
  const edgeX =
    Math.tan((view.fov * DEG) / 2) *
    view.distance *
    frameUnit *
    (window.innerWidth / window.innerHeight);
  const clipUrls =
    devParam("walk") !== null
      ? Object.fromEntries(
          Object.entries(program.walk).map(([name, path]) => [
            name,
            new URL(path, location.origin).href,
          ]),
        )
      : null;
  return Intro.create(target, headHeight, {
    clipUrls,
    variant,
    edgeX,
    puzzle: puzzleClip !== null,
    viewer: camera,
  });
}

/**
 * Where the head scratch's question mark floats, in metres from the head
 * bone: ahead of her forehead (+z) rather than over her crown, so it reads
 * while she walks side-on. The Included effect's own placement suits an
 * Avatar facing the camera.
 */
const PUZZLE_QUESTION_OFFSET = { x: 0.08, y: 0.2, z: 0.15 };

type ClipAvatarEffect = PreviewMedia["avatarEffects"][number];

/** The question mark moved ahead of her forehead; other effects as they are. */
function placePuzzleEffect(entry: ClipAvatarEffect): ClipAvatarEffect {
  const { definition } = entry.effect;
  const attachment = definition.attachment as Record<string, unknown> | null;
  if (entry.effect.stem !== "question_mark" || !attachment) return entry;
  return {
    ...entry,
    effect: {
      ...entry.effect,
      definition: {
        ...definition,
        attachment: { ...attachment, offset: PUZZLE_QUESTION_OFFSET },
      },
    },
  };
}

/**
 * Play the scratch walk's clip, with the Avatar Effects it borrows from the
 * Library items that ship them.
 */
function playPuzzle() {
  if (!avatar || !puzzleClip) return;
  const avatarEffects = new Map<string, ClipAvatarEffect>();
  for (const spec of PUZZLE_EFFECT_SOURCES)
    for (const entry of program.sources[spec]?.media?.avatarEffects ?? [])
      avatarEffects.set(entry.alias, placePuzzleEffect(entry));
  media.setMedia({
    ...EMPTY_PREVIEW_MEDIA,
    avatarEffects: [...avatarEffects.values()],
  });
  avatar.playAnimaPoseClip(puzzleClip, { preserveProceduralOffsets: true });
  puzzled = true;
}

/** Advance the hero entrance; once she faces the camera she waves. */
function updateIntro(delta: number) {
  if (!intro || intro.phase === "waving") return;
  const before = intro.phase;
  const phase = intro.update(delta);
  // Only on a change: every store update re-renders the overlay.
  if (phase !== store.get().intro) store.set({ intro: phase });
  if (phase === "puzzled" && before !== "puzzled") playPuzzle();
  if (phase === "turning" && happyFrom === null)
    happyFrom = time + (puzzled ? HAPPY_AFTER_TAKE_SEC : 0);
  if (phase === "waving") {
    waveFrom = time;
    playClip(0, HERO_WAVE);
  }
}

/** End the entrance (after the wave, or early): reveal the hero's text. */
function finishIntro() {
  if (!intro) return;
  intro.finish();
  intro = null;
  pushedIn = true;
  store.set({ intro: "done", revealed: true });
}

/** Keys that skip the entrance: Escape, and the keys that scroll the page. */
const SKIP_KEYS = new Set([
  "Escape",
  " ",
  "PageDown",
  "PageUp",
  "ArrowDown",
  "ArrowUp",
  "Home",
  "End",
]);

/**
 * During the entrance, a click shows the hero's text, the progress thread
 * and the rest at once while the entrance itself (walk, double take, wave
 * and the camera's push-in) plays on. Escape or a scroll key skips it (the
 * scroll keys still scroll); other keys do nothing.
 */
function revealOnInteraction() {
  const stop = () => {
    window.removeEventListener("pointerdown", reveal);
    window.removeEventListener("keydown", skip);
  };
  const reveal = () => {
    window.removeEventListener("pointerdown", reveal);
    if (!store.get().revealed) store.set({ revealed: true });
  };
  const skip = (event: KeyboardEvent) => {
    if (intro && !SKIP_KEYS.has(event.key)) return;
    stop();
    skipIntro();
  };
  window.addEventListener("pointerdown", reveal);
  window.addEventListener("keydown", skip);
}

/**
 * Skip the entrance: she stands on her mark facing the camera, the text
 * shows and the camera pushes in. She still waves, unless she already is.
 */
function skipIntro() {
  if (!intro) return;
  const waving = intro.phase === "waving";
  finishIntro();
  if (waving) {
    // The wave plays on; her smile fades as it would have when it ended.
    if (happyFrom !== null && happyFadeFrom === null) happyFadeFrom = time;
    return;
  }
  // Her face returns to the wave's own expressions.
  if (happyFrom !== null) avatar?.clearExpressionOverride("happy");
  happyFrom = null;
  happyFadeFrom = null;
  if (store.get().active === 0) playClip(0, HERO_WAVE);
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
    stop.followCursor && !intro && !(stop.clipMode === "once" && clipBusy)
      ? 1
      : 0;
  cursorFollow += (target - cursorFollow) * ease;
  // Snap the tail of a fade-out so the layer fully releases her.
  if (target === 0 && cursorFollow < 0.01) cursorFollow = 0;
  const intensity = Math.round(cursorFollow * 100) / 100;
  if (intensity === shownCursorFollow) return;
  shownCursorFollow = intensity;
  avatar?.setProceduralAnimationLayerParams("cursorLookAt", { intensity });
}

// ── Backdrop glow ──────────────────────────────────────────────────────────

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
  const elapsed = clock.getDelta();
  // Animation steps stay small after a stall; the resolution sees the truth.
  const delta = Math.min(elapsed, 0.1);
  time += delta;
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height, false);

  const { from, blend, active } = scrollPosition();
  const a = STAGE_STOPS[from];
  const b = STAGE_STOPS[from + 1];
  const target = blendCameras(stopCamera(a), stopCamera(b), blend);
  // The entrance is framed wider; the camera pushes in to the stop just
  // into her wave (even when a visitor revealed the text earlier).
  follow(
    pushedIn ? target : { ...target, ...STAGE_STOPS[0].introCamera },
    delta,
  );
  showBackdrops(from, blend);
  showStills?.(from, blend);
  if (active !== store.get().active) enterStop(active);

  placeCamera(shown!, width, height);
  const ease = 1 - Math.exp(-4 * delta);
  lookBack +=
    (THREE.MathUtils.lerp(a.lookBack ?? 0, b.lookBack ?? 0, blend) - lookBack) *
    ease;
  updateIntro(delta);
  turn = lookBackTurn(lookBack) + (intro?.glanceTurn ?? 0);
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
  const ratio = resolution.sample(time, elapsed);
  if (ratio !== null) renderer.setPixelRatio(ratio);

  if (waveFrom !== null && !pushedIn && time - waveFrom >= REVEAL_DELAY_SEC) {
    pushedIn = true;
    if (!store.get().revealed) store.set({ revealed: true });
  }
  if (happyFrom !== null) {
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const rise = smooth(
      THREE.MathUtils.clamp((time - happyFrom) / HAPPY_RAMP_SEC, 0, 1),
    );
    const fade =
      happyFadeFrom === null
        ? 0
        : smooth(Math.min(1, (time - happyFadeFrom) / HAPPY_FADE_SEC));
    avatar?.setExpression("happy", rise * (1 - fade));
    if (fade >= 1) {
      avatar?.clearExpressionOverride("happy");
      happyFrom = null;
      happyFadeFrom = null;
    }
  }
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
    `intro  ${store.get().intro}`,
    `clip   ${avatar?.getClipSnapshot().clipId ?? "-"}`,
    `scenes ${bands.sceneLabels().join(", ") || "-"}`,
    ...problems.map((problem) => `! ${problem}`),
  ].join("\n");
}

// ── Start ──────────────────────────────────────────────────────────────────

// ── Avatars ────────────────────────────────────────────────────────────────

type LoadedAvatar = { avatar: Avatar; headHeight: number; crownHeight: number };

/** Load one of the program's Avatars and wire it for the stage, off stage. */
async function createAvatar(entry: StageProgram["avatars"][number]) {
  const next = new Avatar(camera, ui.canvas, {
    motionCatalog: BUILT_IN_AVATAR_MOTION_CATALOG,
    mediaCatalog: media,
  });
  // A failed load releases what it built.
  try {
    await next.load({ filePath: entry.url });
  } catch (error) {
    next.dispose();
    throw error;
  }
  if (!next.scene || !next.vrm) {
    next.dispose();
    throw new Error(`Cannot load ${entry.id}.`);
  }
  next.update(0);
  const height = next.vrm.humanoid
    .getRawBoneNode("head")!
    .getWorldPosition(new THREE.Vector3()).y;
  const crownHeight = new THREE.Box3().setFromObject(next.vrm.scene).max.y;
  installLookBack(next);
  // Track the cursor continuously while a stop allows it, rather than in the
  // chat's occasional glances; `followCursor` fades the strength in and out.
  next.setProceduralAnimationLayerParams("cursorLookAt", {
    durationMinSec: FOLLOW_FOREVER_SEC,
    durationMaxSec: FOLLOW_FOREVER_SEC,
    pauseMinSec: 0,
    pauseMaxSec: 0,
    intensity: 0,
  });
  next.setPoseClipExternalEventSink(
    bands.clipSceneSink(
      (kind, alias) => media.resolveSceneVFX(kind, alias),
      () => time,
      (alias, kind) => {
        throw new Error(missingSceneMessage(alias, kind));
      },
    ),
  );
  return {
    avatar: next,
    headHeight: height,
    crownHeight,
  } satisfies LoadedAvatar;
}

/** Put a loaded Avatar on stage; camera lengths follow its head height. */
function attachAvatar(loaded: LoadedAvatar) {
  avatar = loaded.avatar;
  headHeight = loaded.headHeight;
  crownHeight = loaded.crownHeight;
  scene.add(loaded.avatar.scene!);
  bands.setAvatar(loaded.avatar);
  // Reapply the cursor look-at strength to the new Avatar.
  shownCursorFollow = -1;
}

/**
 * Swap the Avatar on stage for another of `STAGE_AVATARS`. The current one
 * stays until the new one has loaded, then the active stop starts over with
 * the new one (an entrance in progress ends first).
 */
async function selectAvatar(id: string) {
  const { avatar: current, avatarLoading, ready } = store.get();
  const entry = program.avatars.find((candidate) => candidate.id === id);
  // Until the first Avatar is on stage, `start` owns the stage.
  if (!ready || !entry || id === current || avatarLoading) return;
  store.set({ avatarLoading: id });
  try {
    const loaded = await createAvatar(entry);
    // Loading stalls frames; that says nothing about the machine.
    resolution.settle(time);
    finishIntro();
    stopPlayback();
    if (happyFrom !== null) avatar?.clearExpressionOverride("happy");
    happyFrom = null;
    happyFadeFrom = null;
    const previous = avatar;
    if (previous?.scene) scene.remove(previous.scene);
    previous?.dispose();
    attachAvatar(loaded);
    // Stops with their own clips per Avatar start that Avatar's set over.
    STAGE_STOPS.forEach((stop, index) => {
      if (stop.avatarClips) cursors[index] = 0;
    });
    store.set({ avatar: id });
    enterStop(Math.max(0, store.get().active));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    store.set({ problems: [...store.get().problems, message] });
  } finally {
    store.set({ avatarLoading: null });
  }
}

const controller: StageController = {
  getState: store.get,
  subscribe: store.subscribe,
  scrollToStop,
  playClip,
  selectAvatar: (id) => void selectAvatar(id),
  setHeroTextBottom(px) {
    heroTextBottom = px;
  },
};

// The renderer's live GPU resources, for memory checks.
const renderInfo = () => ({
  ...renderer.info.memory,
  programs: renderer.info.programs?.length ?? 0,
});
window.landingStage = {
  ready: false,
  error: null,
  stop: () => STAGE_STOPS[store.get().active]?.id ?? null,
  problems: program.problems,
  ...(import.meta.env.DEV ? { renderInfo } : {}),
};

/**
 * How long she may take to arrive before the hero's text shows anyway (from
 * page load, in milliseconds), so a slow connection still has a page to read
 * while she loads; she then walks on under it.
 */
const SLOW_ARRIVAL_MS = 4000;

async function start() {
  const slowArrival = window.setTimeout(
    () => store.get().revealed || store.set({ revealed: true }),
    Math.max(0, SLOW_ARRIVAL_MS - performance.now()),
  );
  ui.hud.hidden = devParam("hud") === null;
  // The page's words and its app components' labels, in the visitor's
  // language.
  mountOverlay(
    ui.overlay,
    controller,
    await createLandingI18n(initialLocale(), PAGE_NAMESPACES),
  );
  if (openingStop > 0)
    window.scrollTo({ top: openingStop * window.innerHeight });
  // Captions and camera follow the scroll while the Avatar loads.
  requestAnimationFrame(frame);

  store.set({ problems: program.problems });

  const first = await createAvatar(program.avatars[0]);
  window.clearTimeout(slowArrival);
  resolution.settle(time);
  headHeight = first.headHeight;
  frameUnit = first.headHeight;
  crownHeight = first.crownHeight;
  // Placed at the start of her entrance before she joins the scene, so she
  // never shows on her mark first.
  if (playIntro) {
    intro = await createIntro(first.avatar);
    revealOnInteraction();
  }
  attachAvatar(first);
  // Enter the current stop again now that the Avatar can play it.
  store.set({ ready: true });
  enterStop(Math.max(0, store.get().active));
  document.body.classList.add("is-ready");
  window.landingStage.ready = true;
}

start().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  window.landingStage.error = message;
  console.error(`Landing stage: ${message}`);
  if (import.meta.env.DEV) {
    ui.hud.hidden = false;
    ui.hud.textContent = `Error: ${message}`;
  }
  // She could not load: show her stills, as the fallback page does.
  window.landingStage.fallback = "avatar-failed";
  document.body.classList.add("is-fallback");
  showStills = mountStills(document.querySelector(".stage") as HTMLDivElement);
  store.set({ fallback: true, intro: "done", revealed: true });
});
