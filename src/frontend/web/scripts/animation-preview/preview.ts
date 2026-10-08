import * as THREE from "three";

import { Avatar } from "@/lib/avatar";
import { BUILT_IN_AVATAR_MOTION_CATALOG } from "@/lib/avatar/motion/AvatarMotionCatalog";
import type { ProceduralAnimationLayerId } from "@/lib/avatar/proc-animation/types";
import type { PreviewState } from "@/lib/avatar/motion-authoring/preview/previewSession";
import {
  REVIEW_REGIONS,
  REVIEW_REGION_LABELS,
} from "@/lib/avatar/motion-authoring/preview/reviewRegions";
import type {
  PreviewChoice,
  PreviewClip,
} from "@/lib/avatar/motion-authoring/preview/sources";
import { EMPTY_RUNTIME_MEDIA_PROVIDER } from "@/lib/runtime-content/AnimaRuntimeMediaCatalog";

/**
 * Motion preview page (served by `scripts/animation-preview.mjs`). Each row
 * plays one source on both Included Avatars through the app's own `Avatar`
 * playback, so fades, live-layer mutes and expression precedence look as they
 * do in chat. The page keeps one playback clock for all rows. The Review and
 * Compare pickers switch the server to other listed sources.
 */

type ServerState = PreviewState & { avatars: { id: string; url: string }[] };
type CameraPreset = "front" | "threeQuarter" | "side" | "face";

type RowView = {
  key: string;
  label: string;
  /** The clip file; a different path means another source was picked. */
  path: string;
  clip: PreviewClip | null;
  version: string | null;
};

type Cell = {
  rowKey: string;
  avatarId: string;
  avatar: Avatar;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Rest head height, which frames every camera preset. */
  headHeight: number;
  label: HTMLDivElement;
  playingVersion: string | null;
  /** Which live layers the Avatar enables by default. */
  layerDefaults: Map<ProceduralAnimationLayerId, boolean>;
};

const FRAME = 1 / 30;

const element = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const ui = {
  status: element<HTMLSpanElement>("status"),
  pickSource: element<HTMLSelectElement>("pick-source"),
  pickCompare: element<HTMLSelectElement>("pick-compare"),
  errors: element<HTMLDivElement>("errors"),
  views: element<HTMLDivElement>("views"),
  canvas: element<HTMLCanvasElement>("canvas"),
  labels: element<HTMLDivElement>("labels"),
  play: element<HTMLButtonElement>("play"),
  restart: element<HTMLButtonElement>("restart"),
  stepBack: element<HTMLButtonElement>("step-back"),
  stepForward: element<HTMLButtonElement>("step-forward"),
  loop: element<HTMLInputElement>("loop"),
  speed: element<HTMLSelectElement>("speed"),
  time: element<HTMLSpanElement>("time"),
  cameras: element<HTMLDivElement>("cameras"),
  liveLayers: element<HTMLInputElement>("live-layers"),
  previous: element<HTMLInputElement>("previous"),
  scrubber: element<HTMLInputElement>("scrubber"),
  markers: element<HTMLDivElement>("markers"),
  notesFile: element<HTMLParagraphElement>("notes-file"),
  noteForm: element<HTMLFormElement>("note-form"),
  noteText: element<HTMLTextAreaElement>("note-text"),
  notePin: element<HTMLSelectElement>("note-pin"),
  noteRegion: element<HTMLSelectElement>("note-region"),
  noteError: element<HTMLParagraphElement>("note-error"),
  notesList: element<HTMLOListElement>("notes-list"),
};

