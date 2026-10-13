import { randomUUID } from "node:crypto";
import { expect, type Locator, type Page } from "playwright/test";
import type { PyTypedContentPreview } from "@animama/runtime-contracts/api-types";
import type {
  CreatorContentFixture,
  CreatorContentPlan,
  EvidenceAttachment,
} from "../fixtures/animama";
import {
  attachObservationWindow,
  parsePlaybackObservation,
  readPlaybackObservation,
  type ExpectedPlaybackTarget,
  type PlaybackObservation,
} from "./playback-observation";

export type PlaybackItem = PyTypedContentPreview["item"];
export type OwnedPlaybackItem = {
  plan: CreatorContentPlan;
  itemId: string;
  revisionSha256: string;
};

export const playbackFamilies = {
  avatar: "avatar-content",
  gesture: "gestures",
  reaction: "reactions",
  idle_style: "idle-styles",
  pose: "poses",
  particle_effect: "particle-effects",
  avatar_effect: "avatar-effects",
  scene_effect: "scene-effects",
  sound_effect: "sound-effects",
} as const;

export type PlaybackKind = keyof typeof playbackFamilies;

/** Read the complete typed inventory; never infer imported identities from suffixes. */
export async function playbackInventory(page: Page, kind: PlaybackKind) {
  const response = await page.request.get(`/v1/${playbackFamilies[kind]}`);
  expect(response.ok(), await response.text()).toBe(true);
  const body = (await response.json()) as { items: PlaybackItem[] };
  expect(body.items.every((item) => item.kind === kind)).toBe(true);
  return body.items;
}

/** Original, quiet PCM tone: no external asset or license is needed by this journey. */
function originalTone(): Buffer {
  const rate = 24_000;
  const count = rate * 4;
  const wav = Buffer.alloc(44 + count * 2);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let sample = 0; sample < count; sample += 1) {
    const fade = Math.min(1, sample / 240, (count - sample) / 240);
    wav.writeInt16LE(
      Math.round(Math.sin((sample * 440 * Math.PI * 2) / rate) * 2_000 * fade),
      44 + sample * 2,
    );
  }
  return wav;
}

/** Fixture setup only uses ordinary typed saves, after durable absence/ownership planning. */
async function saveFixture(args: {
  page: Page;
  content: CreatorContentFixture;
  kind: "sound_effect" | "gesture" | "reaction" | "idle_style";
  name: string;
  descriptor: Record<string, unknown>;
  companion?: { name: string; mimeType: string; buffer: Buffer };
}): Promise<PlaybackItem> {
  const { page, content, kind, name, descriptor, companion } = args;
  const logicalKey = String(descriptor.content_id);
  await content.preflightContentAbsence({
    logicalKey,
    // Sound's HTTP family and on-disk content directory intentionally differ.
    expectedRelativePath: `${kind === "sound_effect" ? "sfx" : playbackFamilies[kind]}/${name}`,
  });
  const plan = await content.planContent({
    journeyKey: `imported-playback-source-${name}`,
    kind,
    entryName: name,
    logicalKey,
  });
  const response = await page.request.put(
    `/v1/${playbackFamilies[kind]}/${encodeURIComponent(name)}`,
    {
      headers: {
        Origin: new URL(page.url()).origin,
        "Sec-Fetch-Site": "same-origin",
        "X-Animama-CSRF": "1",
      },
      multipart: {
        operation_id: randomUUID(),
        descriptor_json: JSON.stringify(descriptor),
        companion_paths_json: JSON.stringify(companion ? [companion.name] : []),
        ...(companion ? { files: companion } : {}),
      },
    },
  );
  expect(response.ok(), await response.text()).toBe(true);
  const item = (await response.json()) as PlaybackItem;
  const owned = {
    itemId: item.item_id,
    revisionSha256: item.revision_sha256,
  };
  await content.recordOwnedContent(plan, owned);
  await content.verifyOwnedContent(plan, owned);
  expect(item.name).toBe(name);
  expect(item.logical_key).toBe(logicalKey);
  return item;
}

