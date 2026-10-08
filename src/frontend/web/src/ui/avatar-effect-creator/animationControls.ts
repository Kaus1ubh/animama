import type {
  AvatarEffectKeyframe,
  AvatarEffectMotion,
} from "@animama/runtime-contracts/api-types";

import { DEFAULT_AVATAR_VFX_ANIMATION_CONFIG } from "@/lib/avatar/vfx/animation";

export type AvatarEffectMotionPreset = "pulse" | "spin" | "drift";

const RADIANS_TO_DEGREES = 180 / Math.PI;

/** The values a newly enabled preset starts with. */
const PRESET_STARTS: Required<
  Pick<AvatarEffectMotion, AvatarEffectMotionPreset>
> = {
  pulse: { scaleMin: 0.9, scaleMax: 1.1, cyclesPerSecond: 1.5 },
  spin: { degreesPerSecond: 115, amountTurns: 1, direction: "clockwise" },
  drift: { x: 0, y: 0.08 },
};

/** Turn one preset on or off without discarding the others or the keyframes. */
export function toggleAvatarEffectMotion(
  motion: AvatarEffectMotion,
  preset: AvatarEffectMotionPreset,
  enabled: boolean,
): AvatarEffectMotion {
  const next = { ...motion };
  if (enabled) {
    if (!next[preset]) Object.assign(next, { [preset]: PRESET_STARTS[preset] });
  } else {
    delete next[preset];
  }
  return next;
}

/** A preset's values with the runtime defaults filled in, for the fields. */
export function resolvedAvatarEffectMotion(motion: AvatarEffectMotion) {
  const defaults = DEFAULT_AVATAR_VFX_ANIMATION_CONFIG;
  return {
    pulse: {
      enabled: Boolean(motion.pulse),
      scaleMin: motion.pulse?.scaleMin ?? defaults.pulseScaleMin,
      scaleMax: motion.pulse?.scaleMax ?? defaults.pulseScaleMax,
      cyclesPerSecond:
        motion.pulse?.cyclesPerSecond ?? defaults.pulseCyclesPerSecond,
    },
    spin: {
      enabled: Boolean(motion.spin),
      degreesPerSecond:
        motion.spin?.degreesPerSecond ??
        defaults.rotationRadiansPerSecond * RADIANS_TO_DEGREES,
      amountTurns: motion.spin?.amountTurns ?? defaults.rotationAmountTurns,
      direction: motion.spin?.direction ?? defaults.rotationDirection,
    },
    drift: {
      enabled: Boolean(motion.drift),
      x: motion.drift?.x ?? 0,
      y: motion.drift?.y ?? 0,
    },
  };
}

/** Keyframes the editor can hold; `/2` allows at most 64. */
export const MAX_AVATAR_EFFECT_KEYFRAMES = 64;

/**
 * Add a keyframe after the last one (or at 0 s), copying nothing: an omitted
 * channel is interpolated from the neighbouring keyframes.
 */
export function addAvatarEffectKeyframe(
  motion: AvatarEffectMotion,
): AvatarEffectMotion {
  const frames = motion.keyframes?.frames ?? [];
  if (frames.length >= MAX_AVATAR_EFFECT_KEYFRAMES) return motion;
  const last = frames.at(-1);
  const frame: AvatarEffectKeyframe = last
    ? { t: Math.round((last.t + 0.5) * 100) / 100 }
    : { t: 0, opacity: 1 };
  return {
    ...motion,
    keyframes: {
      loop: motion.keyframes?.loop ?? false,
      frames: [...frames, frame],
    },
  };
}

/** Replace or remove one keyframe; removing the last one removes the timeline. */
export function updateAvatarEffectKeyframe(
  motion: AvatarEffectMotion,
  index: number,
  frame: AvatarEffectKeyframe | null,
): AvatarEffectMotion {
  const frames = [...(motion.keyframes?.frames ?? [])];
  if (index < 0 || index >= frames.length) return motion;
  if (frame) frames[index] = frame;
  else frames.splice(index, 1);
  const next = { ...motion };
  if (frames.length)
    next.keyframes = { loop: motion.keyframes?.loop ?? false, frames };
  else delete next.keyframes;
  return next;
}

/** Index of the first keyframe whose time does not increase, or -1. */
export function avatarEffectKeyframeOrderError(
  motion: AvatarEffectMotion,
): number {
  const frames = motion.keyframes?.frames ?? [];
  return frames.findIndex(
    (frame, index) => index > 0 && !(frame.t > frames[index - 1]!.t),
  );
}