const renderer = new THREE.WebGLRenderer({
  canvas: ui.canvas,
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setScissorTest(true);

const playback = {
  time: 0,
  playing: true,
  speed: 1,
  camera: "front" as CameraPreset,
};
let server: ServerState | null = null;
let rows: RowView[] = [];
let previousRow: RowView | null = null;
let cells: Cell[] = [];
const clock = new THREE.Clock();

// ── Rows and Avatars ─────────────────────────────────────────────────────

/** The longest row's length: a one-shot includes its fade-out. */
function totalDuration(): number {
  return Math.max(
    0.001,
    ...rows.map(({ clip }) =>
      clip ? clip.duration + (clip.loop ? 0 : clip.fadeOut) : 0,
    ),
  );
}

function rowEnd(row: RowView | undefined): number {
  if (!row?.clip) return 0;
  return row.clip.duration + (row.clip.loop ? 0 : row.clip.fadeOut);
}

async function createCell(row: RowView, avatarId: string, url: string) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf4f3ef);
  scene.add(new THREE.AmbientLight(0xffffff, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(1, 2, 2);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  const avatar = new Avatar(camera, ui.canvas, {
    motionCatalog: BUILT_IN_AVATAR_MOTION_CATALOG,
    mediaCatalog: EMPTY_RUNTIME_MEDIA_PROVIDER,
  });
  await avatar.load({ filePath: url });
  if (!avatar.scene || !avatar.vrm) throw new Error(`Cannot load ${avatarId}.`);
  scene.add(avatar.scene);
  avatar.update(0);
  const head = avatar.vrm.humanoid
    .getRawBoneNode("head")!
    .getWorldPosition(new THREE.Vector3());
  const label = document.createElement("div");
  label.className = "view-label";
  ui.labels.append(label);
  const cell: Cell = {
    rowKey: row.key,
    avatarId,
    avatar,
    scene,
    camera,
    headHeight: head.y,
    label,
    playingVersion: null,
    layerDefaults: new Map(
      avatar
        .getProceduralAnimationSnapshot()
        ?.layers.map(({ id, enabled }) => [id, enabled]) ?? [],
    ),
  };
  applyLiveLayers(cell);
  return cell;
}

/** Create or dispose cells so there is one per visible row and Avatar. */
async function syncCells() {
  if (!server) return;
  const visible = visibleRows();
  const keep = new Set(visible.map(({ key }) => key));
  for (const cell of cells.filter(({ rowKey }) => !keep.has(rowKey))) {
    cell.avatar.dispose();
    cell.label.remove();
  }
  cells = cells.filter(({ rowKey }) => keep.has(rowKey));
  for (const row of visible)
    for (const { id, url } of server.avatars)
      if (
        !cells.some((cell) => cell.rowKey === row.key && cell.avatarId === id)
      )
        cells.push(await createCell(row, id, url));
  // Keep row order, then Avatar order, as the grid draws them.
  const order = visible.map(({ key }) => key);
  const avatarOrder = server.avatars.map(({ id }) => id);
  cells.sort(
    (a, b) =>
      order.indexOf(a.rowKey) - order.indexOf(b.rowKey) ||
      avatarOrder.indexOf(a.avatarId) - avatarOrder.indexOf(b.avatarId),
  );
}

function visibleRows(): RowView[] {
  return previousRow && ui.previous.checked ? [...rows, previousRow] : rows;
}

function rowFor(cell: Cell) {
  return visibleRows().find(({ key }) => key === cell.rowKey);
}

/** (Re)start a cell's clip from the beginning, then move it to `time`. */
function startCell(cell: Cell, time: number) {
  const row = rowFor(cell);
  cell.avatar.stopClip({ transition: { mode: "fadeOut", durationSec: 0 } });
  cell.playingVersion = null;
  if (!row?.clip) return;
  cell.avatar.playAnimaPoseClip(row.clip.clip, {
    preserveProceduralOffsets: true,
  });
  cell.playingVersion = row.version;
  if (time > 0) seekCell(cell, time);
}

function seekCell(cell: Cell, time: number) {
  const row = rowFor(cell);
  if (!cell.avatar.isClipActive()) startCell(cell, 0);
  // A loop wraps on its own clock; a one-shot holds its end once finished.
  cell.avatar.seekPoseClip(
    row?.clip?.loop ? time : Math.min(time, Math.max(0, rowEnd(row) - 1e-4)),
  );
}

function seekAll(time: number) {
  playback.time = Math.min(Math.max(0, time), totalDuration());
  for (const cell of cells) seekCell(cell, playback.time);
  showTime();
}

function restartAll() {
  playback.time = 0;
  for (const cell of cells) startCell(cell, 0);
  showTime();
}

function applyLiveLayers(cell: Cell) {
  for (const [id, enabled] of cell.layerDefaults)
    cell.avatar.setProceduralAnimationLayerEnabled(
      id,
      ui.liveLayers.checked && enabled,
    );
}

// ── Frame loop ──────────────────────────────────────────────────────────

function advance(delta: number) {
  const total = totalDuration();
  const step = delta * playback.speed;
  playback.time += step;
  if (playback.time >= total) {
    if (!ui.loop.checked) {
      playback.playing = false;
      seekAll(total);
      updatePlayButton();
      return;
    }
    // Looping clips continue seamlessly; one-shots restart from the top.
    if (!rows.every(({ clip }) => clip?.loop)) return restartAll();
    // Re-align shorter loops with the wrapped playhead.
    return seekAll(playback.time - total);
  }
  for (const cell of cells) cell.avatar.update(step);
  showTime();
}

function render() {
  const width = ui.views.clientWidth;
  const height = ui.views.clientHeight;
  renderer.setSize(width, height, false);
  const visible = visibleRows();
  const columns = server?.avatars.length ?? 2;
  const cellWidth = width / columns;
  const cellHeight = height / Math.max(1, visible.length);
  cells.forEach((cell) => {
    const row = visible.findIndex(({ key }) => key === cell.rowKey);
    const column =
      server?.avatars.findIndex(({ id }) => id === cell.avatarId) ?? 0;
    const x = column * cellWidth;
    const y = height - (row + 1) * cellHeight;
    renderer.setViewport(x, y, cellWidth, cellHeight);
    renderer.setScissor(x, y, cellWidth, cellHeight);
    cell.camera.aspect = cellWidth / cellHeight;
    placeCamera(cell);
    renderer.render(cell.scene, cell.camera);
    cell.label.style.left = `${x + 6}px`;
    cell.label.style.top = `${row * cellHeight + 6}px`;
    cell.label.textContent = `${cell.avatarId.replace("AvatarSample_", "")} · ${visible[row]?.label ?? ""}`;
  });
}

function placeCamera(cell: Cell) {
  const { camera, headHeight } = cell;
  if (playback.camera === "face") {
    const face = cell.avatar
      .vrm!.humanoid.getRawBoneNode("head")!
      .getWorldPosition(new THREE.Vector3())
      .add(new THREE.Vector3(0, headHeight * 0.04, 0));
    camera.position.set(face.x, face.y, face.z + headHeight * 0.55);
    camera.lookAt(face);
  } else {
    // The Avatar faces +Z; ¾ and side views look from its own right.
    const angle = { front: 0, threeQuarter: -Math.PI / 4, side: -Math.PI / 2 }[
      playback.camera
    ];
    const distance = headHeight * 2.9;
    const target = new THREE.Vector3(0, headHeight * 0.55, 0);
    camera.position.set(
      Math.sin(angle) * distance,
      target.y + headHeight * 0.1,
      Math.cos(angle) * distance,
    );
    camera.lookAt(target);
  }
  camera.updateProjectionMatrix();
}

function frame() {
  const delta = Math.min(clock.getDelta(), 0.1);
  if (playback.playing && cells.length > 0) advance(delta);
  render();
  requestAnimationFrame(frame);
}

// ── Transport and markers ───────────────────────────────────────────────

function showTime() {
  const total = totalDuration();
  ui.time.textContent = `${playback.time.toFixed(2)} / ${total.toFixed(2)} s`;
  ui.scrubber.max = String(total);
  ui.scrubber.value = String(playback.time);
  window.animationPreview.time = playback.time;
}

function updatePlayButton() {
  ui.play.textContent = playback.playing ? "Pause" : "Play";
  ui.play.setAttribute("aria-label", playback.playing ? "Pause" : "Play");
}

function renderMarkers() {
  ui.markers.replaceChildren();
  const total = totalDuration();
  for (const marker of rows[0]?.clip?.markers ?? []) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "marker";
    button.style.left = `${(marker.time / total) * 100}%`;
    button.textContent = marker.label;
    button.title = `${marker.label} · ${marker.time.toFixed(2)} s`;
    button.addEventListener("click", () => {
      playback.playing = false;
      updatePlayButton();
      seekAll(marker.time);
    });
    ui.markers.append(button);
  }
}

ui.play.addEventListener("click", () => {
  playback.playing = !playback.playing;
  if (playback.playing && playback.time >= totalDuration() - 1e-3) restartAll();
  clock.getDelta();
  updatePlayButton();
});
ui.restart.addEventListener("click", () => {
  restartAll();
  playback.playing = true;
  updatePlayButton();
});
const step = (direction: number) => {
  playback.playing = false;
  updatePlayButton();
  seekAll(playback.time + direction * FRAME);
};
ui.stepBack.addEventListener("click", () => step(-1));
ui.stepForward.addEventListener("click", () => step(1));
ui.speed.addEventListener("change", () => {
  playback.speed = Number(ui.speed.value);
});
ui.scrubber.addEventListener("input", () => {
  playback.playing = false;
  updatePlayButton();
  seekAll(Number(ui.scrubber.value));
});
ui.cameras.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (!button?.dataset.camera) return;
  playback.camera = button.dataset.camera as CameraPreset;
  for (const other of ui.cameras.querySelectorAll("button"))
    other.setAttribute("aria-pressed", String(other === button));
});
ui.liveLayers.addEventListener("change", () => cells.forEach(applyLiveLayers));
ui.previous.addEventListener("change", () => {
  // Through the state queue, so cells are never synced twice at once. A
  // failure is shown and must not stop later state updates.
  applying = applying
    .then(async () => {
      await syncCells();
      seekAll(playback.time);
    })
    .catch(showError);
});

