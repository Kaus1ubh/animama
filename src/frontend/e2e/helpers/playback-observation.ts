import type { Locator } from "playwright/test";

import type { EvidenceAttachment } from "../fixtures/animama";

export const OBSERVATION_SAMPLE_INTERVAL_MS = 200;
const MAX_OBSERVATION_WINDOW_MS = 5_000;
const MAX_OBSERVATION_SAMPLES = 25;

export type PlaybackTargetKind =
  | "avatar_model"
  | "animation"
  | "anima_pose_clip"
  | "particle_vfx"
  | "avatar_vfx"
  | "scene_vfx";

export type PlaybackStatus =
  | "loading"
  | "ready"
  | "playing"
  | "stopped"
  | "unavailable"
  | "error";

export type PlaybackObservation = {
  version: 1;
  surface: "library-dock" | "anima-loadout-stage" | "creator-stage";
  target: {
    kind: PlaybackTargetKind;
    runtimeId: string;
    status: PlaybackStatus;
  };
  motion: {
    vrma: Array<{
      runtimeId: string;
      active: boolean;
      playheadSec: number;
      durationSec: number;
      weight: number;
    }>;
    poseClip: {
      runtimeId: string;
      active: boolean;
      playheadSec: number;
      durationSec: number;
      resolvedBoneCount: number;
      missingBoneCount: number;
      firedEventIds: string[];
    } | null;
    reactionClip: {
      runtimeId: string;
      active: boolean;
      phase: string | null;
      playheadSec: number;
      durationSec: number;
      firedEventIds: string[];
    } | null;
  };
  expressions: Record<string, number>;
  effects: {
    particle: Array<{
      runtimeId: string;
      active: true;
      elapsedSec: number;
      owner: string | null;
      anchor: string;
      resolvedAnchor: string;
    }>;
    avatar: Array<{
      runtimeId: string;
      active: true;
      elapsedSec: number | null;
      targetRole: string;
      animationPreset: string | null;
      renderMode: string;
    }>;
    scene: Array<{
      runtimeId: string;
      kind: string;
      active: boolean;
    }>;
  };
  diagnostics: Array<{
    channel: string;
    code: string;
    count?: number;
  }>;
};

export type ExpectedPlaybackTarget = {
  kind: PlaybackTargetKind;
  runtimeId: string;
};

type ObservationWindowOptions = {
  evidence: EvidenceAttachment;
  evidenceName: string;
  expectedTarget: ExpectedPlaybackTarget;
  initialSamples?: readonly PlaybackObservation[];
  surface: Locator;
  surfaceKind?: PlaybackObservation["surface"];
  until: (samples: readonly PlaybackObservation[]) => boolean;
  timeoutMs?: number;
  preconditionTimeoutMs?: number;
};

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Playback observation ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`Playback observation ${label} must be an array.`);
  }
  return value;
}

function string(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`Playback observation ${label} must be a string.`);
  }
  return value;
}

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Playback observation ${label} must be a finite number.`);
  }
  return value;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`Playback observation ${label} must be a boolean.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : string(value, label);
}

function validateMotionItem(value: unknown, label: string): void {
  const item = record(value, label);
  string(item.runtimeId, `${label}.runtimeId`);
  boolean(item.active, `${label}.active`);
  number(item.playheadSec, `${label}.playheadSec`);
  number(item.durationSec, `${label}.durationSec`);
}

