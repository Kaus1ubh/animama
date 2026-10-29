import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { MathUtils, Quaternion, Vector3 } from "three";

import { headSized, measureAvatarProportions } from "../../avatarProportions";
import { cloneVRMPose } from "../animaPose";
import {
  JOINT_DEFINITIONS,
  composeJointRotation,
  decomposeJointRotation,
  resolveJoint,
  type ResolvedJoint,
  type Side,
} from "../anatomy/anatomy";
import {
  ArmReachSolver,
  CanonicalSkeleton,
  SkeletonPose,
  avatarScale,
  contactSolveWeight,
  contactStandIn,
  fitContactSolveRamps,
  solveArmContacts,
  type ArmContactSolve,
  type ContactSolveWindow,
} from "../anatomy/arms";
import { ScalarTrack, type ResolvedKey } from "../anatomy/curves";
import { handShapeRotations } from "../anatomy/handPresets";
import { PlantedLegSolver } from "../anatomy/legs";
import {
  foldMissingTorsoRotations,
  torsoFoldsOf,
} from "../anatomy/optionalBones";
import { easeProgress } from "./interpolation";
import type {
  AnimaPoseClipPoseResolver,
  AnimaPoseClipSample,
  QuaternionTuple,
} from "./clipVocabulary";
import {
  ANIMA_POSE_CLIP_V2_CONTACT_SOLVE,
  type AnimaPoseClipEase,
  type AnimaPoseClipScalarKey,
  type AnimaPoseClipV2,
} from "./schemaV2";

/**
 * A 2.0 clip prepared for one Avatar: tracks resolved to absolute times,
 * `"base"` values read from the base pose, hand presets fitted to the Avatar
 * and the planted-leg and arm-contact solvers built from its rig. Sampling
 * then only evaluates curves and solves, so preparation runs once per clip
 * and Avatar, not per frame.
 */
export type PreparedAnimaPoseClipV2 = {
  readonly clip: AnimaPoseClipV2;
  readonly expressionNames: readonly string[];
  /** The canonical pose and expression weights at a playback time. */
  sample(timeSec: number): AnimaPoseClipSample;
};

export type PrepareAnimaPoseClipV2Options = {
  /**
   * The Avatar that plays the clip. It fits Hands-tool presets and plants
   * feet; without one, thumbs use unfitted presets and legs are not solved.
   */
  vrm?: VRM | null;
  /** Resolves the clip's base pose (the app catalog at runtime). */
  resolvePose?: AnimaPoseClipPoseResolver;
  /**
   * Move the arms so contacts with `solve` land on this Avatar (default true;
   * needs `vrm`). False samples the authored arms, as the motion checks
   * measure them before solving.
   */
  solveContacts?: boolean;
};

type Segment = { from: number; to: number; progress: number };
type Timed<T> = { t: number; ease: AnimaPoseClipEase; value: T };

