import type {
  VRM,
  VRMHumanBoneName,
  VRMPose,
  VRMPoseTransform,
} from "@pixiv/three-vrm";
import { Quaternion, Vector3 } from "three";

import { RELAXED_REST_POSE_ID, getResolvedAvatarPose } from "../poses/catalog";
import {
  ANIMA_POSE_CLIP_DECIMALS,
  ANIMA_POSE_CLIP_SCHEMA,
  roundAnimaPoseClipNumber as round,
  type AnimaPoseClip,
  type AnimaPoseSnapshot,
} from "../poses/animaPoseClip";
import { actionClipId } from "@/ui/action-editor/actionDocument";
import {
  JOINT_DEFINITIONS,
  angularDistanceDegrees,
  composeJointRotation,
  decomposeJointRotation,
  resolveJoint,
  type ResolvedJoint,
} from "./anatomy";
import { ScalarTrack, type ResolvedKey } from "./curves";
import {
  DEFAULT_GENERATED_MUTED_LAYERS,
  type MotionDescription,
  type MotionKey,
  type MutableProceduralLayerId,
} from "./description";
import { handShapeRotations, sampleHandShapes } from "./hands";
import { applyCanonicalPose } from "./kinematics";
import { PlantedLegSolver } from "./legs";

/** Gesture clip with the optional live-layer mutes it declares. */
export type GeneratedGestureClip = AnimaPoseClip & {
  mutedProceduralLayers: MutableProceduralLayerId[];
};

export type BakeReport = {
  keyframes: number;
  /** Largest angle between baked slerp playback and the described curves. */
  maxBakeErrorDegrees: number;
  /** Largest hips-position distance between baked playback and the curves, metres. */
  maxBakePositionError: number;
  /** Whether both errors are within the stated bake tolerances. */
  withinTolerance: boolean;
  animatedBones: VRMHumanBoneName[];
  expressions: string[];
};

export type BakeResult = { clip: GeneratedGestureClip; report: BakeReport };

const DEFAULT_SAMPLE_RATE = 30;
/** Baked playback must stay this close to the described curves. */
export const BAKE_TOLERANCE_DEGREES = 1;
export const BAKE_TOLERANCE_METRES = 0.005;
/** Segments are subdivided toward the tolerance down to this spacing. */
const MIN_SAMPLE_SPACING = 1 / 120;
/** A step is baked as a hold ending this long before its key. */
const STEP_LEAD = 0.001;
const DEFAULT_FADE_IN = 0.3;
const DEFAULT_FADE_OUT = 0.4;

type JointTracks = {
  joint: ResolvedJoint;
  components: Record<string, ScalarTrack>;
};

export type MotionEvaluator = {
  humanoid: (time: number) => Map<VRMHumanBoneName, VRMPoseTransform>;
  expressions: (time: number) => Record<string, number>;
  bones: VRMHumanBoneName[];
  expressionNames: string[];
};

/**
 * Bake a validated description into an `animaPoseClip/1.0` Gesture sequence.
 *
 * `referenceVrm` must be the VRM 1 reference Avatar: it fits Hands-tool thumb
 * presets and solves planted legs. All stored values are canonical, so the
 * clip plays on any supported Avatar through the normal VRM 0 conversion.
 * The reference Avatar is left posed at the base pose.
 *
 * Samples start from a regular grid plus every key, then segments whose
 * slerped playback strays from the curves are subdivided. The report states
 * whether the result is within `BAKE_TOLERANCE_DEGREES`/`_METRES`.
 */
