/**
 * VRoid's mood part vocabulary, shared by the preset fallback
 * (`partExpressionFallback.ts`) and the ARKit mixes
 * (`arkitFaceCompositions.ts`).
 *
 * VRoid names each mood's per-feature morphs `Fcl_<Region>_<Mood>`: `ALL` is
 * the whole face, `BRW`, `EYE` and `MTH` its brows, eyes and mouth. Each mood's
 * VRM preset binds its whole-face morph.
 */

/** The VRM mood preset for each VRoid mood name. */
export const VROID_MOOD_PRESETS = {
  Joy: "happy",
  Fun: "relaxed",
  Sorrow: "sad",
  Surprised: "surprised",
  Angry: "angry",
} as const;

export type VroidMood = keyof typeof VROID_MOOD_PRESETS;
export type VroidPartRegion = "ALL" | "BRW" | "EYE" | "MTH";

const MOOD_PART = /^Fcl_(ALL|BRW|EYE|MTH)_(Joy|Fun|Sorrow|Surprised|Angry)$/;

/** A VRoid mood part's region, mood and preset, or null for other names. */
export function parseVroidMoodPart(name: string): {
  region: VroidPartRegion;
  mood: VroidMood;
  preset: string;
} | null {
  const match = MOOD_PART.exec(name);
  if (!match) return null;
  const mood = match[2] as VroidMood;
  return {
    region: match[1] as VroidPartRegion,
    mood,
    preset: VROID_MOOD_PRESETS[mood],
  };
}

/** Whether a name is one of VRoid's mood parts (`Fcl_BRW_Joy` …). */
export function isVroidMoodPart(name: string): boolean {
  return MOOD_PART.test(name);
}