/** Two finite Actions share four real effect dependencies; the Reaction remains expression-only. */
export async function createPlaybackFixtures(args: {
  page: Page;
  content: CreatorContentFixture;
  token: string;
  effects: PlaybackItem[];
}) {
  const { token, effects } = args;
  const soundName = `import-playback-${token}-sound`;
  const sound = await saveFixture({
    ...args,
    kind: "sound_effect",
    name: soundName,
    descriptor: {
      schema_version: 1,
      content_type: "sound_effect",
      content_id: `local:sound:${soundName}`,
      name: soundName,
      files: [{ path: "tone.wav", role: "audio" }],
    },
    companion: {
      name: "tone.wav",
      mimeType: "audio/wav",
      buffer: originalTone(),
    },
  });
  const dependencies = [...effects, sound].map((item) => ({
    ref: item.logical_key,
    alias: item.kind,
    content_type: item.kind,
  }));
  const actions: PlaybackItem[] = [];
  for (const kind of ["gesture", "reaction"] as const) {
    const name = `import-playback-${token}-${kind}`;
    const sequence = {
      schema: "animaPoseClip/2.0",
      role: kind === "reaction" ? "reaction" : "motion",
      id: name,
      name,
      duration: 4,
      beats: [
        { id: "center", label: "Center", time: 0 },
        { id: "smile", label: "Smile", time: 1 },
        { id: "end", label: "Center", time: 4 },
      ],
      ...(kind === "gesture"
        ? {
            rotations: {
              head: [
                { beat: "center", q: [0, 0, 0, 1] },
                { beat: "smile", q: [0, 0.258819, 0, 0.965926] },
                { beat: "end", q: [0, 0, 0, 1] },
              ],
            },
          }
        : {}),
      expressions: {
        happy: [
          { beat: "center", v: 0 },
          { beat: "smile", v: 1 },
          { beat: "end", v: 0 },
        ],
      },
      events: [
        {
          id: "avatar",
          kind: "avatar_vfx",
          effectId: "avatar_effect",
          time: 0.4,
          duration: 3,
        },
        {
          id: "particle",
          kind: "particle_vfx",
          effectId: "particle_effect",
          time: 0.4,
          // Within Included Heart Burst's 2.5 s default and 3 s catalog budget.
          duration: 1.8,
          anchor: "chest",
        },
        {
          id: "scene",
          kind: "scene_vfx",
          sceneKind: "background_layers",
          presetId: "scene_effect",
          time: 0.4,
          duration: 3,
          playAccompanyingSound: false,
        },
        { id: "sound", kind: "sfx", cueId: "sound_effect", time: 0.4 },
      ],
    };
    actions.push(
      await saveFixture({
        ...args,
        kind,
        name,
        descriptor: {
          schema_version: 1,
          content_type: kind,
          content_id: `local:${kind}:${name}`,
          name,
          ...(kind === "gesture" ? { semantic_key: name } : {}),
          implementation: { kind: "anima_clip", file_role: "sequence" },
          config: { time_scale: 1 },
          files: [{ path: "motion.json", role: "sequence" }],
          dependencies,
        },
        companion: {
          name: "motion.json",
          mimeType: "application/json",
          buffer: Buffer.from(JSON.stringify(sequence)),
        },
      }),
    );
  }
  const idleName = `import-playback-${token}-idle`;
  const idle = await saveFixture({
    ...args,
    kind: "idle_style",
    name: idleName,
    descriptor: {
      schema_version: 2,
      content_type: "idle_style",
      content_id: `local:idle-style:${idleName}`,
      name: idleName,
      default_pool: [actions[0]!.logical_key],
      cells: {},
      dependencies: [{ ref: actions[0]!.logical_key, content_type: "gesture" }],
      files: [],
    },
  });
  return [...actions, idle, sound];
}

type AudioObservation = {
  currentTime: number;
  maxTime: number;
  readyState: number;
  paused: boolean;
  error: number | null;
};

declare global {
  interface Window {
    __importedPlaybackAudio?: HTMLAudioElement[];
    __importedPlaybackAudioMax?: number[];
  }
}

/** Observe native media clocks without mocking playback or accessing application stores. */
export async function installAudioObservation(page: Page) {
  await page.addInitScript(() => {
    window.__importedPlaybackAudio = [];
    window.__importedPlaybackAudioMax = [];
    window.Audio = new Proxy(window.Audio, {
      construct(target, args) {
        const audio = Reflect.construct(target, args) as HTMLAudioElement;
        const index = window.__importedPlaybackAudio!.push(audio) - 1;
        window.__importedPlaybackAudioMax![index] = 0;
        audio.addEventListener("timeupdate", () => {
          window.__importedPlaybackAudioMax![index] = Math.max(
            window.__importedPlaybackAudioMax![index] ?? 0,
            audio.currentTime,
          );
        });
        return audio;
      },
    });
  });
}

export async function audioCount(page: Page) {
  return page.evaluate(() => window.__importedPlaybackAudio?.length ?? 0);
}

export async function proveAudioPlayback(
  page: Page,
  since: number,
  evidence: EvidenceAttachment,
  name: string,
) {
  let observed: AudioObservation[] = [];
  await expect
    .poll(
      async () => {
        observed = await page.evaluate(
          (start) =>
            (window.__importedPlaybackAudio ?? [])
              .slice(start)
              .map((audio, offset) => ({
                currentTime: audio.currentTime,
                maxTime: Math.max(
                  audio.currentTime,
                  window.__importedPlaybackAudioMax?.[start + offset] ?? 0,
                ),
                readyState: audio.readyState,
                paused: audio.paused,
                error: audio.error?.code ?? null,
              })),
          since,
        );
        return observed.some(
          (audio) =>
            audio.maxTime > 0.1 &&
            audio.readyState >= 2 &&
            audio.error === null,
        );
      },
      {
        message:
          "imported PCM Sound must decode and advance a real browser media clock",
      },
    )
    .toBe(true);
  await evidence.attachJson(name, {
    nativeAudio: observed,
    audibleOutput: "manual-only",
  });
}

