import * as THREE from "three";

import type { PreviewParticleEffect } from "@/lib/avatar/motion-authoring/preview/previewMedia";
import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";
import { applyAvatarVFXEffectById } from "@/lib/avatar/vfx/runtime";

import {
  cameraView,
  placeReelCamera,
  type ReelCamera,
  type ReelCameraView,
} from "../animation-reel/camera";
import { stopAfter } from "../animation-reel/playback";
import { ReviewStage, TILE_BACKDROP } from "../effect-render/reviewStage";
import { EffectSession, type PageClipMedia } from "../effect-render/session";
import {
  createStage,
  effectEntry,
  type EffectSource,
} from "../effect-render/stage";
import { STAGE_STOPS } from "../landing-stage/stops";

/**
 * Combo page (served by `scripts/animation-combo.mjs`): plays a Library
 * Gesture and Reaction together on an Avatar in real time, the way the reel
 * recorder plays a cue sheet take (`../animation-reel/reel.ts`): the Gesture
 * on the clip player, the Reaction on the reaction layer, both with their
 * effects. The expression panel lists every expression and ARKit shape the
 * Avatar has, shows each one's live weight, and adds slider weights over the
 * face (an expression overlay, as a cue sheet's face cue adds them). Ticked
 * Avatar and Particle Effects are applied on their own and stay on until
 * unticked. "Copy cue sheet" turns the current setup (without those effects)
 * into a take for `animation:reel`.
 */

type PickerEntry = {
  spec: string;
  stem: string;
  name: string;
  duration: number;
  beats: { id: string; time: number; label: string }[];
  emotion: string | null;
  intensity: number | null;
};

type Catalog = {
  /** `sheet` is how a cue sheet names it: an Included id or a file path. */
  avatars: { id: string; url: string; sheet: string }[];
  gestures: PickerEntry[];
  reactions: PickerEntry[];
  media: PageClipMedia;
  avatarEffects: EffectSource[];
  particleEffects: PreviewParticleEffect[];
};

/** An effect the effects panel can turn on, by its applied id. */
type PanelEffect =
  | { kind: "avatar"; id: string; name: string; source: EffectSource }
  | { kind: "particle"; id: string; name: string; alias: string };

/** The pickers' cameras by option value; `medium` is not a preset name. */
const CAMERAS: Record<string, ReelCamera> = {
  // The landing close-up through a wider lens, its lens shift scaled to
  // match, so the close-up is a centred 1.36x crop of it.
  medium: { fov: 40, lift: 0.0442 },
};
/** Seconds a talking-scoped Reaction is held when Hold is blank, as the reel's `--talk`. */
const TALK_SEC = 3;
/** Shortest Hold a cue sheet accepts as later than its start. */
const MIN_HOLD_SEC = 0.1;
/**
 * Most session time the clock may run ahead of the frames: slow frames catch
 * up by advancing several steps between draws, up to this much.
 */
const MAX_BACKLOG_SEC = 1;
/** Longest gap between draws that counts as playing time (a hidden tab pauses). */
const MAX_TICK_SEC = 0.5;
/** Rest between loops, in seconds. */
const LOOP_REST_SEC = 0.6;
/** The expression overlay owner the sliders use. */
const FACE_OWNER = "combo-face";
/** Live weights below this count as off for "Active only". */
const ACTIVE_WEIGHT = 0.01;