export function prepareAnimaPoseClipV2(
  clip: AnimaPoseClipV2,
  options: PrepareAnimaPoseClipV2Options = {},
): PreparedAnimaPoseClipV2 {
  const vrm = options.vrm ?? null;
  const loopDuration = clip.loop ? clip.duration : null;
  const beatTimes = new Map(clip.beats.map((beat) => [beat.id, beat.time]));
  const beatEases = new Map(
    clip.beats.map((beat) => [beat.id, beat.ease] as const),
  );
  const basePose: VRMPose = clip.basePose
    ? (options.resolvePose?.(clip.basePose)?.humanoid ?? {})
    : {};
  const time = (key: { beat: string; dt?: number }) =>
    beatTimes.get(key.beat)! + (key.dt ?? 0);
  const ease = (
    key: { beat: string; ease?: AnimaPoseClipEase },
    fallback: AnimaPoseClipEase,
  ) => key.ease ?? beatEases.get(key.beat) ?? fallback;
  const scalarTrack = (keys: readonly AnimaPoseClipScalarKey[], base: number) =>
    new ScalarTrack(
      keys.map(
        (key): ResolvedKey => ({
          t: time(key),
          v: key.v === "base" ? base : key.v,
          tangent: key.tangent ?? "auto",
          ease: ease(key, "smooth"),
        }),
      ),
      loopDuration,
    );

  const joints = Object.entries(clip.joints ?? {}).map(([id, components]) => {
    const joint = resolveJoint(id)!;
    const baseRotation = basePose[joint.bones[0]]?.rotation;
    const baseValues = decomposeJointRotation(
      joint,
      baseRotation ? new Quaternion(...baseRotation) : new Quaternion(),
    );
    const tracks = Object.keys(JOINT_DEFINITIONS[joint.type].components).map(
      (name): [string, ScalarTrack | number] => {
        const keys = components[name];
        const base = baseValues[name] ?? 0;
        return [name, keys ? scalarTrack(keys, base) : base];
      },
    );
    return { joint, tracks };
  });

  const rotations = Object.entries(clip.rotations ?? {}).map(
    ([bone, keys]) => ({
      bone: bone as VRMHumanBoneName,
      keys: keys!.map(
        (key): Timed<Quaternion> => ({
          t: time(key),
          ease: ease(key, "easeInOutSine"),
          value: new Quaternion(...key.q).normalize(),
        }),
      ),
    }),
  );

  // Untracked axes hold the base pose's hips offset; "base" means it too.
  const baseHips = basePose.hips?.position ?? [0, 0, 0];
  const hipsPosition = (["x", "y", "z"] as const).map((axis, index) => {
    const keys = clip.hipsPosition?.[axis];
    return keys ? scalarTrack(keys, baseHips[index]) : null;
  });
  const hasHipsPosition = hipsPosition.some(Boolean);

  // Thumbs are fitted around the metacarpal as it is at each hand key: its
  // own track when the clip has one, otherwise the base pose.
  const metacarpalAt = (side: Side, t: number) => {
    const bone: VRMHumanBoneName = `${side}ThumbMetacarpal`;
    const track = rotations.find((rotation) => rotation.bone === bone);
    return track
      ? (sampleRotation(
          track.keys,
          t,
          loopDuration,
        ).toArray() as QuaternionTuple)
      : basePose[bone]?.rotation;
  };
  const hands = Object.entries(clip.hands ?? {}).map(([side, keys]) =>
    keys!.map(
      (key): Timed<Map<VRMHumanBoneName, Quaternion>> => ({
        t: time(key),
        ease: ease(key, "easeInOutSine"),
        value: handShapeRotations(
          vrm,
          side as Side,
          key,
          metacarpalAt(side as Side, time(key)),
        ),
      }),
    ),
  );

  const expressions = Object.entries(clip.expressions ?? {}).map(
    ([name, keys]) => [name, scalarTrack(keys, 0)] as const,
  );

  const legSolver = clip.plantFeet && vrm ? plantedLegSolver(vrm) : null;
  // A rig without an upper chest (or chest) bends with the bone below it.
  const torsoFolds = vrm ? torsoFoldsOf(vrm.humanoid) : [];
  const contactSolver =
    vrm && options.solveContacts !== false ? armContactSolver(clip, vrm) : null;
  const clipTime = (timeSec: number) => {
    const t = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
    return loopDuration
      ? ((t % loopDuration) + loopDuration) % loopDuration
      : Math.min(t, clip.duration);
  };

  return {
    clip,
    expressionNames: expressions.map(([name]) => name),
    sample(timeSec) {
      const t = clipTime(timeSec);
      let humanoid = cloneVRMPose(basePose);
      const set = (bone: VRMHumanBoneName, rotation: Quaternion) => {
        humanoid[bone] = {
          ...humanoid[bone],
          rotation: rotation.toArray() as QuaternionTuple,
        };
      };
      // Hand shapes first: explicitly tracked finger bones override them.
      for (const keys of hands)
        for (const [bone, rotation] of blendHandShapes(keys, t, loopDuration))
          set(bone, rotation);
      for (const { joint, tracks } of joints) setJoint(joint, tracks, t, set);
      for (const { bone, keys } of rotations)
        set(bone, sampleRotation(keys, t, loopDuration));
      const hipsOffset = new Vector3(
        ...hipsPosition.map(
          (track, index) => track?.evaluate(t) ?? baseHips[index],
        ),
      );
      if (hasHipsPosition)
        humanoid.hips = {
          ...humanoid.hips,
          position: hipsOffset.toArray() as [number, number, number],
        };
      if (legSolver) {
        const legs = legSolver.solve(
          new Quaternion(...(humanoid.hips?.rotation ?? [0, 0, 0, 1])),
          hipsOffset,
        );
        for (const [bone, rotation] of Object.entries(legs))
          set(bone as VRMHumanBoneName, rotation);
      }
      // `set` writes to the folded copy from here on.
      if (torsoFolds.length > 0)
        humanoid = foldMissingTorsoRotations(humanoid, torsoFolds);
      // Last, from the final pose (legs included): contacts land on it.
      contactSolver?.(humanoid, t, set);
      return {
        ...(Object.keys(humanoid).length > 0 ? { humanoid } : {}),
        ...(expressions.length > 0
          ? {
              expressions: Object.fromEntries(
                expressions.map(([name, track]) => [
                  name,
                  MathUtils.clamp(track.evaluate(t), 0, 1),
                ]),
              ),
            }
          : {}),
      };
    },
  };
}

const PLANTED_LEG_BONES: readonly VRMHumanBoneName[] = [
  "hips",
  "leftUpperLeg",
  "leftLowerLeg",
  "leftFoot",
  "rightUpperLeg",
  "rightLowerLeg",
  "rightFoot",
];

