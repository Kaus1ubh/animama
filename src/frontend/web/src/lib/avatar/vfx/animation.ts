"use client";

import type {
  AvatarVFXAnimationConfig,
  AvatarVFXAnimationPreset,
  AvatarVFXFlipbook,
  AvatarVFXKeyframe,
  AvatarVFXKeyframes,
  AvatarVFXRotationDirection,
  AvatarVFXResolvedAnimationConfig,
} from "./types";

/**
 * Motion at one moment of an effect's own timeline. Presets and keyframes are
 * combined: scale and opacity multiply, rotation and offsets add. `drift*` are
 * fractions of the art's size; `offset*` use the attachment's offset units.
 */
export type AvatarVFXAnimationState = {
  scale: number;
  rotationRadians: number;
  driftX: number;
  driftY: number;
  offsetX: number;
  offsetY: number;
  opacity: number;
  /** Flipbook frame index, 0 without a flipbook. */
  frame: number;
};

export const DEFAULT_AVATAR_VFX_ANIMATION_CONFIG: AvatarVFXResolvedAnimationConfig =
  {
    pulseEnabled: false,
    pulseScaleMin: 0.92,
    pulseScaleMax: 1.08,
    pulseCyclesPerSecond: 2,
    spinEnabled: false,
    rotationAmountTurns: 1,
    rotationRadiansPerSecond: 1.2,
    rotationDirection: "counterclockwise",
    driftEnabled: false,
    driftPerSecond: {
      x: 0.03,
      y: 0,
    },
  };

function resolveFiniteNumber(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function hasFiniteNumber(value: number | undefined): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function clampMinScale(value: number): number {
  return Math.max(0.0001, value);
}

function resolveRotationDirection(
  value: AvatarVFXAnimationConfig["rotationDirection"] | undefined,
): AvatarVFXRotationDirection {
  return value === "clockwise" ? "clockwise" : "counterclockwise";
}

function wrap(value: number, length: number): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  return ((value % length) + length) % length;
}

function pingPong(value: number, length: number): number {
  if (!Number.isFinite(length) || length <= 0) return 0;
  const cycleLength = length * 2;
  const wrapped = ((value % cycleLength) + cycleLength) % cycleLength;
  return wrapped <= length ? wrapped : cycleLength - wrapped;
}

export function resolveAvatarVFXAnimationConfig(
  config?: AvatarVFXAnimationConfig | null,
): AvatarVFXResolvedAnimationConfig {
  const pulseEnabled = Boolean(
    hasFiniteNumber(config?.pulseScaleMin) ||
    hasFiniteNumber(config?.pulseScaleMax) ||
    hasFiniteNumber(config?.pulseCyclesPerSecond),
  );
  const pulseScaleMin = clampMinScale(
    resolveFiniteNumber(
      config?.pulseScaleMin,
      DEFAULT_AVATAR_VFX_ANIMATION_CONFIG.pulseScaleMin,
    ),
  );
  const pulseScaleMax = clampMinScale(
    resolveFiniteNumber(
      config?.pulseScaleMax,
      DEFAULT_AVATAR_VFX_ANIMATION_CONFIG.pulseScaleMax,
    ),
  );
  const spinEnabled = Boolean(
    hasFiniteNumber(config?.rotationAmountTurns) ||
    hasFiniteNumber(config?.rotationRadiansPerSecond) ||
    typeof config?.rotationDirection === "string",
  );
  const driftEnabled = Boolean(
    hasFiniteNumber(config?.driftPerSecond?.x) ||
    hasFiniteNumber(config?.driftPerSecond?.y),
  );

  return {
    pulseEnabled,
    pulseScaleMin,
    pulseScaleMax,
    pulseCyclesPerSecond: resolveFiniteNumber(
      config?.pulseCyclesPerSecond,
      DEFAULT_AVATAR_VFX_ANIMATION_CONFIG.pulseCyclesPerSecond,
    ),
    spinEnabled,
    rotationAmountTurns: Math.max(
      0,
      resolveFiniteNumber(
        config?.rotationAmountTurns,
        DEFAULT_AVATAR_VFX_ANIMATION_CONFIG.rotationAmountTurns,
      ),
    ),
    rotationRadiansPerSecond: resolveFiniteNumber(
      config?.rotationRadiansPerSecond,
      DEFAULT_AVATAR_VFX_ANIMATION_CONFIG.rotationRadiansPerSecond,
    ),
    rotationDirection: resolveRotationDirection(config?.rotationDirection),
    driftEnabled,
    driftPerSecond: {
      x: resolveFiniteNumber(
        config?.driftPerSecond?.x,
        DEFAULT_AVATAR_VFX_ANIMATION_CONFIG.driftPerSecond.x,
      ),
      y: resolveFiniteNumber(
        config?.driftPerSecond?.y,
        DEFAULT_AVATAR_VFX_ANIMATION_CONFIG.driftPerSecond.y,
      ),
    },
  };
}

export function deriveAvatarVFXAnimationPreset(
  config?: AvatarVFXAnimationConfig | null,
): AvatarVFXAnimationPreset | null {
  const resolved = resolveAvatarVFXAnimationConfig(config);
  const { pulseEnabled, spinEnabled, driftEnabled } = resolved;

  if (!pulseEnabled && !spinEnabled && !driftEnabled) {
    return "none";
  }
  if (pulseEnabled && spinEnabled && !driftEnabled) {
    return "pulse_spin";
  }
  if (pulseEnabled && !spinEnabled && !driftEnabled) {
    return "pulse";
  }
  if (!pulseEnabled && spinEnabled && !driftEnabled) {
    return "spin";
  }
  if (!pulseEnabled && !spinEnabled && driftEnabled) {
    return "drift";
  }
  return null;
}

