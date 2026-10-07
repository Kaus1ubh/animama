/**
 * Hands-tool preset ids and adjustment limits. Kept free of imports so the
 * clip schema can validate hand keys without loading the pose catalog.
 */
export const HAND_PRESETS = [
  { id: "fist", name: "Fist" },
  { id: "open-spread", name: "Open · spread" },
  { id: "open-together", name: "Open · together" },
  { id: "relaxed", name: "Relaxed" },
  { id: "point", name: "Point" },
  { id: "peace", name: "Peace" },
  { id: "thumbs-up", name: "Thumbs up" },
] as const;

export type HandPreset = (typeof HAND_PRESETS)[number]["id"];

/** Largest relative Curl and Spread, in degrees. */
export const HAND_ADJUSTMENT_LIMITS = { curl: 90, spread: 30 } as const;
