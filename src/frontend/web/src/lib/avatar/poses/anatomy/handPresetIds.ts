/**
 * Hands-tool preset ids, adjustment limits and the per-finger offset
 * vocabulary. Kept free of imports so the clip schema can validate hand keys
 * without loading the pose catalog. The backend validator mirrors these
 * through the shared `animaPoseClip/fixtures/v2-vocabulary.json`.
 */
export const HAND_PRESETS = [
  { id: "fist", name: "Fist" },
  { id: "open-spread", name: "Open · spread" },
  { id: "open-together", name: "Open · together" },
  { id: "relaxed", name: "Relaxed" },
  { id: "point", name: "Point" },
  { id: "peace", name: "Peace" },
  { id: "thumbs-up", name: "Thumbs up" },
  { id: "cupped", name: "Cupped" },
  { id: "soft-claw", name: "Soft claw" },
  { id: "palm-flat", name: "Palm flat" },
  { id: "pinch", name: "Pinch" },
  { id: "ok", name: "OK" },
] as const;

export type HandPreset = (typeof HAND_PRESETS)[number]["id"];

/** Largest relative Curl and Spread, in degrees. */
export const HAND_ADJUSTMENT_LIMITS = { curl: 90, spread: 30 } as const;

/** Digits a hand key can offset, thumb first. */
export const HAND_DIGITS = [
  "thumb",
  "index",
  "middle",
  "ring",
  "little",
] as const;

export type HandDigit = (typeof HAND_DIGITS)[number];

/**
 * Per-finger offsets a hand key accepts, by digit: the joint-model components
 * it may offset (`fields`) and the segments a per-segment `curl` lists, in
 * order. `curl` applies to every segment; the other fields offset the
 * proximal segment only. The thumb metacarpal is never offset.
 */
export const HAND_DIGIT_OFFSETS = {
  thumb: {
    fields: ["curl", "palmarAbduction", "twist"],
    segments: ["proximal", "distal"],
  },
  index: {
    fields: ["curl", "splay"],
    segments: ["proximal", "intermediate", "distal"],
  },
  middle: {
    fields: ["curl", "splay"],
    segments: ["proximal", "intermediate", "distal"],
  },
  ring: {
    fields: ["curl", "splay"],
    segments: ["proximal", "intermediate", "distal"],
  },
  little: {
    fields: ["curl", "splay"],
    segments: ["proximal", "intermediate", "distal"],
  },
} as const satisfies Record<
  HandDigit,
  { fields: readonly string[]; segments: readonly string[] }
>;

/**
 * One digit's offsets on a hand key, in the joint model's degrees: `curl` on
 * every segment (one value, or one per segment in `HAND_DIGIT_OFFSETS` order),
 * proximal `splay` for fingers, and proximal `palmarAbduction` and `twist` for
 * the thumb.
 */
export type HandDigitOffset = {
  curl?: number | number[];
  splay?: number;
  palmarAbduction?: number;
  twist?: number;
};

/** Largest per-finger offset, in degrees either side of zero. */
export const HAND_FINGER_OFFSET_LIMIT = 90;