// ── Review notes ────────────────────────────────────────────────────────

ui.noteRegion.append(new Option("Whole body", ""));
for (const region of REVIEW_REGIONS)
  ui.noteRegion.append(new Option(REVIEW_REGION_LABELS[region], region));

/** Pin choices: the playhead, or a beat (keyframe) of the reviewed clip. */
function renderPinOptions() {
  const selected = ui.notePin.value;
  ui.notePin.replaceChildren(
    new Option(`Playhead (${playback.time.toFixed(2)} s)`, "playhead"),
  );
  for (const marker of rows[0]?.clip?.markers ?? [])
    ui.notePin.append(
      new Option(`${marker.label} (${marker.time.toFixed(2)} s)`, marker.id),
    );
  if ([...ui.notePin.options].some(({ value }) => value === selected))
    ui.notePin.value = selected;
}
ui.notePin.addEventListener("focus", renderPinOptions);

ui.noteForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const marker = rows[0]?.clip?.markers.find(
    ({ id }) => id === ui.notePin.value,
  );
  const body = {
    time: marker ? marker.time : Number(playback.time.toFixed(3)),
    ...(marker
      ? {
          beat:
            rows[0]?.clip?.format === "animaPoseClip/2.0"
              ? marker.id
              : marker.label,
        }
      : {}),
    ...(ui.noteRegion.value ? { region: ui.noteRegion.value } : {}),
    text: ui.noteText.value,
  };
  const response = await fetch("/__preview/notes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  ui.noteError.hidden = response.ok;
  if (!response.ok) {
    ui.noteError.textContent = result.error;
    return;
  }
  ui.noteText.value = "";
  await applyState(result);
});

