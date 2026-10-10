import {
  VRMHumanBoneList,
  VRMHumanBoneParentMap,
  type VRM,
  type VRMHumanBoneName,
  type VRMPose,
} from "@pixiv/three-vrm";
import { Euler, MathUtils, Quaternion, Vector3 } from "three";

import { isVrm0 } from "../poseRetargeting";
import { JOINT_DEFINITIONS, type Side } from "./anatomy";
import {
  CONTACT_POINTS,
  FINGER_BONE,
  HAND_BONE,
  HAND_OR_FINGER_BONE,
  type ContactPoint,
} from "./contactPoints";

export {
  ARM_BONE,
  CONTACT_POINTS,
  FINGER_BONE,
  HAND_BONE,
  HAND_OR_FINGER_BONE,
  type ContactPoint,
} from "./contactPoints";

/**
 * Hand contacts that move the arm: a canonical skeleton for forward
 * kinematics, the contact points shared with the motion checks, contact solve
 * weights, and an analytic two-bone arm reach solver.
 *
 * Everything works in canonical model space: the space of an Avatar's
 * normalized rig, whose bones have identity rest rotations, expressed in the
 * canonical basis (the Avatar faces +Z, its own left is +X, up is +Y). A VRM 0
 * rig's offsets are turned into that basis, as in `PlantedLegSolver`, so
 * canonical pose rotations apply unchanged. This space equals the scene frame
 * the motion checks measure in (both Avatars face +Z after
 * `VRMUtils.rotateVRM0`), and a bone's canonical world rotation equals the
 * checks' "rest-aligned frame carried by the bone" (its raw world rotation
 * times the inverse of its raw rest world rotation).
 */

/** A bone's world transform in canonical model space. */
export type BoneFrame = { position: Vector3; rotation: Quaternion };

/** Rest height (head bone above the feet) that contact offsets are authored for. */
export const CONTACT_REFERENCE_HEIGHT = 1.25;

const NEXT_SEGMENT: Record<string, Record<string, string>> = {
  Thumb: { Metacarpal: "Proximal", Proximal: "Distal" },
  default: { Proximal: "Intermediate", Intermediate: "Distal" },
};
const PALM_REFERENCE_DIGITS = ["Middle", "Ring", "Index", "Little"] as const;
/** The distal pad sits about 0.8 of the segment's length past its joint. */
const TIP_EXTENSION = 0.8;
const PALM_ALONG = 0.5;
const PALM_DEPTH = 0.3;

/**
 * An Avatar's humanoid rest skeleton in canonical model space, built once per
 * Avatar (and per clip preparation).
 *
 * Each present humanoid bone's parent is its nearest present ancestor in
 * three-vrm's `VRMHumanBoneParentMap`, and its rest offset is the normalized
 * node position (three-vrm stores each normalized node at its rest world
 * offset from that ancestor).
 */
export class CanonicalSkeleton {
  /** Present bones, parents before children. */
  readonly bones: readonly VRMHumanBoneName[];
  /** Index of each bone's nearest present ancestor, or −1 for the root (hips). */
  readonly parents: readonly number[];
  private readonly indices = new Map<VRMHumanBoneName, number>();
  private readonly restOffsets: Vector3[] = [];
  private readonly restPositions: Vector3[] = [];
  /** Cached point offsets, per bone index and `CONTACT_POINTS` index. */
  private readonly pointOffsets: (Vector3 | null | undefined)[] = [];

  constructor(vrm: VRM) {
    const vrm0 = isVrm0(vrm);
    const bones: VRMHumanBoneName[] = [];
    const parents: number[] = [];
    // VRMHumanBoneList lists every parent before its children.
    for (const bone of VRMHumanBoneList) {
      const node = vrm.humanoid.getNormalizedBoneNode(bone);
      if (!node) continue;
      let parent = VRMHumanBoneParentMap[bone];
      while (parent && !this.indices.has(parent))
        parent = VRMHumanBoneParentMap[parent];
      const parentIndex = parent ? this.indices.get(parent)! : -1;
      const { x, y, z } = node.position;
      const offset = vrm0 ? new Vector3(-x, y, -z) : new Vector3(x, y, z);
      this.indices.set(bone, bones.length);
      bones.push(bone);
      parents.push(parentIndex);
      this.restOffsets.push(offset);
      this.restPositions.push(
        parentIndex < 0
          ? offset.clone()
          : offset.clone().add(this.restPositions[parentIndex]),
      );
    }
    if (!this.indices.has("hips"))
      throw new Error("The Avatar has no hips bone.");
    this.bones = bones;
    this.parents = parents;
  }

  has(bone: VRMHumanBoneName): boolean {
    return this.indices.has(bone);
  }