const byId = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const ui = {
  host: byId<HTMLDivElement>("stage-host"),
  status: byId<HTMLParagraphElement>("status"),
  avatar: byId<HTMLSelectElement>("avatar"),
  camera: byId<HTMLSelectElement>("camera"),
  backdrop: byId<HTMLSelectElement>("backdrop"),
  gestureFilter: byId<HTMLInputElement>("gesture-filter"),
  gesture: byId<HTMLSelectElement>("gesture"),
  gestureFrom: byId<HTMLSelectElement>("gesture-from"),
  gestureDelay: byId<HTMLInputElement>("gesture-delay"),
  reactionFilter: byId<HTMLInputElement>("reaction-filter"),
  reaction: byId<HTMLSelectElement>("reaction"),
  reactionDelay: byId<HTMLInputElement>("reaction-delay"),
  reactionHold: byId<HTMLInputElement>("reaction-hold"),
  play: byId<HTMLButtonElement>("play"),
  stop: byId<HTMLButtonElement>("stop"),
  loop: byId<HTMLInputElement>("loop"),
  copy: byId<HTMLButtonElement>("copy"),
  resetFace: byId<HTMLButtonElement>("reset-face"),
  expressionFilter: byId<HTMLInputElement>("expression-filter"),
  activeOnly: byId<HTMLInputElement>("active-only"),
  expressions: byId<HTMLDivElement>("expression-list"),
  effectFilter: byId<HTMLInputElement>("effect-filter"),
  appliedOnly: byId<HTMLInputElement>("applied-only"),
  effects: byId<HTMLDivElement>("effect-list"),
  clearEffects: byId<HTMLButtonElement>("clear-effects"),
  sheet: byId<HTMLTextAreaElement>("sheet"),
};

let catalog: Catalog;
const clips = new Map<string, unknown>();
let stage: ReturnType<typeof createStage> & {
  review: ReviewStage;
  size: { width: number; height: number };
};
let session: EffectSession | null = null;
/** Increases with every Avatar load, so a superseded load drops its result. */
let loadToken = 0;
/** Wall-clock session time the frames catch up to. */
let clock = 0;
/** Each camera's framing for the open Avatar, taken as it stands at rest. */
let views = new Map<string, ReelCameraView>();
/** Slider weights by expression name. */
const face = new Map<string, number>();
/** Every effect the panel offers, by applied id. */
let panelEffects = new Map<string, PanelEffect>();
/** The applied ids of the effects that are on. */
const effectsOn = new Set<string>();
let effectRows: { effect: PanelEffect; row: HTMLElement }[] = [];
let rows: { name: string; row: HTMLElement; label: HTMLElement }[] = [];

/** What Play scheduled, on the session clock. */
let plan: {
  gesture: {
    clip: unknown;
    from: number;
    at: number;
    stopAt: number | null;
  } | null;
  reaction: {
    clip: unknown;
    spec: string;
    at: number;
    stopAt: number | null;
  } | null;
  gestureStarted: boolean;
  gestureStopped: boolean;
  reactionStarted: boolean;
  reactionStopped: boolean;
  idleSince: number | null;
} | null = null;

function setStatus(text: string, error = false): void {
  ui.status.textContent = text;
  ui.status.classList.toggle("error", error);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(
      `${url}: ${(await response.json()).error ?? response.status}`,
    );
  return (await response.json()) as T;
}

/**
 * A Library clip, started from `from` (a beat id) as the reel starts a cue
 * from it: the server re-times the events still running there.
 */
async function clipFor(spec: string, from = ""): Promise<unknown> {
  const key = `${spec}#${from}`;
  if (!clips.has(key))
    clips.set(
      key,
      await fetchJson(
        `/__combo/clip?spec=${encodeURIComponent(spec)}${from ? `&from=${encodeURIComponent(from)}` : ""}`,
      ),
    );
  return clips.get(key);
}

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/** Run an action from a control, showing its failure in the status line. */
const act = (action: () => Promise<void> | void) => () => {
  void Promise.resolve()
    .then(action)
    .catch((error: unknown) => setStatus(errorText(error), true));
};

const currentAvatar = () => catalog.avatars[Number(ui.avatar.value)]!;

const selected = (list: PickerEntry[], select: HTMLSelectElement) =>
  list.find(({ spec }) => spec === select.value) ?? null;

/** Fill a picker with "None" and the entries matching its filter. */
function fillPicker(
  select: HTMLSelectElement,
  list: PickerEntry[],
  filter: string,
  label: (entry: PickerEntry) => string,
): void {
  const previous = select.value;
  const words = filter.toLowerCase().split(/\s+/).filter(Boolean);
  const options = [new Option("None", "")];
  for (const entry of list) {
    const text = label(entry);
    const haystack = `${text} ${entry.stem}`.toLowerCase();
    if (words.every((word) => haystack.includes(word)))
      options.push(new Option(text, entry.spec));
  }
  select.replaceChildren(...options);
  select.value = options.some(({ value }) => value === previous)
    ? previous
    : "";
}

