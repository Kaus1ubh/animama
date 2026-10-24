import compositions from "./arkitFaceCompositions.json";
import type { ArkitFaceCapability } from "./arkitFaceCapability";

/**
 * The ARKit mixes that play VRM and VRoid face names on ARKit Avatars.
 *
 * Emotions, Reactions and Gestures key the VRM mood presets (`happy`, `sad` …)
 * and VRoid's per-feature parts (`Fcl_BRW_Joy`, `Fcl_EYE_Sorrow`,
 * `Fcl_MTH_Fun` …). An Avatar converted from VRChat usually has neither, but
 * carries ARKit shapes. `arkitFaceCompositions.json` gives each mood a mix of
 * ARKit shapes split into brow, eye and mouth regions: `Fcl_BRW_<Mood>`,
 * `Fcl_EYE_<Mood>` and `Fcl_MTH_<Mood>` are one region each, and the preset
 * and `Fcl_ALL_<Mood>` all three. Its `parts` list the other VRoid parts
 * content keys. `arkitFaceExpressions.ts` registers these mixes as expressions;
 * `vrm:bake-expressions` writes the mood presets into a file.
 */

export type ArkitMix = Readonly<Record<string, number>>;
type FaceRegion = "brow" | "eye" | "mouth";

/** The VRM mood presets the table defines, by VRoid mood name. */
const PRESET_BY_MOOD: Readonly<Record<string, string>> = {
  Joy: "happy",
  Fun: "relaxed",
  Sorrow: "sad",
  Surprised: "surprised",
  Angry: "angry",
};

const REGIONS_BY_PART: Readonly<Record<string, readonly FaceRegion[]>> = {
  ALL: ["brow", "eye", "mouth"],
  BRW: ["brow"],
  EYE: ["eye"],
  MTH: ["mouth"],
};

const MOODS = compositions.moods as Readonly<
  Record<string, Readonly<Record<FaceRegion, ArkitMix>>>
>;

/** Combine mixes; a shape in several keeps its largest value. */
function mergeMixes(mixes: readonly ArkitMix[]): ArkitMix {
  const merged: Record<string, number> = {};
  for (const mix of mixes) {
    for (const [shape, value] of Object.entries(mix)) {
      merged[shape] = Math.max(merged[shape] ?? 0, value);
    }
  }
  return merged;
}

/** The ARKit mix for each VRM mood preset at weight 1. */
export const ARKIT_MOOD_MIXES: Readonly<Record<string, ArkitMix>> =
  Object.fromEntries(
    Object.entries(MOODS).map(([preset, regions]) => [
      preset,
      mergeMixes(Object.values(regions)),
    ]),
  );

/** The ARKit mix for each VRoid part the table covers, at weight 1. */
export const ARKIT_PART_MIXES: Readonly<Record<string, ArkitMix>> = {
  ...Object.fromEntries(
    Object.entries(PRESET_BY_MOOD).flatMap(([mood, preset]) =>
      Object.entries(REGIONS_BY_PART).map(([part, regions]) => [
        `Fcl_${part}_${mood}`,
        mergeMixes(regions.map((region) => MOODS[preset]![region])),
      ]),
    ),
  ),
  ...(compositions.parts as Readonly<Record<string, ArkitMix>>),
};

/** Every ARKit shape the table uses. */
export const ARKIT_COMPOSITION_SHAPES: ReadonlySet<string> = new Set(
  [
    ...Object.values(ARKIT_MOOD_MIXES),
    ...Object.values(ARKIT_PART_MIXES),
  ].flatMap((mix) => Object.keys(mix)),
);

/**
 * Whether an Avatar plays faces through ARKit mixes: it must have every shape
 * the table uses, so no mood loses a region to a missing shape. Avatars with
 * only some ARKit shapes keep their own presets and the preset fallback.
 */
export function playsFacesWithArkit(capability: ArkitFaceCapability): boolean {
  return [...ARKIT_COMPOSITION_SHAPES].every((shape) =>
    capability.resolved.has(shape),
  );
}
