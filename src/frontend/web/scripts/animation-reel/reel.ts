import * as THREE from "three";

import type { Avatar } from "@/lib/avatar";
import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import {
  DEFAULT_PIP_SCENE_CAMERA_PRESET,
  isSceneCameraPreset,
} from "@/ui/main/canvas/sceneCameraPresets";

import { STAGE_STOPS, TALL_ASPECT } from "../landing-stage/stops";
import { ReviewStage, TILE_BACKDROP } from "../effect-render/reviewStage";
import {
  EffectSession,
  placeCamera,
  seedRandom,
  type PageClipMedia,
  type SessionSound,
} from "../effect-render/session";
import {
  chatCameraFraming,
  createStage,
  type Framing,
} from "../effect-render/stage";
import { ReelSpeech, type ReelSpeechRequest } from "./speech";

/**
 * Action reel page (driven by `scripts/animation-reel.mjs`): plays one take
 * at a time on an Avatar and draws each video frame on demand.
 *
 * Each take opens a fresh `Avatar` on the review stage (`../effect-render`):
 * the chat's colour pipeline, lights, camera preset and Scene layers. A take
 * is a list of cues on its own clock. A Gesture cue plays through the
 * Avatar's clip player, optionally from part-way through; a Reaction cue on
 * its reaction layer beside it, as chat plays them together. Either one's
 * Avatar, Particle and Scene Effects and sounds start when chat would start
 * them. A looping clip is stopped (with its fade) after one pass, and a
 * talking-scoped one after the request's talking time, as chat stops it when
 * the reply ends, unless the cue says when to stop. A take may also speak a
 * recorded voice take (`./speech.ts`): lip-sync, tag expressions and talking
 * hands as chat drives them. Frames advance in fixed 60 Hz steps, so a reel
 * is the same on every run whatever the capture speed. Sounds are not played
 * here: each one a clip event plays is reported with its time, and Node
 * mixes them (and the voice) into the video's audio. An optional label panel
 * in the top-left corner names the take, its effects (lit while active) and
 * their sounds (lit while playing), and shows the Avatar's live expression
 * weights.
 */

/** One effect the take's clips can start, as the label lists it. */
type ReelEffect = {
  alias: string;
  /** Display kind, such as "Avatar Effect". */
  kind: string;
  name: string;
  /** The sound it plays when a clip event applies it, or null. */
  soundCueId: string | null;
};

type ReelLabel = {
  /** Small heading, such as "Gesture · 12 / 107". */
  kicker: string;
  title: string;
  /** Second line, such as a Reaction's emotion and intensity, or null. */
  detail: string | null;
  effects: ReelEffect[];
  /** Sounds the clips play through their own sound events. */
  sounds: string[];
};

/** A sound cue's display name and length; 0 s for a cue with no file. */
type ReelSoundInfo = { name: string; duration: number };

/** A clip a take plays, on the take's clock (seconds since it opened). */
type ReelCue = {
  /**
   * `gesture` plays on the Avatar's clip player (chat's Gestures, and every
   * single-item reel); `reaction` on its reaction layer, beside a Gesture.
   */
  kind: "gesture" | "reaction";
  /** Names the cue in errors, such as its source. */
  id: string;
  at: number;
  /** Clip time (s) a Gesture starts at. */
  from: number;
  /** Take time the clip is stopped (with its fade), or null for the default. */
  until: number | null;
  clip: unknown;
};

/**
 * A camera: a chat preset, `pip` (the desktop PiP window's default preset)
 * or `landing` / `landing:<stop>` (a landing page stop's framing; `landing`
 * is the hero close-up).
 */
type ReelCamera = string;

type ReelItemRequest = {
  avatar: { id: string; url: string };
  size: { width: number; height: number };
  camera: ReelCamera;
  cues: ReelCue[];
  /** The effects the cues' events play, by (take-unique) alias. */
  clipMedia: PageClipMedia | null;
  /** The corner label, or null for none. */
  label: ReelLabel | null;
  /** Every cue the take may play, by cue id. */
  sounds: Record<string, ReelSoundInfo>;
  speech: ReelSpeechRequest | null;
  /** CSS background behind the Avatar; null keeps the review grey. */
  background: string | null;
  /** Fixed take length (s), or null to end `tail` seconds after it goes idle. */
  duration: number | null;
  /**
   * Seconds a talking-scoped clip (a Reaction, which chat holds while the
   * Anima speaks) is held before it is stopped, at least until its timed
   * effect events end, when its cue does not say.
   */
  talk: number;
  /** Seconds kept after the clips, their effects, sounds and speech have ended. */
  tail: number;
  /** Longest a take runs after its first cue starts before it is cut. */
  maxSec: number;
};

