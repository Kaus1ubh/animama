import type { VRM } from "@pixiv/three-vrm";

import { animaPoseClipHasPose } from "./parseClip";
import { prepareAnimaPoseClipV2 } from "./prepareV2";
import type {
  AnimaPoseClipPoseResolver,
  AnimaPoseClipSampleResult,
} from "./clipVocabulary";
import type { AnimaPoseClipV2 } from "./schemaV2";

/**
 * What a player needs from a clip, prepared once when it starts for the
 * Avatar (hand presets fitted, planted legs and solved contacts solved on its
 * rig).
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
  /**
   * The Avatar that plays the clip (needed for 2.0 hands, planted feet and
   * solved contacts).
   */
  vrm?: VRM | null;
  resolvePose: AnimaPoseClipPoseResolver;
  /**
   * Solve contacts that declare `solve` on the Avatar's arms (default true).
   * False plays the authored arms, as the motion checks measure them before
   * solving.
   */
  solveContacts?: boolean;
};

/** Prepare a parsed clip for playback. */
export function createAnimaPoseClipProgram(
  clip: AnimaPoseClipV2,
  { vrm, resolvePose, solveContacts }: AnimaPoseClipProgramOptions,
): AnimaPoseClipProgram {
  const missingPoseRefs =
    clip.basePose && !resolvePose(clip.basePose) ? [clip.basePose] : [];
  const prepared = prepareAnimaPoseClipV2(clip, {
    vrm,
    resolvePose,
    solveContacts,
  });
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
