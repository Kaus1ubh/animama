/**
 * Preset fallback for VRoid per-feature expressions.
 *
 * Content can key VRoid's per-feature morphs (`Fcl_BRW_Joy`, `Fcl_EYE_Sorrow`,
 * …) to shape brows, eyes and mouth separately — Reactions do, so the mouth
 * stays mostly closed under lip-sync. On VRoid models each whole-face morph
 * `Fcl_ALL_<Mood>` is exactly its brow + eye + mouth parts, and the VRM preset
 * for that mood binds the whole-face morph. An Avatar without the parts would
 * otherwise drop those keys and show no expression, so each missing whole-face,
 * brow or eye part drives its mood's VRM preset at the part's weight instead.
 * Mouth parts are left out: `Fcl_MTH_Fun` also shapes happy faces, so it cannot
 * name one mood.
 *
 * On Avatars that have the parts, an overlaid part (a Reaction's brows, say)
 * only fills the room its mood's whole-face preset leaves, because both move
 * the same vertices; `ExpressionController` applies that cap.
 */

import { parseVroidMoodPart } from "./vroidMoodParts";

/**
 * The VRM preset whose whole-face morph contains this VRoid part, mouth parts
 * included: at full weight the preset already moves the part's vertices fully.
 */
export function wholeFacePresetForPart(name: string): string | null {
  return parseVroidMoodPart(name)?.preset ?? null;
}

/** The VRM preset a VRoid whole-face, brow or eye part falls back to. */
export function fallbackPresetForPart(name: string): string | null {
  const part = parseVroidMoodPart(name);
  return part && part.region !== "MTH" ? part.preset : null;
}

/**
 * Replace each VRoid part the Avatar lacks with its mood's VRM preset. A preset
 * takes the largest weight among its missing parts and any value already keyed
 * for it; unsupported names without a fallback are dropped.
 *
 * @param supports Whether the Avatar has an expression of that name.
 */
export function resolvePartExpressionFallbacks(
  expressions: Readonly<Record<string, number>>,
  supports: (name: string) => boolean,
): Record<string, number> {
  const resolved: Record<string, number> = {};
  for (const [name, value] of Object.entries(expressions)) {
    if (supports(name)) {
      resolved[name] = Math.max(resolved[name] ?? 0, value);
      continue;
    }
    const preset = fallbackPresetForPart(name);
    if (preset && supports(preset)) {
      resolved[preset] = Math.max(resolved[preset] ?? 0, value);
    }
  }
  return resolved;
}
