import type { PyAnimaIdleStyle } from "@animama/runtime-contracts/api-types";
import { TRACKED_EMOTIONS, type TrackedEmotion } from "@/lib/emotion";
import {
  IDLE_INTENSITIES,
  type IdleIntensity,
} from "@/lib/content/idleStyleDocument";

/**
 * One pool row: the Style's Default pool (`emotion` and `intensity` null) or
 * one emotion/intensity cell. Display labels are worded by the component.
 */
export type IdleStyleAssignment = {
  key: string;
  emotion: TrackedEmotion | null;
  intensity: IdleIntensity | null;
  gestureRefs: string[];
  gestureNames: string[];
  mode: "default" | "inherit" | "pool" | "none";
};

/** Present Style-owned cells without recreating a per-Anima override layer. */
export function presentIdleStyle(
  style: PyAnimaIdleStyle,
): IdleStyleAssignment[] {
  if (style.state === "empty") return [];
  const names = new Map(
    (style.gestures ?? []).map((gesture) => [
      gesture.logical_key,
      gesture.name,
    ]),
  );
  const defaultPool = style.default_pool ?? [];
  return [
    {
      key: "default",
      emotion: null,
      intensity: null,
      gestureRefs: defaultPool,
      gestureNames: defaultPool.map((ref) => names.get(ref) ?? ref),
      mode: "default",
    },
    ...[...TRACKED_EMOTIONS].sort().flatMap((emotion) =>
      IDLE_INTENSITIES.map((intensity): IdleStyleAssignment => {
        const cell = style.cells?.[emotion]?.[intensity];
        const pool = !cell
          ? defaultPool
          : cell.mode === "none"
            ? []
            : cell.gestures;
        return {
          key: `${emotion}:${intensity}`,
          emotion,
          intensity,
          gestureRefs: pool,
          gestureNames: pool.map((ref) => names.get(ref) ?? ref),
          mode: cell?.mode ?? "inherit",
        };
      }),
    ),
  ];
}