export function bakeMotion(
  description: MotionDescription,
  referenceVrm: VRM,
): BakeResult {
  const basePose = getResolvedAvatarPose(RELAXED_REST_POSE_ID).humanoid ?? {};
  applyCanonicalPose(referenceVrm, basePose);
  const evaluator = createMotionEvaluator(description, basePose, referenceVrm);
  const { times, sampled, error } = refineSamples(
    sampleTimes(description),
    evaluator,
  );

  const poses: Record<string, AnimaPoseSnapshot> = {};
  const poseKeyframes: AnimaPoseClip["poseKeyframes"] = [];
  times.forEach((time, index) => {
    const alias = `f${String(index).padStart(3, "0")}`;
    const humanoid: VRMPose = {};
    for (const [bone, transform] of sampled[index])
      humanoid[bone] = roundTransform(transform);
    const expressions = evaluator.expressions(time);
    poses[alias] = {
      ...(Object.keys(humanoid).length > 0 ? { humanoid } : {}),
      ...(evaluator.expressionNames.length > 0
        ? { expressions: roundWeights(expressions) }
        : {}),
    };
    poseKeyframes.push({
      time: round(time, ANIMA_POSE_CLIP_DECIMALS.time),
      pose: alias,
    });
  });

  const clip: GeneratedGestureClip = {
    schema: ANIMA_POSE_CLIP_SCHEMA,
    id: actionClipId(description.name, "gesture"),
    name: description.name,
    duration: description.duration,
    loop: description.kind === "loop",
    basePose: RELAXED_REST_POSE_ID,
    defaultTransition: {
      easing: "linear",
      interpolation: {
        humanoidRotation: "slerp",
        humanoidPosition: "linear",
        expression: "linear",
      },
    },
    fadeIn: { duration: description.fadeIn ?? DEFAULT_FADE_IN },
    fadeOut: { duration: description.fadeOut ?? DEFAULT_FADE_OUT },
    poses,
    poseKeyframes,
    mutedProceduralLayers: [
      ...(description.mutedProceduralLayers ?? DEFAULT_GENERATED_MUTED_LAYERS),
    ],
  };

  return {
    clip,
    report: {
      keyframes: times.length,
      maxBakeErrorDegrees: round(error.degrees, 3),
      maxBakePositionError: round(error.metres, 5),
      withinTolerance:
        error.degrees <= BAKE_TOLERANCE_DEGREES &&
        error.metres <= BAKE_TOLERANCE_METRES,
      animatedBones: evaluator.bones,
      expressions: evaluator.expressionNames,
    },
  };
}

/**
 * Evaluate a description's curves directly (before baking). `bakeMotion` uses
 * it; checks and tests use it to compare playback with the authored curves.
 */