function renderNotes() {
  const review = server?.review;
  ui.notesFile.textContent = review
    ? `Saved to ${review.path}${review.error ? ` — ${review.error}` : ""}`
    : "";
  const notes = [...(review?.sidecar?.notes ?? [])].sort(
    (a, b) => a.time - b.time,
  );
  ui.notesList.replaceChildren(
    ...notes.map((note) => {
      const item = document.createElement("li");
      item.className = "note";
      const head = document.createElement("div");
      head.className = "note-head";
      head.textContent = [
        `${note.time.toFixed(2)} s`,
        // A 2.0 note names its beat by id; show the beat's label.
        rows[0]?.clip?.markers.find(({ id }) => id === note.beat)?.label ??
          note.beat,
        note.region ? REVIEW_REGION_LABELS[note.region] : null,
      ]
        .filter(Boolean)
        .join(" · ");
      const status = document.createElement("span");
      status.className = `note-status ${note.status}`;
      status.textContent = note.status === "open" ? "Open" : "Resolved";
      head.append(status);
      if (note.status === "open") {
        const remove = document.createElement("button");
        remove.type = "button";
        remove.textContent = "Delete";
        remove.className = "small";
        remove.addEventListener("click", async (event) => {
          event.stopPropagation();
          const response = await fetch(
            `/__preview/notes/${encodeURIComponent(note.id)}`,
            { method: "DELETE" },
          );
          if (response.ok) await applyState(await response.json());
        });
        head.append(remove);
      }
      const text = document.createElement("p");
      text.textContent = note.text;
      item.append(head, text);
      if (note.resolution) {
        const resolution = document.createElement("p");
        resolution.className = "resolution";
        resolution.textContent = note.resolution;
        item.append(resolution);
      }
      item.addEventListener("click", () => {
        playback.playing = false;
        updatePlayButton();
        seekAll(note.time);
      });
      return item;
    }),
  );
}