/** Parse and validate the complete version-one observation allowlist. */
export function parsePlaybackObservation(value: unknown): PlaybackObservation {
  const root = record(value, "root");
  if (root.version !== 1) {
    throw new Error(
      `Unsupported playback observation schema version ${String(root.version)}; expected 1.`,
    );
  }
  if (
    root.surface !== "library-dock" &&
    root.surface !== "anima-loadout-stage" &&
    root.surface !== "creator-stage"
  ) {
    throw new Error(
      `Playback observation has unknown surface ${String(root.surface)}.`,
    );
  }

  const target = record(root.target, "target");
  const targetKind = string(target.kind, "target.kind");
  if (
    ![
      "avatar_model",
      "animation",
      "anima_pose_clip",
      "particle_vfx",
      "avatar_vfx",
      "scene_vfx",
    ].includes(targetKind)
  ) {
    throw new Error(
      `Playback observation has unknown target kind ${targetKind}.`,
    );
  }
  const targetStatus = string(target.status, "target.status");
  if (
    ![
      "loading",
      "ready",
      "playing",
      "stopped",
      "unavailable",
      "error",
    ].includes(targetStatus)
  ) {
    throw new Error(`Playback observation has unknown status ${targetStatus}.`);
  }
  string(target.runtimeId, "target.runtimeId");

  const motion = record(root.motion, "motion");
  const vrma = array(motion.vrma, "motion.vrma");
  vrma.forEach((item, index) => {
    validateMotionItem(item, `motion.vrma[${index}]`);
    number(
      record(item, `motion.vrma[${index}]`).weight,
      `motion.vrma[${index}].weight`,
    );
  });
  for (const channel of ["poseClip", "reactionClip"] as const) {
    const item = motion[channel];
    if (item === null) continue;
    validateMotionItem(item, `motion.${channel}`);
    const channelRecord = record(item, `motion.${channel}`);
    array(
      channelRecord.firedEventIds,
      `motion.${channel}.firedEventIds`,
    ).forEach((eventId, index) =>
      string(eventId, `motion.${channel}.firedEventIds[${index}]`),
    );
    if (channel === "poseClip") {
      number(
        channelRecord.resolvedBoneCount,
        "motion.poseClip.resolvedBoneCount",
      );
      number(
        channelRecord.missingBoneCount,
        "motion.poseClip.missingBoneCount",
      );
    } else {
      nullableString(channelRecord.phase, "motion.reactionClip.phase");
    }
  }

  const expressions = record(root.expressions, "expressions");
  Object.entries(expressions).forEach(([name, weight]) =>
    number(weight, `expressions.${name}`),
  );
  const effects = record(root.effects, "effects");
  for (const channel of ["particle", "avatar", "scene"] as const) {
    array(effects[channel], `effects.${channel}`).forEach((effect, index) => {
      const item = record(effect, `effects.${channel}[${index}]`);
      string(item.runtimeId, `effects.${channel}[${index}].runtimeId`);
      boolean(item.active, `effects.${channel}[${index}].active`);
      if (channel === "particle") {
        number(item.elapsedSec, `effects.${channel}[${index}].elapsedSec`);
        nullableString(item.owner, `effects.${channel}[${index}].owner`);
        string(item.anchor, `effects.${channel}[${index}].anchor`);
        string(
          item.resolvedAnchor,
          `effects.${channel}[${index}].resolvedAnchor`,
        );
      } else if (channel === "avatar") {
        if (item.elapsedSec !== null) {
          number(item.elapsedSec, `effects.${channel}[${index}].elapsedSec`);
        }
        string(item.targetRole, `effects.${channel}[${index}].targetRole`);
        nullableString(
          item.animationPreset,
          `effects.${channel}[${index}].animationPreset`,
        );
        string(item.renderMode, `effects.${channel}[${index}].renderMode`);
      } else {
        string(item.kind, `effects.${channel}[${index}].kind`);
      }
    });
  }
  array(root.diagnostics, "diagnostics").forEach((diagnostic, index) => {
    const item = record(diagnostic, `diagnostics[${index}]`);
    string(item.channel, `diagnostics[${index}].channel`);
    string(item.code, `diagnostics[${index}].code`);
    if (item.count !== undefined)
      number(item.count, `diagnostics[${index}].count`);
  });

  return root as PlaybackObservation;
}

