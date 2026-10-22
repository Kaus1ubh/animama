import { expect, type Locator } from "playwright/test";

import type { EvidenceAttachment } from "../fixtures/animama";
import {
  observePlaybackWindow,
  type ExpectedPlaybackTarget,
  type PlaybackObservation,
} from "./playback-observation";

type BaseProof = {
  evidence: EvidenceAttachment;
  evidenceName: string;
  expectedTarget: ExpectedPlaybackTarget;
  surface: Locator;
  surfaceKind?: PlaybackObservation["surface"];
};

type ClipObservationChannel = "poseClip" | "reactionClip";

function advances(values: readonly number[], minimumDelta = 0.04): boolean {
  if (values.length < 2) return false;
  return Math.max(...values) - Math.min(...values) >= minimumDelta;
}

function eventIds(
  samples: readonly PlaybackObservation[],
  channel: ClipObservationChannel,
): Set<string> {
  return new Set(
    samples.flatMap((sample) => sample.motion[channel]?.firedEventIds ?? []),
  );
}

function effectIds(
  samples: readonly PlaybackObservation[],
  channel: "particle" | "avatar" | "scene",
): Set<string> {
  return new Set(
    samples.flatMap((sample) =>
      sample.effects[channel].map((effect) => effect.runtimeId),
    ),
  );
}

function containsAll(actual: Set<string>, expected: readonly string[]) {
  return expected.every((item) => actual.has(item));
}

/** Prove a selected VRMA action is weighted and advancing. */
export function proveVrmaPlayback(
  args: BaseProof,
): Promise<PlaybackObservation[]> {
  return observePlaybackWindow({
    ...args,
    until: (samples) => {
      const states = samples.flatMap((sample) =>
        sample.motion.vrma.filter(
          (item) =>
            item.runtimeId === args.expectedTarget.runtimeId && item.active,
        ),
      );
      return (
        states.some((state) => state.weight > 0) &&
        advances(states.map((state) => state.playheadSec))
      );
    },
  });
}

/** Prove an Anima pose clip, skeleton resolution, events, and time progression. */
export function provePoseClipPlayback(
  args: BaseProof & {
    expectedAvatarEffects?: readonly string[];
    expectedEventIds?: readonly string[];
    expectedSceneEffects?: readonly string[];
    maxMissingBones?: number;
  },
): Promise<PlaybackObservation[]> {
  return observePlaybackWindow({
    ...args,
    until: (samples) => {
      const clips = samples.flatMap((sample) => {
        const clip = sample.motion.poseClip;
        return clip?.runtimeId === args.expectedTarget.runtimeId ? [clip] : [];
      });
      return (
        clips.some(
          (clip) =>
            clip.active &&
            clip.resolvedBoneCount > 0 &&
            clip.missingBoneCount <= (args.maxMissingBones ?? 0),
        ) &&
        advances(clips.map((clip) => clip.playheadSec)) &&
        containsAll(
          eventIds(samples, "poseClip"),
          args.expectedEventIds ?? [],
        ) &&
        containsAll(
          effectIds(samples, "avatar"),
          args.expectedAvatarEffects ?? [],
        ) &&
        containsAll(
          effectIds(samples, "scene"),
          args.expectedSceneEffects ?? [],
        )
      );
    },
  });
}

/** Prove reaction timing, expression thresholds, fired events, and VFX lanes. */
export function proveReactionPlayback(
  args: BaseProof & {
    expressionThresholds: Readonly<Record<string, number>>;
    expectedAvatarEffects: readonly string[];
    expectedEventIds: readonly string[];
    expectedParticleEffects: readonly string[];
    expectedSceneEffects: readonly string[];
  },
): Promise<PlaybackObservation[]> {
  return observePlaybackWindow({
    ...args,
    until: (samples) => {
      const clips = samples.flatMap((sample) => {
        const clip = sample.motion.reactionClip;
        return clip?.runtimeId === args.expectedTarget.runtimeId ? [clip] : [];
      });
      const expressionsPass = Object.entries(args.expressionThresholds).every(
        ([name, threshold]) =>
          samples.some(
            (sample) => (sample.expressions[name] ?? 0) >= threshold,
          ),
      );
      const controllerError = samples.some((sample) =>
        sample.diagnostics.some(
          (diagnostic) =>
            (diagnostic.channel === "particle_vfx" ||
              diagnostic.channel === "avatar_vfx") &&
            (diagnostic.code === "controller_error" ||
              diagnostic.code === "controller_unavailable"),
        ),
      );
      return (
        clips.some((clip) => clip.active && Boolean(clip.phase)) &&
        advances(clips.map((clip) => clip.playheadSec)) &&
        expressionsPass &&
        containsAll(eventIds(samples, "reactionClip"), args.expectedEventIds) &&
        containsAll(effectIds(samples, "avatar"), args.expectedAvatarEffects) &&
        containsAll(
          effectIds(samples, "particle"),
          args.expectedParticleEffects,
        ) &&
        containsAll(effectIds(samples, "scene"), args.expectedSceneEffects) &&
        !controllerError
      );
    },
  });
}