/** Retain the short Library particle clock without per-sample browser protocol latency. */
export async function proveLibraryParticleReplay(args: {
  surface: Locator;
  target: ExpectedPlaybackTarget;
  evidence: EvidenceAttachment;
  name: string;
}) {
  const { surface, target, evidence, name } = args;
  // A handle containing the promise returns immediately: the observer is
  // installed before the real Replay click, rather than racing its first frame.
  const capture = await surface
    .locator("output[data-playback-observation]")
    .evaluateHandle((output, expected) => {
      let finish = () => {};
      const result = new Promise<string[]>((resolve) => {
        const readings: string[] = [];
        const observer = new MutationObserver(read);
        const timeout = setTimeout(() => finish(), 5_000);
        finish = () => {
          observer.disconnect();
          clearTimeout(timeout);
          resolve(readings);
        };
        function read() {
          const source = output.textContent ?? "";
          let observation: PlaybackObservation;
          try {
            observation = JSON.parse(source) as PlaybackObservation;
            if (observation.target.status !== "playing") return;
          } catch {
            readings.push(source);
            finish();
            return;
          }
          if (readings.at(-1) !== source) readings.push(source);
          const elapsed = readings.flatMap((reading) => {
            const sample = JSON.parse(reading) as PlaybackObservation;
            return sample.target.kind === expected.kind &&
              sample.target.runtimeId === expected.runtimeId
              ? sample.effects.particle
                  .filter(
                    (effect) =>
                      effect.runtimeId === expected.runtimeId &&
                      effect.active &&
                      effect.owner === "content-preview" &&
                      effect.anchor === "chest" &&
                      effect.resolvedAnchor === "chest",
                  )
                  .map((effect) => effect.elapsedSec)
              : [];
          });
          if (
            (elapsed.length >= 2 &&
              Math.max(...elapsed) - Math.min(...elapsed) >= 0.04) ||
            readings.length >= 26
          )
            finish();
        }
        observer.observe(output, {
          characterData: true,
          childList: true,
          subtree: true,
        });
        read();
      });
      return { result, cancel: () => finish() };
    }, target);
  try {
    await surface.getByRole("button", { name: "Replay", exact: true }).click();
    const readings = await capture.evaluate((pending) => pending.result);
    const samples = readings.map((reading) =>
      parsePlaybackObservation(JSON.parse(reading)),
    );
    await attachObservationWindow(evidence, name, samples);
    for (const sample of samples) {
      expect(sample.target).toEqual({ ...target, status: "playing" });
      expect(sample.diagnostics).toEqual([]);
    }
    const elapsed = samples.flatMap((sample) =>
      sample.effects.particle
        .filter(
          (effect) =>
            effect.runtimeId === target.runtimeId &&
            effect.active &&
            effect.owner === "content-preview" &&
            effect.anchor === "chest" &&
            effect.resolvedAnchor === "chest",
        )
        .map((effect) => effect.elapsedSec),
    );
    expect(
      new Set(elapsed).size,
      "two distinct clocks from the exact imported, chest-anchored particle controller",
    ).toBeGreaterThanOrEqual(2);
    expect(Math.max(...elapsed) - Math.min(...elapsed)).toBeGreaterThanOrEqual(
      0.04,
    );
    return samples;
  } finally {
    await capture
      .evaluate((pending) => pending.cancel())
      .catch(() => undefined);
    await capture.dispose();
  }
}

