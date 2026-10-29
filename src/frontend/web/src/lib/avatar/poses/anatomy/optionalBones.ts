import {
  VRMHumanBoneList,
  VRMHumanBoneParentMap,
  type VRMHumanBoneName,
  type VRMPose,
} from "@pixiv/three-vrm";
import { Quaternion } from "three";

import { FINGER_BONE } from "./contactPoints";

/**
 * Optional humanoid bones that Animama content uses, and what stands in for
 * them on a rig without them.
 *
 * VRM requires only the hips, spine, head and limbs. Gestures, poses and
 * contacts also move or touch the chest, upper chest, neck, shoulders, eyes
 * and every finger segment, which VRChat conversions and low-poly Avatars
 * often lack. Two fallbacks keep that content working:
 *
 * - Torso: in Gestures and poses, the rotation of a missing `chest` or
 *   `upperChest` folds into the nearest torso bone below it
 *   (`foldMissingTorsoRotations`), so a bend authored there still bends
 *   everything above it, and contacts on it use that bone (`upperChest`
 *   contacts at an estimated upper-chest joint; `contactStandIn` in
 *   `arms.ts`). Procedural layers still skip it.
 * - Fingers: contacts on a missing segment use the nearest segment of the
 *   same finger toward the hand. Its motion is skipped: on such a rig the
 *   remaining segment already carries the rest of the finger, and adding the
 *   missing joint's curl to it would bend that rigid tip into the palm.
 *
 * Nothing stands in for a missing neck, shoulder or eye, whose motion is
 * skipped as before.
 */

/** What a stand-in takes over from a missing optional bone. */
export type OptionalBoneCover = "motion_and_contacts" | "contacts" | "nothing";

/** A missing optional bone that content uses, and what replaces it. */
export type OptionalBoneStandIn = {
  bone: VRMHumanBoneName;
  /** The present bone that takes its place, or null when none does. */
  standIn: VRMHumanBoneName | null;
  /** What the stand-in takes over; `nothing` when there is none. */
  covers: OptionalBoneCover;
};

/** Torso bones whose rotation folds into a stand-in, parents first. */
const TORSO_BONES: readonly VRMHumanBoneName[] = ["chest", "upperChest"];

/**
 * The optional bones Animama's Gestures, poses and contacts move or touch,
 * in VRM order: the torso above the spine, neck, shoulders, eyes and every
 * finger segment (not the jaw or toes).
 */
export const CONTENT_OPTIONAL_BONES: readonly VRMHumanBoneName[] =
  VRMHumanBoneList.filter(
    (bone) =>
      TORSO_BONES.includes(bone) ||
      bone === "neck" ||
      bone === "leftShoulder" ||
      bone === "rightShoulder" ||
      bone === "leftEye" ||
      bone === "rightEye" ||
      FINGER_BONE.test(bone),
  );

/** The finger a segment belongs to (side and digit), or null. */
function fingerOf(bone: VRMHumanBoneName): string | null {
  const match = FINGER_BONE.exec(bone);
  return match ? `${match[1]}${match[2]}` : null;
}

/**
 * The present bone that stands in for `bone` on a rig without it: the
 * nearest present ancestor in the torso chain for `chest` and `upperChest`,
 * or in the same finger for a finger segment. `bone` itself when the rig has
 * it; null when nothing stands in (a neck, shoulder, eye, a finger with no
 * segment at all, or any other bone).
 */
export function standInBone(
  bone: VRMHumanBoneName,
  has: (bone: VRMHumanBoneName) => boolean,
): VRMHumanBoneName | null {
  if (has(bone)) return bone;
  const torso = TORSO_BONES.includes(bone);
  const finger = fingerOf(bone);
  if (!torso && !finger) return null;
  for (
    let parent = VRMHumanBoneParentMap[bone];
    parent;
    parent = VRMHumanBoneParentMap[parent]
  ) {
    // The torso falls back down to the spine; a finger stops at the hand.
    const sameChain = torso
      ? parent === "spine" || TORSO_BONES.includes(parent)
      : fingerOf(parent) === finger;
    if (!sameChain) return null;
    if (has(parent)) return parent;
  }
  return null;
}