type KeyframeChannel = "opacity" | "scale" | "rotation" | "offsetX" | "offsetY";

function keyframeChannel(
  frame: AvatarVFXKeyframe,
  channel: KeyframeChannel,
): number | undefined {
  if (channel === "offsetX") return frame.offset?.x;
  if (channel === "offsetY") return frame.offset?.y;
  return frame[channel];
}

/** Linear interpolation of one channel between the keyframes that define it. */
function sampleKeyframeChannel(
  frames: readonly AvatarVFXKeyframe[],
  channel: KeyframeChannel,
  time: number,
  fallback: number,
): number {
  let previous: AvatarVFXKeyframe | null = null;
  for (const frame of frames) {
    const value = keyframeChannel(frame, channel);
    if (value === undefined) continue;
    if (frame.t >= time) {
      if (!previous) return value;
      const start = keyframeChannel(previous, channel)!;
      const span = frame.t - previous.t;
      const alpha = span > 0 ? (time - previous.t) / span : 1;
      return start + (value - start) * alpha;
    }
    previous = frame;
  }
  return previous ? keyframeChannel(previous, channel)! : fallback;
}

/**
 * Sample keyframes on the effect's own timeline. A looping timeline repeats
 * every last-keyframe time; otherwise the last values hold.
 */
export function evaluateAvatarVFXKeyframes(
  keyframes: AvatarVFXKeyframes,
  elapsedSec: number,
): {
  opacity: number;
  scale: number;
  rotation: number;
  offsetX: number;
  offsetY: number;
} {
  const frames = keyframes.frames;
  const end = frames[frames.length - 1]?.t ?? 0;
  const time =
    keyframes.loop && end > 0 ? wrap(elapsedSec, end) : Math.max(0, elapsedSec);
  return {
    opacity: Math.min(
      1,
      Math.max(0, sampleKeyframeChannel(frames, "opacity", time, 1)),
    ),
    scale: Math.max(0.0001, sampleKeyframeChannel(frames, "scale", time, 1)),
    rotation: sampleKeyframeChannel(frames, "rotation", time, 0),
    offsetX: sampleKeyframeChannel(frames, "offsetX", time, 0),
    offsetY: sampleKeyframeChannel(frames, "offsetY", time, 0),
  };
}

/** Flipbook frame index at a time; `once` holds the last frame. */
export function resolveAvatarVFXFlipbookFrame(
  flipbook: AvatarVFXFlipbook,
  elapsedSec: number,
): number {
  const count = Math.max(1, Math.floor(flipbook.frames));
  if (count === 1) return 0;
  const step = Math.max(0, Math.floor(elapsedSec * flipbook.fps));
  if (flipbook.loop === "once") return Math.min(step, count - 1);
  if (flipbook.loop === "pingpong") {
    const period = (count - 1) * 2;
    const position = step % period;
    return position < count ? position : period - position;
  }
  return step % count;
}

export function evaluateAvatarVFXAnimation(args: {
  elapsedSec: number;
  config: AvatarVFXResolvedAnimationConfig;
  keyframes?: AvatarVFXKeyframes;
  flipbook?: AvatarVFXFlipbook;
}): AvatarVFXAnimationState {
  const { elapsedSec, config } = args;

  let scale = 1;
  let rotationRadians = 0;
  let driftX = 0;
  let driftY = 0;

  if (config.pulseEnabled) {
    const oscillation =
      (Math.sin(elapsedSec * Math.PI * 2 * config.pulseCyclesPerSecond) + 1) *
      0.5;
    scale =
      config.pulseScaleMin +
      (config.pulseScaleMax - config.pulseScaleMin) * oscillation;
  }
  if (config.spinEnabled) {
    const maxRotationRadians = config.rotationAmountTurns * Math.PI * 2;
    const directionMultiplier =
      config.rotationDirection === "clockwise" ? -1 : 1;
    const rotationProgress =
      config.rotationAmountTurns < 1
        ? pingPong(
            elapsedSec * config.rotationRadiansPerSecond,
            maxRotationRadians,
          )
        : wrap(
            elapsedSec * config.rotationRadiansPerSecond,
            maxRotationRadians,
          );
    rotationRadians = rotationProgress * directionMultiplier;
  }
  if (config.driftEnabled) {
    driftX = elapsedSec * config.driftPerSecond.x;
    driftY = elapsedSec * config.driftPerSecond.y;
  }

  let opacity = 1;
  let offsetX = 0;
  let offsetY = 0;
  if (args.keyframes) {
    const sampled = evaluateAvatarVFXKeyframes(args.keyframes, elapsedSec);
    scale *= sampled.scale;
    rotationRadians += sampled.rotation;
    opacity = sampled.opacity;
    offsetX = sampled.offsetX;
    offsetY = sampled.offsetY;
  }

  return {
    scale,
    rotationRadians,
    driftX,
    driftY,
    offsetX,
    offsetY,
    opacity,
    frame: args.flipbook
      ? resolveAvatarVFXFlipbookFrame(args.flipbook, elapsedSec)
      : 0,
  };
}
