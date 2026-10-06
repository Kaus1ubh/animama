import type { VRM, VRMHumanBoneName, VRMPose } from "@pixiv/three-vrm";
import { MathUtils, Quaternion, Vector3 } from "three";

import { cloneVRMPose } from "../animaPose";
import {
  JOINT_DEFINITIONS,
  composeJointRotation,
  decomposeJointRotation,
  resolveJoint,
  type ResolvedJoint,
  type Side,
} from "../anatomy/anatomy";
import { ScalarTrack, type ResolvedKey } from "../anatomy/curves";
import { handShapeRotations } from "../anatomy/handPresets";
import { PlantedLegSolver } from "../anatomy/legs";
import { easeProgress } from "./interpolation";
import type {
  AnimaPoseClipPoseResolver,
  AnimaPoseClipSample,
  QuaternionTuple,
} from "./schema";
import {
  type AnimaPoseClipEase,
  type AnimaPoseClipScalarKey,
  type AnimaPoseClipV2,
} from "./schemaV2";

/**
 * A 2.0 clip prepared for one Avatar: tracks resolved to absolute times,
 * `"base"` values read from the base pose, hand presets fitted to the Avatar
 * and the planted-leg solver built from its rig. Sampling then only evaluates
 * curves, so preparation runs once per clip and Avatar, not per frame.
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
      const humanoid = cloneVRMPose(basePose);
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
