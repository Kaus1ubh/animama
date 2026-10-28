import type * as THREE from "three";

/**
 * The parts of three-liltoon's `LilToonMaterial` that Animama's own passes
 * read, without importing the (lazily loaded) package.
 */
export type LilToonSurfaceFacts = {
  isLilToonMaterial?: boolean;
  /** `forward` for the surface; lilToon's helper passes use other values. */
  pass?: string;
  /** `opaque`, `cutout`, `transparent`, …; see three-liltoon's render modes. */
  renderMode?: string;
  /** lilToon's property values by their shader names (`_Invisible`, …). */
  lilToonProperties?: Record<string, unknown>;
};

/**
 * Whether a material is a three-liltoon surface pass, as lilToon's loader
 * builds it for a mesh: not one of lilToon's own outline or helper passes.
 */
export function isLilToonSurface(
  material: THREE.Material,
): material is THREE.Material & LilToonSurfaceFacts {
  const facts = material as THREE.Material & LilToonSurfaceFacts;
  return facts.isLilToonMaterial === true && facts.pass === "forward";
}