  /** Index of a present bone, or −1. */
  indexOf(bone: VRMHumanBoneName): number {
    return this.indices.get(bone) ?? -1;
  }

  /** The bone's nearest present humanoid ancestor, or null. */
  parentOf(bone: VRMHumanBoneName): VRMHumanBoneName | null {
    const parent = this.parents[this.indexOf(bone)] ?? -1;
    return parent < 0 ? null : this.bones[parent];
  }

  /**
   * Rest offset from the parent's joint, in canonical axes (for the hips: its
   * rest position). Shared; do not mutate. Null when the rig lacks the bone.
   */
  restOffset(bone: VRMHumanBoneName): Readonly<Vector3> | null {
    const index = this.indexOf(bone);
    return index < 0 ? null : this.restOffsets[index];
  }

  /** Rest (T-pose) position in canonical model space. Shared; do not mutate. */
  restPosition(bone: VRMHumanBoneName): Readonly<Vector3> | null {
    const index = this.indexOf(bone);
    return index < 0 ? null : this.restPositions[index];
  }

  /** Whether `bone` is `ancestor` or lies below it. */
  isWithin(bone: VRMHumanBoneName, ancestor: VRMHumanBoneName): boolean {
    const target = this.indexOf(ancestor);
    for (
      let index = this.indexOf(bone);
      index >= 0;
      index = this.parents[index]
    )
      if (index === target) return true;
    return false;
  }

  /**
   * A contact point's offset from the bone's origin, in the bone's rest-aligned
   * frame: its world position is `origin + worldRotation · offset`, where
   * `worldRotation` is the bone's canonical world rotation (in the checks, its
   * raw world rotation times the inverse raw rest world rotation). Shared; do
   * not mutate. Null when the rig lacks the bone.
   *
   * Throws when the point does not apply to the bone (`palm` on a non-hand,
   * `tip` on a non-finger); clip validation rejects those.
   */
  pointOffset(
    bone: VRMHumanBoneName,
    point: ContactPoint = "joint",
  ): Readonly<Vector3> | null {
    const kind = CONTACT_POINTS.indexOf(point);
    if (kind < 0) throw new Error(`Unknown contact point ${String(point)}.`);
    const slot = this.indexOf(bone) * CONTACT_POINTS.length;
    if (slot < 0) return null;
    const index = slot + kind;
    let offset = this.pointOffsets[index];
    if (offset === undefined) {
      offset = this.computePointOffset(bone, point);
      this.pointOffsets[index] = offset;
    }
    return offset;
  }

  /**
   * World transforms of `bones` (default: every present bone) for a canonical
   * pose, as fresh objects. Bones the rig lacks are left out. Use a reusable
   * `SkeletonPose` on hot paths.
   */
  frames(
    pose: VRMPose,
    bones: readonly VRMHumanBoneName[] = this.bones,
  ): Map<VRMHumanBoneName, BoneFrame> {
    const evaluated = new SkeletonPose(this).setPose(pose);
    const result = new Map<VRMHumanBoneName, BoneFrame>();
    for (const bone of bones) {
      const position = evaluated.position(bone);
      const rotation = evaluated.rotation(bone);
      if (position && rotation)
        result.set(bone, {
          position: position.clone(),
          rotation: rotation.clone(),
        });
    }
    return result;
  }

  private computePointOffset(
    bone: VRMHumanBoneName,
    point: ContactPoint,
  ): Vector3 | null {
    if (!this.has(bone)) return null;
    if (point === "joint") return new Vector3();
    if (point === "palm") {
      const side = HAND_BONE.exec(bone)?.[1];
      if (!side)
        throw new Error(`A palm contact point needs a hand bone, not ${bone}.`);
      for (const digit of PALM_REFERENCE_DIGITS) {
        const base = this.restOffset(
          `${side}${digit}Proximal` as VRMHumanBoneName,
        );
        if (base)
          return base
            .clone()
            .multiplyScalar(PALM_ALONG)
            .add(new Vector3(0, -PALM_DEPTH * base.length(), 0));
      }
      // A hand without fingers has no palm length: use the wrist joint.
      return new Vector3();
    }
    const match = FINGER_BONE.exec(bone);
    if (!match)
      throw new Error(`A tip contact point needs a finger bone, not ${bone}.`);
    const [, side, digit, segment] = match;
    const next = (NEXT_SEGMENT[digit] ?? NEXT_SEGMENT.default)[segment];
    const child = next
      ? this.restOffset(`${side}${digit}${next}` as VRMHumanBoneName)
      : null;
    if (child) return child.clone();
    return this.restOffset(bone)!.clone().multiplyScalar(TIP_EXTENSION);
  }
}