type ReelFrame = {
  /** The take ended: its duration, or everything finished and the tail shown. */
  done: boolean;
  /** The take ran for `maxSec` without ending and should be cut. */
  timedOut: boolean;
  /** Sounds clip events started since the previous frame. */
  sounds: SessionSound[];
  /** Every controller warning and media problem so far. */
  warnings: string[];
};

const LABEL_CSS = `
.reel-label {
  position: absolute;
  top: calc(var(--u) * 36);
  left: calc(var(--u) * 36);
  z-index: 30;
  box-sizing: border-box;
  min-width: calc(var(--u) * 360);
  max-width: calc(var(--u) * 680);
  padding: calc(var(--u) * 20) calc(var(--u) * 26);
  border-radius: calc(var(--u) * 16);
  background: rgba(18, 19, 24, 0.76);
  color: #f5f5f7;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.25;
}
.reel-kicker {
  font-size: calc(var(--u) * 17);
  font-weight: 600;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.7;
}
.reel-title {
  margin-top: calc(var(--u) * 4);
  font-size: calc(var(--u) * 40);
  font-weight: 650;
}
.reel-detail {
  margin-top: calc(var(--u) * 2);
  font-size: calc(var(--u) * 24);
  opacity: 0.85;
}
.reel-rows {
  display: grid;
  gap: calc(var(--u) * 6);
  margin-top: calc(var(--u) * 14);
  font-size: calc(var(--u) * 21);
}
.reel-row {
  display: flex;
  align-items: center;
  gap: calc(var(--u) * 10);
  opacity: 0.5;
}
.reel-row.is-active { opacity: 1; }
.reel-dot {
  flex: none;
  width: calc(var(--u) * 10);
  height: calc(var(--u) * 10);
  border-radius: 50%;
  background: rgba(245, 245, 247, 0.5);
}
.reel-row.is-active .reel-dot { background: #ffd166; }
.reel-kind { font-size: calc(var(--u) * 16); opacity: 0.7; }
.reel-sound {
  margin-left: auto;
  padding-left: calc(var(--u) * 14);
  font-size: calc(var(--u) * 18);
  white-space: nowrap;
}
.reel-sound.is-playing { color: #7ee0ff; }
.reel-row:has(.reel-sound.is-playing) { opacity: 1; }
.reel-none { font-size: calc(var(--u) * 20); opacity: 0.55; }
.reel-expressions {
  /* Takes the panel's width without widening it as the values change. */
  width: 0;
  min-width: 100%;
  margin-top: calc(var(--u) * 14);
}
.reel-expressions-title {
  font-size: calc(var(--u) * 15);
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  opacity: 0.6;
}
.reel-chips {
  display: flex;
  flex-wrap: wrap;
  gap: calc(var(--u) * 6);
  margin-top: calc(var(--u) * 6);
  font-size: calc(var(--u) * 18);
  font-variant-numeric: tabular-nums;
}
.reel-chip {
  padding: calc(var(--u) * 2) calc(var(--u) * 8);
  border-radius: calc(var(--u) * 6);
  white-space: nowrap;
}
`;

/** Weights below this are not listed (they show as 0.00). */
const EXPRESSION_MIN_WEIGHT = 0.005;

/** The corner label: the item, its effects, their sounds and expressions. */
class LabelPanel {
  readonly element = document.createElement("div");
  private effects: { alias: string; row: HTMLElement }[] = [];
  private sounds: { cueId: string; element: HTMLElement }[] = [];
  private chips = document.createElement("div");

  constructor(host: HTMLElement, height: number) {
    const style = document.createElement("style");
    style.textContent = LABEL_CSS;
    document.head.append(style);
    this.element.className = "reel-label";
    // Sizes are authored for 1080 rows and scale with the video height.
    this.element.style.setProperty("--u", `${height / 1080}px`);
    host.append(this.element);
  }