/**
 * The content-used optional bones a rig lacks, each with its stand-in, in
 * VRM order. Empty for a complete rig (both Included Avatars).
 */
export function missingOptionalBones(
  has: (bone: VRMHumanBoneName) => boolean,
): OptionalBoneStandIn[] {
  return CONTENT_OPTIONAL_BONES.filter((bone) => !has(bone)).map((bone) => {
    const standIn = standInBone(bone, has);
    return {
      bone,
      standIn,
      covers:
        standIn === null
          ? "nothing"
          : TORSO_BONES.includes(bone)
            ? "motion_and_contacts"
            : "contacts",
    };
  });
}

/**
 * A missing optional bone and what stands in for it, in plain English for
 * support reports and `vrm:inspect` (the app's text comes from the catalogs).
 */
export function optionalBoneText({
  bone,
  standIn,
  covers,
}: OptionalBoneStandIn): string {
  switch (covers) {
    case "motion_and_contacts":
      return `${bone} (Gestures, poses and contacts use ${standIn})`;
    case "contacts":
      return `${bone} (contacts use ${standIn})`;
    case "nothing":
      return `${bone} (not moved)`;
  }
}

/** A missing torso bone and the present bone its rotation folds into. */
export type TorsoFold = { bone: VRMHumanBoneName; into: VRMHumanBoneName };

/**
 * The torso folds a rig needs, parents first; empty for a rig with a chest
 * and upper chest, so callers can skip folding at no per-frame cost.
 */
export function torsoFoldsFor(
  has: (bone: VRMHumanBoneName) => boolean,
): TorsoFold[] {
  return TORSO_BONES.flatMap((bone) => {
    const into = has(bone) ? null : standInBone(bone, has);
    return into ? [{ bone, into }] : [];
  });
}

/** The humanoid query the torso folds need. */
type BoneLookup = {
  getNormalizedBoneNode(bone: VRMHumanBoneName): unknown;
};

const foldsByHumanoid = new WeakMap<BoneLookup, readonly TorsoFold[]>();

/**
 * `torsoFoldsFor` a loaded rig, computed once per humanoid and cached, since
 * poses are applied every frame during some transitions. A humanoid's bones
 * do not change after load.
 */
export function torsoFoldsOf(humanoid: BoneLookup): readonly TorsoFold[] {
  let folds = foldsByHumanoid.get(humanoid);
  if (!folds) {
    folds = torsoFoldsFor((bone) =>
      Boolean(humanoid.getNormalizedBoneNode(bone)),
    );
    foldsByHumanoid.set(humanoid, folds);
  }
  return folds;
}

const scratchInto = new Quaternion();
const scratchFolded = new Quaternion();

/**
 * Fold the local rotations of torso bones the rig lacks into the bones below
 * them (`folds` from `torsoFoldsFor`): `into` becomes `into · bone` and the
 * missing bone's entry is removed, so every bone above keeps the world
 * rotation it would have on a complete rig (it pivots at `into`'s joint).
 * Returns `pose` unchanged when there is nothing to fold, otherwise a copy;
 * the input is never mutated. Works in any one basis (canonical or VRM 0
 * runtime), since folding commutes with the basis change.
 */
export function foldMissingTorsoRotations(
  pose: VRMPose,
  folds: readonly TorsoFold[],
): VRMPose {
  if (!folds.some(({ bone }) => pose[bone])) return pose;
  const folded: VRMPose = { ...pose };
  for (const { bone, into } of folds) {
    const rotation = folded[bone]?.rotation;
    delete folded[bone];
    if (!rotation) continue;
    const base = folded[into]?.rotation;
    if (base) scratchInto.fromArray(base);
    else scratchInto.identity();
    scratchFolded.fromArray(rotation);
    folded[into] = {
      ...folded[into],
      rotation: scratchInto.multiply(scratchFolded).toArray() as [
        number,
        number,
        number,
        number,
      ],
    };
  }
  return folded;
}