export function createMotionEvaluator(
  description: MotionDescription,
  basePose: VRMPose,
  referenceVrm: VRM,
): MotionEvaluator {
  const loopDuration =
    description.kind === "loop" ? description.duration : null;
  const track = (keys: readonly MotionKey[], base: number) =>
    new ScalarTrack(
      keys.map(
        (key): ResolvedKey => ({
          t: key.t,
          v: key.v === "base" ? base : key.v,
          tangent: key.tangent ?? "auto",
          interp: key.interp ?? "smooth",
        }),
      ),
      loopDuration,
    );
  const constant = (value: number) => track([{ t: 0, v: value }], value);

  const joints: JointTracks[] = Object.entries(description.joints ?? {}).map(
    ([id, components]) => {
      const joint = resolveJoint(id)!;
      const baseRotation = basePose[joint.bones[0]]?.rotation;
      const baseValues = decomposeJointRotation(
        joint,
        baseRotation ? new Quaternion(...baseRotation) : new Quaternion(),
      );
      const definition = JOINT_DEFINITIONS[joint.type];
      return {
        joint,
        components: Object.fromEntries(
          Object.keys(definition.components).map((name) => {
            const keys = components[name];
            const base = baseValues[name] ?? 0;
            return [name, keys ? track(keys, base) : constant(base)];
          }),
        ),
      };
    },
  );

  const hipsPositionTracks = Object.entries(description.hipsPosition ?? {}).map(
    ([axis, keys]) => [axis as "x" | "y" | "z", track(keys!, 0)] as const,
  );
  const hipsJoint = joints.find(({ joint }) => joint.type === "hips");
  const solveLegs =
    description.plantFeet !== false &&
    (hipsJoint !== undefined || hipsPositionTracks.length > 0);
  const legSolver = solveLegs ? new PlantedLegSolver(referenceVrm) : null;

  const hands = Object.entries(description.hands ?? {}).map(([side, keys]) => {
    const handSide = side as "left" | "right";
    return {
      keys: keys!,
      shapes: keys!.map((key) =>
        handShapeRotations(referenceVrm, handSide, key),
      ),
    };
  });

  const expressionTracks = Object.entries(description.expressions ?? {}).map(
    ([name, keys]) => [name, track(keys, 0)] as const,
  );

  const humanoid = (time: number) => {
    const result = new Map<VRMHumanBoneName, VRMPoseTransform>();
    // Hand shapes first: explicitly keyed finger joints then override them.
    for (const hand of hands)
      for (const [bone, rotation] of sampleHandShapes(
        hand.keys,
        hand.shapes,
        time,
        loopDuration,
      ))
        result.set(bone, {
          rotation: rotation.toArray() as [number, number, number, number],
        });
    for (const { joint, components } of joints) {
      const values = Object.fromEntries(
        Object.entries(components).map(([name, curve]) => [
          name,
          curve.evaluate(time),
        ]),
      );
      const rotation = composeJointRotation(joint, values);
      for (const bone of joint.bones)
        result.set(bone, {
          rotation: rotation.toArray() as [number, number, number, number],
        });
    }
    const hipsOffset = new Vector3();
    for (const [axis, curve] of hipsPositionTracks)
      hipsOffset[axis] = curve.evaluate(time);
    if (hipsPositionTracks.length > 0) {
      const hips = result.get("hips") ?? {
        rotation: basePose.hips?.rotation ?? [0, 0, 0, 1],
      };
      result.set("hips", {
        ...hips,
        position: hipsOffset.toArray() as [number, number, number],
      });
    }
    if (legSolver) {
      const hipsRotation = new Quaternion(
        ...(result.get("hips")?.rotation ?? [0, 0, 0, 1]),
      );
      for (const [bone, rotation] of Object.entries(
        legSolver.solve(hipsRotation, hipsOffset),
      ))
        result.set(bone as VRMHumanBoneName, {
          rotation: rotation.toArray() as [number, number, number, number],
        });
    }
    return result;
  };

  const expressions = (time: number) =>
    Object.fromEntries(
      expressionTracks.map(([name, curve]) => [
        name,
        Math.min(1, Math.max(0, curve.evaluate(time))),
      ]),
    );

  const bones = [...humanoid(0).keys()].sort();
  return {
    humanoid,
    expressions,
    bones,
    expressionNames: expressionTracks.map(([name]) => name).sort(),
  };
}

/** A regular grid at the sample rate plus every authored key time. */
function sampleTimes(description: MotionDescription): number[] {
  const rate = description.sampleRate ?? DEFAULT_SAMPLE_RATE;
  const duration = description.duration;
  const times = new Set<number>();
  const count = Math.ceil(duration * rate - 1e-9);
  for (let index = 0; index <= count; index += 1)
    times.add(
      round(Math.min(index / rate, duration), ANIMA_POSE_CLIP_DECIMALS.time),
    );
  const addKeys = (
    keys: readonly { t: number; interp?: string }[] | undefined,
  ) =>
    keys?.forEach((key, index) => {
      times.add(round(key.t, ANIMA_POSE_CLIP_DECIMALS.time));
      // Hold a step's value until just before the next key.
      const next = keys[index + 1];
      if (key.interp === "step" && next)
        times.add(round(next.t - STEP_LEAD, ANIMA_POSE_CLIP_DECIMALS.time));
    });
  for (const components of Object.values(description.joints ?? {}))
    Object.values(components).forEach(addKeys);
  Object.values(description.hipsPosition ?? {}).forEach(addKeys);
  Object.values(description.hands ?? {}).forEach(addKeys);
  Object.values(description.expressions ?? {}).forEach(addKeys);
  const sorted = [...times].sort((a, b) => a - b);
  // Drop near-duplicates that would form zero-length segments.
  return sorted.filter(
    (time, index) => index === 0 || time - sorted[index - 1] > 5e-4,
  );
}

