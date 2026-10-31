import * as THREE from "three";

import { parseAnimaPoseClip } from "@/lib/avatar/poses/animaPoseClip";

import {
  cameraView,
  placeReelCamera,
  type ReelCamera,
  type ReelCameraView,
} from "../animation-reel/camera";
import { ReviewStage, TILE_BACKDROP } from "../effect-render/reviewStage";
import { EffectSession, type PageClipMedia } from "../effect-render/session";
import { createStage } from "../effect-render/stage";
import { STAGE_STOPS } from "../landing-stage/stops";

/**
 * Combo page (served by `scripts/animation-combo.mjs`): plays a Library
 * Gesture and Reaction together on an Avatar in real time, the way the reel
 * recorder plays a cue sheet take (`../animation-reel/reel.ts`): the Gesture
 * on the clip player, the Reaction on the reaction layer, both with their
 * effects. The expression panel lists every expression and ARKit shape the
 * Avatar has, shows each one's live weight, and adds slider weights over the
 * face (an expression overlay, as a cue sheet's face cue adds them). "Copy
 * cue sheet" turns the current setup into a take for `animation:reel`.
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
  avatars: { id: string; url: string; file: string }[];
  gestures: PickerEntry[];
  reactions: PickerEntry[];
  media: PageClipMedia;
};

/** The pickers' cameras by option value; `medium` is not a preset name. */
const CAMERAS: Record<string, ReelCamera> = {
  // The landing close-up through a wider lens, its lens shift scaled to
  // match, so the close-up is a centred 1.36x crop of it.
  medium: { fov: 40, lift: 0.0442 },
};
/** Seconds a talking-scoped Reaction is held when Hold is blank, as the reel's `--talk`. */
const TALK_SEC = 3;
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
  sheet: byId<HTMLTextAreaElement>("sheet"),
};

let catalog: Catalog;
const clips = new Map<string, unknown>();
let stage: ReturnType<typeof createStage> & {
  review: ReviewStage;
  size: { width: number; height: number };
};
let session: EffectSession | null = null;
/** Each camera's framing for the open Avatar, taken as it stands at rest. */
let views = new Map<string, ReelCameraView>();
/** Slider weights by expression name. */
const face = new Map<string, number>();
let rows: { name: string; row: HTMLElement; label: HTMLElement }[] = [];

/** What Play scheduled, on the session clock. */
let plan: {
  gesture: { clip: unknown; from: number; at: number } | null;
  reaction: {
    clip: unknown;
    spec: string;
    at: number;
    stopAt: number | null;
  } | null;
  gestureStarted: boolean;
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

async function clipFor(spec: string): Promise<unknown> {
  if (!clips.has(spec))
    clips.set(
      spec,
      await fetchJson(`/__combo/clip?spec=${encodeURIComponent(spec)}`),
    );
  return clips.get(spec);
}

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
    ...(gesture?.beats ?? [])
      .filter((beat) => beat.time > 0)
      .map((beat) => new Option(`${beat.label} (${beat.time} s)`, beat.id)),
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
  const avatar = catalog.avatars.find(({ id }) => id === ui.avatar.value)!;
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
    },
    stage.review,
  );
  stage.review.attachCanvas(stage.renderer.domElement, next.avatar);
  stage.scene.add(next.avatar.scene!);
  await next.apply({ effects: [] });
  next.setFrameHook(frameHook);
  views = new Map(
    [...ui.camera.options].map(({ value }) => [
      value,
      cameraView(next.avatar, CAMERAS[value] ?? value, stage.size),
    ]),
  );
  session = next;
  buildExpressionList();
  applyFace();
  setStatus(`${avatar.id} ready.`);
}

/** Start and stop the planned clips due at session time `time`. */
function frameHook(time: number): void {
  if (!plan || !session) return;
  const due = time + 1e-6;
  if (plan.gesture && !plan.gestureStarted && plan.gesture.at <= due) {
    session.playGesture(plan.gesture.clip, plan.gesture.from);
    plan.gestureStarted = true;
  }
  const reaction = plan.reaction;
  if (reaction && !plan.reactionStarted && reaction.at <= due) {
    session.playReaction(reaction.clip, reaction.spec);
    plan.reactionStarted = true;
  }
  if (
    reaction &&
    plan.reactionStarted &&
    !plan.reactionStopped &&
    reaction.stopAt !== null &&
    reaction.stopAt <= due
  ) {
    session.stopReaction();
    plan.reactionStopped = true;
  }
}

const seconds = (input: HTMLInputElement, fallback: number) => {
  const value = Number(input.value);
  return input.value !== "" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
};

/**
 * How long a Reaction plays before it is stopped: Hold, or for a
 * talking-scoped one `TALK_SEC` and its timed events, as the reel holds it;
 * null for one that ends by itself.
 */
