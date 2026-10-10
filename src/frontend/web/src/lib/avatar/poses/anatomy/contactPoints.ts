/**
 * Contact vocabulary shared by the clip schema, the arm-contact solver
 * (`arms.ts`) and the motion checks. It has no imports, so the schema can use
 * it without loading the solver.
 */

/**
 * Where on a bone a contact is measured.
 *
 * - `joint`: the bone's origin (its joint with the parent).
 * - `tip`: finger bones only. The far end of the segment: the next joint of
 *   the digit, or, for the last segment, the pad extrapolated 0.8 of the
 *   segment's own length past its origin (the `fitPinch` convention).
 * - `palm`: hands only. A point on the palm surface halfway to the middle
 *   finger's base, 0.3 of that length toward the palm side (−Y in the hand's
 *   rest frame, since the canonical T-pose holds the palms down).
 */
export type ContactPoint = "joint" | "tip" | "palm";

export const CONTACT_POINTS: readonly ContactPoint[] = ["joint", "tip", "palm"];

/**
 * A hand or finger bone, with its side in group 1: what a solved contact
 * moves and what `facing` turns toward its target.
 */
export const HAND_OR_FINGER_BONE =
  /^(left|right)(Hand|Thumb|Index|Middle|Ring|Little)/;

/** A hand bone, the only bone with a `palm` point. */
export const HAND_BONE = /^(left|right)Hand$/;

/**
 * A finger segment, the only bone with a `tip` point; groups: side, digit,
 * segment.
 */
export const FINGER_BONE =
  /^(left|right)(Thumb|Index|Middle|Ring|Little)(Metacarpal|Proximal|Intermediate|Distal)$/;

/**
 * A bone that solving an arm moves (the upper arm and everything below it),
 * with its side in group 1. A solved contact cannot target its own arm.
 */
export const ARM_BONE =
  /^(left|right)(UpperArm|LowerArm|Hand|Thumb|Index|Middle|Ring|Little)/;