/** A Reaction's picker label: its emotion, intensity and variant, as "Joy 3 (B)". */
const reactionLabel = (entry: PickerEntry) =>
  entry.emotion
    ? `${entry.emotion[0]!.toUpperCase()}${entry.emotion.slice(1)} ${entry.intensity ?? ""}${entry.stem.endsWith("-b") ? " (B)" : ""}`
    : entry.name;

function fillGestureFrom(): void {
  const gesture = selected(catalog.gestures, ui.gesture);
  ui.gestureFrom.replaceChildren(
    new Option("The start", ""),
    ...(gesture?.beats ?? []).map(
      (beat) => new Option(`${beat.label} (${beat.time} s)`, beat.id),
    ),
  );
}

function stageSize(): { width: number; height: number } {
  const area = ui.host.parentElement!.getBoundingClientRect();
  const width = Math.max(
    320,
    Math.min(area.width - 32, ((area.height - 48) * 16) / 9),
  );
  const even = (value: number) => Math.round(value / 2) * 2;
  return { width: even(width), height: even((width * 9) / 16) };
}

function buildStage(): void {
  const size = stageSize();
  const review = new ReviewStage(size.width, size.height);
  const parts = createStage(size.width, size.height, {
    pixelRatio: Math.min(window.devicePixelRatio || 1, 2),
    preserveDrawingBuffer: false,
  });
  ui.host.append(review.element);
  stage = { ...parts, review, size };
  applyBackdrop();
}

function applyBackdrop(): void {
  const hero = STAGE_STOPS.find(({ id }) => id === "hero")!;
  stage.review.element.style.background =
    ui.backdrop.value === "landing" ? hero.backdrop : TILE_BACKDROP;
}

function closeSession(): void {
  if (!session) return;
  plan = null;
  if (session.avatar.scene) stage.scene.remove(session.avatar.scene);
  session.dispose();
  session = null;
  stage.review.bands.clearScenes();
  stage.review.bands.setAvatar(null);
}

async function openAvatar(): Promise<void> {
  const avatar = currentAvatar();
  const token = ++loadToken;
  closeSession();
  setStatus(`Loading ${avatar.id}…`);
  const next = await EffectSession.open(
    avatar.url,
    stage.camera,
    stage.renderer.domElement,
    {
      clip: null,
      clipMedia: catalog.media,
      expression: null,
      clipPlayback: "avatar",
      // Particle Effects the panel plays, beside the clips' own.
      particles: catalog.particleEffects.filter(
        ({ alias }) =>
          !catalog.media.particleEffects.some(
            (particle) => particle.alias === alias,
          ),
      ),
    },
    stage.review,
  );
  // A later pick superseded this load while the file loaded.
  if (token !== loadToken) {
    next.dispose();
    return;
  }
  stage.review.attachCanvas(stage.renderer.domElement, next.avatar);
  stage.scene.add(next.avatar.scene!);
  try {
    await next.apply({ effects: [] });
    next.setFrameHook(frameHook);
    views = new Map(
      [...ui.camera.options].map(({ value }) => [
        value,
        cameraView(next.avatar, CAMERAS[value] ?? value, stage.size),
      ]),
    );
  } catch (error) {
    stage.scene.remove(next.avatar.scene!);
    next.dispose();
    stage.review.bands.setAvatar(null);
    throw error;
  }
  if (token !== loadToken) {
    stage.scene.remove(next.avatar.scene!);
    next.dispose();
    return;
  }
  session = next;
  clock = next.time;
  buildExpressionList();
  applyFace();
  for (const id of effectsOn) void setEffect(id, true);
  setStatus(`${avatar.id} ready.`);
}