/**
 * Lazily evaluated forward kinematics of one canonical pose on a
 * `CanonicalSkeleton`. Reuse one instance per preparation: `setPose` loads a
 * sample, world frames are computed on demand, and `setLocalRotation`
 * replaces a bone's rotation (for example a solved arm) and invalidates its
 * descendants.
 *
 * Bones absent from the pose take the identity (T-pose) rotation, as
 * `applyCanonicalPose` does. The hips sit at their rest position plus the
 * pose's hips position.
 */
export class SkeletonPose {
  readonly skeleton: CanonicalSkeleton;
  private readonly local: Quaternion[];
  private readonly worldPositions: Vector3[];
  private readonly worldRotations: Quaternion[];
  private readonly valid: Uint8Array;
  private readonly children: number[][];
  private readonly hipsOffset = new Vector3();

  constructor(skeleton: CanonicalSkeleton) {
    this.skeleton = skeleton;
    const count = skeleton.bones.length;
    this.local = Array.from({ length: count }, () => new Quaternion());
    this.worldPositions = Array.from({ length: count }, () => new Vector3());
    this.worldRotations = Array.from({ length: count }, () => new Quaternion());
    this.valid = new Uint8Array(count);
    this.children = Array.from({ length: count }, () => []);
    skeleton.parents.forEach((parent, index) => {
      if (parent >= 0) this.children[parent].push(index);
    });
  }

  /** Load a canonical pose (a clip sample's `humanoid`). */
  setPose(pose: VRMPose): this {
    this.skeleton.bones.forEach((bone, index) => {
      const rotation = pose[bone]?.rotation;
      if (rotation) this.local[index].fromArray(rotation);
      else this.local[index].identity();
    });
    const position = pose.hips?.position;
    if (position) this.hipsOffset.fromArray(position);
    else this.hipsOffset.set(0, 0, 0);
    this.valid.fill(0);
    return this;
  }

  /** The bone's canonical local rotation. Shared; do not mutate. */
  localRotation(bone: VRMHumanBoneName): Readonly<Quaternion> | null {
    const index = this.skeleton.indexOf(bone);
    return index < 0 ? null : this.local[index];
  }

  /** Replace a bone's local rotation; its descendants are re-evaluated. */
  setLocalRotation(bone: VRMHumanBoneName, rotation: Quaternion): void {
    const index = this.skeleton.indexOf(bone);
    if (index < 0) throw new Error(`The Avatar has no ${bone} bone.`);
    this.local[index].copy(rotation);
    this.invalidate(index);
  }

  /** World position of the bone's joint. Shared; do not mutate. */
  position(bone: VRMHumanBoneName): Readonly<Vector3> | null {
    const index = this.skeleton.indexOf(bone);
    if (index < 0) return null;
    this.evaluate(index);
    return this.worldPositions[index];
  }

  /** World rotation of the bone (from its rest). Shared; do not mutate. */
  rotation(bone: VRMHumanBoneName): Readonly<Quaternion> | null {
    const index = this.skeleton.indexOf(bone);
    if (index < 0) return null;
    this.evaluate(index);
    return this.worldRotations[index];
  }

  /** World position of a contact point, written to `out`; null without the bone. */
  contactPoint(
    bone: VRMHumanBoneName,
    point: ContactPoint | undefined,
    out: Vector3,
  ): Vector3 | null {
    const offset = this.skeleton.pointOffset(bone, point);
    const position = this.position(bone);
    if (!offset || !position) return null;
    return out.copy(offset).applyQuaternion(this.rotation(bone)!).add(position);
  }

  private evaluate(index: number): void {
    if (this.valid[index]) return;
    const parent = this.skeleton.parents[index];
    const offset = this.skeleton.restOffset(this.skeleton.bones[index])!;
    const position = this.worldPositions[index];
    const rotation = this.worldRotations[index];
    if (parent < 0) {
      position.copy(offset).add(this.hipsOffset);
      rotation.copy(this.local[index]);
    } else {
      this.evaluate(parent);
      const parentRotation = this.worldRotations[parent];
      position
        .copy(offset)
        .applyQuaternion(parentRotation)
        .add(this.worldPositions[parent]);
      rotation.multiplyQuaternions(parentRotation, this.local[index]);
    }
    this.valid[index] = 1;
  }

  private invalidate(index: number): void {
    this.valid[index] = 0;
    for (const child of this.children[index]) this.invalidate(child);
  }
}

/**
 * The Avatar's size relative to the reference contacts are authored for:
 * rest head-bone height above the feet over `CONTACT_REFERENCE_HEIGHT`.
 * Contact offsets are multiplied by it.
 */