  show(label: ReelLabel, sounds: Record<string, ReelSoundInfo>): void {
    const text = (className: string, value: string) => {
      const element = document.createElement("div");
      element.className = className;
      element.textContent = value;
      return element;
    };
    const soundName = (cueId: string) => sounds[cueId]?.name ?? cueId;
    const soundTag = (cueId: string) => {
      const element = text("reel-sound", `♪ ${soundName(cueId)}`);
      this.sounds.push({ cueId, element });
      return element;
    };
    const row = (name: string, kind: string, cueId: string | null) => {
      const element = document.createElement("div");
      element.className = "reel-row";
      const dot = document.createElement("span");
      dot.className = "reel-dot";
      element.append(dot);
      if (name) element.append(text("reel-name", name));
      element.append(text("reel-kind", kind));
      if (cueId) element.append(soundTag(cueId));
      return element;
    };
    this.effects = [];
    this.sounds = [];
    const rows = document.createElement("div");
    rows.className = "reel-rows";
    for (const effect of label.effects) {
      const element = row(effect.name, effect.kind, effect.soundCueId);
      this.effects.push({ alias: effect.alias, row: element });
      rows.append(element);
    }
    for (const cueId of label.sounds)
      rows.append(row("", "Sound event", cueId));
    if (rows.childElementCount === 0)
      rows.append(text("reel-none", "No effects"));
    const expressions = document.createElement("div");
    expressions.className = "reel-expressions";
    this.chips = document.createElement("div");
    this.chips.className = "reel-chips";
    expressions.append(
      text("reel-expressions-title", "Expressions"),
      this.chips,
    );
    this.element.replaceChildren(
      text("reel-kicker", label.kicker),
      text("reel-title", label.title),
      ...(label.detail ? [text("reel-detail", label.detail)] : []),
      rows,
      expressions,
    );
  }

  /**
   * Light the effects that are active and the sounds that are playing, and
   * list each expression's weight, in the Avatar's expression order. A chip's
   * fill shows its weight.
   */
  update(
    activeAliases: Set<string>,
    playingCues: Set<string>,
    expressions: [name: string, weight: number][],
  ): void {
    for (const { alias, row } of this.effects)
      row.classList.toggle("is-active", activeAliases.has(alias));
    for (const { cueId, element } of this.sounds)
      element.classList.toggle("is-playing", playingCues.has(cueId));
    const chips = expressions.map(([name, weight]) => {
      const chip = document.createElement("span");
      chip.className = "reel-chip";
      chip.textContent = `${name} ${weight.toFixed(2)}`;
      const filled = `${(weight * 100).toFixed(1)}%`;
      chip.style.background = `linear-gradient(to right, rgba(255, 209, 102, 0.38) ${filled}, rgba(245, 245, 247, 0.1) ${filled})`;
      return chip;
    });
    if (chips.length === 0) {
      const none = document.createElement("span");
      none.className = "reel-none";
      none.textContent = "None";
      chips.push(none);
    }
    this.chips.replaceChildren(...chips);
  }

  clear(): void {
    this.element.replaceChildren();
    this.effects = [];
    this.sounds = [];
    this.chips = document.createElement("div");
  }
}

/** The page's stage, kept across takes of the same size. */
let stage: {
  review: ReviewStage;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  disposeRenderer: () => void;
  label: LabelPanel;
  width: number;
  height: number;
} | null = null;

/** A cue's playback state in the open take. */
type CueState = {
  cue: ReelCue;
  /** Take time it is stopped, or null when it ends by itself. */
  stopAt: number | null;
  started: boolean;
  stopped: boolean;
};

/** The open take. */
let item: {
  request: ReelItemRequest;
  session: EffectSession;
  framing: Framing;
  /** Lens shift of a landing page framing, as shares of the frame. */
  offset: { shift: number; lift: number } | null;
  cues: CueState[];
  /** The Gesture and Reaction cues playing, which their stops apply to. */
  gesture: CueState | null;
  reaction: CueState | null;
  speech: ReelSpeech | null;
  /** Take time of the first cue: `maxSec` counts from it. */
  firstAt: number;
  /** Session time since which everything has been idle, or null. */
  idleSince: number | null;
  sounds: SessionSound[];
  reported: number;
  warnings: Set<string>;
} | null = null;

function ensureStage({ width, height }: ReelItemRequest["size"]) {
  if (stage && stage.width === width && stage.height === height) return stage;
  if (stage) {
    stage.disposeRenderer();
    stage.review.dispose();
  }
  const review = new ReviewStage(width, height);
  const { renderer, scene, camera, disposeRenderer } = createStage(
    width,
    height,
  );
  stage = {
    review,
    renderer,
    scene,
    camera,
    disposeRenderer,
    label: new LabelPanel(review.element, height),
    width,
    height,
  };
  return stage;
}

/** Close the open take, keeping the stage for the next one. */
function closeReelItem(): void {
  if (!item || !stage) return;
  const { session } = item;
  item = null;
  if (session.avatar.scene) stage.scene.remove(session.avatar.scene);
  session.dispose();
  stage.review.bands.clearScenes();
  stage.review.bands.setAvatar(null);
  stage.label.clear();
}