// ── Source pickers ──────────────────────────────────────────────────────

let choices: PreviewChoice[] = [];

/** Fill a picker with the choices, grouped as the server lists them. */
function fillPicker(select: HTMLSelectElement, none: string | null) {
  select.replaceChildren();
  if (none) select.append(new Option(none, ""));
  const groups = new Map<string, HTMLOptGroupElement>();
  for (const choice of choices) {
    let group = groups.get(choice.group);
    if (!group) {
      group = document.createElement("optgroup");
      group.label = choice.group;
      groups.set(choice.group, group);
      select.append(group);
    }
    group.append(new Option(choice.label, choice.spec));
  }
}

/** Show the playing sources in the pickers. */
function showSelection() {
  const specFor = (row: RowView | undefined) =>
    choices.find(({ path }) => path === row?.path)?.spec ?? "";
  ui.pickSource.value = specFor(rows[0]);
  ui.pickCompare.value = specFor(rows[1]);
}

async function loadChoices() {
  const response = await fetch("/__preview/choices");
  if (!response.ok) return;
  choices = await response.json();
  fillPicker(ui.pickSource, null);
  fillPicker(ui.pickCompare, "None");
  showSelection();
}

/** Ask the server to play the picked sources. */
async function pick() {
  ui.status.textContent = "Loading…";
  const response = await fetch("/__preview/select", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: ui.pickSource.value,
      compare: ui.pickCompare.value || null,
    }),
  });
  const result = await response.json();
  if (!response.ok) {
    showSelection();
    showError(new Error(result.error));
    return;
  }
  await applyState(result);
}
ui.pickSource.addEventListener("change", () => void pick());
ui.pickCompare.addEventListener("change", () => void pick());
// New clips or Library items appear when the page regains focus.
window.addEventListener("focus", () => void loadChoices());

// ── Server state ────────────────────────────────────────────────────────