export function avatarScale(skeleton: CanonicalSkeleton): number {
  const head = skeleton.restPosition("head");
  const foot = skeleton.restPosition("leftFoot");
  if (!head || !foot) throw new Error("The Avatar lacks a head or foot bone.");
  return (head.y - foot.y) / CONTACT_REFERENCE_HEIGHT;
}

/** A contact's target point: `targetPoint` on `target`, moved by `offset`. */
export type ContactTargetSpec = {
  target: VRMHumanBoneName;
  targetPoint?: ContactPoint;
  /** Metres at the reference height, in the target's rest-aligned frame. */
  offset?: readonly [number, number, number];
};

/**
 * World position of a contact's target on this pose, with the offset scaled by
 * `scale` (see `avatarScale`), written to `out`; null when the rig lacks the
 * target bone.
 */
export function contactTargetPosition(
  pose: SkeletonPose,
  contact: ContactTargetSpec,
  scale: number,
  out: Vector3,
): Vector3 | null {
  if (!pose.contactPoint(contact.target, contact.targetPoint, out)) return null;
  const offset = contact.offset;
  if (offset)
    out.add(
      scratchOffset
        .set(offset[0] * scale, offset[1] * scale, offset[2] * scale)
        .applyQuaternion(pose.rotation(contact.target)!),
    );
  return out;
}

const scratchOffset = new Vector3();

/** A solved contact's window and ramps, in seconds of clip time. */
export type ContactSolveWindow = {
  start: number;
  end: number;
  blendIn: number;
  blendOut: number;
};

/**
 * How strongly a solved contact holds at clip time `t`: 1 inside
 * `[start, end]`, easing in over `blendIn` before it and out over `blendOut`
 * after it with smootherstep ramps, and 0 elsewhere. Loop clips wrap the
 * window and its ramps across the seam; one-shots clamp `t` to the clip.
 */
export function contactSolveWeight(
  window: ContactSolveWindow,
  t: number,
  duration: number,
  loop: boolean,
): number {
  const time = MathUtils.clamp(t, 0, duration);
  const at = (shifted: number) => {
    if (shifted < window.start) {
      const before = window.start - shifted;
      return before >= window.blendIn
        ? 0
        : smootherstep(1 - before / window.blendIn);
    }
    if (shifted > window.end) {
      const after = shifted - window.end;
      return after >= window.blendOut
        ? 0
        : smootherstep(1 - after / window.blendOut);
    }
    return 1;
  };
  if (!loop || duration <= 0) return at(time);
  return Math.max(at(time), at(time - duration), at(time + duration));
}

/**
 * Shorten the ramps of consecutive solved windows on one side so they never
 * overlap: where an out-ramp and the next in-ramp would cross, they meet at the
 * middle of the gap, or, when one ramp is shorter than half the gap, the other
 * takes the rest. Repeated contacts (claps) therefore chain through the
 * authored pose between them. Loop clips also pair the last window with the
 * first across the seam. Returns copies in the input order.
 */
export function fitContactSolveRamps<T extends ContactSolveWindow>(
  windows: readonly T[],
  duration: number,
  loop: boolean,
): T[] {
  const fitted = windows.map((window) => ({ ...window }));
  const order = fitted
    .map((window, index) => ({ window, index }))
    .sort((a, b) => a.window.start - b.window.start)
    .map(({ window }) => window);
  const pairs = order.length - (loop ? 0 : 1);
  for (let index = 0; index < pairs; index += 1) {
    const before = order[index];
    const after = order[(index + 1) % order.length];
    const gap = Math.max(
      0,
      index + 1 < order.length
        ? after.start - before.end
        : after.start + duration - before.end,
    );
    const out = before.blendOut;
    const into = after.blendIn;
    if (out + into <= gap) continue;
    const half = gap / 2;
    before.blendOut = Math.min(out, Math.max(half, gap - into));
    after.blendIn = Math.min(into, Math.max(half, gap - out));
  }
  return fitted;
}

