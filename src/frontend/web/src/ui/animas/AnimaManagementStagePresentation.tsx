import type { AnimaRosterLayout } from "@/lib/animas/anima-roster-layout";

export type AnimaShowcaseCamera = {
  position: [number, number, number];
  fov: number;
};

/**
 * Breakpoint-specific framing. Lower a preset's Z value to move closer to the
 * avatar and raise it to pull back while preserving the perspective.
 */
export const ANIMA_SHOWCASE_CAMERAS: Record<
  AnimaRosterLayout,
  AnimaShowcaseCamera
> = {
  phone: { position: [0, 0.85, 6.3], fov: 28 },
  tablet: { position: [0, 0.85, 5], fov: 28 },
  desktop: { position: [0, 0.85, 4.5], fov: 28 },
};

export const ANIMA_SHOWCASE_ORBIT_TARGET: [number, number, number] = [
  0, 0.65, 0,
];

export function AnimaPageBackdrop() {
  return <div className="bg-background absolute inset-0" />;
}