/** Read exactly one surface-local output and fail early on harness drift. */
export async function readPlaybackObservation(
  surface: Locator,
): Promise<PlaybackObservation> {
  const outputs = surface.locator("output[data-playback-observation]");
  const count = await outputs.count();
  if (count !== 1) {
    throw new Error(
      `Playback surface must contain exactly one observation output; found ${count}.`,
    );
  }
  const output = outputs.first();
  const declaredVersion = await output.getAttribute("data-schema-version");
  if (declaredVersion !== "1") {
    throw new Error(
      `Unsupported playback observation data-schema-version ${String(declaredVersion)}; expected 1.`,
    );
  }
  const serialized = await output.textContent();
  if (!serialized?.trim()) {
    throw new Error("Playback observation output is empty.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch (cause) {
    throw new Error("Playback observation contains invalid JSON.", { cause });
  }
  return parsePlaybackObservation(parsed);
}

function assertTarget(
  observation: PlaybackObservation,
  expected: ExpectedPlaybackTarget,
): void {
  if (
    observation.target.kind !== expected.kind ||
    observation.target.runtimeId !== expected.runtimeId
  ) {
    throw new Error(
      `Playback target changed: expected ${expected.kind}/${expected.runtimeId}, received ${observation.target.kind}/${observation.target.runtimeId}.`,
    );
  }
  if (
    observation.target.status === "error" ||
    observation.target.status === "unavailable"
  ) {
    throw new Error(
      `Playback target ${expected.runtimeId} entered ${observation.target.status}.`,
    );
  }
}

function compactTimeline(samples: readonly PlaybackObservation[]) {
  return samples.map((sample, index) => ({
    sample: index + 1,
    status: sample.target.status,
    vrma: sample.motion.vrma.map((item) => [
      item.runtimeId,
      item.playheadSec,
      item.weight,
    ]),
    pose: sample.motion.poseClip
      ? [
          sample.motion.poseClip.runtimeId,
          sample.motion.poseClip.playheadSec,
          sample.motion.poseClip.resolvedBoneCount,
          sample.motion.poseClip.firedEventIds,
        ]
      : null,
    reaction: sample.motion.reactionClip
      ? [
          sample.motion.reactionClip.runtimeId,
          sample.motion.reactionClip.phase,
          sample.motion.reactionClip.playheadSec,
          sample.motion.reactionClip.firedEventIds,
        ]
      : null,
    expressions: { ...sample.expressions },
    particle: sample.effects.particle.map((item) => [
      item.runtimeId,
      item.elapsedSec,
      item.owner,
      item.resolvedAnchor,
    ]),
    avatar: sample.effects.avatar.map((item) => [
      item.runtimeId,
      item.targetRole,
      item.animationPreset,
      item.renderMode,
    ]),
    scene: sample.effects.scene.map((item) => [
      item.runtimeId,
      item.kind,
      item.active,
    ]),
    diagnostics: sample.diagnostics.map((diagnostic) => ({ ...diagnostic })),
  }));
}

/**
 * Read the first Playing DOM update without polling past a short opening pose.
 * This runs in the browser, reads only the selected output, and retains no
 * history. It may watch the mounted body while waiting for dock insertion.
 */
export function waitForPlayingOutput(
  root: HTMLElement | SVGElement,
  args: {
    expectedTarget: ExpectedPlaybackTarget;
    surfaceKind?: PlaybackObservation["surface"];
    timeoutMs: number;
  },
): Promise<string> {
  return new Promise((resolve, reject) => {
    let lastStatus = "unobserved";
    const observer = new MutationObserver(read);
    const timeout = setTimeout(() => {
      observer.disconnect();
      reject(
        new Error(
          `Playback target ${args.expectedTarget.kind}/${args.expectedTarget.runtimeId} did not enter playing within ${args.timeoutMs}ms; last status was ${lastStatus}.`,
        ),
      );
    }, args.timeoutMs);

    function finish(source: string) {
      observer.disconnect();
      clearTimeout(timeout);
      resolve(source);
    }

    function read() {
      let output = root;
      if (args.surfaceKind) {
        const outputs = root.querySelectorAll<HTMLElement>(
          `[data-playback-surface="${args.surfaceKind}"] output[data-playback-observation]`,
        );
        if (outputs.length === 0) return;
        if (outputs.length !== 1) {
          observer.disconnect();
          clearTimeout(timeout);
          reject(
            new Error(
              `Expected one ${args.surfaceKind} playback output; received ${outputs.length}.`,
            ),
          );
          return;
        }
        output = outputs[0]!;
      }
      const source = output.textContent ?? "";
      try {
        const value = JSON.parse(source) as Partial<PlaybackObservation>;
        const target = value.target;
        // Return invalid/error states to the shared Node-side schema and
        // target validator instead of silently waiting through a bad payload.
        if (
          value.version !== 1 ||
          !target ||
          target.kind !== args.expectedTarget.kind ||
          target.runtimeId !== args.expectedTarget.runtimeId ||
          !["loading", "ready", "stopped"].includes(target.status)
        ) {
          finish(source);
          return;
        }
        lastStatus = target.status;
      } catch {
        finish(source);
      }
    }

    observer.observe(root, {
      characterData: true,
      childList: true,
      subtree: true,
    });
    read();
  });
}

/** Wait for real playback readiness without spending the bounded proof window. */
async function waitForPlaybackTarget(args: {
  expectedTarget: ExpectedPlaybackTarget;
  surface: Locator;
  surfaceKind?: PlaybackObservation["surface"];
  timeoutMs?: number;
}): Promise<PlaybackObservation> {
  const timeoutMs = args.timeoutMs ?? 30_000;
  // A pre-armed dock may not exist yet. Observe its insertion from the already
  // mounted body in one browser call; waiting for the output and then making a
  // second call to attach its observer can miss the entire opening landmark.
  const root = args.surfaceKind
    ? args.surface.page().locator("body")
    : args.surface.locator("output[data-playback-observation]");
  const source = await root.evaluate(
    waitForPlayingOutput,
    {
      expectedTarget: args.expectedTarget,
      surfaceKind: args.surfaceKind,
      timeoutMs,
    },
    { timeout: timeoutMs },
  );
  const observation = parsePlaybackObservation(JSON.parse(source));
  assertTarget(observation, args.expectedTarget);
  return observation;
}

/**
 * Retain a bounded 5 Hz temporal window until a channel-specific proof passes.
 * The product output stays history-free; history exists only in test evidence.
 */
export async function observePlaybackWindow({
  evidence,
  evidenceName,
  expectedTarget,
  initialSamples = [],
  surface,
  surfaceKind,
  until,
  timeoutMs = MAX_OBSERVATION_WINDOW_MS,
  preconditionTimeoutMs = 30_000,
}: ObservationWindowOptions): Promise<PlaybackObservation[]> {
  const boundedTimeout = Math.min(MAX_OBSERVATION_WINDOW_MS, timeoutMs);
  const samples: PlaybackObservation[] = [];
  let lastError: Error | null = null;

  try {
    for (const sample of initialSamples) {
      assertTarget(sample, expectedTarget);
      samples.push(sample);
    }
    const playing = await waitForPlaybackTarget({
      expectedTarget,
      surface,
      surfaceKind,
      timeoutMs: preconditionTimeoutMs,
    });
    samples.push(playing);
    if (samples.length >= 2 && until(samples)) return samples;
    const deadline = Date.now() + boundedTimeout;
    while (Date.now() <= deadline && samples.length < MAX_OBSERVATION_SAMPLES) {
      await surface.page().waitForTimeout(OBSERVATION_SAMPLE_INTERVAL_MS);
      const observation = await readPlaybackObservation(surface);
      assertTarget(observation, expectedTarget);
      samples.push(observation);
      if (samples.length >= 2 && until(samples)) return samples;
    }
    lastError = new Error(
      `Playback proof for ${expectedTarget.kind}/${expectedTarget.runtimeId} did not pass within ${boundedTimeout}ms (${samples.length} samples).`,
    );
    throw lastError;
  } catch (cause) {
    lastError = cause instanceof Error ? cause : new Error(String(cause));
    await evidence.attachJson(`${evidenceName}-observation-failure`, {
      error: lastError.message,
      expectedTarget,
      sampleCount: samples.length,
      lastValidObservation: samples.at(-1) ?? null,
      timeline: compactTimeline(samples),
    });
    throw lastError;
  }
}

/** Attach the final valid observation and compact timeline at a checkpoint. */
export async function attachObservationWindow(
  evidence: EvidenceAttachment,
  name: string,
  samples: readonly PlaybackObservation[],
): Promise<void> {
  await evidence.attachJson(`${name}-observation`, {
    sampleCount: samples.length,
    lastObservation: samples.at(-1) ?? null,
    timeline: compactTimeline(samples),
  });
}