/** Prove Particle VFX identity, ownership, anchor resolution, and its clock. */
export function proveParticlePlayback(
  args: BaseProof & { expectedAnchor?: string; expectedOwner?: string },
): Promise<PlaybackObservation[]> {
  return observePlaybackWindow({
    ...args,
    until: (samples) => {
      const effects = samples.flatMap((sample) =>
        sample.effects.particle.filter(
          (effect) => effect.runtimeId === args.expectedTarget.runtimeId,
        ),
      );
      return (
        effects.some(
          (effect) =>
            effect.active &&
            (!args.expectedOwner || effect.owner === args.expectedOwner) &&
            (!args.expectedAnchor ||
              (effect.anchor === args.expectedAnchor &&
                effect.resolvedAnchor === args.expectedAnchor)),
        ) && advances(effects.map((effect) => effect.elapsedSec))
      );
    },
  });
}

/** Prove Avatar VFX activation using its intentionally clock-free snapshot. */
export function proveAvatarVFXPlayback(
  args: BaseProof,
): Promise<PlaybackObservation[]> {
  return observePlaybackWindow({
    ...args,
    until: (samples) => {
      const effects = samples.flatMap((sample) =>
        sample.effects.avatar.filter(
          (effect) => effect.runtimeId === args.expectedTarget.runtimeId,
        ),
      );
      const controllerProblem = samples.some((sample) =>
        sample.diagnostics.some(
          (diagnostic) =>
            diagnostic.channel === "avatar_vfx" &&
            (diagnostic.code === "controller_error" ||
              diagnostic.code === "controller_unavailable" ||
              diagnostic.code === "controller_warnings"),
        ),
      );
      return (
        effects.some(
          (effect) =>
            effect.active &&
            Boolean(effect.targetRole) &&
            Boolean(effect.renderMode),
        ) && !controllerProblem
      );
    },
  });
}

/** Prove Scene VFX identity in both the typed observation and visible DOM. */
export async function proveScenePlayback(
  args: BaseProof & { expectedKind: string },
): Promise<{ effectRoot: Locator; samples: PlaybackObservation[] }> {
  const samples = await observePlaybackWindow({
    ...args,
    until: (window) =>
      window.some((sample) =>
        sample.effects.scene.some(
          (effect) =>
            effect.runtimeId === args.expectedTarget.runtimeId &&
            effect.kind === args.expectedKind &&
            effect.active,
        ),
      ),
  });
  const effectRoot = args.surface.locator(
    `[data-scene-vfx-id="${args.expectedTarget.runtimeId}"][data-scene-vfx-kind="${args.expectedKind}"]`,
  );
  await expect(effectRoot).toHaveCount(1);
  await expect(effectRoot).toBeVisible();
  return { effectRoot, samples };
}

/** Prove the dock remains at its default bottom-right viewport position. */
export async function expectBottomRightDock(dock: Locator): Promise<void> {
  const box = await dock.boundingBox();
  const viewport = dock.page().viewportSize();
  if (!box || !viewport)
    throw new Error("Preview Dock has no measurable viewport box.");
  expect(Math.abs(viewport.width - (box.x + box.width))).toBeLessThanOrEqual(
    20,
  );
  expect(Math.abs(viewport.height - (box.y + box.height))).toBeLessThanOrEqual(
    20,
  );
}

/**
 * Prove Emotion Joy's gradient and polka-dot pattern, its Blob-backed scatter
 * items (stars and confetti), and their running drift.
 */
export async function proveEmotionJoySceneDom(
  effectRoot: Locator,
): Promise<void> {
  for (const layer of ["gradient", "pattern"])
    await expect(
      effectRoot.locator(`[data-scene-vfx-layer="${layer}"]`),
    ).toBeVisible();
  const scatters = effectRoot.locator('[data-scene-vfx-layer="scatter"]');
  await expect(scatters).toHaveCount(2);
  for (const itemId of ["star", "curl"]) {
    const matching = effectRoot.locator(`[data-scene-vfx-item-id="${itemId}"]`);
    await expect(matching).not.toHaveCount(0);
    const backgroundImage = await matching
      .first()
      .evaluate((element) => getComputedStyle(element).backgroundImage);
    expect(backgroundImage).toContain("blob:");
  }

  // Each placement drifts on its outermost element.
  const placement = scatters.first().locator(":scope > div").first();
  const first = await placement.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      animationName: style.animationName,
      animationPlayState: style.animationPlayState,
      transform: style.transform,
    };
  });
  expect(first.animationName).toContain("scene-vfx-drift");
  expect(first.animationPlayState).toBe("running");
  await placement.page().waitForTimeout(250);
  const secondTransform = await placement.evaluate(
    (element) => getComputedStyle(element).transform,
  );
  expect(secondTransform).not.toBe(first.transform);
}
