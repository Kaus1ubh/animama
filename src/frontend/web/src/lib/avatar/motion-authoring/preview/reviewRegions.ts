/** Body regions a review note may point at (shared by the page and the CLI). */
export const REVIEW_REGIONS = [
  "head",
  "face",
  "torso",
  "hips",
  "leftArm",
  "rightArm",
  "leftHand",
  "rightHand",
  "legs",
] as const;

export type ReviewRegion = (typeof REVIEW_REGIONS)[number];

/** Display labels; sides are the Avatar's own. */
export const REVIEW_REGION_LABELS: Record<ReviewRegion, string> = {
  head: "Head",
  face: "Face",
  torso: "Torso",
  hips: "Hips",
  leftArm: "Left arm",
  rightArm: "Right arm",
  leftHand: "Left hand",
  rightHand: "Right hand",
  legs: "Legs",
};