/** Start and stop the planned clips due at session time `time`. */
function frameHook(time: number): void {
  const current = plan;
  if (!current || !session) return;
  const due = time + 1e-6;
  const { gesture, reaction } = current;
  try {
    if (gesture && !current.gestureStarted && gesture.at <= due) {
      current.gestureStarted = true;
      session.playGesture(gesture.clip, gesture.from);
    }
    if (reaction && !current.reactionStarted && reaction.at <= due) {
      current.reactionStarted = true;
      session.playReaction(reaction.clip, reaction.spec);
    }
  } catch (error) {
    plan = null;
    setStatus(errorText(error), true);
    return;
  }
  if (
    gesture &&
    current.gestureStarted &&
    !current.gestureStopped &&
    gesture.stopAt !== null &&
    gesture.stopAt <= due
  ) {
    current.gestureStopped = true;
    session.avatar.stopClip();
  }
  if (
    reaction &&
    current.reactionStarted &&
    !current.reactionStopped &&
    reaction.stopAt !== null &&
    reaction.stopAt <= due
  ) {
    current.reactionStopped = true;
    session.stopReaction();
  }
}

const seconds = (input: HTMLInputElement, fallback: number) => {
  const value = Number(input.value);
  return input.value !== "" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
};

/**
 * How long a clip plays before it is stopped, from where it starts: one
 * pass of a loop, `TALK_SEC` and the timed events of a talking-scoped one,
 * as the reel stops it; null for one that ends by itself.
 */
function clipHold(clip: unknown): number | null {
  return stopAfter(parseAnimaPoseClip(clip), TALK_SEC);
}

/** The Reaction's hold: Hold when given (at least `MIN_HOLD_SEC`), else its clip's. */
function reactionHold(clip: unknown): number | null {
  const hold = seconds(ui.reactionHold, -1);
  return hold >= MIN_HOLD_SEC ? hold : clipHold(clip);
}

async function play(): Promise<void> {
  const current = session;
  if (!current) return;
  const gesture = selected(catalog.gestures, ui.gesture);
  const reaction = selected(catalog.reactions, ui.reaction);
  if (!gesture && !reaction) {
    plan = null;
    setStatus("Pick a Gesture, a Reaction or both.", true);
    return;
  }
  const from = ui.gestureFrom.value;
  const gestureClip = gesture ? await clipFor(gesture.spec, from) : null;
  const reactionClip = reaction ? await clipFor(reaction.spec) : null;
  // The Avatar changed while the clips loaded.
  if (current !== session) return;
  // Clips the new plan has no replacement for stop now.
  if (!gesture) current.avatar.stopClip();
  if (!reaction) current.stopReaction();
  const start = current.time;
  const gestureAt = start + seconds(ui.gestureDelay, 0);
  const reactionAt = start + seconds(ui.reactionDelay, 0);
  const gestureHold = gestureClip ? clipHold(gestureClip) : null;
  const hold = reactionClip ? reactionHold(reactionClip) : null;
  const fromTime = gesture?.beats.find(({ id }) => id === from)?.time ?? 0;
  plan = {
    gesture: gesture
      ? {
          clip: gestureClip,
          from: fromTime,
          at: gestureAt,
          stopAt:
            gestureHold === null
              ? null
              : gestureAt + Math.max(0, gestureHold - fromTime),
        }
      : null,
    reaction: reaction
      ? {
          clip: reactionClip,
          spec: reaction.spec,
          at: reactionAt,
          stopAt: hold === null ? null : reactionAt + hold,
        }
      : null,
    gestureStarted: false,
    gestureStopped: false,
    reactionStarted: false,
    reactionStopped: false,
    idleSince: null,
  };
  setStatus(
    [gesture?.name, reaction && reactionLabel(reaction)]
      .filter(Boolean)
      .join(" + "),
  );
}

function stop(): void {
  plan = null;
  session?.avatar.stopClip();
  session?.stopReaction();
}

/** Loop once both clips have ended and rested. */
function maybeLoop(): void {
  if (!plan || !session) return;
  const started =
    (!plan.gesture || plan.gestureStarted) &&
    (!plan.reaction || plan.reactionStarted);
  const idle =
    started && !session.avatar.isClipActive() && !session.isReactionActive();
  plan.idleSince = idle ? (plan.idleSince ?? session.time) : null;
  if (plan.idleSince === null || session.time - plan.idleSince < LOOP_REST_SEC)
    return;
  plan = null;
  if (ui.loop.checked) act(play)();
}