type Sample = Map<VRMHumanBoneName, VRMPoseTransform>;
type BakeError = { degrees: number; metres: number };

/**
 * Subdivide segments whose midpoint playback (slerp/lerp, as the runtime
 * plays linear keyframes) strays beyond tolerance, then report the largest
 * remaining error. Step leads shorter than the minimum spacing are skipped.
 */
function refineSamples(
  initial: readonly number[],
  evaluator: MotionEvaluator,
): { times: number[]; sampled: Sample[]; error: BakeError } {
  const times = [...initial];
  const sampled = times.map((time) => evaluator.humanoid(time));
  let error: BakeError = { degrees: 0, metres: 0 };
  for (let pass = 0; pass < 5; pass += 1) {
    error = { degrees: 0, metres: 0 };
    const inserts: number[] = [];
    for (let index = 0; index < times.length - 1; index += 1) {
      const span = times[index + 1] - times[index];
      if (span <= STEP_LEAD * 2) continue;
      const middle = times[index] + span / 2;
      const segment = segmentError(
        sampled[index],
        sampled[index + 1],
        evaluator.humanoid(middle),
      );
      const exceeds =
        segment.degrees > BAKE_TOLERANCE_DEGREES ||
        segment.metres > BAKE_TOLERANCE_METRES;
      if (exceeds && span / 2 >= MIN_SAMPLE_SPACING) inserts.push(index);
      error = {
        degrees: Math.max(error.degrees, segment.degrees),
        metres: Math.max(error.metres, segment.metres),
      };
    }
    if (inserts.length === 0) break;
    for (const index of inserts.reverse()) {
      const middle = round(
        (times[index] + times[index + 1]) / 2,
        ANIMA_POSE_CLIP_DECIMALS.time,
      );
      times.splice(index + 1, 0, middle);
      sampled.splice(index + 1, 0, evaluator.humanoid(middle));
    }
  }
  return { times, sampled, error };
}

function segmentError(from: Sample, to: Sample, exact: Sample): BakeError {
  let degrees = 0;
  let metres = 0;
  for (const [bone, transform] of exact) {
    const a = from.get(bone);
    const b = to.get(bone);
    if (transform.rotation && a?.rotation && b?.rotation) {
      const baked = new Quaternion(...a.rotation).slerp(
        new Quaternion(...b.rotation),
        0.5,
      );
      degrees = Math.max(
        degrees,
        angularDistanceDegrees(baked, new Quaternion(...transform.rotation)),
      );
    }
    if (transform.position && a?.position && b?.position) {
      const baked = new Vector3(...a.position).lerp(
        new Vector3(...b.position),
        0.5,
      );
      metres = Math.max(
        metres,
        baked.distanceTo(new Vector3(...transform.position)),
      );
    }
  }
  return { degrees, metres };
}

function roundTransform(transform: VRMPoseTransform): VRMPoseTransform {
  const rotation = transform.rotation
    ? (normalizeTuple(transform.rotation).map((n) =>
        round(n, ANIMA_POSE_CLIP_DECIMALS.transform),
      ) as [number, number, number, number])
    : undefined;
  const position = transform.position?.map((n) =>
    round(n, ANIMA_POSE_CLIP_DECIMALS.transform),
  ) as [number, number, number] | undefined;
  return {
    ...(rotation ? { rotation } : {}),
    ...(position ? { position } : {}),
  };
}

function normalizeTuple(
  rotation: readonly number[],
): [number, number, number, number] {
  const q = new Quaternion(
    ...(rotation as [number, number, number, number]),
  ).normalize();
  // Keep a consistent hemisphere so serialized values are deterministic.
  return (q.w < 0 ? [-q.x, -q.y, -q.z, -q.w] : [q.x, q.y, q.z, q.w]) as [
    number,
    number,
    number,
    number,
  ];
}

function roundWeights(weights: Record<string, number>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(weights).map(([name, value]) => [
      name,
      round(value, ANIMA_POSE_CLIP_DECIMALS.expressionWeight),
    ]),
  );
}