async function fetchState(): Promise<ServerState> {
  const response = await fetch("/__preview/state");
  if (!response.ok) throw new Error(`State request failed: ${response.status}`);
  return response.json();
}

/**
 * The earlier version to compare with: the one the latest note was made
 * against (what the owner last reviewed), or else the retained version
 * before the current one.
 */
async function loadPreviousRow(state: ServerState): Promise<RowView | null> {
  const sidecar = state.review.sidecar;
  const versions = sidecar?.versions ?? [];
  const current = state.rows[0]?.version;
  const latestNote = [...(sidecar?.notes ?? [])]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1);
  const index = versions.findIndex(({ id }) => id === current);
  const previous =
    versions.find(({ id }) => id === latestNote?.version && id !== current) ??
    (index > 0 ? versions[index - 1] : null);
  if (!previous) return null;
  if (previousRow?.version === previous.id) return previousRow;
  const response = await fetch(`/__preview/versions/${previous.id}`);
  if (!response.ok) return null;
  return {
    key: "previous",
    path: "",
    label: `${previous.id === latestNote?.version ? "Reviewed" : "Previous"} version (${new Date(previous.savedAt).toLocaleTimeString()})`,
    clip: await response.json(),
    version: previous.id,
  };
}

/** Apply server state, one update at a time (Avatars load asynchronously). */
let applying: Promise<void> = Promise.resolve();
function applyState(state: ServerState): Promise<void> {
  const next = applying.then(() => applyStateNow(state));
  applying = next.catch(() => undefined);
  return next;
}

async function applyStateNow(state: ServerState) {
  // An older state can arrive after a newer one; keep the newer.
  if (server && state.generation < server.generation) return;
  server = state;
  const before = rows.map(({ path }) => path).join("\n");
  rows = state.rows.map((row) => ({
    key: row.role,
    label: row.label,
    path: row.path,
    clip: row.clip,
    version: row.version,
  }));
  // Another source was picked: start it from the top.
  const switched =
    before !== "" && before !== rows.map(({ path }) => path).join("\n");
  if (switched) {
    playback.time = 0;
    ui.previous.checked = false;
  }
  showSelection();
  previousRow = await loadPreviousRow(state);
  ui.previous.disabled = !previousRow;
  if (!previousRow) ui.previous.checked = false;
  const problems = state.rows.filter(({ error }) => error);
  ui.errors.hidden = problems.length === 0;
  ui.errors.textContent = problems
    .map(({ label, error }) =>
      [
        `${label}: ${error!.message}`,
        ...error!.issues.map(({ path, message }) => `  ${path}: ${message}`),
      ].join("\n"),
    )
    .join("\n\n");
  await syncCells();
  // Restart any row whose source changed, keeping the playhead.
  const time = Math.min(playback.time, totalDuration());
  for (const cell of cells)
    if (switched || cell.playingVersion !== rowFor(cell)?.version)
      startCell(cell, time);
  playback.time = time;
  renderMarkers();
  renderPinOptions();
  renderNotes();
  showTime();
  ui.status.textContent = `${rows.length > 1 ? "Comparing" : "Playing"} · live reload on`;
  window.animationPreview.generation = state.generation;
  window.animationPreview.ready = true;
}

declare global {
  interface Window {
    animationPreview: {
      ready: boolean;
      generation: number;
      time: number;
      error: string | null;
    };
  }
}
window.animationPreview = {
  ready: false,
  generation: -1,
  time: 0,
  error: null,
};

async function start() {
  try {
    await loadChoices();
    await applyState(await fetchState());
    updatePlayButton();
    requestAnimationFrame(frame);
    const events = new EventSource("/__preview/events");
    events.onmessage = async (message) => {
      if (Number(message.data) !== server?.generation)
        await applyState(await fetchState());
    };
  } catch (error) {
    showError(error);
  }
}

function showError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  window.animationPreview.error = message;
  ui.status.textContent = `Error: ${message}`;
}

void start();