/** The Avatar's current non-zero expression weights, in its expression order. */
function expressionWeights(avatar: Avatar): [string, number][] {
  return avatar
    .getAvailableExpressions()
    .map((name): [string, number] => [name, avatar.getExpressionValue(name)])
    .filter(([, weight]) => weight >= EXPRESSION_MIN_WEIGHT);
}

/**
 * When to stop a clip that does not end by itself, in seconds after it
 * starts: a talking-scoped clip after `talk` seconds and its timed events, a
 * loop after one pass; null for a clip that completes on its own.
 */
function stopAfter(
  clip: ReturnType<typeof parseAnimaPoseClip>,
  talk: number,
): number | null {
  if (clip.playback) {
    const eventsEnd = Math.max(
      0,
      ...(clip.events ?? []).map(
        (event) =>
          event.time + ("duration" in event ? (event.duration ?? 0) : 0),
      ),
    );
    return Math.max(talk, clip.duration, eventsEnd);
  }
  return clip.loop === true ? clip.duration : null;
}

/** A cue's stop time: its own, else its clip's default from where it starts. */
function cueStopAt(cue: ReelCue, talk: number): number | null {
  if (cue.until !== null) return cue.until;
  const after = stopAfter(parseAnimaPoseClip(cue.clip), talk);
  return after === null ? null : cue.at + Math.max(0, after - cue.from);
}

/** Head bone height of the Avatar as it stands: the landing camera's unit. */
function headHeight(avatar: Avatar): number {
  const head = avatar.vrm?.humanoid.getRawBoneNode("head");
  if (!head) throw new Error("The Avatar has no head bone to frame.");
  return head.getWorldPosition(new THREE.Vector3()).y;
}

/**
 * Where the camera stands for `camera`: a chat preset, `pip`, or a landing
 * page stop placed as `landing-stage/stage.ts` places it (orbit, aim and
 * distance in head heights, the stop's tall framing on a tall frame) with
 * its lens shift.
 */
function cameraView(
  avatar: Avatar,
  camera: ReelCamera,
  { width, height }: ReelItemRequest["size"],
): { framing: Framing; offset: { shift: number; lift: number } | null } {
  if (camera === "pip")
    return {
      framing: chatCameraFraming(avatar, DEFAULT_PIP_SCENE_CAMERA_PRESET),
      offset: null,
    };
  if (isSceneCameraPreset(camera))
    return { framing: chatCameraFraming(avatar, camera), offset: null };
  const stopId = /^landing(?::(.+))?$/.exec(camera);
  const stop =
    stopId && STAGE_STOPS.find(({ id }) => id === (stopId[1] ?? "hero"));
  if (!stop)
    throw new Error(
      `Unknown camera ${camera}; landing stops are ${STAGE_STOPS.map(({ id }) => id).join(", ")}.`,
    );
  const view =
    width / height < TALL_ASPECT
      ? { ...stop.camera, ...stop.tall }
      : stop.camera;
  const unit = headHeight(avatar);
  const yaw = THREE.MathUtils.degToRad(view.yaw);
  const target = new THREE.Vector3(0, view.aim * unit, 0);
  return {
    framing: {
      position: new THREE.Vector3(
        Math.sin(yaw) * view.distance * unit,
        target.y + view.rise * unit,
        Math.cos(yaw) * view.distance * unit,
      ),
      target,
      fov: view.fov,
    },
    offset: { shift: view.shift, lift: view.lift },
  };
}

/**
 * Open one take: a fresh Avatar at rest, its label shown, its speech
 * planned, no cue started.
 */
async function openReelItem(request: ReelItemRequest): Promise<void> {
  closeReelItem();
  seedRandom(0x5eed);
  const current = ensureStage(request.size);
  const transparent = request.background === "transparent";
  document.body.style.background = transparent ? "transparent" : "#000";
  current.review.element.style.background = request.background ?? TILE_BACKDROP;
  const speech = request.speech ? ReelSpeech.plan(request.speech) : null;
  const sounds: SessionSound[] = [];
  const session = await EffectSession.open(
    request.avatar.url,
    current.camera,
    current.renderer.domElement,
    {
      clip: null,
      clipMedia: request.clipMedia,
      expression: null,
      clipPlayback: "avatar",
      onSound: (sound) => sounds.push(sound),
    },
    current.review,
  );
  current.review.attachCanvas(current.renderer.domElement, session.avatar);
  current.scene.add(session.avatar.scene!);
  if (request.label) current.label.show(request.label, request.sounds);
  current.label.element.hidden = !request.label;
  // Event sinks and effect loads, before any cue plays.
  await session.apply({ effects: [] });
  const cues = request.cues
    .map((cue) => ({
      cue,
      stopAt: cueStopAt(cue, request.talk),
      started: false,
      stopped: false,
    }))
    .sort((a, b) => a.cue.at - b.cue.at);
  const { framing, offset } = cameraView(
    session.avatar,
    request.camera,
    request.size,
  );
  const open: NonNullable<typeof item> = {
    request,
    session,
    framing,
    offset,
    cues,
    gesture: null,
    reaction: null,
    speech,
    firstAt: Math.min(
      ...request.cues.map(({ at }) => at),
      speech?.at ?? Infinity,
    ),
    idleSince: null,
    sounds,
    reported: 0,
    warnings: new Set(),
  };
  if (speech) {
    if (speech.fallback)
      open.warnings.add(
        `speech lip-sync follows the audio alone (${speech.fallback})`,
      );
    // The voice's clock is the session's frame clock.
    speech.attach(session.avatar, {
      get currentTime() {
        return session.time;
      },
    });
  }
  session.setFrameHook((time) => frameHook(open, time));
  item = open;
}