/** The Particle creator owns Quarks directly, outside the Avatar controller snapshot. */
export async function proveParticleCreatorPlayback(args: {
  page: Page;
  surface: Locator;
  target: ExpectedPlaybackTarget;
  evidence: EvidenceAttachment;
  name: string;
}) {
  const { page, surface, target, evidence, name } = args;
  // With both overlays hidden, this canvas contains only the imported Heart
  // Burst particles and a static neutral grid. Model animation cannot satisfy proof.
  await page
    .getByRole("switch", { name: "Show Avatar", exact: true })
    .uncheck();
  await page
    .getByRole("switch", { name: "Show emitter shape outline", exact: true })
    .uncheck();
  const stop = page.getByRole("button", {
    name: "Stop effect preview",
    exact: true,
  });
  await stop.click();
  await expect
    .poll(async () => (await readPlaybackObservation(surface)).target.status)
    .toBe("stopped");
  await expect(
    page.getByLabel("Effect preview time", { exact: true }),
  ).toHaveText("0.00s");

  // Capture within one browser call so protocol latency cannot consume the
  // short 1.8-second effect. Read only the public output, clock, and canvas.
  const capture = page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      '[data-testid="particle-vfx-creator-canvas"] canvas',
    );
    const output = document.querySelector(
      '[data-playback-surface="creator-stage"] output[data-playback-observation]',
    );
    const clock = document.querySelector('[aria-label="Effect preview time"]');
    if (!canvas || !output || !clock)
      throw new Error("Particle creator preview is missing.");
    const image = document.createElement("canvas");
    image.width = 320;
    image.height = Math.max(
      1,
      Math.round((canvas.height * 320) / canvas.width),
    );
    const context = image.getContext("2d", { willReadFrequently: true })!;
    const pixels = () => {
      context.clearRect(0, 0, image.width, image.height);
      context.drawImage(canvas, 0, 0, image.width, image.height);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    const colored = (data: Uint8ClampedArray, index: number) =>
      data[index + 3]! > 32 &&
      Math.max(data[index]!, data[index + 1]!, data[index + 2]!) -
        Math.min(data[index]!, data[index + 1]!, data[index + 2]!) >
        32;
    const count = (data: Uint8ClampedArray) => {
      let total = 0;
      for (let index = 0; index < data.length; index += 4)
        if (colored(data, index)) total += 1;
      return total;
    };
    const baselineColoredPixels = count(pixels());
    const frames: Array<{
      time: number;
      coloredPixels: number;
      changedColoredPixels: number;
      observation: string;
      png: string;
    }> = [];
    let firstPixels: Uint8ClampedArray | null = null;
    const deadline = performance.now() + 8_000;
    while (performance.now() < deadline && frames.length < 2) {
      await new Promise(requestAnimationFrame);
      const observation = output.textContent ?? "";
      if (JSON.parse(observation).target.status !== "playing") continue;
      const time = Number.parseFloat(clock.textContent ?? "");
      if (
        !Number.isFinite(time) ||
        time <= 0 ||
        (frames[0] && time - frames[0].time <= 0.1)
      )
        continue;
      const data = pixels();
      const coloredPixels = count(data);
      if (coloredPixels <= 20) continue;
      let changedColoredPixels = 0;
      if (firstPixels) {
        for (let index = 0; index < data.length; index += 4) {
          if (
            (colored(data, index) || colored(firstPixels, index)) &&
            [0, 1, 2, 3].some(
              (channel) =>
                Math.abs(
                  data[index + channel]! - firstPixels![index + channel]!,
                ) > 16,
            )
          )
            changedColoredPixels += 1;
        }
        if (changedColoredPixels <= 20) continue;
      }
      frames.push({
        time,
        coloredPixels,
        changedColoredPixels,
        observation,
        png: image.toDataURL("image/png"),
      });
      firstPixels ??= data;
    }
    return { baselineColoredPixels, frames };
  });
  await page
    .getByRole("button", { name: "Restart effect preview", exact: true })
    .click();
  const result = await capture;
  await evidence.attachJson(`${name}-isolated-canvas-motion`, {
    baselineColoredPixels: result.baselineColoredPixels,
    frames: result.frames.map((frame) => ({
      time: frame.time,
      coloredPixels: frame.coloredPixels,
      changedColoredPixels: frame.changedColoredPixels,
      observation: frame.observation,
    })),
  });
  expect(
    result.baselineColoredPixels,
    "stopped canvas contains only the neutral grid",
  ).toBe(0);
  expect(
    result.frames,
    "two painted particle frames must advance the visible effect clock and change colored pixels",
  ).toHaveLength(2);
  const samples = result.frames.map((frame) =>
    parsePlaybackObservation(JSON.parse(frame.observation)),
  );
  for (const [index, frame] of result.frames.entries()) {
    expect(samples[index]!.target).toMatchObject({
      ...target,
      status: "playing",
    });
    // Hiding the Avatar removes its two controllers. The standalone Quarks
    // renderer still paints; require exactly these intentional diagnostics.
    expect(samples[index]!.diagnostics).toEqual([
      { channel: "avatar", code: "avatar_not_ready" },
      { channel: "particle_vfx", code: "controller_unavailable" },
      { channel: "avatar_vfx", code: "controller_unavailable" },
    ]);
    await evidence.attachBuffer(
      `${name}-particle-frame-${index + 1}`,
      Buffer.from(frame.png.split(",")[1]!, "base64"),
      "image/png",
    );
  }
  await stop.click();
  await expect
    .poll(async () => (await readPlaybackObservation(surface)).target.status)
    .toBe("stopped");
  await expect(
    page.getByLabel("Effect preview time", { exact: true }),
  ).toHaveText("0.00s");
  return samples;
}