/**
 * The Avatar's leg solver, or null when its rig lacks leg bones: such a clip
 * plays without planted-leg solving rather than failing.
 */
function plantedLegSolver(vrm: VRM): PlantedLegSolver | null {
  return PLANTED_LEG_BONES.every((bone) =>
    vrm.humanoid.getNormalizedBoneNode(bone),
  )
    ? new PlantedLegSolver(vrm)
    : null;
}

const ARM_BONES = ["UpperArm", "LowerArm", "Hand"] as const;

/** A solved contact's window and ramps, with its index in `clip.contacts`. */
export type SolvedContactWindow = ContactSolveWindow & {
  index: number;
  side: Side;
};

/**
 * The windows of a clip's contacts that declare `solve`, in seconds of clip
 * time. Each runs from its beat's time plus `from` to plus `to`, with the
 * default blends where `solve` names none; ramps of consecutive windows on
 * one side are shortened to meet midway (`fitContactSolveRamps`), as
 * playback solves them.
 */
export function solvedContactWindows(
  clip: AnimaPoseClipV2,
): SolvedContactWindow[] {
  const beatTimes = new Map(clip.beats.map((beat) => [beat.id, beat.time]));
  const blend = ANIMA_POSE_CLIP_V2_CONTACT_SOLVE.defaultBlendSeconds;
  const windows = (clip.contacts ?? []).flatMap(
    (contact, index): SolvedContactWindow[] => {
      if (!contact.solve) return [];
      const beat = beatTimes.get(contact.beat)!;
      return [
        {
          index,
          side: contact.bone.startsWith("left") ? "left" : "right",
          start: beat + contact.from,
          end: beat + contact.to,
          blendIn: contact.solve.blendIn ?? blend,
          blendOut: contact.solve.blendOut ?? blend,
        },
      ];
    },
  );
  const loop = clip.loop === true;
  return (["left", "right"] as const).flatMap((side) =>
    fitContactSolveRamps(
      windows.filter((window) => window.side === side),
      clip.duration,
      loop,
    ),
  );
}

/**
 * Solves a clip's contacts that declare `solve` on one Avatar: at a clip time
 * it writes the upper and lower arm of each side with an active contact into
 * `humanoid`, over the windows from `solvedContactWindows`. Null when the clip
 * has no solved contact or the rig lacks the bones a solve needs (it then
 * plays its authored arms rather than failing). Offsets scale with the
 * Avatar's size (`avatarScale`); offsets from the head scale with a big
 * head's face size instead (`avatarProportions.ts`), so hands reach a chibi
 * Avatar's cheeks rather than stopping inside its head or at its chest.
 * Contacts on an upper chest or finger segment the rig lacks use the bone
 * that stands in for it (`contactStandIn`).
 */
function armContactSolver(
  clip: AnimaPoseClipV2,
  vrm: VRM,
):
  | ((
      humanoid: VRMPose,
      t: number,
      set: (bone: VRMHumanBoneName, rotation: Quaternion) => void,
    ) => void)
  | null {
  if (!(clip.contacts ?? []).some((contact) => contact.solve)) return null;
  const has = (bone: VRMHumanBoneName) =>
    Boolean(vrm.humanoid.getNormalizedBoneNode(bone));
  if (!has("hips") || !has("head") || !has("leftFoot")) return null;
  const skeleton = new CanonicalSkeleton(vrm);
  const solvers: Partial<Record<Side, ArmReachSolver>> = {};
  for (const side of ["left", "right"] as const)
    if (ARM_BONES.every((bone) => skeleton.has(`${side}${bone}`)))
      solvers[side] = new ArmReachSolver(skeleton, side);
  if (!solvers.left && !solvers.right) return null;
  const scale = avatarScale(skeleton);
  // Offsets from the head (cheeks, the face's front) follow a big head's face
  // size; `scale` then multiplies them back out (`contactTargetPosition`).
  const proportions = measureAvatarProportions(vrm);
  const headFactor =
    headSized(proportions, scale, proportions.headScale) / scale;
  const pose = new SkeletonPose(skeleton);

  const fitted = solvedContactWindows(clip)
    .filter((window) => solvers[window.side])
    .map((window) => {
      const contact = clip.contacts![window.index];
      // Bones the rig lacks: a stand-in when one exists (`contactStandIn`),
      // otherwise the contact keeps its bone and the solver skips it.
      const bone = contactStandIn(skeleton, contact.bone as VRMHumanBoneName);
      const target = contactStandIn(
        skeleton,
        contact.target as VRMHumanBoneName,
      );
      const offset =
        contact.offset && contact.target === "head" && headFactor !== 1
          ? ([
              contact.offset[0] * headFactor,
              contact.offset[1] * headFactor,
              contact.offset[2] * headFactor,
            ] as const)
          : contact.offset;
      // A missing upper chest's estimated joint on the chest, in authored
      // units (`scale` multiplies offsets back to this rig's size).
      const joint = target?.jointOffset;
      const solve: ArmContactSolve = {
        bone: bone?.bone ?? (contact.bone as VRMHumanBoneName),
        point: contact.point,
        target: target?.bone ?? (contact.target as VRMHumanBoneName),
        targetPoint: contact.targetPoint,
        offset: joint
          ? [
              (offset?.[0] ?? 0) + joint.x / scale,
              (offset?.[1] ?? 0) + joint.y / scale,
              (offset?.[2] ?? 0) + joint.z / scale,
            ]
          : offset,
        weight: 0,
      };
      // Reused every frame: only `weight` changes.
      return { ...window, contact: solve };
    });
  if (fitted.length === 0) return null;
  const loop = clip.loop === true;
  const active: ArmContactSolve[] = [];

  return (humanoid, t, set) => {
    active.length = 0;
    for (const span of fitted) {
      span.contact.weight = contactSolveWeight(span, t, clip.duration, loop);
      if (span.contact.weight > 0) active.push(span.contact);
    }
    if (active.length === 0) return;
    pose.setPose(humanoid);
    const solvedSides = solveArmContacts(pose, solvers, active, scale);
    for (const side of Object.keys(solvedSides) as Side[]) {
      set(`${side}UpperArm`, pose.localRotation(`${side}UpperArm`)!);
      set(`${side}LowerArm`, pose.localRotation(`${side}LowerArm`)!);
    }
  };
}