function smootherstep(x: number): number {
  const t = MathUtils.clamp(x, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** The bone and point a solved contact moves. */
export type ContactEffector = { bone: VRMHumanBoneName; point?: ContactPoint };

/** New canonical local rotations for one arm, written by `ArmReachSolver.solve`. */
export type ArmReachResult = {
  upperArm: Quaternion;
  lowerArm: Quaternion;
  /**
   * Distance in metres from the pinned target left after solving: non-zero
   * for a target beyond reach or within the soft reach (`SOFT_REACH`).
   */
  error: number;
};

const LOWER_ARM_FLEXION = JOINT_DEFINITIONS.lowerArm.components.flexion;
const FLEXION_MIN = MathUtils.degToRad(LOWER_ARM_FLEXION.hard[0]);
const FLEXION_MAX = MathUtils.degToRad(LOWER_ARM_FLEXION.hard[1]);
const TWO_PI = Math.PI * 2;
const UP = new Vector3(0, 1, 0);
/**
 * Elbow offset from the shoulder→effector axis (as a fraction of the upper
 * arm's length) below which the elbow's swivel is undefined (a straight arm):
 * the swivel correction fades out between these values.
 */
const SWIVEL_FADE: [number, number] = [0.02, 0.08];
/**
 * Soft reach, metres: pinned distances in this last stretch of an arm's reach
 * saturate exponentially toward full reach instead of clamping at it. The
 * distance→flexion map has a square-root singularity at full extension, so a
 * hard clamp spins the elbow arbitrarily fast as a ramp drives the arm
 * straight. A target exactly at full reach misses by `SOFT_REACH / e`
 * (about 1.1 cm).
 */
export const SOFT_REACH = 0.03;

/**
 * Analytic two-bone reach for one arm on one Avatar: changes the upper arm and
 * elbow so a hand or finger contact point reaches a target, keeping the
 * authored collarbone (shoulder), elbow swivel, forearm rotation, wrist and
 * fingers.
 *
 * - Pin target: `T' = E + w (T − E)`, with `E` the authored effector. At
 *   `w = 0`, or when `T` is the authored effector, the authored pose returns
 *   unchanged, so weight ramps are continuous.
 * - Elbow: lowerArm flexion is the outermost (Y) axis of its YXZ Euler
 *   composition, so a flexion change is exactly a pre-multiplied rotation about
 *   the upper arm's +Y axis. The solver picks the smallest change that sets the
 *   shoulder→effector distance to `|T' − S|`, keeping supination and deviation
 *   exactly, within the flexion hard range (never further outside it than
 *   authored). Within `SOFT_REACH` of full reach the distance saturates
 *   smoothly (soft reach), so the elbow comes to rest as it straightens; a
 *   target beyond reach leaves the arm pointing at it, short of it. A distance
 *   inside the fold clamps.
 * - Upper arm: the minimal swing that points the arm at `T'`, then a turn about
 *   the shoulder→target axis that restores the authored elbow swivel: the
 *   elbow's direction about the authored shoulder→effector axis, carried to the
 *   new axis by the smallest rotation between them (faded out for a nearly
 *   straight arm, whose swivel is undefined).
 *
 * Mirroring keeps the flexion structure, so both sides share the maths; only
 * the flexion sign differs.
 */
export class ArmReachSolver {
  readonly side: Side;
  private readonly skeleton: CanonicalSkeleton;
  private readonly upperArm: VRMHumanBoneName;
  private readonly lowerArm: VRMHumanBoneName;
  private readonly parent: VRMHumanBoneName;
  /** Flexion = sign × the outer Y Euler angle of the local rotation. */
  private readonly flexionSign: number;
  /** Elbow joint offset from the shoulder joint (upper-arm frame). */
  private readonly elbow: Vector3;
  private readonly euler = new Euler();
  private readonly effector = new Vector3();
  private readonly reach = new Vector3();
  private readonly pinned = new Vector3();
  private readonly direction = new Vector3();
  private readonly axis = new Vector3();
  private readonly authoredAxis = new Vector3();
  private readonly authoredElbow = new Vector3();
  private readonly solvedElbow = new Vector3();
  private readonly cross = new Vector3();
  private readonly world = new Quaternion();
  private readonly turn = new Quaternion();
  private readonly flexion = new Quaternion();
  /** The loaded reach's distance terms (see `setReach`). */
  private readonly terms = { a: 0, b: 0, c: 0, base: 0 };
  /** Allowed elbow changes [low, high], radians (see `setReach`). */
  private readonly range: [number, number] = [0, 0];

  constructor(skeleton: CanonicalSkeleton, side: Side) {
    this.skeleton = skeleton;
    this.side = side;
    this.upperArm = `${side}UpperArm`;
    this.lowerArm = `${side}LowerArm`;
    const parent = skeleton.parentOf(this.upperArm);
    const elbow = skeleton.restOffset(this.lowerArm);
    if (!parent || !elbow || !skeleton.has(`${side}Hand`))
      throw new Error(`The Avatar lacks the ${side} arm bones.`);
    this.parent = parent;
    this.elbow = elbow.clone();
    this.flexionSign = (side === "left" ? 1 : -1) / LOWER_ARM_FLEXION.sign;
  }

  /** Whether solving this arm moves `bone` (the upper arm and everything below). */
  moves(bone: VRMHumanBoneName): boolean {
    return this.skeleton.isWithin(bone, this.upperArm);
  }

  /**
   * Solve the arm on `pose` so `effector` moves toward `target` (world) with
   * `weight` in [0, 1]. Returns new local rotations for the upper arm and
   * lower arm; `pose` is not changed. Throws when the effector is not on this
   * arm's hand or the rig lacks it (`solveArmContacts` skips missing bones).
   */
  solve(
    pose: SkeletonPose,
    effector: ContactEffector,
    target: Vector3,
    weight: number,
    out: ArmReachResult = {
      upperArm: new Quaternion(),
      lowerArm: new Quaternion(),
      error: 0,
    },
  ): ArmReachResult {
    if (
      effector.bone === this.lowerArm ||
      !this.skeleton.isWithin(effector.bone, this.lowerArm)
    )
      throw new Error(
        `${effector.bone} is not on the ${this.side} hand, so the ${this.side} arm cannot move it.`,
      );
    const shoulder = pose.position(this.upperArm)!;
    const parentRotation = pose.rotation(this.parent)!;
    const upperWorld = pose.rotation(this.upperArm)!;
    const lowerLocal = pose.localRotation(this.lowerArm)!;
    const effectorPosition = pose.contactPoint(
      effector.bone,
      effector.point,
      this.effector,
    );
    if (!effectorPosition)
      throw new Error(`The Avatar has no ${effector.bone} bone.`);

    // Elbow→effector in the upper arm's frame: the wrist and fingers stay as
    // authored, so the effector is fixed in the forearm's frame.
    const reach = this.reach
      .copy(effectorPosition)
      .sub(pose.position(this.lowerArm)!)
      .applyQuaternion(this.turn.copy(pose.rotation(this.lowerArm)!).invert())
      .applyQuaternion(lowerLocal);

    const w = MathUtils.clamp(Number.isFinite(weight) ? weight : 0, 0, 1);
    const pinned = this.pinned
      .copy(target)
      .sub(effectorPosition)
      .multiplyScalar(w)
      .add(effectorPosition);
    this.setReach(reach, lowerLocal);
    const distance = this.softReach(
      pinned.distanceTo(shoulder),
      effectorPosition.distanceTo(shoulder),
    );

    const change = this.elbowChange(distance);
    this.flexion.setFromAxisAngle(UP, change);
    out.lowerArm.multiplyQuaternions(this.flexion, lowerLocal);

    // Shoulder→effector after the elbow change, still in the upper arm's frame.
    reach.applyQuaternion(this.flexion).add(this.elbow);
    const direction = this.direction.copy(reach).applyQuaternion(upperWorld);
    const axis = this.axis.copy(pinned).sub(shoulder);
    const world = this.world.copy(upperWorld);
    const authoredAxis = this.authoredAxis.copy(effectorPosition).sub(shoulder);
    if (axis.lengthSq() > 1e-12 && direction.lengthSq() > 1e-12) {
      axis.normalize();
      world.premultiply(
        this.turn.setFromUnitVectors(direction.normalize(), axis),
      );
      if (authoredAxis.lengthSq() > 1e-12)
        this.restoreSwivel(world, upperWorld, authoredAxis.normalize(), axis);
    }
    out.upperArm.copy(parentRotation).invert().multiply(world);
    out.error = this.direction
      .copy(reach)
      .applyQuaternion(world)
      .add(shoulder)
      .distanceTo(pinned);
    return out;
  }

  /**
   * Load a reach (elbow→effector `v` in the upper arm's frame) and the
   * authored lower arm. As the elbow changes by Δ (applied as
   * `R_y(Δ) · lowerArm`), with `u` the elbow offset and `k = +Y`,
   * `|u + R_k(Δ) v|² = base + 2 (c + a cos Δ + b sin Δ)` where
   * `base = |u|² + |v|²`, `a = u·v − (u·k)(k·v)`, `b = u·(k × v)` and
   * `c = (u·k)(k·v)`. The allowed changes keep flexion within its hard range,
   * or no further outside it than authored.
   */
  private setReach(reach: Vector3, lowerLocal: Readonly<Quaternion>): void {
    const u = this.elbow;
    const terms = this.terms;
    terms.c = u.y * reach.y;
    terms.a = u.dot(reach) - terms.c;
    terms.b = u.x * reach.z - u.z * reach.x;
    terms.base = u.lengthSq() + reach.lengthSq();
    const flexion =
      this.flexionSign * this.euler.setFromQuaternion(lowerLocal, "YXZ").y;
    const low = Math.min(flexion, FLEXION_MIN) - flexion;
    const high = Math.max(flexion, FLEXION_MAX) - flexion;
    this.range[0] = this.flexionSign > 0 ? low : -high;
    this.range[1] = this.flexionSign > 0 ? high : -low;
  }

  /** `angle` shifted by whole turns into the allowed changes, or null. */
  private within(angle: number): number | null {
    const [low, high] = this.range;
    const shifted = angle + TWO_PI * Math.ceil((low - 1e-9 - angle) / TWO_PI);
    return shifted <= high + 1e-9 ? shifted : null;
  }

  /** `a cos Δ + b sin Δ` for the loaded reach. */
  private wave(change: number): number {
    return this.terms.a * Math.cos(change) + this.terms.b * Math.sin(change);
  }

  /** Full reach: the farthest shoulder→effector distance an allowed change gives. */
  private maxDistance(): number {
    const { a, b, c, base } = this.terms;
    const peak = this.within(Math.atan2(b, a));
    const best = Math.max(
      this.wave(this.range[0]),
      this.wave(this.range[1]),
      peak === null ? Number.NEGATIVE_INFINITY : this.wave(peak),
    );
    return Math.sqrt(Math.max(0, base + 2 * (c + best)));
  }

  /**
   * Soft reach: a pinned distance within `SOFT_REACH` of full reach saturates
   * exponentially toward it, with value and slope continuous where the knee
   * starts. The knee never starts below the authored distance, so a zero
   * weight still returns the authored arm; an arm authored closer to full
   * reach gets a narrower knee (and has less flexion left to change).
   */
  private softReach(distance: number, authored: number): number {
    const max = this.maxDistance();
    const start = Math.max(max - SOFT_REACH, authored);
    const knee = max - start;
    if (distance <= start || knee <= 0) return distance;
    return start + knee * (1 - Math.exp(-(distance - start) / knee));
  }

  /**
   * The flexion change Δ (radians, applied as `R_y(Δ) · lowerArm`) that puts
   * the effector at `distance` from the shoulder joint, closest to the
   * authored elbow, for the loaded reach (`setReach`).
   */
  private elbowChange(distance: number): number {
    const { a, b, c, base } = this.terms;
    const rho = Math.hypot(a, b);
    if (rho < 1e-9) return 0;
    const goal = (distance * distance - base) / 2 - c;
    const center = Math.atan2(b, a);
    const spread = Math.acos(MathUtils.clamp(goal / rho, -1, 1));
    const first = this.within(center + spread);
    const second = this.within(center - spread);
    if (first !== null && second !== null)
      return Math.abs(first) <= Math.abs(second) ? first : second;
    if (first !== null) return first;
    if (second !== null) return second;

    // No exact solution in range: take the reachable change whose distance is
    // closest (a cos Δ + b sin Δ is monotonic in the distance).
    const [low, high] = this.range;
    let best = low;
    let bestMiss = Infinity;
    for (const candidate of [
      low,
      high,
      this.within(center),
      this.within(center + Math.PI),
    ]) {
      if (candidate === null) continue;
      const miss = Math.abs(this.wave(candidate) - goal);
      if (
        miss < bestMiss - 1e-12 ||
        (Math.abs(miss - bestMiss) <= 1e-12 &&
          Math.abs(candidate) < Math.abs(best))
      ) {
        best = candidate;
        bestMiss = miss;
      }
    }
    return best;
  }

  /**
   * Turn `world` about the shoulder→target `axis` so the elbow keeps its
   * authored swivel: its direction about the authored shoulder→effector axis,
   * carried to the new axis by the smallest rotation between the two axes.
   * Measured that way, the swivel survives a correction unchanged to first
   * order whatever body reference it is read against.
   */
  private restoreSwivel(
    world: Quaternion,
    authored: Readonly<Quaternion>,
    authoredAxis: Vector3,
    axis: Vector3,
  ): void {
    const authoredElbow = this.authoredElbow
      .copy(this.elbow)
      .applyQuaternion(authored)
      .applyQuaternion(this.turn.setFromUnitVectors(authoredAxis, axis));
    authoredElbow.addScaledVector(axis, -authoredElbow.dot(axis));
    const solvedElbow = this.solvedElbow
      .copy(this.elbow)
      .applyQuaternion(world);
    solvedElbow.addScaledVector(axis, -solvedElbow.dot(axis));
    const fade = MathUtils.smoothstep(
      Math.min(authoredElbow.length(), solvedElbow.length()) /
        this.elbow.length(),
      SWIVEL_FADE[0],
      SWIVEL_FADE[1],
    );
    if (fade <= 0) return;
    const angle = Math.atan2(
      this.cross.crossVectors(solvedElbow, authoredElbow).dot(axis),
      solvedElbow.dot(authoredElbow),
    );
    world.premultiply(this.turn.setFromAxisAngle(axis, angle * fade));
  }
}

/** One solved contact at a moment of the clip. */
export type ArmContactSolve = ContactEffector &
  ContactTargetSpec & {
    /** Solve weight from `contactSolveWeight`. */
    weight: number;
  };

/** Mutual contacts alternate sides until a target moves less than this (m)… */
const MUTUAL_TOLERANCE = 5e-4;
/** …or this many solves have run. */
const MUTUAL_SOLVES = 8;
const solveTarget = new Vector3();
const solveResult: ArmReachResult = {
  upperArm: new Quaternion(),
  lowerArm: new Quaternion(),
  error: 0,
};
const solveScratch = {
  left: {
    upperArm: new Quaternion(),
    lowerArm: new Quaternion(),
    target: new Vector3(),
  },
  right: {
    upperArm: new Quaternion(),
    lowerArm: new Quaternion(),
    target: new Vector3(),
  },
};

/**
 * Solve the active contacts (weight > 0, at most one per side; the strongest
 * wins) on `pose`, writing the solved upper-arm and lower-arm rotations into it.
 *
 * When one side's target rides on the other side's arm and that side is also
 * solving, the other side goes first. Mutual contacts (crossed arms, each
 * hand on the other upper arm or forearm) alternate A, B, A, … until the side
 * due next has a target that moved less than half a millimetre since it was
 * solved (usually after A, B, A). Each solve starts again from that side's
 * authored arm, so a partial weight pins toward the target once rather than
 * compounding. Clips never solve a mutual pair where either target is on the
 * other hand or its fingers (schema validation): each hand would chase the
 * other and the solve diverges. Contacts whose bones the rig lacks, or whose
 * side has no solver, are skipped. Returns each solved side's distance from its last pinned target
 * (non-zero beyond or near full reach).
 */
export function solveArmContacts(
  pose: SkeletonPose,
  solvers: Partial<Record<Side, ArmReachSolver>>,
  contacts: readonly ArmContactSolve[],
  scale: number,
): Partial<Record<Side, number>> {
  let left: ArmContactSolve | undefined;
  let right: ArmContactSolve | undefined;
  for (const contact of contacts) {
    if (!(contact.weight > 0)) continue;
    const side = HAND_OR_FINGER_BONE.exec(contact.bone)?.[1] as
      | Side
      | undefined;
    if (!side)
      throw new Error(
        `A solved contact needs a hand or finger bone, not ${contact.bone}.`,
      );
    if (side === "left" && (!left || contact.weight > left.weight))
      left = contact;
    if (side === "right" && (!right || contact.weight > right.weight))
      right = contact;
  }
  if (!solvers.left || (left && !pose.skeleton.has(left.bone)))
    left = undefined;
  if (!solvers.right || (right && !pose.skeleton.has(right.bone)))
    right = undefined;

  const errors: Partial<Record<Side, number>> = {};
  const solve = (side: Side, contact: ArmContactSolve): boolean => {
    const scratch = solveScratch[side];
    const target = contactTargetPosition(pose, contact, scale, solveTarget);
    if (!target) return false;
    if (side in errors) {
      // Not converged: re-solve from the authored arm toward the moved target.
      if (target.distanceTo(scratch.target) < MUTUAL_TOLERANCE) return false;
      pose.setLocalRotation(`${side}UpperArm`, scratch.upperArm);
      pose.setLocalRotation(`${side}LowerArm`, scratch.lowerArm);
    } else {
      scratch.upperArm.copy(pose.localRotation(`${side}UpperArm`)!);
      scratch.lowerArm.copy(pose.localRotation(`${side}LowerArm`)!);
    }
    scratch.target.copy(target);
    const result = solvers[side]!.solve(
      pose,
      contact,
      target,
      contact.weight,
      solveResult,
    );
    pose.setLocalRotation(`${side}UpperArm`, result.upperArm);
    pose.setLocalRotation(`${side}LowerArm`, result.lowerArm);
    errors[side] = result.error;
    return true;
  };

  if (left && right) {
    const leftFollows = solvers.right!.moves(left.target);
    const rightFollows = solvers.left!.moves(right.target);
    const order: [Side, ArmContactSolve][] =
      leftFollows && !rightFollows
        ? [
            ["right", right],
            ["left", left],
          ]
        : [
            ["left", left],
            ["right", right],
          ];
    solve(...order[0]);
    solve(...order[1]);
    if (leftFollows && rightFollows)
      for (let count = 2; count < MUTUAL_SOLVES; count += 1)
        if (!solve(...order[count % 2])) break;
  } else if (left) solve("left", left);
  else if (right) solve("right", right);
  return errors;
}