/** Turn one panel effect on or off on the open Avatar. */
async function setEffect(id: string, on: boolean): Promise<void> {
  const avatar = session?.avatar;
  const effect = panelEffects.get(id);
  if (!avatar || !effect) return;
  if (effect.kind === "avatar") {
    if (!on) return avatar.vfxController?.removeEffect(id);
    const applied = await applyAvatarVFXEffectById({
      avatar,
      effectId: effect.source.contentId,
      appliedEffectId: id,
      effectEntry: effectEntry(effect.source),
    });
    if (!applied)
      setStatus(`${effect.name} did not apply on this Avatar.`, true);
  } else if (!on) avatar.particleVFXController?.clearEffect(id);
  else if (
    !(await avatar.particleVFXController?.playEffect({
      effectId: effect.alias,
      appliedId: id,
    }))
  )
    setStatus(
      `${effect.name} did not play: ${avatar.particleVFXController?.getSnapshot().warnings.at(-1) ?? "no particle controller"}`,
      true,
    );
}

function buildEffectList(): void {
  panelEffects = new Map<string, PanelEffect>([
    ...catalog.avatarEffects.map((source): [string, PanelEffect] => [
      `combo:${source.contentId}`,
      {
        kind: "avatar",
        id: `combo:${source.contentId}`,
        name: source.name,
        source,
      },
    ]),
    ...catalog.particleEffects.map((particle): [string, PanelEffect] => [
      `combo:${particle.alias}`,
      {
        kind: "particle",
        id: `combo:${particle.alias}`,
        name: particle.name,
        alias: particle.alias,
      },
    ]),
  ]);
  effectRows = [...panelEffects.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((effect) => {
      const row = document.createElement("label");
      row.className = "effect";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.addEventListener("change", () => {
        if (box.checked) effectsOn.add(effect.id);
        else effectsOn.delete(effect.id);
        row.classList.toggle("is-on", box.checked);
        void setEffect(effect.id, box.checked);
      });
      const kind = document.createElement("span");
      kind.className = "effect-kind";
      kind.textContent = effect.kind === "avatar" ? "Avatar" : "Particle";
      row.append(box, document.createTextNode(effect.name), kind);
      return { effect, row };
    });
  ui.effects.replaceChildren(...effectRows.map(({ row }) => row));
  filterEffects();
}

function filterEffects(): void {
  const words = ui.effectFilter.value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  for (const { effect, row } of effectRows) {
    const text = `${effect.name} ${effect.id}`.toLowerCase();
    row.hidden =
      !words.every((word) => text.includes(word)) ||
      (ui.appliedOnly.checked && !effectsOn.has(effect.id));
  }
}

function clearEffects(): void {
  for (const id of effectsOn) void setEffect(id, false);
  effectsOn.clear();
  for (const { row } of effectRows) {
    row.classList.remove("is-on");
    row.querySelector("input")!.checked = false;
  }
  filterEffects();
}

function buildExpressionList(): void {
  const avatar = session!.avatar;
  const arkit = new Set(
    avatar.expressionController?.getArkitFaceCapability().resolved.keys() ?? [],
  );
  const names = avatar.getAvailableExpressions();
  // Weights for expressions another Avatar had would drive hidden shapes.
  for (const name of [...face.keys()])
    if (!names.includes(name)) face.delete(name);
  const groups: [string, string[]][] = [
    ["Expressions", names.filter((name) => !arkit.has(name))],
    ["ARKit shapes", names.filter((name) => arkit.has(name))],
  ];
  rows = [];
  const children: HTMLElement[] = [];
  for (const [title, list] of groups) {
    if (!list.length) continue;
    const heading = document.createElement("div");
    heading.className = "expression-heading";
    heading.textContent = `${title} (${list.length})`;
    children.push(heading);
    for (const name of list) {
      const row = document.createElement("label");
      row.className = "expression";
      const label = document.createElement("span");
      label.className = "expression-name";
      label.textContent = name;
      label.title = name;
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "1";
      slider.step = "0.01";
      slider.value = String(face.get(name) ?? 0);
      const value = document.createElement("span");
      value.className = "expression-value";
      const show = () => {
        const weight = Number(slider.value);
        value.textContent = weight ? weight.toFixed(2) : "";
        row.classList.toggle("is-set", weight > 0);
      };
      slider.addEventListener("input", () => {
        const weight = Number(slider.value);
        if (weight > 0) face.set(name, weight);
        else face.delete(name);
        show();
        applyFace();
      });
      show();
      row.append(label, slider, value);
      rows.push({ name, row, label });
      children.push(row);
    }
  }
  ui.expressions.replaceChildren(...children);
  filterExpressions();
}

function applyFace(): void {
  const controller = session?.avatar.expressionController;
  if (!controller) return;
  if (face.size)
    controller.setExpressionOverlay(FACE_OWNER, Object.fromEntries(face));
  else controller.clearExpressionOverlay(FACE_OWNER);
}

function filterExpressions(): void {
  const words = ui.expressionFilter.value
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const avatar = session?.avatar;
  for (const { name, row } of rows) {
    const matches = words.every((word) => name.toLowerCase().includes(word));
    const active =
      face.has(name) ||
      (avatar?.getExpressionValue(name) ?? 0) >= ACTIVE_WEIGHT;
    row.hidden = !matches || (ui.activeOnly.checked && !active);
  }
}

function updateMeters(): void {
  const avatar = session?.avatar;
  if (!avatar) return;
  for (const { name, label, row } of rows)
    if (!row.hidden || ui.activeOnly.checked)
      label.style.setProperty(
        "--live",
        String(THREE.MathUtils.clamp(avatar.getExpressionValue(name), 0, 1)),
      );
}

/** The current setup as an `animation:reel` cue sheet take. */
function cueSheet(): object {
  const gesture = selected(catalog.gestures, ui.gesture);
  const reaction = selected(catalog.reactions, ui.reaction);
  const avatar = currentAvatar();
  const gestureAt = seconds(ui.gestureDelay, 0);
  const reactionAt = seconds(ui.reactionDelay, 0);
  const from = ui.gestureFrom.value;
  const reactionClip = reaction ? clips.get(`${reaction.spec}#`) : null;
  const hold = reactionClip ? reactionHold(reactionClip) : null;
  const gestureClip = gesture ? clips.get(`${gesture.spec}#${from}`) : null;
  const fromTime = gesture?.beats.find(({ id }) => id === from)?.time ?? 0;
  const gestureHold = gestureClip ? clipHold(gestureClip) : null;
  const gestureEnd = gesture
    ? gestureAt +
      (gestureHold === null
        ? gesture.duration - fromTime
        : Math.max(0, gestureHold - fromTime))
    : 0;
  const end = Math.max(
    gestureEnd,
    reaction ? reactionAt + (hold ?? reaction.duration) : 0,
    1,
  );
  const round = (value: number) => Math.round(value * 1000) / 1000;
  const camera = CAMERAS[ui.camera.value] ?? ui.camera.value;
  return {
    title: [gesture?.name, reaction && reactionLabel(reaction)]
      .filter(Boolean)
      .join(" + "),
    avatar: avatar.sheet,
    camera,
    duration: round(end + 0.5),
    cues: [
      ...(gesture
        ? [
            {
              gesture: gesture.spec,
              at: round(gestureAt),
              ...(from ? { from } : {}),
            },
          ]
        : []),
      ...(reaction
        ? [
            {
              reaction: reaction.spec,
              at: round(reactionAt),
              ...(seconds(ui.reactionHold, -1) >= MIN_HOLD_SEC && hold !== null
                ? { until: round(reactionAt + hold) }
                : {}),
            },
          ]
        : []),
      ...(face.size
        ? [
            {
              face: Object.fromEntries(face),
              at: 0,
              until: round(end + 0.5),
              fade: 0,
            },
          ]
        : []),
    ],
  };
}

async function copySheet(): Promise<void> {
  const gesture = selected(catalog.gestures, ui.gesture);
  const reaction = selected(catalog.reactions, ui.reaction);
  if (!gesture && !reaction && !face.size) {
    setStatus("Pick a Gesture, a Reaction or a face weight first.", true);
    return;
  }
  // Load the clips, so their default holds are known.
  if (gesture) await clipFor(gesture.spec, ui.gestureFrom.value);
  if (reaction) await clipFor(reaction.spec);
  const text = `${JSON.stringify(cueSheet(), null, 2)}\n`;
  ui.sheet.hidden = false;
  ui.sheet.value = text;
  const left = effectsOn.size
    ? " Ticked effects are not part of cue sheets."
    : "";
  try {
    await navigator.clipboard.writeText(text);
    setStatus(`Copied the cue sheet take.${left}`);
  } catch {
    ui.sheet.select();
    setStatus(`Select the cue sheet below and copy it.${left}`);
  }
}

let busy = false;
let last = performance.now();
let frames = 0;
/**
 * Advance to wall-clock time at any display rate: the clock keeps the part
 * of a frame each tick leaves over (`advanceTo` steps whole 60 Hz frames).
 */
function tick(now: number): void {
  requestAnimationFrame(tick);
  const delta = Math.min(MAX_TICK_SEC, (now - last) / 1000);
  last = now;
  const current = session;
  if (!current) return;
  clock = Math.min(clock + delta, current.time + MAX_BACKLOG_SEC);
  if (busy) return;
  busy = true;
  void current
    .advanceTo(clock)
    .then(async () => {
      if (current !== session) return;
      const view = views.get(ui.camera.value);
      if (view) placeReelCamera(stage.camera, current.avatar, view, stage.size);
      stage.renderer.render(stage.scene, stage.camera);
      await stage.review.seek(current.time);
      maybeLoop();
      updateMeters();
      frames += 1;
      if (ui.activeOnly.checked && frames % 6 === 0) filterExpressions();
    })
    .catch((error: unknown) => setStatus(errorText(error), true))
    .finally(() => {
      busy = false;
    });
}

async function start(): Promise<void> {
  catalog = await fetchJson<Catalog>("/__combo/catalog");
  // By index: two Avatar files may share a name.
  ui.avatar.replaceChildren(
    ...catalog.avatars.map(({ id }, index) => new Option(id, String(index))),
  );
  fillPicker(ui.gesture, catalog.gestures, "", (entry) => entry.name);
  fillPicker(ui.reaction, catalog.reactions, "", reactionLabel);
  fillGestureFrom();
  buildEffectList();
  buildStage();
  ui.gestureFilter.addEventListener("input", () => {
    fillPicker(
      ui.gesture,
      catalog.gestures,
      ui.gestureFilter.value,
      (entry) => entry.name,
    );
    fillGestureFrom();
  });
  ui.reactionFilter.addEventListener("input", () =>
    fillPicker(
      ui.reaction,
      catalog.reactions,
      ui.reactionFilter.value,
      reactionLabel,
    ),
  );
  ui.gesture.addEventListener("change", fillGestureFrom);
  ui.gesture.addEventListener("dblclick", act(play));
  ui.reaction.addEventListener("dblclick", act(play));
  ui.avatar.addEventListener("change", act(openAvatar));
  ui.backdrop.addEventListener("change", applyBackdrop);
  ui.play.addEventListener("click", act(play));
  ui.stop.addEventListener("click", stop);
  ui.copy.addEventListener("click", act(copySheet));
  ui.resetFace.addEventListener("click", () => {
    face.clear();
    applyFace();
    buildExpressionList();
  });
  ui.effectFilter.addEventListener("input", filterEffects);
  ui.appliedOnly.addEventListener("change", filterEffects);
  ui.clearEffects.addEventListener("click", clearEffects);
  ui.expressionFilter.addEventListener("input", filterExpressions);
  ui.activeOnly.addEventListener("change", filterExpressions);
  // Frames run from the start, so picking another Avatar after a failed
  // load still shows it.
  requestAnimationFrame(tick);
  await openAvatar();
}

declare global {
  interface Window {
    comboReady?: boolean;
    /** Playback state, for tests. */
    comboState?: () => {
      time: number;
      gesture: boolean;
      reaction: boolean;
      avatarsOnStage: number;
    } | null;
  }
}

window.comboState = () =>
  session
    ? {
        time: session.time,
        gesture: session.avatar.isClipActive(),
        reaction: session.isReactionActive(),
        // The stage holds its lights and the Avatars' scenes.
        avatarsOnStage: stage.scene.children.filter(
          (child) => !(child instanceof THREE.Light),
        ).length,
      }
    : null;

start()
  .then(() => {
    window.comboReady = true;
  })
  .catch((error: unknown) => setStatus(errorText(error), true));