function reactionHold(clip: unknown): number | null {
  if (ui.reactionHold.value !== "") return seconds(ui.reactionHold, TALK_SEC);
  const parsed = parseAnimaPoseClip(clip);
  if (!parsed.playback) return parsed.loop ? parsed.duration : null;
  const eventsEnd = Math.max(
    0,
    ...(parsed.events ?? []).map(
      (event) => event.time + ("duration" in event ? (event.duration ?? 0) : 0),
    ),
  );
  return Math.max(TALK_SEC, parsed.duration, eventsEnd);
}

async function play(): Promise<void> {
  if (!session) return;
  const gesture = selected(catalog.gestures, ui.gesture);
  const reaction = selected(catalog.reactions, ui.reaction);
  if (!gesture && !reaction) {
    setStatus("Pick a Gesture, a Reaction or both.", true);
    return;
  }
  const start = session.time;
  const beat = gesture?.beats.find(({ id }) => id === ui.gestureFrom.value);
  const reactionClip = reaction ? await clipFor(reaction.spec) : null;
  const reactionAt = start + seconds(ui.reactionDelay, 0);
  const hold = reactionClip ? reactionHold(reactionClip) : null;
  plan = {
    gesture: gesture
      ? {
          clip: await clipFor(gesture.spec),
          from: beat?.time ?? 0,
          at: start + seconds(ui.gestureDelay, 0),
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
  if (ui.loop.checked) void play();
  else plan = null;
}

function buildExpressionList(): void {
  const avatar = session!.avatar;
  const arkit = new Set(
    avatar.expressionController?.getArkitFaceCapability().resolved.keys() ?? [],
  );
  const names = avatar.getAvailableExpressions();
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
  const avatar = catalog.avatars.find(({ id }) => id === ui.avatar.value)!;
  const gestureAt = seconds(ui.gestureDelay, 0);
  const reactionAt = seconds(ui.reactionDelay, 0);
  const from = ui.gestureFrom.value;
  const reactionClip = reaction ? clips.get(reaction.spec) : null;
  const hold = reactionClip ? reactionHold(reactionClip) : null;
  const gestureEnd = gesture
    ? gestureAt +
      gesture.duration -
      (gesture.beats.find(({ id }) => id === from)?.time ?? 0)
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
    avatar: avatar.file,
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
              ...(ui.reactionHold.value !== "" && hold !== null
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
  // Load the Reaction's clip, so its default hold is known.
  const reaction = selected(catalog.reactions, ui.reaction);
  if (reaction) await clipFor(reaction.spec);
  const text = `${JSON.stringify(cueSheet(), null, 2)}\n`;
  ui.sheet.hidden = false;
  ui.sheet.value = text;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("Copied the cue sheet take.");
  } catch {
    ui.sheet.select();
    setStatus("Select the cue sheet below and copy it.");
  }
}

let busy = false;
let last = performance.now();
let frames = 0;
function tick(now: number): void {
  requestAnimationFrame(tick);
  const current = session;
  if (!current || busy) {
    last = now;
    return;
  }
  busy = true;
  const delta = Math.min(0.1, (now - last) / 1000);
  last = now;
  void current
    .advanceTo(current.time + delta)
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
    .catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : String(error), true),
    )
    .finally(() => {
      busy = false;
    });
}

async function start(): Promise<void> {
  catalog = await fetchJson<Catalog>("/__combo/catalog");
  ui.avatar.replaceChildren(
    ...catalog.avatars.map(({ id }) => new Option(id, id)),
  );
  fillPicker(ui.gesture, catalog.gestures, "", (entry) => entry.name);
  fillPicker(ui.reaction, catalog.reactions, "", reactionLabel);
  fillGestureFrom();
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
  ui.gesture.addEventListener("dblclick", () => void play());
  ui.reaction.addEventListener("dblclick", () => void play());
  ui.avatar.addEventListener("change", () =>
    openAvatar().catch((error: unknown) =>
      setStatus(error instanceof Error ? error.message : String(error), true),
    ),
  );
  ui.backdrop.addEventListener("change", applyBackdrop);
  ui.play.addEventListener("click", () => void play());
  ui.stop.addEventListener("click", stop);
  ui.copy.addEventListener("click", () => void copySheet());
  ui.resetFace.addEventListener("click", () => {
    face.clear();
    applyFace();
    buildExpressionList();
  });
  ui.expressionFilter.addEventListener("input", filterExpressions);
  ui.activeOnly.addEventListener("change", filterExpressions);
  await openAvatar();
  requestAnimationFrame(tick);
}

declare global {
  interface Window {
    comboReady?: boolean;
  }
}

start()
  .then(() => {
    window.comboReady = true;
  })
  .catch((error: unknown) =>
    setStatus(error instanceof Error ? error.message : String(error), true),
  );
