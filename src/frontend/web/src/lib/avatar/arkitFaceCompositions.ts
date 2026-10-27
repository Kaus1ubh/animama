import compositions from "./arkitFaceCompositions.json";
import type { ArkitFaceCapability } from "./arkitFaceCapability";
import { VROID_MOOD_PRESETS } from "./vroidMoodParts";

export { isVroidMoodPart } from "./vroidMoodParts";

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
 * content keys. `arkitFaceExpressions.ts` registers these mixes as expressions,
 * region by region where the model and its MMD morphs leave one empty;
 * `vrm:bake-expressions` writes the mood presets into a file. Its `vowels` give
 * each `vowel5` lip-sync channel an ARKit mouth mix, which `ExpressionController`
 * plays instead of the viseme presets when ARKit lip-sync shaping is selected.
 */

export type ArkitMix = Readonly<Record<string, number>>;
/** A face region: VRoid's `BRW`, `EYE` and `MTH` parts. */
export type FaceRegion = "brow" | "eye" | "mouth";

const REGIONS_BY_PART: Readonly<Record<string, readonly FaceRegion[]>> = {
  ALL: ["brow", "eye", "mouth"],
  BRW: ["brow"],
  EYE: ["eye"],
  MTH: ["mouth"],
};

const MOODS = compositions.moods as Readonly<
  Record<string, Readonly<Record<FaceRegion, ArkitMix>>>
>;

/** Each VRM mood preset's ARKit mix, region by region, at weight 1. */
export const ARKIT_MOOD_REGION_MIXES: Readonly<
  Record<string, Readonly<Record<FaceRegion, ArkitMix>>>
> = MOODS;

/** Combine mixes; a shape in several keeps its largest value. */
export function mergeMixes(mixes: readonly ArkitMix[]): ArkitMix {
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

/**
 * The table's VRoid parts that are not one mood's region (`Fcl_MTH_Large`,
 * `Fcl_EYE_Close` …), at weight 1.
 */
export const ARKIT_NON_MOOD_PART_MIXES = compositions.parts as Readonly<
  Record<string, ArkitMix>
>;

/** The ARKit mix for each VRoid part the table covers, at weight 1. */
export const ARKIT_PART_MIXES: Readonly<Record<string, ArkitMix>> = {
  ...Object.fromEntries(
    Object.entries(VROID_MOOD_PRESETS).flatMap(([mood, preset]) =>
      Object.entries(REGIONS_BY_PART).map(([part, regions]) => [
        `Fcl_${part}_${mood}`,
        mergeMixes(regions.map((region) => MOODS[preset]![region])),
      ]),
    ),
  ),
  ...ARKIT_NON_MOOD_PART_MIXES,
};

/** Every ARKit shape the table's moods and parts use (not its vowels). */
export const ARKIT_COMPOSITION_SHAPES: ReadonlySet<string> = new Set(
  [
    ...Object.values(ARKIT_MOOD_MIXES),
    ...Object.values(ARKIT_PART_MIXES),
  ].flatMap((mix) => Object.keys(mix)),
);

/** The `vowel5` lip-sync channels, in frame order. */
export const VOWEL5_CHANNELS = ["A", "E", "I", "O", "U"] as const;
export type Vowel5Channel = (typeof VOWEL5_CHANNELS)[number];

/** The ARKit mouth mix for each `vowel5` channel at weight 1. */
export const ARKIT_VOWEL_MIXES = compositions.vowels as Readonly<
  Record<Vowel5Channel, ArkitMix>
>;

/** Every ARKit shape the vowel mixes use. */
export const ARKIT_VOWEL_SHAPES: ReadonlySet<string> = new Set(
  Object.values(ARKIT_VOWEL_MIXES).flatMap((mix) => Object.keys(mix)),
);

/**
 * Whether an Avatar can shape `vowel5` lip sync from ARKit shapes: it must
 * have every shape the vowel mixes use. The mood table's bar is separate, so
 * an Avatar may have one and not the other.
 */
export function shapesVowelsWithArkit(
  capability: ArkitFaceCapability,
): boolean {
  return [...ARKIT_VOWEL_SHAPES].every((shape) =>
    capability.resolved.has(shape),
  );
}

/**
 * The ARKit shape weights for one `vowel5` frame: each channel's mix scaled by
 * its value and summed, each shape clamped to 1. Every vowel shape is listed,
 * at 0 when no channel moves it, so a frame also releases the previous one.
 */
export function arkitVowelWeights(
  values: readonly number[],
): Record<string, number> {
  const weights: Record<string, number> = Object.fromEntries(
    [...ARKIT_VOWEL_SHAPES].map((shape) => [shape, 0]),
  );
  VOWEL5_CHANNELS.forEach((channel, index) => {
    const value = Math.max(0, Math.min(1, values[index] ?? 0));
    if (!value) return;
    for (const [shape, weight] of Object.entries(ARKIT_VOWEL_MIXES[channel])) {
      weights[shape] = Math.min(1, weights[shape]! + weight * value);
    }
  });
  return weights;
}