/** Start and stop cues due at take time `time`, and feed the speech. */
function frameHook(open: NonNullable<typeof item>, time: number) {
  const { session } = open;
  // Within half a frame, so a cue on a frame boundary is not a frame late.
  const due = time + 1e-6;
  for (const state of open.cues) {
    if (state.started || state.cue.at > due) continue;
    state.started = true;
    if (state.cue.kind === "gesture") {
      session.playGesture(state.cue.clip, state.cue.from);
      open.gesture = state;
    } else {
      session.playReaction(state.cue.clip, state.cue.id);
      open.reaction = state;
    }
  }
  for (const state of [open.gesture, open.reaction]) {
    if (!state || state.stopped || state.stopAt === null) continue;
    if (state.stopAt > due) continue;
    state.stopped = true;
    if (state.cue.kind === "gesture") session.avatar.stopClip();
    else session.stopReaction();
  }
  return open.speech?.frame(session.avatar, time);
}

/** Draw the open take at `time` seconds after opening it. */
async function reelFrame(time: number): Promise<ReelFrame> {
  if (!item || !stage) throw new Error("No reel item is open.");
  const current = item;
  const { session, request } = current;
  await session.advanceTo(time);

  placeCamera(stage.camera, "front", session.avatar, current.framing);
  const { width, height } = request.size;
  if (current.offset)
    // A negative x offset moves the subject right; a positive y offset, up.
    stage.camera.setViewOffset(
      width,
      height,
      -current.offset.shift * width,
      current.offset.lift * height,
      width,
      height,
    );
  else stage.camera.clearViewOffset();
  stage.renderer.render(stage.scene, stage.camera);
  await stage.review.seek(session.time);

  const diagnostics = session.diagnostics(request.avatar.id);
  diagnostics.warnings.forEach((warning) => current.warnings.add(warning));
  const playing = new Set<string>();
  let soundsEnd = 0;
  for (const sound of current.sounds) {
    const end = sound.time + (request.sounds[sound.cueId]?.duration ?? 0);
    soundsEnd = Math.max(soundsEnd, end);
    if (session.time >= sound.time && session.time < end)
      playing.add(sound.cueId);
  }
  if (request.label)
    stage.label.update(
      new Set(diagnostics.activeEffectIds),
      playing,
      expressionWeights(session.avatar),
    );

  const speechEnd = current.speech
    ? current.speech.at + current.speech.durationSec
    : 0;
  const idle =
    current.cues.every(({ started }) => started) &&
    !session.avatar.isClipActive() &&
    !session.isReactionActive() &&
    diagnostics.activeEffectIds.length === 0 &&
    session.time >= soundsEnd &&
    session.time >= speechEnd;
  current.idleSince = idle ? (current.idleSince ?? session.time) : null;
  const sounds = current.sounds.slice(current.reported);
  current.reported = current.sounds.length;
  return {
    done:
      request.duration !== null
        ? session.time >= request.duration - 1e-6
        : current.idleSince !== null &&
          session.time - current.idleSince >= request.tail,
    timedOut:
      request.duration === null &&
      session.time - current.firstAt >= request.maxSec,
    sounds,
    warnings: [...current.warnings],
  };
}

declare global {
  interface Window {
    openReelItem: typeof openReelItem;
    reelFrame: typeof reelFrame;
    closeReelItem: typeof closeReelItem;
    effectRendererReady: boolean;
  }
}

window.openReelItem = openReelItem;
window.reelFrame = reelFrame;
window.closeReelItem = closeReelItem;
window.effectRendererReady = true;
