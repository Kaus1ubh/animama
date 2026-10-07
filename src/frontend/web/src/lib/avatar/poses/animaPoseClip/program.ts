import type { VRM } from "@pixiv/three-vrm";

import {
  animaPoseClipHasPose,
  isAnimaPoseClipV2,
  parseAnyAnimaPoseClip,
  type AnyAnimaPoseClip,
} from "./anyClip";
import { getAnimaPoseClipTimelineDuration } from "./playback";
import { prepareAnimaPoseClipV2 } from "./prepareV2";
import { sampleAnimaPoseClip } from "./sampling";
import type {
  AnimaPoseClip,
  AnimaPoseClipPoseResolver,
  AnimaPoseClipSampleResult,
} from "./schema";

/**
 * What a player needs from a clip of either schema, prepared once when it
 * starts: 1.0 clips sample their keyframes; 2.0 clips are prepared for the
 * Avatar (hand presets fitted, planted legs solved on its rig).
 */
export type AnimaPoseClipProgram = {
  /** Whether the clip moves the body or face (otherwise it only times events). */
  readonly hasPose: boolean;
  /** Expressions the clip keys, which take precedence over emotion while it plays. */
  readonly expressionNames: readonly string[];
  /**
   * The sample at a playback time: loops wrap and one-shots hold their ends.
   * `atEnd` ignores the time and samples the final frame of a cycle, which a
   * loop would otherwise wrap to its start.
   */
  sample(
    playbackTimeSec: number,
    options?: { atEnd?: boolean },
  ): AnimaPoseClipSampleResult;
};

export type AnimaPoseClipProgramOptions = {
  /** The Avatar that plays the clip (needed for 2.0 hands and planted feet). */
  vrm?: VRM | null;
  resolvePose: AnimaPoseClipPoseResolver;
};

/** Prepare a parsed clip for playback. */
export function createAnimaPoseClipProgram(
  clip: AnyAnimaPoseClip,
  options: AnimaPoseClipProgramOptions,
): AnimaPoseClipProgram {
  return isAnimaPoseClipV2(clip)
    ? createV2Program(clip, options)
    : createV1Program(clip, options.resolvePose);
}

function createV1Program(
  value: AnimaPoseClip,
  resolvePose: AnimaPoseClipPoseResolver,
): AnimaPoseClipProgram {
  // Parsed here once; the sampler then reuses the parsed clips every frame.
  const clip = parseAnyAnimaPoseClip(value) as AnimaPoseClip;
  const unwrapped = clip.loop
    ? (parseAnyAnimaPoseClip({ ...clip, loop: false }) as AnimaPoseClip)
    : clip;
  const end = getAnimaPoseClipTimelineDuration(clip);
  const expressionNames = new Set<string>();
  for (const keyframe of clip.poseKeyframes) {
    const { sample } = sampleAnimaPoseClip(clip, keyframe.time, resolvePose);
    for (const name of Object.keys(sample.expressions ?? {}))
      expressionNames.add(name);
  }
  return {
    hasPose: clip.poseKeyframes.length > 0,
    expressionNames: [...expressionNames],
    sample: (time, sampleOptions) =>
      sampleOptions?.atEnd
        ? sampleAnimaPoseClip(unwrapped, end, resolvePose)
        : sampleAnimaPoseClip(clip, time, resolvePose),
  };
}

function createV2Program(
  clip: Parameters<typeof prepareAnimaPoseClipV2>[0],
  { vrm, resolvePose }: AnimaPoseClipProgramOptions,
): AnimaPoseClipProgram {
  const missingPoseRefs =
    clip.basePose && !resolvePose(clip.basePose) ? [clip.basePose] : [];
  const prepared = prepareAnimaPoseClipV2(clip, { vrm, resolvePose });
  // Just before the cycle's end: a loop would otherwise wrap to its start.
  const end = Math.max(0, clip.duration - 1e-6);
  return {
    hasPose: animaPoseClipHasPose(clip),
    expressionNames: prepared.expressionNames,
    sample: (time, sampleOptions) => ({
      sample: prepared.sample(sampleOptions?.atEnd ? end : time),
      diagnostics: { missingPoseRefs: [...missingPoseRefs] },
    }),
  };
}
