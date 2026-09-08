"use client";

import type {
  AvatarVFXAnimationConfig,
  AvatarVFXAnimationPreset,
  AvatarVFXRotationDirection,
  AvatarVFXResolvedAnimationConfig,
} from "./types";

export type AvatarVFXAnimationState = {
  scale: number;
  rotationRadians: number;
  driftX: number;
  driftY: number;
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

export function evaluateAvatarVFXAnimation(args: {
  elapsedSec: number;
  config: AvatarVFXResolvedAnimationConfig;
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

  return {
    scale,
    rotationRadians,
    driftX,
    driftY,
  };
}
