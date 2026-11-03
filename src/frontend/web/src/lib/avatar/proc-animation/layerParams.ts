import * as THREE from "three";

/**
 * Parameter helpers shared by the procedural animation layers. Each sanitizer
 * turns a missing or non-finite setting into the layer's fallback.
 */

/** A layer's activation weight in [0, 1]; a missing value means fully active. */
export function sanitizeActivationWeight(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return THREE.MathUtils.clamp(value, 0, 1);
}

/** A finite value floored at zero, or `fallback` when it is missing. */
export function sanitizeNonNegativeNumber(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

/** A smoothing lag in [0, 1], or `fallback` when it is missing. */
export function sanitizeLag(
  value: number | undefined,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return THREE.MathUtils.clamp(value, 0, 1);
}

/** A uniform random value in [min, max); `min` when the range is empty. */
export function randomRange(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.random() * (max - min);
}