function setJoint(
  joint: ResolvedJoint,
  tracks: readonly [string, ScalarTrack | number][],
  t: number,
  set: (bone: VRMHumanBoneName, rotation: Quaternion) => void,
) {
  const values: Record<string, number> = {};
  for (const [name, track] of tracks)
    values[name] = typeof track === "number" ? track : track.evaluate(t);
  const rotation = composeJointRotation(joint, values);
  for (const bone of joint.bones) set(bone, rotation);
}

/**
 * The keys around `t`: holds before the first and after the last key, or wraps
 * across the seam of a loop.
 */
export function findSegment(
  keys: readonly { t: number }[],
  t: number,
  loopDuration: number | null,
): Segment {
  const last = keys.length - 1;
  if (last === 0) return { from: 0, to: 0, progress: 0 };
  if (loopDuration !== null && (t < keys[0].t || t >= keys[last].t)) {
    const span = keys[0].t + loopDuration - keys[last].t;
    const elapsed =
      t >= keys[last].t ? t - keys[last].t : t + loopDuration - keys[last].t;
    return { from: last, to: 0, progress: span > 0 ? elapsed / span : 1 };
  }
  if (t <= keys[0].t) return { from: 0, to: 0, progress: 0 };
  if (t >= keys[last].t) return { from: last, to: last, progress: 0 };
  let low = 0;
  let high = last - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (keys[middle].t <= t) low = middle;
    else high = middle - 1;
  }
  const span = keys[low + 1].t - keys[low].t;
  return {
    from: low,
    to: low + 1,
    progress: span > 0 ? (t - keys[low].t) / span : 1,
  };
}

/** A rotation track's value: slerp between keys, shaped by the arrival ease. */
function sampleRotation(
  keys: readonly Timed<Quaternion>[],
  t: number,
  loopDuration: number | null,
): Quaternion {
  const segment = findSegment(keys, t, loopDuration);
  const to = keys[segment.to];
  return keys[segment.from].value
    .clone()
    .slerp(to.value, easedProgress(segment.progress, to.ease));
}

/** Progress through a segment as its arrival ease shapes it. */
export function easedProgress(
  progress: number,
  ease: AnimaPoseClipEase,
): number {
  if (ease === "hold") return progress >= 1 ? 1 : 0;
  if (ease === "smooth") return easeProgress(progress, "easeInOutSine");
  return easeProgress(progress, ease);
}

function blendHandShapes(
  keys: readonly Timed<Map<VRMHumanBoneName, Quaternion>>[],
  t: number,
  loopDuration: number | null,
): Map<VRMHumanBoneName, Quaternion> {
  const segment = findSegment(keys, t, loopDuration);
  const from = keys[segment.from].value;
  const to = keys[segment.to].value;
  const progress = easedProgress(segment.progress, keys[segment.to].ease);
  const result = new Map<VRMHumanBoneName, Quaternion>();
  for (const [bone, rotation] of from) {
    const target = to.get(bone);
    result.set(
      bone,
      target ? rotation.clone().slerp(target, progress) : rotation.clone(),
    );
  }
  return result;
}
